import type { IncomingMessage, ServerResponse } from 'node:http'
import { buildApp } from '../server/src/app.js'

/**
 * Vercel entrypoint. vercel.json rewrites /api/*, /health* and /uploads/* here,
 * and the original URL is preserved, so Fastify routes exactly as it does
 * locally. The app is built once per warm instance, not per request.
 */
const ready = buildApp().then(async (app) => {
  await app.ready()
  return app
})

export default async function handler(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const app = await ready
  app.server.emit('request', request, response)
}
