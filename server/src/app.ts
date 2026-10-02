import cors from '@fastify/cors'
import multipart from '@fastify/multipart'
import rateLimit from '@fastify/rate-limit'
import { sql } from 'drizzle-orm'
import Fastify, { type FastifyInstance } from 'fastify'
import { env } from './config/env.js'
import { db } from './db/client.js'
import authPlugin from './plugins/auth.js'
import errorPlugin from './plugins/errors.js'
import alertRoutes from './modules/collections/alerts.routes.js'
import comparisonRoutes from './modules/collections/comparisons.routes.js'
import favoriteRoutes from './modules/collections/favorites.routes.js'
import shoppingListRoutes from './modules/collections/lists.routes.js'
import campaignRoutes from './modules/campaigns/routes.js'
import authRoutes from './modules/auth/routes.js'
import offerRoutes from './modules/catalog/offers.routes.js'
import productRoutes from './modules/catalog/products.routes.js'
import taxonomyRoutes from './modules/catalog/taxonomy.routes.js'
import mediaRoutes from './modules/media/routes.js'
import { registerUploadsRoute } from './modules/media/uploads.js'
import merchantRoutes from './modules/merchants/routes.js'
import notificationRoutes from './modules/notifications/routes.js'
import reviewRoutes from './modules/reviews/routes.js'
import seoRoutes from './modules/seo/routes.js'
import userRoutes from './modules/users/routes.js'

export const API_PREFIX = '/api/v1'

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: env.LOG_LEVEL,
      // Never log credentials that may appear in headers or bodies.
      redact: ['req.headers.authorization', 'req.headers.cookie', 'res.headers["set-cookie"]'],
    },
    // Vercel's edge always sets X-Forwarded-For, so the client IP (rate limits,
    // session metadata) is only correct when it is trusted there.
    trustProxy: env.TRUST_PROXY || env.onVercel,
    bodyLimit: 1_000_000,
  })

  // Global safety net; auth routes override this with tighter windows.
  await app.register(rateLimit, {
    global: true,
    max: 300,
    timeWindow: '1 minute',
  })

  await app.register(cors, {
    origin: env.corsOrigins,
    // Required for the refresh cookie to travel cross-origin in development.
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    maxAge: 86_400,
  })

  await app.register(multipart, {
    limits: { fileSize: env.MAX_UPLOAD_BYTES, files: 1, fields: 10 },
  })

  // Security headers without a dependency. The API only serves JSON and uploaded
  // images, so nothing it returns should ever be framed, sniffed or run scripts.
  app.addHook('onSend', async (_request, reply) => {
    reply.header('x-content-type-options', 'nosniff')
    reply.header('x-frame-options', 'DENY')
    reply.header('referrer-policy', 'no-referrer')
    reply.header('content-security-policy', "default-src 'none'; frame-ancestors 'none'")
    reply.header('cross-origin-opener-policy', 'same-origin')
    if (env.isProduction) reply.header('strict-transport-security', 'max-age=31536000; includeSubDomains')
  })

  await app.register(errorPlugin)
  await app.register(authPlugin)

  app.get('/health', async () => ({ status: 'ok', uptime: process.uptime() }))

  app.get('/health/ready', async (_request, reply) => {
    try {
      await db.execute(sql`select 1`)
      return { status: 'ready', database: 'reachable' }
    } catch (error) {
      app.log.error({ err: error }, 'readiness check failed')
      reply.status(503)
      return { status: 'unavailable', database: 'unreachable' }
    }
  })

  await app.register(
    async (api) => {
      await api.register(authRoutes, { prefix: '/auth' })
      await api.register(userRoutes)
      await api.register(taxonomyRoutes)
      await api.register(productRoutes)
      await api.register(offerRoutes)
      await api.register(merchantRoutes)
      await api.register(campaignRoutes)
      await api.register(mediaRoutes)
      await api.register(favoriteRoutes)
      await api.register(shoppingListRoutes)
      await api.register(alertRoutes)
      await api.register(comparisonRoutes)
      await api.register(notificationRoutes)
      await api.register(reviewRoutes)
      await api.register(seoRoutes)
    },
    { prefix: API_PREFIX },
  )

  if (env.STORAGE_DRIVER === 'local') registerUploadsRoute(app)

  return app
}
