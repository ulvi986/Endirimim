import { desc, eq, sql } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { db } from '../../db/client.js'
import { favorites } from '../../db/schema.js'
import { notFound } from '../../lib/errors.js'
import { paginate, parsePagination } from '../../lib/pagination.js'
import { requireAuth } from '../../plugins/auth.js'
import { recordEvent } from '../analytics/events.js'
import { loadOffersForProducts, loadProductRowsByIds, loadProductSummaries, type ProductListRow } from '../catalog/shared.js'

export default async function favoriteRoutes(app: FastifyInstance): Promise<void> {
  app.get('/favorites', { preHandler: app.authenticate }, async (request) => {
    const auth = requireAuth(request)
    const pagination = parsePagination(request.query as Record<string, unknown>)
    const where = eq(favorites.userId, auth.user.id)

    const [rows, countRows] = await Promise.all([
      db
        .select({ productId: favorites.productId, createdAt: favorites.createdAt })
        .from(favorites)
        .where(where)
        .orderBy(desc(favorites.createdAt))
        .limit(pagination.limit)
        .offset(pagination.offset),
      db.select({ total: sql<number>`count(*)::int` }).from(favorites).where(where),
    ])

    // Order comes from favorites.createdAt, so products are looked up by id and
    // re-sequenced rather than joined and re-sorted.
    const productsById = await loadProductRowsByIds(rows.map((row) => row.productId))
    const orderedRows = rows
      .map((row) => productsById.get(row.productId))
      .filter((row): row is ProductListRow => row !== undefined)

    const summaries = await loadProductSummaries(orderedRows)
    const favoritedAt = new Map(rows.map((row) => [row.productId, row.createdAt]))

    return paginate(
      summaries.map((summary) => ({ ...summary, favoritedAt: favoritedAt.get(summary.id) ?? null })),
      Number(countRows[0]?.total ?? 0),
      pagination,
    )
  })

  app.post('/favorites', { preHandler: app.authenticate }, async (request, reply) => {
    const auth = requireAuth(request)
    const body = z.object({ productId: z.uuid() }).parse(request.body)

    const productsById = await loadProductRowsByIds([body.productId])
    if (!productsById.has(body.productId)) throw notFound('Məhsul tapılmadı.')

    const inserted = await db
      .insert(favorites)
      .values({ userId: auth.user.id, productId: body.productId })
      .onConflictDoNothing({ target: [favorites.userId, favorites.productId] })
      .returning()

    // Idempotent by design: favoriting an already-favorited product is a no-op,
    // not an error, so a double-tap in the UI cannot fail.
    if (inserted.length > 0) {
      const offers = await loadOffersForProducts([body.productId])
      recordEvent({
        merchantId: offers.get(body.productId)?.find((offer) => offer.isCheapest)?.merchantId,
        productId: body.productId,
        eventType: 'favorite',
      })
    }

    reply.status(inserted.length > 0 ? 201 : 200)
    return { success: true, productId: body.productId, alreadySaved: inserted.length === 0 }
  })

  app.delete('/favorites/:productId', { preHandler: app.authenticate }, async (request, reply) => {
    const auth = requireAuth(request)
    const { productId } = request.params as { productId: string }

    await db.delete(favorites).where(sql`${favorites.userId} = ${auth.user.id} and ${favorites.productId} = ${productId}`)
    reply.status(204)
  })
}
