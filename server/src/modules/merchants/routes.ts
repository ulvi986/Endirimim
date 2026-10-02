import { count, desc, eq, ilike, sql } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { containsPattern, httpUrl } from '../../lib/validation.js'
import { db, rawRows } from '../../db/client.js'
import { merchants, productOffers, reviews } from '../../db/schema.js'
import { notFound } from '../../lib/errors.js'
import { paginate, parsePagination } from '../../lib/pagination.js'
import { requireAuth } from '../../plugins/auth.js'

export default async function merchantRoutes(app: FastifyInstance): Promise<void> {
  /* --------------------------------- public -------------------------------- */

  app.get('/merchants', async (request) => {
    const query = z.object({ q: z.string().trim().max(120).optional() }).parse(request.query)
    const pagination = parsePagination(request.query as Record<string, unknown>)
    const where = query.q ? ilike(merchants.name, containsPattern(query.q)) : undefined

    const [rows, countRows] = await Promise.all([
      db
        .select({
          id: merchants.id,
          name: merchants.name,
          slug: merchants.slug,
          logoUrl: merchants.logoUrl,
          coverUrl: merchants.coverUrl,
          description: merchants.description,
          rating: merchants.rating,
          isVerified: merchants.isVerified,
          createdAt: merchants.createdAt,
        })
        .from(merchants)
        .where(where)
        .orderBy(desc(merchants.isVerified), desc(merchants.rating))
        .limit(pagination.limit)
        .offset(pagination.offset),
      db.select({ total: count() }).from(merchants).where(where),
    ])

    return paginate(rows, Number(countRows[0]?.total ?? 0), pagination)
  })

  app.get('/merchants/:slug', async (request) => {
    const { slug } = request.params as { slug: string }

    const [merchant] = await db.select().from(merchants).where(eq(merchants.slug, slug)).limit(1)
    if (!merchant) throw notFound('Mağaza tapılmadı.')

    const [offerStats] = await db
      .select({
        total: count(),
        cheapestCount: sql<number>`count(*) filter (where ${productOffers.stockStatus} <> 'out_of_stock')::int`,
      })
      .from(productOffers)
      .where(eq(productOffers.merchantId, merchant.id))

    const [reviewStats] = await db
      .select({ total: count() })
      .from(reviews)
      .innerJoin(productOffers, eq(productOffers.productId, reviews.productId))
      .where(eq(productOffers.merchantId, merchant.id))

    // owner_user_id is deliberately not exposed on the public profile.
    const { ownerUserId: _ownerUserId, ...publicMerchant } = merchant

    return {
      ...publicMerchant,
      stats: {
        activeOffers: Number(offerStats?.total ?? 0),
        inStockOffers: Number(offerStats?.cheapestCount ?? 0),
        reviewsOnProducts: Number(reviewStats?.total ?? 0),
      },
    }
  })

  /* ------------------------------- self-service ---------------------------- */

  app.patch('/merchant', { preHandler: app.requireStore }, async (request) => {
    const auth = requireAuth(request)
    const body = z
      .object({
        name: z.string().trim().min(2).max(160).optional(),
        website: z.string().trim().max(300).nullish(),
        description: z.string().trim().max(3000).nullish(),
        phone: z.string().trim().max(40).nullish(),
        logoUrl: httpUrl(500).nullish(),
        coverUrl: httpUrl(500).nullish(),
      })
      .parse(request.body)

    const [updated] = await db
      .update(merchants)
      .set({
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.website !== undefined ? { website: body.website } : {}),
        ...(body.description !== undefined ? { description: body.description } : {}),
        ...(body.phone !== undefined ? { phone: body.phone } : {}),
        ...(body.logoUrl !== undefined ? { logoUrl: body.logoUrl } : {}),
        ...(body.coverUrl !== undefined ? { coverUrl: body.coverUrl } : {}),
        updatedAt: new Date(),
      })
      .where(eq(merchants.id, auth.merchantId!))
      .returning()

    if (!updated) throw notFound('Mağaza tapılmadı.')
    return updated
  })

  /** Everything the store dashboard header needs, in one round trip. */
  app.get('/merchant/dashboard', { preHandler: app.requireStore }, async (request) => {
    const auth = requireAuth(request)
    const merchantId = auth.merchantId!

    const [offerStats] = await db
      .select({
        totalOffers: count(),
        inStock: sql<number>`count(*) filter (where ${productOffers.stockStatus} = 'in_stock')::int`,
        outOfStock: sql<number>`count(*) filter (where ${productOffers.stockStatus} = 'out_of_stock')::int`,
        discounted: sql<number>`count(*) filter (where ${productOffers.discountPercentage} > 0)::int`,
        averageDiscount: sql<string>`coalesce(avg(${productOffers.discountPercentage}) filter (where ${productOffers.discountPercentage} > 0), 0)::text`,
      })
      .from(productOffers)
      .where(eq(productOffers.merchantId, merchantId))

    const eventTotals = await rawRows<{ event_type: string; total: number }>(sql`
      select event_type, count(*)::int as total
      from store_analytics_events
      where merchant_id = ${merchantId} and occurred_at >= now() - interval '30 days'
      group by 1
    `)

    const byType = Object.fromEntries(eventTotals.map((row) => [row.event_type, Number(row.total)]))

    const [merchant] = await db.select().from(merchants).where(eq(merchants.id, merchantId)).limit(1)
    if (!merchant) throw notFound('Mağaza tapılmadı.')

    return {
      merchant,
      offers: {
        total: Number(offerStats?.totalOffers ?? 0),
        inStock: Number(offerStats?.inStock ?? 0),
        outOfStock: Number(offerStats?.outOfStock ?? 0),
        discounted: Number(offerStats?.discounted ?? 0),
        averageDiscount: Number(Number(offerStats?.averageDiscount ?? 0).toFixed(2)),
      },
      last30Days: {
        views: byType.view ?? 0,
        offerClicks: byType.offer_click ?? 0,
        favorites: byType.favorite ?? 0,
        alerts: byType.alert ?? 0,
      },
    }
  })

  app.get('/merchant/analytics', { preHandler: app.requireStore }, async (request) => {
    const auth = requireAuth(request)
    const merchantId = auth.merchantId!
    const query = z.object({ days: z.coerce.number().int().min(1).max(365).default(30) }).parse(request.query)

    const [totals, series, topProducts] = await Promise.all([
      rawRows<{ event_type: string; total: number }>(sql`
        select event_type, count(*)::int as total
        from store_analytics_events
        where merchant_id = ${merchantId}
          and occurred_at >= now() - (${query.days} * interval '1 day')
        group by 1
      `),
      rawRows<{ day: string; event_type: string; total: number }>(sql`
        select to_char(date_trunc('day', occurred_at), 'YYYY-MM-DD') as day,
               event_type,
               count(*)::int as total
        from store_analytics_events
        where merchant_id = ${merchantId}
          and occurred_at >= now() - (${query.days} * interval '1 day')
        group by 1, 2
        order by 1
      `),
      rawRows<{ product_id: string | null; product_name: string | null; event_type: string; total: number }>(sql`
        select e.product_id, p.name as product_name, e.event_type, count(*)::int as total
        from store_analytics_events e
        left join products p on p.id = e.product_id
        where e.merchant_id = ${merchantId}
          and e.occurred_at >= now() - (${query.days} * interval '1 day')
        group by 1, 2, 3
      `),
    ])

    const dailyMap = new Map<string, Record<string, number>>()
    for (const row of series) {
      const bucket = dailyMap.get(row.day) ?? { view: 0, offer_click: 0, favorite: 0, alert: 0 }
      bucket[row.event_type] = Number(row.total)
      dailyMap.set(row.day, bucket)
    }

    const productMap = new Map<string, { productId: string | null; productName: string | null; views: number; clicks: number; favorites: number; alerts: number }>()
    for (const row of topProducts) {
      const key = row.product_id ?? 'unattributed'
      const entry = productMap.get(key) ?? {
        productId: row.product_id,
        productName: row.product_name,
        views: 0,
        clicks: 0,
        favorites: 0,
        alerts: 0,
      }
      const total = Number(row.total)
      if (row.event_type === 'view') entry.views += total
      if (row.event_type === 'offer_click') entry.clicks += total
      if (row.event_type === 'favorite') entry.favorites += total
      if (row.event_type === 'alert') entry.alerts += total
      productMap.set(key, entry)
    }

    return {
      days: query.days,
      totals: Object.fromEntries(totals.map((row) => [row.event_type, Number(row.total)])),
      series: [...dailyMap.entries()]
        .map(([day, bucket]) => ({ day, ...bucket }))
        .sort((a, b) => a.day.localeCompare(b.day)),
      topProducts: [...productMap.values()].sort((a, b) => b.views - a.views).slice(0, 20),
    }
  })

  /** Price competitiveness: where this merchant sits versus the market on each product. */
  app.get('/merchant/positioning', { preHandler: app.requireStore }, async (request) => {
    const auth = requireAuth(request)
    const merchantId = auth.merchantId!

    const rows = await rawRows<{
      product_id: string
      product_name: string
      own_price: string
      best_price: string
      worst_price: string
      merchant_count: number
      rank: number
    }>(sql`
      with market as (
        select product_id, min(price) as best_price, max(price) as worst_price, count(*)::int as merchant_count
        from product_offers
        group by product_id
      )
      select o.product_id, p.name as product_name, o.price::text as own_price,
             m.best_price::text as best_price, m.worst_price::text as worst_price, m.merchant_count,
             (select count(*)::int from product_offers c where c.product_id = o.product_id and c.price < o.price) + 1 as rank
      from product_offers o
      join market m on m.product_id = o.product_id
      join products p on p.id = o.product_id
      where o.merchant_id = ${merchantId}
      order by p.name
    `)

    const items = rows.map((row) => {
      const own = Number(row.own_price)
      const best = Number(row.best_price)
      const worst = Number(row.worst_price)
      const rank = Number(row.rank)

      return {
        productId: row.product_id,
        productName: row.product_name,
        ownPrice: own,
        marketBestPrice: best,
        marketWorstPrice: worst,
        competitorCount: Number(row.merchant_count),
        rank,
        isCheapest: own === best,
        deltaToBest: Number((own - best).toFixed(2)),
      }
    })

    const cheapestCount = items.filter((item) => item.isCheapest).length

    return {
      offers: items,
      summary: {
        trackedProducts: items.length,
        cheapestCount,
        cheapestRate: items.length > 0 ? Math.round((cheapestCount / items.length) * 1000) / 10 : 0,
        averageDeltaToBest:
          items.length > 0
            ? Number((items.reduce((total, item) => total + item.deltaToBest, 0) / items.length).toFixed(2))
            : 0,
      },
    }
  })
}
