import { and, count, desc, eq } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { db } from '../../db/client.js'
import { reviews, users } from '../../db/schema.js'
import { forbidden, notFound } from '../../lib/errors.js'
import { paginate, parsePagination } from '../../lib/pagination.js'
import { requireAuth } from '../../plugins/auth.js'
import { recomputeProductRating, resolveProductId } from '../catalog/shared.js'

const reviewBody = z.object({
  rating: z.coerce.number().int().min(1).max(5),
  title: z.string().trim().max(160).nullish(),
  content: z.string().trim().max(5000).nullish(),
})

const reviewSelect = {
  id: reviews.id,
  rating: reviews.rating,
  title: reviews.title,
  content: reviews.content,
  createdAt: reviews.createdAt,
  updatedAt: reviews.updatedAt,
  userId: users.id,
  authorFirstName: users.firstName,
  authorLastName: users.lastName,
  authorAvatarUrl: users.avatarUrl,
} as const

export default async function reviewRoutes(app: FastifyInstance): Promise<void> {
  app.get('/products/:idOrSlug/reviews', async (request) => {
    const { idOrSlug } = request.params as { idOrSlug: string }
    const pagination = parsePagination(request.query as Record<string, unknown>)
    const productId = await resolveProductId(idOrSlug)
    const where = eq(reviews.productId, productId)

    const [rows, countRows] = await Promise.all([
      db
        .select(reviewSelect)
        .from(reviews)
        .innerJoin(users, eq(users.id, reviews.userId))
        .where(where)
        .orderBy(desc(reviews.createdAt))
        .limit(pagination.limit)
        .offset(pagination.offset),
      db.select({ total: count() }).from(reviews).where(where),
    ])

    return paginate(
      rows.map((row) => ({
        id: row.id,
        rating: row.rating,
        title: row.title,
        content: row.content,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
        author: {
          id: row.userId,
          displayName: [row.authorFirstName, row.authorLastName].filter(Boolean).join(' ') || 'Endirimim istifadəçisi',
          avatarUrl: row.authorAvatarUrl,
        },
      })),
      Number(countRows[0]?.total ?? 0),
      pagination,
    )
  })

  // One review per user per product (reviews_user_id_product_id_key), so this is
  // an upsert rather than a create.
  app.post('/products/:idOrSlug/reviews', { preHandler: app.authenticate }, async (request, reply) => {
    const auth = requireAuth(request)
    const { idOrSlug } = request.params as { idOrSlug: string }
    const body = reviewBody.parse(request.body)
    const productId = await resolveProductId(idOrSlug)

    const [existing] = await db
      .select({ id: reviews.id })
      .from(reviews)
      .where(and(eq(reviews.productId, productId), eq(reviews.userId, auth.user.id)))
      .limit(1)

    const [saved] = await db
      .insert(reviews)
      .values({
        userId: auth.user.id,
        productId,
        rating: body.rating,
        title: body.title ?? null,
        content: body.content ?? null,
      })
      .onConflictDoUpdate({
        target: [reviews.userId, reviews.productId],
        set: { rating: body.rating, title: body.title ?? null, content: body.content ?? null, updatedAt: new Date() },
      })
      .returning()

    await recomputeProductRating(productId)

    reply.status(existing ? 200 : 201)
    return { review: saved, updatedExisting: Boolean(existing) }
  })

  app.patch('/reviews/:id', { preHandler: app.authenticate }, async (request) => {
    const auth = requireAuth(request)
    const { id } = request.params as { id: string }
    const body = reviewBody.partial().parse(request.body)

    const [existing] = await db.select().from(reviews).where(eq(reviews.id, id)).limit(1)
    if (!existing) throw notFound('Rəy tapılmadı.')
    if (existing.userId !== auth.user.id) throw forbidden('Bu rəy sizə aid deyil.')

    const [updated] = await db
      .update(reviews)
      .set({
        ...(body.rating !== undefined ? { rating: body.rating } : {}),
        ...(body.title !== undefined ? { title: body.title } : {}),
        ...(body.content !== undefined ? { content: body.content } : {}),
        updatedAt: new Date(),
      })
      .where(eq(reviews.id, id))
      .returning()

    await recomputeProductRating(existing.productId)
    return updated
  })

  app.delete('/reviews/:id', { preHandler: app.authenticate }, async (request, reply) => {
    const auth = requireAuth(request)
    const { id } = request.params as { id: string }

    const [existing] = await db.select().from(reviews).where(eq(reviews.id, id)).limit(1)
    if (!existing) throw notFound('Rəy tapılmadı.')
    if (existing.userId !== auth.user.id && auth.role !== 'admin') throw forbidden('Bu rəy sizə aid deyil.')

    await db.delete(reviews).where(eq(reviews.id, id))
    await recomputeProductRating(existing.productId)

    reply.status(204)
  })

  app.get('/users/me/reviews', { preHandler: app.authenticate }, async (request) => {
    const auth = requireAuth(request)
    const pagination = parsePagination(request.query as Record<string, unknown>)
    const where = eq(reviews.userId, auth.user.id)

    const [rows, countRows] = await Promise.all([
      db
        .select(reviewSelect)
        .from(reviews)
        .innerJoin(users, eq(users.id, reviews.userId))
        .where(where)
        .orderBy(desc(reviews.createdAt))
        .limit(pagination.limit)
        .offset(pagination.offset),
      db.select({ total: count() }).from(reviews).where(where),
    ])

    return paginate(rows, Number(countRows[0]?.total ?? 0), pagination)
  })

  /** Guards against a second review being posted through a stale UI. */
  app.get('/products/:idOrSlug/reviews/mine', { preHandler: app.authenticate }, async (request) => {
    const auth = requireAuth(request)
    const { idOrSlug } = request.params as { idOrSlug: string }
    const productId = await resolveProductId(idOrSlug)

    const [mine] = await db
      .select(reviewSelect)
      .from(reviews)
      .innerJoin(users, eq(users.id, reviews.userId))
      .where(and(eq(reviews.productId, productId), eq(reviews.userId, auth.user.id)))
      .limit(1)

    return { review: mine ?? null }
  })

  app.post('/reviews/:id/report', { preHandler: app.authenticate }, async (request) => {
    const { id } = request.params as { id: string }
    const body = z.object({ reason: z.string().trim().min(3).max(500) }).parse(request.body)

    const [existing] = await db.select({ id: reviews.id }).from(reviews).where(eq(reviews.id, id)).limit(1)
    if (!existing) throw notFound('Rəy tapılmadı.')

    // Reported reviews go to the admin queue; a dedicated table is the next step
    // if moderation volume grows beyond log review.
    request.log.warn({ reviewId: id, reason: body.reason, reportedBy: requireAuth(request).user.id }, 'review reported')
    return { success: true }
  })
}
