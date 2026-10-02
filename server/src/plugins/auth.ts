import { eq } from 'drizzle-orm'
import type { FastifyReply, FastifyRequest } from 'fastify'
import fp from 'fastify-plugin'
import { db } from '../db/client.js'
import { merchants, refreshTokens, users, type User } from '../db/schema.js'
import { forbidden, unauthorized } from '../lib/errors.js'
import { verifyAccessToken, type AccountRole } from '../lib/tokens.js'
import { sessionAllowsAccess } from '../modules/auth/service.js'

export type AuthContext = {
  user: User
  /** refresh_tokens row id — revoking it revokes every access token derived from it. */
  sessionId: string
  role: AccountRole
  merchantId: string | null
}

declare module 'fastify' {
  interface FastifyRequest {
    auth?: AuthContext
  }
  interface FastifyInstance {
    /** Populates request.auth or throws 401. */
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>
    /** Populates request.auth, additionally resolving the caller's merchant. */
    requireStore: (request: FastifyRequest, reply: FastifyReply) => Promise<void>
    /**
     * For writes on existing merchant content (edit/delete an offer, campaign or
     * product image). Admins moderate other merchants' content and usually own no
     * store, so they pass without a merchant; everyone else needs their own merchant.
     * Handlers must not assume `merchantId` is set.
     */
    requireStoreOrAdmin: (request: FastifyRequest, reply: FastifyReply) => Promise<void>
    requireRole: (roles: AccountRole[]) => (request: FastifyRequest, reply: FastifyReply) => Promise<void>
  }
}

async function resolveAuth(request: FastifyRequest): Promise<AuthContext> {
  const header = request.headers.authorization
  if (!header?.startsWith('Bearer ')) throw unauthorized('Authorization: Bearer başlığı tələb olunur.')

  const token = header.slice('Bearer '.length).trim()
  if (!token) throw unauthorized()

  const claims = verifyAccessToken(token)

  // Signature alone is not enough: a logged-out session must stop working
  // immediately, so every request checks the session row.
  const [session] = await db.select().from(refreshTokens).where(eq(refreshTokens.id, claims.sid)).limit(1)
  if (!session || session.userId !== claims.sub) throw unauthorized('Sessiya tapılmadı.')
  // A rotated refresh token keeps its access tokens alive until they expire, since
  // every tab shares one refresh cookie; only hard revocation (logout, password
  // change, reuse detection) or expiry ends them. See modules/auth/service.ts.
  if (!sessionAllowsAccess(session)) throw unauthorized('Sessiya bağlanıb.')

  const [user] = await db.select().from(users).where(eq(users.id, claims.sub)).limit(1)
  if (!user) throw unauthorized('İstifadəçi tapılmadı.')

  const context: AuthContext = { user, sessionId: session.id, role: user.role, merchantId: null }

  if (user.role === 'store' || user.role === 'admin') {
    const [merchant] = await db
      .select({ id: merchants.id })
      .from(merchants)
      .where(eq(merchants.ownerUserId, user.id))
      .limit(1)
    context.merchantId = merchant?.id ?? null
  }

  return context
}

export default fp(
  async (app) => {
    app.decorateRequest('auth', undefined)

    app.decorate('authenticate', async (request: FastifyRequest) => {
      request.auth = await resolveAuth(request)
    })

    app.decorate('requireStore', async (request: FastifyRequest) => {
      request.auth = await resolveAuth(request)
      if (!request.auth.merchantId) {
        throw forbidden('Bu əməliyyat üçün mağaza hesabı tələb olunur.')
      }
    })

    app.decorate('requireStoreOrAdmin', async (request: FastifyRequest) => {
      request.auth = await resolveAuth(request)
      if (request.auth.role !== 'admin' && !request.auth.merchantId) {
        throw forbidden('Bu əməliyyat üçün mağaza hesabı tələb olunur.')
      }
    })

    app.decorate('requireRole', (roles: AccountRole[]) => async (request: FastifyRequest) => {
      request.auth = await resolveAuth(request)
      if (!roles.includes(request.auth.role)) throw forbidden()
    })
  },
  { name: 'auth' },
)

/**
 * Narrows request.auth for handlers. Throws rather than asserting, so a route
 * that forgets its preHandler fails loudly instead of dereferencing undefined.
 */
export function requireAuth(request: FastifyRequest): AuthContext {
  if (!request.auth) throw unauthorized()
  return request.auth
}
