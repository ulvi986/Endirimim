import 'dotenv/config'
import { z } from 'zod'

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  HOST: z.string().default('0.0.0.0'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  DATABASE_POOL_MAX: z.coerce.number().int().positive().default(10),
  DATABASE_SSL: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),

  // Must be a long random string. Access tokens are HS256-signed with it.
  AUTH_SECRET: z.string().min(32, 'AUTH_SECRET must be at least 32 characters'),
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(900), // 15 minutes
  REFRESH_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(2_592_000), // 30 days
  PASSWORD_RESET_TTL_SECONDS: z.coerce.number().int().positive().default(3600),
  // A rotated refresh token presented again within this window is treated as a
  // benign race (two tabs refreshing at once), not as theft. 0 disables it.
  REFRESH_REUSE_GRACE_SECONDS: z.coerce.number().int().min(0).max(60).default(10),
  // "none" is required when the web app and the API live on different sites;
  // it forces the Secure flag, so it only works over HTTPS.
  COOKIE_SAME_SITE: z.enum(['lax', 'strict', 'none']).default('lax'),

  APP_URL: z.string().default('http://localhost:5173'),
  CORS_ORIGINS: z.string().default('http://localhost:5173'),
  TRUST_PROXY: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),

  STORAGE_DRIVER: z.enum(['local', 'vercel-blob']).default('local'),
  STORAGE_LOCAL_DIR: z.string().default('server/uploads'),
  STORAGE_PUBLIC_URL: z.string().optional(),
  BLOB_READ_WRITE_TOKEN: z.string().optional(),
  // Vercel rejects request bodies over 4.5 MB before they reach the function.
  MAX_UPLOAD_BYTES: z.coerce.number().int().positive().max(4_400_000).default(4 * 1024 * 1024),

  // Transactional email via Resend. Leave blank to use the console transport.
  RESEND_API_KEY: z.string().optional(),
  MAIL_FROM: z.string().optional(),

})

const parsed = envSchema.safeParse(process.env)

if (!parsed.success) {
  const issues = parsed.error.issues.map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`).join('\n')
  throw new Error(`Invalid environment configuration:\n${issues}\n\nCopy .env.example to .env and fill it in.`)
}

const raw = parsed.data

// Vercel sets VERCEL=1 in every build and function. Serverless instances have no
// persistent disk and no long-lived process, so the two local-only backends
// would silently lose data there. Refuse to start instead.
const onVercel = process.env.VERCEL === '1'
const deploymentProblems = [
  onVercel && raw.DATABASE_URL.startsWith('pglite:') && 'DATABASE_URL must point at a real Postgres (e.g. Neon), not pglite.',
  onVercel && raw.STORAGE_DRIVER === 'local' && 'STORAGE_DRIVER must be "vercel-blob"; the function filesystem is not persistent.',
  raw.NODE_ENV === 'production' && raw.APP_URL.includes('localhost') && 'APP_URL must be the public site URL in production.',
].filter(Boolean)
if (deploymentProblems.length > 0) {
  throw new Error(`Invalid production configuration:\n${deploymentProblems.map((problem) => `  - ${problem}`).join('\n')}`)
}

export const env = {
  ...raw,
  isProduction: raw.NODE_ENV === 'production',
  onVercel,
  STORAGE_PUBLIC_URL: raw.STORAGE_PUBLIC_URL || `http://localhost:${raw.PORT}/uploads`,
  STORAGE_PUBLIC_URL_EXPLICIT: Boolean(raw.STORAGE_PUBLIC_URL),
  cookie: {
    sameSite: ({ lax: 'Lax', strict: 'Strict', none: 'None' } as const)[raw.COOKIE_SAME_SITE],
    // Browsers reject SameSite=None without Secure.
    secure: raw.NODE_ENV === 'production' || raw.COOKIE_SAME_SITE === 'none',
  },
  corsOrigins: raw.CORS_ORIGINS.split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),
}

export type Env = typeof env
