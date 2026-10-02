import { sql } from 'drizzle-orm'
import { buildApp } from './app.js'
import { env } from './config/env.js'
import { closePool, db, isPgliteUrl } from './db/client.js'
import { explainDbError, parseDatabaseUrl } from './lib/db-errors.js'

async function main(): Promise<void> {
  const app = await buildApp()

  // Fail fast with an actionable message: a missing database, bad credentials or
  // unapplied migration is the most common cause of a server that boots but
  // 500s on every request.
  try {
    await db.execute(sql`select 1 from users limit 0`)
  } catch (error) {
    const parsed = isPgliteUrl(env.DATABASE_URL) ? undefined : parseDatabaseUrl(env.DATABASE_URL)
    const hint = explainDbError(error, parsed?.ok ? parsed.target : undefined)
    app.log.error(
      hint ?? 'database is not reachable or migrations have not been applied',
    )
    app.log.error(
      'Start here: `npm run db:setup`, then `npm run db:migrate`, then restart the API.',
    )
    process.exitCode = 1
    await app.close()
    return
  }

  app.addHook('onClose', async () => {
    await closePool()
  })

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => {
      app.log.info(`received ${signal}, shutting down`)
      void app
        .close()
        .then(() => process.exit(0))
        .catch(() => process.exit(1))
    })
  }

  await app.listen({ port: env.PORT, host: env.HOST })
  app.log.info(`Endirimim API listening on http://${env.HOST}:${env.PORT}${''} (storage: ${env.STORAGE_DRIVER}, database: ${isPgliteUrl(env.DATABASE_URL) ? 'embedded pglite' : 'postgres'})`)
}

main().catch((error) => {
  console.error('[server] failed to start', error)
  process.exit(1)
})
