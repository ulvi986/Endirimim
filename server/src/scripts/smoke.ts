/**
 * Boots the Fastify app in-process (no listening socket, no database required)
 * and asserts the wiring: every route module registered, the error envelope is
 * consistent, and unauthenticated requests are rejected before touching the DB.
 *
 * It runs against a throwaway in-memory database, so it is safe to run while the
 * API holds the real one open. The env var is set before the app modules load
 * (dotenv never overrides an existing value), hence the dynamic imports.
 *
 * Run with `npm run smoke`.
 */
export {}

process.env.DATABASE_URL = 'pglite:memory://'

const { buildApp } = await import('../app.js')
const { closePool } = await import('../db/client.js')

async function main(): Promise<void> {
  const app = await buildApp()
  await app.ready()

  const checks: { name: string; passed: boolean; detail: string }[] = []

  const health = await app.inject({ method: 'GET', url: '/health' })
  checks.push({
    name: 'GET /health returns ok',
    passed: health.statusCode === 200 && health.json().status === 'ok',
    detail: `${health.statusCode} ${health.body}`,
  })

  const protectedCall = await app.inject({ method: 'GET', url: '/api/v1/favorites' })
  const protectedBody = protectedCall.json()
  checks.push({
    name: 'Protected route rejects anonymous access with 401',
    passed: protectedCall.statusCode === 401 && protectedBody.error?.code === 'unauthorized',
    detail: `${protectedCall.statusCode} ${protectedCall.body}`,
  })

  const badLogin = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { email: 'not-an-email', password: '' },
  })
  const badLoginBody = badLogin.json()
  checks.push({
    name: 'Invalid input returns a 400 validation envelope',
    passed: badLogin.statusCode === 400 && badLoginBody.error?.code === 'validation_failed',
    detail: `${badLogin.statusCode} ${badLogin.body}`,
  })

  const unknown = await app.inject({ method: 'GET', url: '/api/v1/does-not-exist' })
  checks.push({
    name: 'Unknown route returns the 404 envelope',
    passed: unknown.statusCode === 404 && unknown.json().error?.code === 'not_found',
    detail: `${unknown.statusCode} ${unknown.body}`,
  })

  for (const [method, url] of [
    ['GET', '/api/v1/auth/google/start'],
    ['GET', '/api/v1/auth/google/callback'],
    ['POST', '/api/v1/auth/email/verify'],
    ['POST', '/api/v1/auth/email/resend'],
  ] as const) {
    const removed = await app.inject({ method, url })
    checks.push({
      name: `${method} ${url} is removed`,
      passed: removed.statusCode === 404,
      detail: `${removed.statusCode}`,
    })
  }

  const routeTree = app.printRoutes({ commonPrefix: false })
  const routeCount = (routeTree.match(/\(([A-Z, ]+)\)/g) ?? []).length
  checks.push({
    name: 'All route modules registered (>= 60 handlers)',
    passed: routeCount >= 60,
    detail: `${routeCount} handlers`,
  })

  for (const check of checks) {
    console.log(`${check.passed ? 'PASS' : 'FAIL'}  ${check.name}  [${check.detail}]`)
  }

  const failed = checks.filter((check) => !check.passed)
  console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`)

  await app.close()
  await closePool()

  if (failed.length > 0) process.exitCode = 1
}

main().catch(async (error) => {
  console.error('[smoke] crashed', error)
  await closePool().catch(() => undefined)
  process.exitCode = 1
})
