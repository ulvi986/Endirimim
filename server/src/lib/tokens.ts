import { createHash, randomBytes } from 'node:crypto'
import jwt from 'jsonwebtoken'
import { env } from '../config/env.js'
import { unauthorized } from './errors.js'

export type AccountRole = 'user' | 'store' | 'admin'

export type AccessTokenClaims = {
  sub: string
  role: AccountRole
  /** Refresh-token row id, so an access token can be revoked with its session. */
  sid: string
}

const ISSUER = 'endirimim'
const AUDIENCE = 'endirimim-api'

export function signAccessToken(claims: AccessTokenClaims): string {
  return jwt.sign(claims, env.AUTH_SECRET, {
    algorithm: 'HS256',
    expiresIn: env.ACCESS_TOKEN_TTL_SECONDS,
    issuer: ISSUER,
    audience: AUDIENCE,
  })
}

export function verifyAccessToken(token: string): AccessTokenClaims {
  try {
    const payload = jwt.verify(token, env.AUTH_SECRET, {
      algorithms: ['HS256'],
      issuer: ISSUER,
      audience: AUDIENCE,
    }) as jwt.JwtPayload

    if (typeof payload.sub !== 'string' || typeof payload.sid !== 'string') throw new Error('malformed')
    const role = payload.role
    if (role !== 'user' && role !== 'store' && role !== 'admin') throw new Error('malformed')

    return { sub: payload.sub, role, sid: payload.sid }
  } catch {
    throw unauthorized('Etibarsız və ya vaxtı keçmiş token.')
  }
}

/** Refresh/reset tokens are opaque random strings, never JWTs. */
export function generateOpaqueToken(): { token: string; hash: string } {
  const token = randomBytes(48).toString('base64url')
  return { token, hash: hashToken(token) }
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export function addSeconds(seconds: number, from: Date = new Date()): Date {
  return new Date(from.getTime() + seconds * 1000)
}
