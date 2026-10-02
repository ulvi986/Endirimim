import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'

/**
 * scrypt ships with Node, so there is no native addon to build (argon2/bcrypt
 * both need a toolchain). Parameters follow the current OWASP minimum:
 * N=2^15, r=8, p=1.
 */
const N = 32_768
const r = 8
const p = 1
const KEY_LENGTH = 64
const MAX_MEM = 128 * N * r * 2

const scrypt = promisify(scryptCallback) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>

const ALGORITHM = 'scrypt'

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16)
  const derived = await scrypt(password.normalize('NFKC'), salt, KEY_LENGTH, { N, r, p, maxmem: MAX_MEM })
  return [ALGORITHM, N, r, p, salt.toString('base64url'), derived.toString('base64url')].join('$')
}

export async function verifyPassword(password: string, storedHash: string | null): Promise<boolean> {
  if (!storedHash) return false

  const parts = storedHash.split('$')
  if (parts.length !== 6 || parts[0] !== ALGORITHM) return false

  const [, rawN, rawR, rawP, rawSalt, rawKey] = parts as [string, string, string, string, string, string]
  const cost = { N: Number(rawN), r: Number(rawR), p: Number(rawP) }
  if (!Number.isFinite(cost.N) || !Number.isFinite(cost.r) || !Number.isFinite(cost.p)) return false

  const salt = Buffer.from(rawSalt, 'base64url')
  const expected = Buffer.from(rawKey, 'base64url')

  try {
    const derived = await scrypt(password.normalize('NFKC'), salt, expected.length, { ...cost, maxmem: MAX_MEM })
    return derived.length === expected.length && timingSafeEqual(derived, expected)
  } catch {
    return false
  }
}
