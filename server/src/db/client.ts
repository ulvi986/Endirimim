import { mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import type { SQL } from 'drizzle-orm'
import { drizzle as drizzleNodePg } from 'drizzle-orm/node-postgres'
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core'
import { drizzle as drizzlePglite } from 'drizzle-orm/pglite'
import pg from 'pg'
import { env } from '../config/env.js'
import * as schema from './schema.js'

const { Pool } = pg

/**
 * Two drivers, one schema and one set of migrations:
 *
 * - `DATABASE_URL=pglite:<dir>` runs an embedded Postgres (WASM) inside the API
 *   process. Local development needs no installed database server.
 * - `DATABASE_URL=postgresql://...` uses a real server (Neon, Vercel Postgres,
 *   Supabase, Render...). This is what production uses; serverless platforms
 *   have no persistent disk, so pglite is never an option there.
 *
 * Both speak the same Postgres dialect, so switching is a config change only.
 */
export const PGLITE_PREFIX = 'pglite:'

export function isPgliteUrl(url: string): boolean {
  return url.startsWith(PGLITE_PREFIX)
}

export function pgliteDataDir(url: string): string {
  const dir = url.slice(PGLITE_PREFIX.length).trim() || '.data/pglite'
  // `pglite:memory://` is a throwaway in-process database (used by the smoke test).
  if (dir.startsWith('memory://')) return dir
  return path.resolve(process.cwd(), dir)
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    // EPERM: the process exists but belongs to someone else.
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

/**
 * pglite is a single-process database: two processes opening the same data
 * directory (the API plus `db:migrate`, `db:seed` or the smoke test) can corrupt
 * it, and pglite itself does not detect this. A pid lock file next to the
 * directory makes the second process fail with an explanation instead.
 */
function acquirePgliteLock(dataDir: string): () => void {
  const lockPath = `${dataDir}.lock`
  const ownPid = String(process.pid)

  try {
    writeFileSync(lockPath, ownPid, { flag: 'wx' })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    const holder = Number(readFileSync(lockPath, 'utf8').trim())
    if (Number.isInteger(holder) && holder > 0 && holder !== process.pid && isProcessAlive(holder)) {
      throw new Error(
        `The embedded database at ${dataDir} is already open in another process (pid ${holder}).\n` +
          'pglite allows only one process at a time — stop the API (or that script) first, then retry.\n' +
          `If no such process is running, delete ${lockPath}.`,
      )
    }
    // Stale lock left by a crashed process: take it over.
    writeFileSync(lockPath, ownPid)
  }

  let released = false
  const release = () => {
    if (released) return
    released = true
    try {
      if (readFileSync(lockPath, 'utf8').trim() === ownPid) unlinkSync(lockPath)
    } catch {
      // Already gone; nothing to release.
    }
  }
  process.once('exit', release)
  return release
}

export type Database = PgDatabase<PgQueryResultHKT, typeof schema>
/** Either the shared db or a transaction handle — services accept both. */
export type Executor = Database | Parameters<Parameters<Database['transaction']>[0]>[0]

let closeDriver: () => Promise<void>

function createDatabase(): Database {
  if (isPgliteUrl(env.DATABASE_URL)) {
    const dataDir = pgliteDataDir(env.DATABASE_URL)
    let releaseLock = () => {}
    if (!dataDir.startsWith('memory://')) {
      mkdirSync(dataDir, { recursive: true })
      releaseLock = acquirePgliteLock(dataDir)
    }
    const client = new PGlite(dataDir)
    closeDriver = async () => {
      try {
        await client.close()
      } finally {
        releaseLock()
      }
    }
    // pglite has a single connection and runs transactions exclusively, so code
    // inside a transaction must use its `tx` handle, never the shared `db`.
    return drizzlePglite(client, { schema }) as unknown as Database
  }

  const pool = new Pool({
    // pg already treats sslmode=require (Neon's default) as verify-full but warns
    // on every cold start that this will change; pin the strict behaviour.
    connectionString: env.DATABASE_URL.replace(/([?&])sslmode=require(?=&|$)/, '$1sslmode=verify-full'),
    max: env.DATABASE_POOL_MAX,
    ssl: env.DATABASE_SSL ? { rejectUnauthorized: false } : undefined,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  })

  // An idle client erroring out must not take the process down with it.
  pool.on('error', (error) => {
    console.error('[db] unexpected idle client error', error)
  })

  closeDriver = () => pool.end()
  return drizzleNodePg(pool, { schema }) as unknown as Database
}

export const db = createDatabase()

/** Fastify's onClose hook calls this so the process exits cleanly. */
export async function closePool(): Promise<void> {
  await closeDriver()
}

/**
 * Typed escape hatch for aggregate queries the query builder cannot express
 * (date_trunc grouping, FILTER aggregates). Always parameterise via `sql`
 * interpolation — never concatenate user input into the statement.
 */
export async function rawRows<T>(query: SQL): Promise<T[]> {
  const result = await db.execute(query)
  return (result as unknown as { rows?: T[] }).rows ?? []
}
