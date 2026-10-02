import { and, eq, isNull } from 'drizzle-orm'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { env } from '../../config/env.js'
import { db } from '../../db/client.js'
import { merchants, passwordResetTokens, refreshTokens, users, type User } from '../../db/schema.js'
import { badRequest, conflict, unauthorized, AppError } from '../../lib/errors.js'
import { serializeCookie, parseCookies } from '../../lib/cookies.js'
import { driverErrorCode } from '../../lib/db-errors.js'
import { hashPassword, verifyPassword } from '../../lib/password.js'
import { uniqueSlug } from '../../lib/slug.js'
import { addSeconds, generateOpaqueToken, hashToken } from '../../lib/tokens.js'
import { devLink, mailer, passwordResetEmail, passwordResetPath } from '../../mail/mailer.js'
import { requireAuth } from '../../plugins/auth.js'
import { toPublicUser as publicUser } from '../users/serialize.js'
import { issueSession, revokeAllSessions, revokeSession, rotateSession, type IssuedSession } from './service.js'

const REFRESH_COOKIE = 'endirimim_rt'
// Scoped to the auth routes so the refresh token is not attached to every call.
const REFRESH_COOKIE_OPTIONS = { path: '/api/v1/auth', httpOnly: true, secure: env.cookie.secure, sameSite: env.cookie.sameSite }

const emailField = z.email('Email ünvanı düzgün deyil.').max(320)
const passwordField = z.string().min(8, 'Şifrə ən azı 8 simvol olmalıdır.').max(200)

const registerBody = z.object({
  email: emailField,
  password: passwordField,
  accountType: z.enum(['user', 'store']).default('user'),
  firstName: z.string().trim().min(1).max(80).optional(),
  lastName: z.string().trim().min(1).max(80).optional(),
  storeName: z.string().trim().min(2).max(160).optional(),
  phone: z.string().trim().max(40).optional(),
  website: z.string().trim().max(300).optional(),
})

function sessionMeta(request: FastifyRequest) {
  return { userAgent: request.headers['user-agent'] ?? null, ipAddress: request.ip }
}

function applyRefreshCookie(reply: FastifyReply, session: IssuedSession): void {
  reply.header(
    'Set-Cookie',
    serializeCookie(REFRESH_COOKIE, session.refreshToken, {
      ...REFRESH_COOKIE_OPTIONS,
      maxAge: env.REFRESH_TOKEN_TTL_SECONDS,
    }),
  )
}

function clearRefreshCookie(reply: FastifyReply): void {
  reply.header('Set-Cookie', serializeCookie(REFRESH_COOKIE, '', { ...REFRESH_COOKIE_OPTIONS, maxAge: 0 }))
}

// Drizzle wraps the driver error, so the pg code lives on error.cause.
function isUniqueViolation(error: unknown): boolean {
  return driverErrorCode(error) === '23505'
}

/**
 * The refresh token is returned in the body (for non-browser clients) and also
 * set as an httpOnly cookie. The cookie path is `/api/v1/auth` so it is never
 * sent alongside normal API traffic.
 */
function sessionPayload(session: IssuedSession) {
  return {
    accessToken: session.accessToken,
    refreshToken: session.refreshToken,
    tokenType: 'Bearer' as const,
    expiresIn: session.accessTokenExpiresIn,
    refreshExpiresAt: session.refreshExpiresAt,
  }
}

