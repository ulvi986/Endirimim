import { and, count, desc, eq } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { db } from '../../db/client.js'
import { priceAlerts } from '../../db/schema.js'
import { conflict, notFound } from '../../lib/errors.js'
import { paginate, parsePagination } from '../../lib/pagination.js'
import { requireAuth } from '../../plugins/auth.js'
import { recordEvent } from '../analytics/events.js'
import { triggerPriceAlerts } from '../catalog/offers.service.js'
import { loadOffersForProducts, loadProductRowsByIds, loadProductSummaries, type ProductListRow } from '../catalog/shared.js'

const alertBody = z.object({
  productId: z.uuid(),
  targetPrice: z.coerce.number().positive().max(99_999_999),
})

export default async function alertRoutes(app: FastifyInstance): Promise<void> {
  app.get('/alerts', { preHandler: app.authenticate }, async (request) => {
    const auth = requireAuth(request)
    const pagination = parsePagination(request.query as Record<string, unknown>)
    const where = eq(priceAlerts.userId, auth.user.id)

    const [rows, countRows] = await Promise.all([
      db
        .select()
        .from(priceAlerts)
        .where(where)
        .orderBy(desc(priceAlerts.createdAt))
        .limit(pagination.limit)
        .offset(pagination.offset),
      db.select({ total: count() }).from(priceAlerts).where(where),
    ])

    const productsById = await loadProductRowsByIds(rows.map((row) => row.productId))
    const orderedRows = rows
      .map((row) => productsById.get(row.productId))
      .filter((row): row is ProductListRow => row !== undefined)
    const summaries = await loadProductSummaries(orderedRows)
    const summaryById = new Map(summaries.map((summary) => [summary.id, summary]))

    const items = rows.map((alert) => {
      const product = summaryById.get(alert.productId) ?? null
      const bestPrice = product?.bestPrice ?? null
      const targetPrice = Number(alert.targetPrice)

      // Status is derived, never stored: a stored flag would go stale the moment
      // any merchant changes a price.
      const status = alert.triggeredAt
        ? 'triggered'
        : !alert.isActive
          ? 'paused'
          : bestPrice !== null && bestPrice <= targetPrice
            ? 'met'
            : 'watching'

      return {
        id: alert.id,
        targetPrice,
        isActive: alert.isActive,
        createdAt: alert.createdAt,
        triggeredAt: alert.triggeredAt,
        status,
        currentBestPrice: bestPrice,
        gapPercentage: bestPrice !== null && bestPrice > 0 ? Math.round(((bestPrice - targetPrice) / bestPrice) * 10000) / 100 : null,
        product,
      }
    })

    return paginate(items, Number(countRows[0]?.total ?? 0), pagination)
  })

  app.post('/alerts', { preHandler: app.authenticate }, async (request, reply) => {
    const auth = requireAuth(request)
    const body = alertBody.parse(request.body)

    const productsById = await loadProductRowsByIds([body.productId])
    if (!productsById.has(body.productId)) throw notFound('Məhsul tapılmadı.')

    const [existing] = await db
      .select({ id: priceAlerts.id })
      .from(priceAlerts)
      .where(and(eq(priceAlerts.userId, auth.user.id), eq(priceAlerts.productId, body.productId)))
      .limit(1)
    if (existing) throw conflict('Bu məhsul üçün artıq xəbərdarlığınız var.')

    const [created] = await db
      .insert(priceAlerts)
      .values({ userId: auth.user.id, productId: body.productId, targetPrice: body.targetPrice })
      .returning()

    // A target that is already met should notify now, not on the next price change.
    await triggerPriceAlerts(body.productId)

    const offers = await loadOffersForProducts([body.productId])
    recordEvent({
      merchantId: offers.get(body.productId)?.find((offer) => offer.isCheapest)?.merchantId,
      productId: body.productId,
      eventType: 'alert',
    })

    reply.status(201)
    return created
  })

  app.patch('/alerts/:id', { preHandler: app.authenticate }, async (request) => {
    const auth = requireAuth(request)
    const { id } = request.params as { id: string }
    const body = z
      .object({ targetPrice: z.coerce.number().positive().max(99_999_999).optional(), isActive: z.boolean().optional() })
      .parse(request.body)

    // Re-arming an alert clears triggeredAt so it can fire again.
    const rearm = body.isActive === true

    const [updated] = await db
      .update(priceAlerts)
      .set({
        ...(body.targetPrice !== undefined ? { targetPrice: body.targetPrice, triggeredAt: null } : {}),
        ...(body.isActive !== undefined ? { isActive: body.isActive, ...(rearm ? { triggeredAt: null } : {}) } : {}),
      })
      .where(and(eq(priceAlerts.id, id), eq(priceAlerts.userId, auth.user.id)))
      .returning()

    if (!updated) throw notFound('Xəbərdarlıq tapılmadı.')
    if (updated.isActive && !updated.triggeredAt) await triggerPriceAlerts(updated.productId)
    return updated
  })

  app.delete('/alerts/:id', { preHandler: app.authenticate }, async (request, reply) => {
    const auth = requireAuth(request)
    const { id } = request.params as { id: string }

    const [deleted] = await db
      .delete(priceAlerts)
      .where(and(eq(priceAlerts.id, id), eq(priceAlerts.userId, auth.user.id)))
      .returning({ id: priceAlerts.id })

    if (!deleted) throw notFound('Xəbərdarlıq tapılmadı.')
    reply.status(204)
  })
}
