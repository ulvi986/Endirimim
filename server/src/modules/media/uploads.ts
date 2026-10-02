import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import path from 'node:path'
import type { FastifyInstance } from 'fastify'
import { env } from '../../config/env.js'

const CONTENT_TYPES: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
}

/**
 * Only registered for the local storage driver. With an object store the CDN or
 * bucket serves these URLs and this route would just be dead weight.
 */
export function registerUploadsRoute(app: FastifyInstance): void {
  const root = path.resolve(process.cwd(), env.STORAGE_LOCAL_DIR)

  app.get('/uploads/*', async (request, reply) => {
    const wildcard = (request.params as Record<string, string>)['*'] ?? ''
    if (!wildcard) return reply.status(404).send()

    const target = path.resolve(root, wildcard)

    // Path traversal guard: the resolved path must stay inside the upload root.
    if (target !== root && !target.startsWith(root + path.sep)) {
      return reply.status(403).send({ error: { code: 'forbidden', message: 'İcazəsiz yol.' } })
    }

    try {
      const stats = await stat(target)
      if (!stats.isFile()) return reply.status(404).send()

      reply.header('content-type', CONTENT_TYPES[path.extname(target).toLowerCase()] ?? 'application/octet-stream')
      reply.header('content-length', String(stats.size))
      reply.header('cache-control', 'public, max-age=31536000, immutable')
      return reply.send(createReadStream(target))
    } catch {
      return reply.status(404).send({ error: { code: 'not_found', message: 'Fayl tapılmadı.' } })
    }
  })
}
