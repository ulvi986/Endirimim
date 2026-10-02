import { and, count, desc, eq } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { env } from '../../config/env.js'
import { db } from '../../db/client.js'
import { mediaAssets } from '../../db/schema.js'
import { badRequest, notFound } from '../../lib/errors.js'
import { paginate, parsePagination } from '../../lib/pagination.js'
import { ALLOWED_IMAGE_TYPES, buildObjectKey, contentMatchesImageType, storage } from '../../storage/index.js'
import { requireAuth } from '../../plugins/auth.js'

export default async function mediaRoutes(app: FastifyInstance): Promise<void> {
  app.get('/merchant/media', { preHandler: app.requireStore }, async (request) => {
    const auth = requireAuth(request)
    const query = z.object({ mediaType: z.enum(['image', 'video', 'document']).optional() }).parse(request.query)
    const pagination = parsePagination(request.query as Record<string, unknown>)

    const filters = [eq(mediaAssets.merchantId, auth.merchantId!)]
    if (query.mediaType) filters.push(eq(mediaAssets.mediaType, query.mediaType))

    const [rows, countRows] = await Promise.all([
      db
        .select()
        .from(mediaAssets)
        .where(and(...filters))
        .orderBy(desc(mediaAssets.createdAt))
        .limit(pagination.limit)
        .offset(pagination.offset),
      db.select({ total: count() }).from(mediaAssets).where(and(...filters)),
    ])

    return paginate(
      rows.map((row) => ({ ...row, url: storage.url(row.storageKey) })),
      Number(countRows[0]?.total ?? 0),
      pagination,
    )
  })

  app.post('/merchant/media', { preHandler: app.requireStore }, async (request, reply) => {
    const auth = requireAuth(request)
    const upload = await request.file({ limits: { fileSize: env.MAX_UPLOAD_BYTES } })
    if (!upload) throw badRequest('Fayl tələb olunur.')

    if (!ALLOWED_IMAGE_TYPES.includes(upload.mimetype)) {
      throw badRequest(`Dəstəklənməyən fayl növü: ${upload.mimetype}. İcazə verilənlər: ${ALLOWED_IMAGE_TYPES.join(', ')}`)
    }

    const buffer = await upload.toBuffer()
    if (upload.file.truncated) throw badRequest('Fayl ölçüsü həddi aşıldı.')
    if (!contentMatchesImageType(buffer, upload.mimetype)) throw badRequest('Faylın məzmunu göstərilən şəkil növünə uyğun deyil.')

    const key = buildObjectKey(`merchants/${auth.merchantId}/media`, upload.filename ?? 'upload', upload.mimetype)
    const stored = await storage.put({ key, body: buffer, contentType: upload.mimetype })

    const [asset] = await db
      .insert(mediaAssets)
      .values({
        merchantId: auth.merchantId!,
        storageKey: stored.key,
        mediaType: 'image',
        originalName: upload.filename ?? null,
        mimeType: upload.mimetype,
        sizeBytes: stored.size,
      })
      .returning()

    reply.status(201)
    return { ...asset, url: stored.url }
  })

  app.delete('/merchant/media/:id', { preHandler: app.requireStore }, async (request, reply) => {
    const auth = requireAuth(request)
    const { id } = request.params as { id: string }

    // Scoped by merchantId so one store cannot delete another store's asset.
    const [deleted] = await db
      .delete(mediaAssets)
      .where(and(eq(mediaAssets.id, id), eq(mediaAssets.merchantId, auth.merchantId!)))
      .returning()

    if (!deleted) throw notFound('Media faylı tapılmadı.')

    await storage.remove(deleted.storageKey)
    reply.status(204)
  })
}
