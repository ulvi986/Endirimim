import { existsSync } from 'node:fs'
import path from 'node:path'
import { migrate as migrateNodePg } from 'drizzle-orm/node-postgres/migrator'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import { migrate as migratePglite } from 'drizzle-orm/pglite/migrator'
import type { PgliteDatabase } from 'drizzle-orm/pglite'
import { closePool, db, isPgliteUrl, pgliteDataDir } from './client.js'
import { env } from '../config/env.js'
import { explainDbError, parseDatabaseUrl } from '../lib/db-errors.js'
import type * as schema from './schema.js'

/**
 * Run with `npm run db:migrate`. Kept separate from index.ts so migrations are
 * an explicit deployment step, never a side effect of booting the API.
 */
async function main(): Promise<void> {
  const migrationsFolder = path.resolve(process.cwd(), 'server/drizzle')

  if (!existsSync(migrationsFolder)) {
    console.error(`\n[db] no migrations found at ${migrationsFolder}`)
    console.error('Create them with `npm run db:generate`.\n')
    process.exitCode = 1
    return
  }

  if (isPgliteUrl(env.DATABASE_URL)) {
    console.log(`[db] target: embedded pglite at ${pgliteDataDir(env.DATABASE_URL)}`)
    console.log(`[db] applying migrations from ${migrationsFolder}`)
    await migratePglite(db as unknown as PgliteDatabase<typeof schema>, { migrationsFolder })
  } else {
    const parsed = parseDatabaseUrl(env.DATABASE_URL)
    if (parsed.ok) {
      console.log(`[db] target: ${parsed.target.host}/${parsed.target.database} as "${parsed.target.username}"`)
    }
    console.log(`[db] applying migrations from ${migrationsFolder}`)
    await migrateNodePg(db as unknown as NodePgDatabase<typeof schema>, { migrationsFolder })
  }

  console.log('[db] migrations applied')
}

const target = isPgliteUrl(env.DATABASE_URL) ? undefined : parseDatabaseUrl(env.DATABASE_URL)

main()
  .catch((error) => {
    const hint = explainDbError(error, target?.ok ? target.target : undefined)
    if (hint) {
      console.error(`\n[db] ${hint}\n`)
    } else {
      console.error('\n[db] migration failed\n')
      console.error(error)
    }
    process.exitCode = 1
  })
  .finally(async () => {
    await closePool()
  })
