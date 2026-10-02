/** Exercises authentication and merchant permissions against a throwaway database. */
import assert from 'node:assert/strict'
import { eq } from 'drizzle-orm'
import { migrate } from 'drizzle-orm/pglite/migrator'

process.env.DATABASE_URL = 'pglite:memory://'
process.env.NODE_ENV = 'test'
process.env.LOG_LEVEL = 'silent'
process.env.AUTH_SECRET = 'isolated-auth-test-secret-at-least-32-characters'
process.env.STORAGE_DRIVER = 'local'
process.env.VERCEL = '0'

const { db, closePool } = await import('../db/client.js')
const { users, emailVerificationTokens } = await import('../db/schema.js')
const { mailer } = await import('../mail/mailer.js')
const { buildApp } = await import('../app.js')
let sentEmails = 0
mailer.send = async () => { sentEmails += 1 }
const app = await buildApp()
const password = 'Sample-password-2026'

try {
  await migrate(db as unknown as Parameters<typeof migrate>[0], { migrationsFolder: 'server/drizzle' })
  const request = async (method: 'GET' | 'POST' | 'PATCH', path: string, payload?: object, token?: string) =>
    app.inject({ method, url: `/api/v1${path}`, payload, headers: token ? { authorization: `Bearer ${token}` } : {} })
  const signup = async (email: string, accountType: 'user' | 'store') => {
    const response = await request('POST', '/auth/register', { email, password, accountType, storeName: 'Test store' })
    assert.equal(response.statusCode, 201, response.body)
    const body = response.json()
    assert.ok(body.accessToken)
    assert.ok(response.headers['set-cookie'])
    assert.equal(body.user.hasPassword, true)
    for (const key of ['devVerificationPath', 'emailVerificationSent']) assert.equal(key in body, false)
    assert.equal('passwordHash' in body.user, false)
    const me = await request('GET', '/auth/me', undefined, body.accessToken)
    assert.equal(me.statusCode, 200, me.body)
    return body
  }
  const user = await signup('buyer@example.com', 'user')
  const store = await signup('store@example.com', 'store')
  assert.equal(sentEmails, 0, 'Registration must not send verification emails')
  assert.equal((await db.select().from(emailVerificationTokens)).length, 0)
  const [storeRow] = await db.select().from(users).where(eq(users.id, store.user.id))
  assert.ok(storeRow)
  assert.equal(storeRow.emailVerifiedAt, null, 'Do not fabricate email ownership')
  console.log('PASS user/store registration opens a session without verification or email')

  const login = await request('POST', '/auth/login', { email: 'store@example.com', password })
  assert.equal(login.statusCode, 200, login.body)
  assert.equal((await request('POST', '/auth/login', { email: 'store@example.com', password: 'incorrect' })).statusCode, 401)
  console.log('PASS password login accepts the right password and rejects the wrong one')

  const productPayload = { name: 'Test product', offer: { price: 25, oldPrice: 30, productUrl: 'https://example.com/product' } }
  const product = await request('POST', '/products', productPayload, store.accessToken)
  assert.equal(product.statusCode, 201, product.body)
  const offerId = product.json().offer.id
  const edited = await request('PATCH', `/offers/${offerId}`, { price: 24 }, store.accessToken)
  assert.equal(edited.statusCode, 200, edited.body)
  const campaign = await request('POST', '/merchant/campaigns', {
    title: 'Test campaign', startDate: '2026-10-01', endDate: '2026-10-31', isActive: true,
  }, store.accessToken)
  assert.equal(campaign.statusCode, 201, campaign.body)
  console.log('PASS store publishes products, edits offers and creates campaigns without email verification')

  assert.equal((await request('POST', '/products', productPayload)).statusCode, 401)
  assert.equal((await request('POST', '/products', productPayload, user.accessToken)).statusCode, 403)
  const otherStore = await signup('other@example.com', 'store')
  assert.equal((await request('PATCH', `/offers/${offerId}`, { price: 1 }, otherStore.accessToken)).statusCode, 404)
  assert.equal((await request('PATCH', `/campaigns/${campaign.json().id}`, { title: 'Intrusion' }, otherStore.accessToken)).statusCode, 403)
  console.log('PASS anonymous, user and other-store write restrictions remain enforced')

  // Previously created accounts without passwords retain a recovery route.
  await db.update(users).set({ passwordHash: null, authProvider: 'google' }).where(eq(users.id, user.user.id))
  const forgot = await request('POST', '/auth/password/forgot', { email: 'buyer@example.com' })
  assert.equal(forgot.statusCode, 200, forgot.body)
  const token = new URL(forgot.json().devResetPath, 'http://localhost').searchParams.get('token')
  assert.ok(token)
  const reset = await request('POST', '/auth/password/reset', { token, password })
  assert.equal(reset.statusCode, 200, reset.body)
  assert.equal((await request('POST', '/auth/login', { email: 'buyer@example.com', password })).statusCode, 200)
  assert.equal((await request('GET', '/auth/me', undefined, user.accessToken)).statusCode, 401)
  console.log('PASS legacy accounts can set a password through recovery; old sessions are revoked')
} finally {
  await app.close()
  await closePool()
}