export default async function authRoutes(app: FastifyInstance): Promise<void> {
  /* -------------------------------- register ------------------------------- */

  app.post('/register', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (request, reply) => {
    const body = registerBody.parse(request.body)
    const email = body.email.trim().toLowerCase()

    if (body.accountType === 'store' && !body.storeName) {
      throw badRequest('Mağaza adı tələb olunur.')
    }

    const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1)
    if (existing) throw conflict('Bu email ünvanı artıq qeydiyyatdadır.')

    const passwordHash = await hashPassword(body.password)

    try {
      const created = await db.transaction(async (tx) => {
        const [user] = await tx
          .insert(users)
          .values({
            email,
            passwordHash,
            authProvider: 'password',
            firstName: body.firstName ?? null,
            lastName: body.lastName ?? null,
            role: body.accountType === 'store' ? 'store' : 'user',
          })
          .returning()

        if (!user) throw new AppError(500, 'internal_error', 'İstifadəçi yaradıla bilmədi.')

        let merchant: typeof merchants.$inferSelect | null = null
        if (body.accountType === 'store') {
          const slug = await uniqueSlug(body.storeName!, async (candidate) => {
            const [taken] = await tx.select({ id: merchants.id }).from(merchants).where(eq(merchants.slug, candidate)).limit(1)
            return Boolean(taken)
          })
          const [record] = await tx
            .insert(merchants)
            .values({
              ownerUserId: user.id,
              name: body.storeName!,
              slug,
              phone: body.phone ?? null,
              website: body.website ?? null,
            })
            .returning()
          merchant = record ?? null
        }

        return { user: user as User, merchant }
      })

      const session = await issueSession({ id: created.user.id, role: created.user.role }, sessionMeta(request))
      applyRefreshCookie(reply, session)

      reply.status(201)
      return {
        user: publicUser(created.user),
        merchant: created.merchant,
        ...sessionPayload(session),
      }
    } catch (error) {
      // Two concurrent signups for the same address both pass the check above;
      // the unique index is the real guard.
      if (isUniqueViolation(error)) throw conflict('Bu email ünvanı artıq qeydiyyatdadır.')
      throw error
    }
  })

  /* --------------------------------- login --------------------------------- */

  app.post('/login', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (request, reply) => {
    const body = z.object({ email: emailField, password: z.string().min(1).max(200) }).parse(request.body)
    const email = body.email.trim().toLowerCase()

    const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1)

    // Always run a full hash comparison — including for legacy accounts that
    // have no password — so response timing does not reveal whether the account
    // exists or how it signs in.
    const storedHash = user?.passwordHash ?? (await getDummyHash())
    const passwordMatches = await verifyPassword(body.password, storedHash)

    if (!user?.passwordHash || !passwordMatches) throw unauthorized('Email və ya şifrə yanlışdır.')

    const session = await issueSession({ id: user.id, role: user.role }, sessionMeta(request))
    applyRefreshCookie(reply, session)

    return { user: publicUser(user), ...sessionPayload(session) }
  })

  /* -------------------------------- refresh -------------------------------- */

  app.post('/refresh', { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (request, reply) => {
    const body = z.object({ refreshToken: z.string().min(10).optional() }).parse(request.body ?? {})
    const cookieToken = parseCookies(request.headers.cookie)[REFRESH_COOKIE]
    const rawToken = body.refreshToken ?? cookieToken

    if (!rawToken) throw unauthorized('Yenilənmə tokeni tələb olunur.')

    try {
      const session = await rotateSession(rawToken, sessionMeta(request))
      applyRefreshCookie(reply, session)
      return sessionPayload(session)
    } catch (error) {
      // A rejected rotation must also clear the stale cookie, or the browser
      // keeps replaying a dead token on every page load.
      clearRefreshCookie(reply)
      throw error
    }
  })

  /* --------------------------------- logout -------------------------------- */

  app.post('/logout', async (request, reply) => {
    const body = z.object({ refreshToken: z.string().optional(), allDevices: z.boolean().default(false) }).parse(request.body ?? {})
    const cookieToken = parseCookies(request.headers.cookie)[REFRESH_COOKIE]
    const rawToken = body.refreshToken ?? cookieToken

    if (rawToken) {
      const [row] = await db
        .select({ id: refreshTokens.id, userId: refreshTokens.userId })
        .from(refreshTokens)
        .where(eq(refreshTokens.tokenHash, hashToken(rawToken)))
        .limit(1)

      if (row) {
        if (body.allDevices) await revokeAllSessions(row.userId)
        else await revokeSession(row.id)
      }
    } else if (request.headers.authorization) {
      // Bearer-only clients have no cookie, so revoke the token's own session.
      try {
        await app.authenticate(request, reply)
        if (request.auth) await revokeSession(request.auth.sessionId)
      } catch {
        // Logging out with an invalid or expired token is still a successful logout.
      }
    }

    clearRefreshCookie(reply)
    return { success: true }
  })

  /* ----------------------------------- me ---------------------------------- */

  app.get('/me', { preHandler: app.authenticate }, async (request) => {
    const auth = requireAuth(request)
    const [merchant] = auth.merchantId
      ? await db.select().from(merchants).where(eq(merchants.id, auth.merchantId)).limit(1)
      : []
    return { user: publicUser(auth.user), merchant: merchant ?? null }
  })

  /* ----------------------------- password reset ---------------------------- */

  app.post('/password/forgot', { config: { rateLimit: { max: 10, timeWindow: '15 minutes' } } }, async (request) => {
    const body = z.object({ email: emailField }).parse(request.body)
    const email = body.email.trim().toLowerCase()

    const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1)
    let resetPath: string | undefined

    if (user) {
      await db
        .update(passwordResetTokens)
        .set({ usedAt: new Date() })
        .where(and(eq(passwordResetTokens.userId, user.id), isNull(passwordResetTokens.usedAt)))

      const { token, hash } = generateOpaqueToken()
      await db.insert(passwordResetTokens).values({
        userId: user.id,
        tokenHash: hash,
        expiresAt: addSeconds(env.PASSWORD_RESET_TTL_SECONDS),
      })
      await mailer.send({ to: user.email, ...passwordResetEmail(token) })
      resetPath = passwordResetPath(token)
    }

    // Identical response either way: this endpoint must not confirm accounts.
    // (The dev-only link necessarily differs; it is never sent in production.)
    return { success: true, message: 'Əgər bu email qeydiyyatdadırsa, bərpa keçidi göndərildi.', devResetPath: resetPath ? devLink(resetPath) : undefined }
  })

  app.post('/password/reset', { config: { rateLimit: { max: 20, timeWindow: '15 minutes' } } }, async (request) => {
    const body = z.object({ token: z.string().min(10), password: passwordField }).parse(request.body)

    const [record] = await db
      .select()
      .from(passwordResetTokens)
      .where(eq(passwordResetTokens.tokenHash, hashToken(body.token)))
      .limit(1)

    if (!record || record.usedAt || record.expiresAt.getTime() <= Date.now()) {
      throw badRequest('Bərpa keçidi etibarsızdır və ya vaxtı bitib.')
    }

    const passwordHash = await hashPassword(body.password)

    await db.transaction(async (tx) => {
      await tx
        .update(users)
        .set({ passwordHash, authProvider: 'password', updatedAt: new Date() })
        .where(eq(users.id, record.userId))
      await tx.update(passwordResetTokens).set({ usedAt: new Date() }).where(eq(passwordResetTokens.id, record.id))
    })

    // Changing a password invalidates every existing session.
    const revoked = await revokeAllSessions(record.userId)
    return { success: true, sessionsRevoked: revoked }
  })

}

/* ------------------------------------------------------------------------- */

let dummyHash: string | null = null

/** Computed once, lazily, so a missing account costs the same as a real one. */
async function getDummyHash(): Promise<string> {
  dummyHash ??= await hashPassword('timing-equalisation-placeholder')
  return dummyHash
}
