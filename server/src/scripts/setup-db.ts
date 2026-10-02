import pg from 'pg'
import { env } from '../config/env.js'
import {
  explainDbError,
  PG_ERROR_CODES,
  parseDatabaseUrl,
  driverErrorCode,
  type DatabaseTarget,
} from '../lib/db-errors.js'

const { Client } = pg

/**
 * Creates the database named in DATABASE_URL if it does not exist yet.
 *
 * Run with `npm run db:setup`, then `npm run db:migrate`.
 *
 * This connects to the cluster's `postgres` maintenance database using the same
 * credentials as the app, so a single correct DATABASE_URL is all that is
 * needed — no separate psql invocation and no superuser tooling on PATH.
 */
async function connect(url: string): Promise<pg.Client> {
  const client = new Client({
    connectionString: url,
    ssl: env.DATABASE_SSL ? { rejectUnauthorized: false } : undefined,
    connectionTimeoutMillis: 10_000,
  })
  await client.connect()
  return client
}

/** `postgres` may be absent on trimmed clusters; `template1` always exists. */
async function connectToMaintenance(target: DatabaseTarget): Promise<pg.Client> {
  try {
    return await connect(target.maintenanceUrl)
  } catch (error) {
    if (driverErrorCode(error) !== PG_ERROR_CODES.invalidCatalog) throw error
    const template1 = new URL(target.maintenanceUrl)
    template1.pathname = '/template1'
    return await connect(template1.toString())
  }
}

async function main(): Promise<void> {
  // The embedded database creates its data directory on first use.
  if (env.DATABASE_URL.startsWith('pglite:')) {
    console.log('[db:setup] DATABASE_URL uses embedded pglite — nothing to create')
    console.log('\n[db:setup] next:  npm run db:migrate\n')
    return
  }

  const parsed = parseDatabaseUrl(env.DATABASE_URL)
  if (!parsed.ok) {
    console.error(`\n[db:setup] ${parsed.message}\n`)
    process.exitCode = 1
    return
  }

  const { target } = parsed
  console.log(`[db:setup] connecting to ${target.host} as "${target.username}"`)

  let client: pg.Client | undefined
  try {
    client = await connectToMaintenance(target)

    const existing = await client.query<{ datname: string }>(
      'select datname from pg_database where datname = $1',
      [target.database],
    )

    if (existing.rowCount && existing.rowCount > 0) {
      console.log(`[db:setup] database "${target.database}" already exists — nothing to do`)
    } else {
      // The name is validated as an identifier by parseDatabaseUrl, so quoting is
      // safe. CREATE DATABASE cannot take a bind parameter.
      await client.query(`create database "${target.database}"`)
      console.log(`[db:setup] created database "${target.database}"`)
    }

    console.log('\n[db:setup] next:  npm run db:migrate\n')
  } catch (error) {
    const hint = explainDbError(error, target)
    if (hint) {
      console.error(`\n[db:setup] ${hint}\n`)
    } else {
      console.error('\n[db:setup] failed to create the database\n')
      console.error(error)
    }
    process.exitCode = 1
  } finally {
    await client?.end()
  }
}

main().catch((error) => {
  console.error('[db:setup] unexpected failure', error)
  process.exit(1)
})
