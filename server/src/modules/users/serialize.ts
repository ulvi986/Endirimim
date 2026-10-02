import type { User } from '../../db/schema.js'

export type PublicUser = Omit<User, 'passwordHash' | 'emailVerifiedAt'> & { hasPassword: boolean }

/**
 * The only way a user row leaves the API. Stripping the hash here (rather than
 * at each call site) means a new endpoint cannot accidentally expose it.
 */
export function toPublicUser(user: User): PublicUser {
  const { passwordHash, emailVerifiedAt: _emailVerifiedAt, ...rest } = user
  return { ...rest, hasPassword: Boolean(passwordHash) }
}
