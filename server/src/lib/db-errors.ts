/**
 * Turns opaque Postgres driver failures into something a human can act on.
 *
 * The driver errors are wrapped by Drizzle (`DrizzleQueryError`), so the real
 * `code` lives on `error.cause`. These helpers walk the chain and map the codes
 * we care about to the exact edit the operator needs to make.
 */

type PgErrorLike = { code?: string; message?: string }

export type DatabaseTarget = {
  database: string
  username: string
  host: string
  /** Same credentials, but pointing at a database every cluster is guaranteed to have. */
  maintenanceUrl: string
}

export type ParseResult = { ok: true; target: DatabaseTarget } | { ok: false; message: string }

const URL_EXAMPLE = 'postgresql://postgres:YOUR_PASSWORD@localhost:5432/endirimim'

/** Postgres error codes: https://www.postgresql.org/docs/current/errcodes-appendix.html */
export const PG_ERROR_CODES = {
  invalidPassword: '28P01',
  invalidAuthorization: '28000',
  invalidCatalog: '3D000',
  insufficientPrivilege: '42501',
  cannotConnectNow: '57P03',
} as const

/**
 * Walks `error.cause` looking for the first object carrying a Postgres/Node
 * error code. Drizzle nests the driver error one level down.
 */
export function findDriverError(error: unknown): PgErrorLike | undefined {
  let current: unknown = error
  for (let depth = 0; depth < 8; depth += 1) {
    if (typeof current !== 'object' || current === null) return undefined
    const candidate = current as PgErrorLike & { cause?: unknown }
    if (typeof candidate.code === 'string') return candidate
    current = candidate.cause
  }
  return undefined
}

export function driverErrorCode(error: unknown): string | undefined {
  return findDriverError(error)?.code
}

/**
 * Parses DATABASE_URL without throwing, so callers can print a friendly message
 * instead of a stack trace. Only the database name is validated as an
 * identifier, because it is later interpolated into `CREATE DATABASE`.
 */
export function parseDatabaseUrl(raw: string | undefined): ParseResult {
  if (!raw) {
    return { ok: false, message: `DATABASE_URL is not set.\n\nAdd it to .env, for example:\n  DATABASE_URL=${URL_EXAMPLE}` }
  }

  let parsed: URL
  try {
    parsed = new URL(raw)
  } catch {
    return { ok: false, message: `DATABASE_URL is not a valid connection URL:\n  ${raw}\n\nExpected a shape like:\n  DATABASE_URL=${URL_EXAMPLE}` }
  }

  if (parsed.protocol !== 'postgresql:' && parsed.protocol !== 'postgres:') {
    return { ok: false, message: `DATABASE_URL must start with postgresql:// (got "${parsed.protocol}//").\n\nExample:\n  DATABASE_URL=${URL_EXAMPLE}` }
  }

  const database = decodeURIComponent(parsed.pathname.replace(/^\/+/, ''))
  if (!database) {
    return { ok: false, message: `DATABASE_URL has no database name at the end.\n\nExample:\n  DATABASE_URL=${URL_EXAMPLE}` }
  }

  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(database)) {
    return { ok: false, message: `DATABASE_URL database name "${database}" is not a simple identifier.\n\nUse letters, digits and underscores, e.g.  /endirimim` }
  }

  const maintenance = new URL(parsed.toString())
  maintenance.pathname = '/postgres'

  return {
    ok: true,
    target: {
      database,
      username: decodeURIComponent(parsed.username) || '(empty)',
      host: parsed.host || 'localhost',
      maintenanceUrl: maintenance.toString(),
    },
  }
}

/**
 * Returns a ready-to-print explanation for the common failure modes, or
 * `undefined` when we have nothing specific to add.
 */
export function explainDbError(error: unknown, target?: DatabaseTarget): string | undefined {
  const driver = findDriverError(error)
  const code = driver?.code
  const username = target?.username ?? 'your user'
  const host = target?.host ?? 'localhost'
  const database = target?.database ?? 'endirimim'

  switch (code) {
    case PG_ERROR_CODES.invalidPassword:
    case PG_ERROR_CODES.invalidAuthorization:
      return [
        `PostgreSQL rejected the credentials in DATABASE_URL (error ${code}).`,
        '',
        `  Server:   ${host}`,
        `  Username: ${username}`,
        '',
        'The password is wrong, or that role does not exist.',
        '',
        'Fix: open .env and put your real local password in DATABASE_URL:',
        `  DATABASE_URL=postgresql://${username === 'your user' ? 'postgres' : username}:YOUR_PASSWORD@${host}/${database}`,
        '',
        'That is the password you chose when you installed PostgreSQL 17.',
        'If you never set one, reset it from pgAdmin, or from a psql session run as an',
        'OS administrator:   ALTER USER postgres WITH PASSWORD \'new-password\';',
      ].join('\n')

    case PG_ERROR_CODES.invalidCatalog:
      return [
        `The database "${database}" does not exist yet (error ${code}).`,
        '',
        `Fix: run \`npm run db:setup\` to create it, then \`npm run db:migrate\`.`,
      ].join('\n')

    case PG_ERROR_CODES.insufficientPrivilege:
      return [
        `The role "${username}" is not allowed to do that (error ${code}).`,
        '',
        `Fix: connect as a superuser such as \`postgres\`, or grant "${username}" the right`,
        `to create the "${database}" database.`,
      ].join('\n')

    case PG_ERROR_CODES.cannotConnectNow:
      return [
        'PostgreSQL is still starting up and not accepting connections yet (error 57P03).',
        '',
        'Wait a few seconds and try again.',
      ].join('\n')

    case 'ECONNREFUSED':
      return [
        `Nothing is listening on ${host} — the PostgreSQL service is not running.`,
        '',
        'Fix: start it with (in an Administrator terminal):',
        '  net start postgresql-x64-17',
      ].join('\n')

    case 'ENOTFOUND':
      return [
        `The host "${host}" in DATABASE_URL could not be resolved.`,
        '',
        'Fix: for a local database use `localhost`, not a machine name.',
      ].join('\n')

    case 'ETIMEDOUT':
      return [
        `Connecting to ${host} timed out.`,
        '',
        'Fix: check the host/port in DATABASE_URL, and any firewall in between.',
      ].join('\n')

    default:
      return undefined
  }
}
