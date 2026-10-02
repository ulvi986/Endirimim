import { and, desc, eq, sql } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { db } from '../../db/client.js'
import { productOffers, products } from '../../db/schema.js'
import { badRequest, notFound } from '../../lib/errors.js'
import { paginate, parsePagination } from '../../lib/pagination.js'
import { requireAuth } from '../../plugins/auth.js'
import { storage } from '../../storage/index.js'
import { recordEvent } from '../analytics/events.js'
import { offerBody, offerPatchBody, upsertOffer } from './offers.service.js'

export default async function offerRoutes(app: FastifyInstance): Promise<void> {
  /* ------------------------------ merchant view ----------------------------- */

  app.get('/merchant/offers', { preHandler: app.requireStore }, async (request) => {
    const auth = requireAuth(request)
    const pagination = parsePagination(request.query as Record<string, unknown>)
    const where = eq(productOffers.merchantId, auth.merchantId!)

    const [rows, countRows] = await Promise.all([
      db
        .select({
          id: productOffers.id,
          price: productOffers.price,
          oldPrice: productOffers.oldPrice,
          discountPercentage: productOffers.discountPercentage,
          currency: productOffers.currency,
          stockStatus: productOffers.stockStatus,
          shippingPrice: productOffers.shippingPrice,
          productUrl: productOffers.productUrl,
          sku: productOffers.sku,
          lastCheckedAt: productOffers.lastCheckedAt,
          updatedAt: productOffers.updatedAt,
          productId: products.id,
          productName: products.name,
          productSlug: products.slug,
          primaryImageKey: sql<string | null>`(select pi.storage_key from product_images pi where pi.product_id = ${products.id} order by pi.is_primary desc, pi.sort_order asc limit 1)`,
        })
        .from(productOffers)
        .innerJoin(products, eq(products.id, productOffers.productId))
        .where(where)
        .orderBy(desc(productOffers.updatedAt))
        .limit(pagination.limit)
        .offset(pagination.offset),
      db.select({ total: sql<number>`count(*)::int` }).from(productOffers).where(where),
    ])

    // Only the key is stored; the URL is derived so the storage backend can change.
    const items = rows.map(({ primaryImageKey, ...row }) => ({ ...row, primaryImageUrl: primaryImageKey ? storage.url(primaryImageKey) : null }))
    return paginate(items, Number(countRows[0]?.total ?? 0), pagination)
  })

  /* -------------------------------- writes --------------------------------- */

  // Upsert: one merchant has at most one offer per product (enforced by the
  // UNIQUE(product_id, merchant_id) constraint), so this is idempotent.
  app.post('/products/:productId/offers', { preHandler: app.requireStore }, async (request, reply) => {
    const auth = requireAuth(request)
    const { productId } = request.params as { productId: string }
    const body = offerBody.parse(request.body)

    const [product] = await db.select({ id: products.id }).from(products).where(eq(products.id, productId)).limit(1)
    if (!product) throw notFound('Məhsul tapılmadı.')

    const offer = await upsertOffer({ ...body, productId, merchantId: auth.merchantId! })
    reply.status(201)
    return offer
  })

  app.patch('/offers/:id', { preHandler: app.requireStoreOrAdmin }, async (request) => {
    const auth = requireAuth(request)
    const { id } = request.params as { id: string }
    const body = offerPatchBody.parse(request.body)

    const [existing] = await db.select().from(productOffers).where(eq(productOffers.id, id)).limit(1)
    if (!existing) throw notFound('Təklif tapılmadı.')
    if (auth.role !== 'admin' && existing.merchantId !== auth.merchantId) throw notFound('Təklif tapılmadı.')

    // Merging with the stored row keeps partial updates from silently zeroing
    // required fields such as productUrl.
    return upsertOffer({
      productId: existing.productId,
      merchantId: existing.merchantId,
      price: body.price ?? existing.price,
      oldPrice: body.oldPrice !== undefined ? body.oldPrice : existing.oldPrice,
      currency: body.currency ?? existing.currency.trim(),
      stockStatus: body.stockStatus ?? existing.stockStatus,
      shippingPrice: body.shippingPrice ?? existing.shippingPrice,
      productUrl: body.productUrl ?? existing.productUrl,
      sku: body.sku !== undefined ? body.sku : existing.sku,
    })
  })

  app.delete('/offers/:id', { preHandler: app.requireStoreOrAdmin }, async (request, reply) => {
    const auth = requireAuth(request)
    const { id } = request.params as { id: string }

    const [existing] = await db.select().from(productOffers).where(eq(productOffers.id, id)).limit(1)
    if (!existing) throw notFound('Təklif tapılmadı.')
    if (auth.role !== 'admin' && existing.merchantId !== auth.merchantId) throw notFound('Təklif tapılmadı.')

    await db.delete(productOffers).where(eq(productOffers.id, id))
    reply.status(204)
  })

  /* -------------------------------- tracking -------------------------------- */

  // Returns the outbound URL instead of redirecting, so the SPA can open it in a
  // new tab and the affiliate click is attributed before the user leaves.
  app.post('/offers/:id/click', async (request) => {
    const { id } = request.params as { id: string }

    const [offer] = await db
      .select({
        id: productOffers.id,
        productId: productOffers.productId,
        merchantId: productOffers.merchantId,
        productUrl: productOffers.productUrl,
        stockStatus: productOffers.stockStatus,
      })
      .from(productOffers)
      .where(eq(productOffers.id, id))
      .limit(1)

    if (!offer) throw notFound('Təklif tapılmadı.')
    if (offer.stockStatus === 'out_of_stock') throw badRequest('Bu təklif hazırda stokda yoxdur.')

    recordEvent({ merchantId: offer.merchantId, productId: offer.productId, eventType: 'offer_click', dedupeKey: `${request.ip}:${offer.id}` })
    return { offerId: offer.id, url: offer.productUrl }
  })

  /* ------------------------------ merchant stats ---------------------------- */

  app.get('/offers/:id/price-history', { preHandler: app.requireRole(['store', 'admin']) }, async (request) => {
    const auth = requireAuth(request)
    const { id } = request.params as { id: string }

    const [existing] = await db.select().from(productOffers).where(eq(productOffers.id, id)).limit(1)
    if (!existing) throw notFound('Təklif tapılmadı.')
    if (auth.role !== 'admin' && existing.merchantId !== auth.merchantId) throw notFound('Təklif tapılmadı.')

    const result = await db.execute(sql`
      select to_char(date_trunc('day', recorded_at), 'YYYY-MM-DD') as day, price::text as price
      from price_history
      where product_id = ${existing.productId} and merchant_id = ${existing.merchantId}
      order by recorded_at desc
      limit 365
    `)

    const rows = (result as unknown as { rows: { day: string; price: string }[] }).rows ?? []
    return { offerId: id, points: rows.map((row) => ({ day: row.day, price: Number(row.price) })) }
  })
}
