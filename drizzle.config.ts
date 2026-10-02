import 'dotenv/config'
import { defineConfig } from 'drizzle-kit'

const url = process.env.DATABASE_URL ?? 'pglite:.data/pglite'
const isPglite = url.startsWith('pglite:')

export default defineConfig({
  schema: './server/src/db/schema.ts',
  out: './server/drizzle',
  dialect: 'postgresql',
  strict: true,
  verbose: true,
  ...(isPglite
    ? { driver: 'pglite' as const, dbCredentials: { url: url.slice('pglite:'.length) || '.data/pglite' } }
    : { dbCredentials: { url } }),
})
