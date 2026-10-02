import { randomUUID } from 'node:crypto'
import { and, eq, isNotNull, isNull, lt, or, sql } from 'drizzle-orm'
import { db, type Executor } from '../../db/client.js'
import { refreshTokens, users } from '../../db/schema.js'
import { env } from '../../config/env.js'
import { unauthorized } from '../../lib/errors.js'
import { addSeconds, generateOpaqueToken, hashToken, signAccessToken, type AccountRole } from '../../lib/tokens.js'

export type SessionMeta = { userAgent?: string | null; ipAddress?: string | null }

export type IssuedSession = {
  accessToken: string
  refreshToken: string
  sessionId: string
  refreshExpiresAt: Date
  accessTokenExpiresIn: number
}

export async function issueSession(
  user: { id: string; role: AccountRole },
  meta: SessionMeta = {},
  executor: Executor = db,
  /** Continues an existing sign-in; omitted for a fresh sign-in (new family). */
  familyId: string = randomUUID(),
): Promise<IssuedSession> {
  const { token, hash } = generateOpaqueToken()
  const refreshExpiresAt = addSeconds(env.REFRESH_TOKEN_TTL_SECONDS)

  const [session] = await executor
    .insert(refreshTokens)
    .values({
      userId: user.id,
      familyId,
      tokenHash: hash,
      expiresAt: refreshExpiresAt,
      userAgent: meta.userAgent ?? null,
      ipAddress: meta.ipAddress ?? null,
    })
    .returning({ id: refreshTokens.id })

  if (!session) throw new Error('Failed to persist session')

  return {
    accessToken: signAccessToken({ sub: user.id, role: user.role, sid: session.id }),
    refreshToken: token,
    sessionId: session.id,
    refreshExpiresAt,
    accessTokenExpiresIn: env.ACCESS_TOKEN_TTL_SECONDS,
  }
}

/**
 * Refresh-token rotation with reuse detection.
 *
 * A refresh token is single-use: consuming it mints a new one and marks the old
 * row revoked. If an already-revoked token is presented, the token was stolen or
 * replayed, so every session for that user is revoked rather than just failing.
 */
export async function rotateSession(rawToken: string, meta: SessionMeta = {}): Promise<IssuedSession> {
  const tokenHash = hashToken(rawToken)
  let reusedByUserId: string | null = null

  const issued = await db.transaction(async (tx) => {
    // FOR UPDATE serialises concurrent refreshes of the same token, so two
    // parallel requests cannot both mint a successor from one token.
    const [session] = await tx
      .select()
      .from(refreshTokens)
      .where(eq(refreshTokens.tokenHash, tokenHash))
      .limit(1)
      .for('update')
    if (!session) throw unauthorized('Etibarsız yenilənmə tokeni.')

    if (session.expiresAt.getTime() <= Date.now()) throw unauthorized('Yenilənmə tokeninin vaxtı bitib.')

    if (session.revokedAt) {
      // Two tabs refreshing with the same token is a race, not theft: the loser
      // arrives moments after rotation. Inside the grace window it gets its own
      // new session instead of logging the user out everywhere. Only rotated
      // tokens qualify — a logged-out token (no successor) never does.
      let rotatedRecently =
        session.replacedByTokenHash !== null &&
        Date.now() - session.revokedAt.getTime() <= env.REFRESH_REUSE_GRACE_SECONDS * 1000
      if (rotatedRecently) {
        // The successor must still be alive (or itself rotated onward). If it was
        // logged out or revoked wholesale, the grace window must not resurrect it.
        const [successor] = await tx
          .select({ revokedAt: refreshTokens.revokedAt, replacedByTokenHash: refreshTokens.replacedByTokenHash })
          .from(refreshTokens)
          .where(eq(refreshTokens.tokenHash, session.replacedByTokenHash!))
          .limit(1)
        rotatedRecently = Boolean(successor && (!successor.revokedAt || successor.replacedByTokenHash))
      }
      if (!rotatedRecently) {
        // Revoking here would be rolled back by the throw below, so the
        // revocation runs after the transaction instead.
        reusedByUserId = session.userId
        return null
      }
    }

    const [user] = await tx
      .select({ id: users.id, role: users.role })
      .from(users)
      .where(eq(users.id, session.userId))
      .limit(1)
    if (!user) throw unauthorized('İstifadəçi tapılmadı.')

    const issued = await issueSession(user, { ...meta, userAgent: meta.userAgent ?? session.userAgent }, tx, session.familyId ?? session.id)

    // A grace-window reissue keeps the original revocation time, so the window
    // cannot be extended by replaying the token repeatedly.
    if (!session.revokedAt) {
      await tx
        .update(refreshTokens)
        .set({ revokedAt: new Date(), replacedByTokenHash: hashToken(issued.refreshToken) })
        .where(eq(refreshTokens.id, session.id))
    }

    return issued
  })

  if (reusedByUserId) {
    await revokeAllSessions(reusedByUserId)
    console.error('[auth] refresh token reuse detected; all sessions revoked', { userId: reusedByUserId })
    throw unauthorized('Təhlükəsizlik səbəbindən bütün sessiyalar bağlandı. Yenidən daxil olun.')
  }
  if (!issued) throw unauthorized('Etibarsız yenilənmə tokeni.')
  return issued
}

/*
 * Two kinds of "revoked" row:
 *
 * - Rotated: revokedAt + replacedByTokenHash. The refresh token is spent, but
 *   access tokens minted from it stay valid until their own short expiry. Every
 *   tab of a browser shares one refresh cookie, so if rotation killed access
 *   tokens, each tab's refresh would sign the other tabs out.
 * - Hard-revoked: revokedAt with no successor. Logout, password change and
 *   reuse detection produce this, and it kills access tokens immediately.
 */

/**
 * Signs out one sign-in: hard-revokes every session in its family — rotated
 * predecessors and the sibling sessions other tabs got in the grace window — so
 * no tab of that browser keeps a working access token. Other devices, which
 * signed in separately, are unaffected.
 */
export async function revokeSession(sessionId: string): Promise<void> {
  const [row] = await db.select({ id: refreshTokens.id, familyId: refreshTokens.familyId }).from(refreshTokens).where(eq(refreshTokens.id, sessionId)).limit(1)
  if (!row) return
  const family = row.familyId ?? row.id
  await db
    .update(refreshTokens)
    .set({ revokedAt: sql`coalesce(${refreshTokens.revokedAt}, ${new Date().toISOString()}::timestamptz)`, replacedByTokenHash: null })
    .where(or(eq(refreshTokens.familyId, family), eq(refreshTokens.id, family)))
}

/** Hard-revokes every session of a user, including rotated ones. */
export async function revokeAllSessions(userId: string): Promise<number> {
  const now = new Date()
  const revoked = await db
    .update(refreshTokens)
    .set({ revokedAt: sql`coalesce(${refreshTokens.revokedAt}, ${now.toISOString()}::timestamptz)`, replacedByTokenHash: null })
    .where(and(eq(refreshTokens.userId, userId), or(isNull(refreshTokens.revokedAt), isNotNull(refreshTokens.replacedByTokenHash))))
    .returning({ id: refreshTokens.id })
  return revoked.length
}

/** A session row still backs access tokens unless it was hard-revoked or expired. */
export function sessionAllowsAccess(session: { revokedAt: Date | null; replacedByTokenHash: string | null; expiresAt: Date }): boolean {
  if (session.expiresAt.getTime() <= Date.now()) return false
  return !session.revokedAt || session.replacedByTokenHash !== null
}

/** Housekeeping for expired rows; safe to run periodically. */
export async function purgeExpiredSessions(): Promise<number> {
  const deleted = await db.delete(refreshTokens).where(lt(refreshTokens.expiresAt, new Date())).returning({ id: refreshTokens.id })
  return deleted.length
}
