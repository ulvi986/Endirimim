import { and, asc, desc, eq, sql, type SQL } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { env } from '../../config/env.js'
import { db } from '../../db/client.js'
import { brands, categories, productImages, productOffers, products } from '../../db/schema.js'
import { badRequest, internal, notFound } from '../../lib/errors.js'
import { paginate, parsePagination } from '../../lib/pagination.js'
import { uniqueSlug } from '../../lib/slug.js'
import { ALLOWED_IMAGE_TYPES, buildObjectKey, contentMatchesImageType, storage } from '../../storage/index.js'
import { containsPattern } from '../../lib/validation.js'
import { requireAuth } from '../../plugins/auth.js'
import { recordEvent } from '../analytics/events.js'
import { offerBody, upsertOffer } from './offers.service.js'
import {
  loadImagesForProducts,
  loadOffersForProducts,
  loadProductSummaries,
  productRowColumns,
  summarizeProduct,
  type ProductListRow,
} from './shared.js'

const productRowSelection = productRowColumns

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const listQuery = z.object({
  q: z.string().trim().max(120).optional(),
  category: z.string().trim().max(120).optional(),
  brand: z.string().trim().max(120).optional(),
  minPrice: z.coerce.number().nonnegative().optional(),
  maxPrice: z.coerce.number().nonnegative().optional(),
  inStock: z.enum(['true', 'false']).optional(),
  hasDiscount: z.enum(['true', 'false']).optional(),
  sort: z.enum(['newest', 'rating', 'name', 'best_price', 'biggest_discount']).default('newest'),
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().optional(),
})

const productFields = z.object({
  name: z.string().trim().min(2).max(250),
  slug: z.string().trim().max(120).optional(),
  description: z.string().trim().max(5000).nullish(),
  brandId: z.uuid().nullish(),
  categoryId: z.uuid().nullish(),
  specifications: z.record(z.string(), z.unknown()),
})

const createProductBody = productFields.extend({
  specifications: productFields.shape.specifications.default({}),
  offer: offerBody.optional(),
})

// Built from the default-free fields: `.partial()` keeps `.default()`, which
// would wipe stored specifications on any update that omits them.
const updateProductBody = productFields.partial()

export default async function productRoutes(app: FastifyInstance): Promise<void> {
  /* --------------------------------- public -------------------------------- */

  app.get('/products', async (request) => {
    const query = listQuery.parse(request.query)
    const pagination = parsePagination(query)
    const conditions: SQL[] = []

    if (query.q) {
      const pattern = containsPattern(query.q)
      conditions.push(
        sql`(to_tsvector('simple', ${products.name}) @@ plainto_tsquery('simple', ${query.q}) or ${products.name} ilike ${pattern})`,
      )
    }

    // Slugs are resolved to ids up front so the paged query and its COUNT share
    // one plan instead of each joining the taxonomy tables.
    if (query.category) {
      const [category] = await db.select({ id: categories.id }).from(categories).where(eq(categories.slug, query.category)).limit(1)
      if (!category) return paginate([], 0, pagination)
      conditions.push(eq(products.categoryId, category.id))
    }

    if (query.brand) {
      const [brand] = await db.select({ id: brands.id }).from(brands).where(eq(brands.slug, query.brand)).limit(1)
      if (!brand) return paginate([], 0, pagination)
      conditions.push(eq(products.brandId, brand.id))
    }

    if (query.minPrice !== undefined) {
      conditions.push(
        sql`exists (select 1 from product_offers po where po.product_id = ${products.id} and po.price >= ${query.minPrice})`,
      )
    }
    if (query.maxPrice !== undefined) {
      conditions.push(
        sql`exists (select 1 from product_offers po where po.product_id = ${products.id} and po.price <= ${query.maxPrice})`,
      )
    }
    if (query.inStock === 'true') {
      conditions.push(
        sql`exists (select 1 from product_offers po where po.product_id = ${products.id} and po.stock_status <> 'out_of_stock')`,
      )
    }
    if (query.hasDiscount === 'true') {
      conditions.push(
        sql`exists (select 1 from product_offers po where po.product_id = ${products.id} and po.discount_percentage > 0)`,
      )
    }

    const where = conditions.length > 0 ? and(...conditions) : undefined

    const orderBy = (() => {
      switch (query.sort) {
        case 'rating':
          return [desc(products.rating), desc(products.reviewCount)]
        case 'name':
          return [asc(products.name)]
        case 'best_price':
          return [sql`(select min(po.price) from product_offers po where po.product_id = ${products.id}) asc nulls last`]
        case 'biggest_discount':
          return [sql`(select max(po.discount_percentage) from product_offers po where po.product_id = ${products.id}) desc nulls last`]
        default:
          return [desc(products.createdAt)]
      }
    })()

    const [rows, countRows] = await Promise.all([
      db
        .select(productRowSelection)
        .from(products)
        .leftJoin(brands, eq(brands.id, products.brandId))
        .leftJoin(categories, eq(categories.id, products.categoryId))
        .where(where)
        .orderBy(...orderBy)
        .limit(pagination.limit)
        .offset(pagination.offset),
      db.select({ total: sql<number>`count(*)::int` }).from(products).where(where),
    ])

    const summaries = await loadProductSummaries(rows as ProductListRow[])
    return paginate(summaries, Number(countRows[0]?.total ?? 0), pagination)
  })

  app.get('/products/:idOrSlug', async (request) => {
    const { idOrSlug } = request.params as { idOrSlug: string }
    const isUuid = UUID_RE.test(idOrSlug)

    const [row] = await db
      .select(productRowSelection)
      .from(products)
      .leftJoin(brands, eq(brands.id, products.brandId))
      .leftJoin(categories, eq(categories.id, products.categoryId))
      .where(isUuid ? eq(products.id, idOrSlug) : eq(products.slug, idOrSlug))
      .limit(1)

    if (!row) throw notFound('Məhsul tapılmadı.')

    const [offers, images] = await Promise.all([
      loadOffersForProducts([row.id]),
      loadImagesForProducts([row.id]),
    ])

    const summary = summarizeProduct(row as ProductListRow, offers.get(row.id) ?? [], images.get(row.id) ?? [])

    // The cheapest store gets the view credit, since that is who the shopper saw.
    recordEvent({
      merchantId: summary.offers.find((offer) => offer.isCheapest)?.merchantId,
      productId: row.id,
      eventType: 'view',
      dedupeKey: `${request.ip}:${row.id}`,
    })

    return summary
  })

  app.get('/products/:idOrSlug/offers', async (request) => {
    const { idOrSlug } = request.params as { idOrSlug: string }
    const product = await resolveProductId(idOrSlug)
    const offers = await loadOffersForProducts([product.id])
    return { productId: product.id, items: offers.get(product.id) ?? [] }
  })

  app.get('/products/:idOrSlug/price-history', async (request) => {
    const { idOrSlug } = request.params as { idOrSlug: string }
    const rawQuery = z
      .object({
        merchantId: z.uuid().optional(),
        days: z.coerce.number().int().min(1).max(730).default(90),
      })
      .parse(request.query)

    const product = await resolveProductId(idOrSlug)

    const result = await db.execute(sql`
      select to_char(date_trunc('day', recorded_at), 'YYYY-MM-DD') as day,
             min(price)::text  as min_price,
             max(price)::text  as max_price,
             avg(price)::text  as avg_price,
             count(*)::int     as samples
      from price_history
      where product_id = ${product.id}
        and recorded_at >= now() - (${rawQuery.days} * interval '1 day')
        ${rawQuery.merchantId ? sql`and merchant_id = ${rawQuery.merchantId}` : sql``}
      group by 1
      order by 1
    `)

    const rows = (result as unknown as { rows: RawPricePoint[] }).rows ?? []

    return {
      productId: product.id,
      days: rawQuery.days,
      points: rows.map((row) => ({
        day: row.day,
        minPrice: Number(row.min_price),
        maxPrice: Number(row.max_price),
        averagePrice: Number(Number(row.avg_price).toFixed(2)),
        samples: Number(row.samples),
      })),
    }
  })

  /* ------------------------------ merchant write ---------------------------- */

  app.post('/products', { preHandler: app.requireStore }, async (request, reply) => {
    const auth = requireAuth(request)
    const body = createProductBody.parse(request.body)

    if (!auth.merchantId) throw badRequest('Mağaza profili tapılmadı.')
    if (!body.offer) throw badRequest('Məhsul əlavə edərkən ilk təklifinizi də göndərməlisiniz.')

    // Captured before the transaction so narrowing survives into the closure.
    const merchantId = auth.merchantId
    const offerInput = body.offer

    const result = await db.transaction(async (tx) => {
      const slug = await uniqueSlug(body.slug ?? body.name, async (candidate) => {
        const [existing] = await tx.select({ id: products.id }).from(products).where(eq(products.slug, candidate)).limit(1)
        return Boolean(existing)
      })

      const [created] = await tx
        .insert(products)
        .values({
          name: body.name,
          slug,
          description: body.description ?? null,
          brandId: body.brandId ?? null,
          categoryId: body.categoryId ?? null,
          specifications: body.specifications,
        })
        .returning()

      if (!created) throw internal('Məhsul yaradıla bilmədi.')

      const offer = await upsertOffer({ ...offerInput, productId: created.id, merchantId }, tx)
      return { created, offer }
    })

    reply.status(201)
    return { product: result.created, offer: result.offer }
  })

  // Catalog entries are shared across merchants, so editing them is an admin
  // action. Merchants edit their own offer (see offers.routes.ts).
  app.patch('/products/:id', { preHandler: app.requireRole(['admin']) }, async (request) => {
    const { id } = request.params as { id: string }
    const body = updateProductBody.parse(request.body)

    const [updated] = await db
      .update(products)
      .set({
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.slug !== undefined ? { slug: body.slug } : {}),
        ...(body.description !== undefined ? { description: body.description } : {}),
        ...(body.brandId !== undefined ? { brandId: body.brandId } : {}),
        ...(body.categoryId !== undefined ? { categoryId: body.categoryId } : {}),
        ...(body.specifications !== undefined ? { specifications: body.specifications } : {}),
        updatedAt: new Date(),
      })
      .where(eq(products.id, id))
      .returning()

    if (!updated) throw notFound('Məhsul tapılmadı.')
    return updated
  })

  app.delete('/products/:id', { preHandler: app.requireRole(['admin']) }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const [deleted] = await db.delete(products).where(eq(products.id, id)).returning({ id: products.id })
    if (!deleted) throw notFound('Məhsul tapılmadı.')
    reply.status(204)
  })

  /* --------------------------------- images -------------------------------- */

  app.post('/products/:id/images', { preHandler: app.requireStoreOrAdmin }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const auth = requireAuth(request)

    const [product] = await db.select({ id: products.id }).from(products).where(eq(products.id, id)).limit(1)
    if (!product) throw notFound('Məhsul tapılmadı.')

    // A merchant may only attach media to a product they actually sell.
    if (auth.role !== 'admin') {
      const [ownOffer] = await db
        .select({ id: productOffers.id })
        .from(productOffers)
        .where(and(eq(productOffers.productId, id), eq(productOffers.merchantId, auth.merchantId!)))
        .limit(1)
      if (!ownOffer) throw notFound('Bu məhsul üçün təklifiniz yoxdur.')
    }

    const upload = await request.file({ limits: { fileSize: env.MAX_UPLOAD_BYTES } })
    if (!upload) throw badRequest('Şəkil faylı tələb olunur.')
    if (!ALLOWED_IMAGE_TYPES.includes(upload.mimetype)) {
      throw badRequest(`Dəstəklənməyən fayl növü: ${upload.mimetype}. İcazə verilənlər: ${ALLOWED_IMAGE_TYPES.join(', ')}`)
    }

    const buffer = await upload.toBuffer()
    if (upload.file.truncated) throw badRequest('Fayl ölçüsü həddi aşıldı.')
    if (!contentMatchesImageType(buffer, upload.mimetype)) throw badRequest('Faylın məzmunu göstərilən şəkil növünə uyğun deyil.')

    const key = buildObjectKey(`products/${id}`, upload.filename ?? 'image', upload.mimetype)
    const stored = await storage.put({ key, body: buffer, contentType: upload.mimetype })

    const existing = await db.select({ id: productImages.id }).from(productImages).where(eq(productImages.productId, id))
    const altText = (upload.fields?.altText as { value?: string } | undefined)?.value ?? null

    const [image] = await db
      .insert(productImages)
      .values({
        productId: id,
        storageKey: stored.key,
        altText,
        sortOrder: existing.length,
        isPrimary: existing.length === 0,
      })
      .returning()

    reply.status(201)
    return { ...image, url: storage.url(stored.key) }
  })

  app.delete('/products/:productId/images/:imageId', { preHandler: app.requireStoreOrAdmin }, async (request, reply) => {
    const { productId, imageId } = request.params as { productId: string; imageId: string }
    const auth = requireAuth(request)

    if (auth.role !== 'admin') {
      const [ownOffer] = await db
        .select({ id: productOffers.id })
        .from(productOffers)
        .where(and(eq(productOffers.productId, productId), eq(productOffers.merchantId, auth.merchantId!)))
        .limit(1)
      if (!ownOffer) throw notFound('Bu məhsul üçün təklifiniz yoxdur.')
    }

    const [deleted] = await db
      .delete(productImages)
      .where(and(eq(productImages.id, imageId), eq(productImages.productId, productId)))
      .returning()

    if (!deleted) throw notFound('Şəkil tapılmadı.')

    await storage.remove(deleted.storageKey)

    // Never leave a product without a primary image.
    if (deleted.isPrimary) {
      const [next] = await db
        .select({ id: productImages.id })
        .from(productImages)
        .where(eq(productImages.productId, productId))
        .orderBy(asc(productImages.sortOrder))
        .limit(1)
      if (next) await db.update(productImages).set({ isPrimary: true }).where(eq(productImages.id, next.id))
    }

    reply.status(204)
  })

  app.patch('/products/:productId/images/:imageId', { preHandler: app.requireStoreOrAdmin }, async (request) => {
    const { productId, imageId } = request.params as { productId: string; imageId: string }
    const auth = requireAuth(request)
    const body = z.object({ altText: z.string().max(300).nullish(), isPrimary: z.boolean().optional() }).parse(request.body)

    if (auth.role !== 'admin') {
      const [ownOffer] = await db
        .select({ id: productOffers.id })
        .from(productOffers)
        .where(and(eq(productOffers.productId, productId), eq(productOffers.merchantId, auth.merchantId!)))
        .limit(1)
      if (!ownOffer) throw notFound('Bu məhsul üçün təklifiniz yoxdur.')
    }

    const updated = await db.transaction(async (tx) => {
      const [target] = await tx
        .select({ id: productImages.id })
        .from(productImages)
        .where(and(eq(productImages.id, imageId), eq(productImages.productId, productId)))
        .limit(1)
      if (!target) throw notFound('Şəkil tapılmadı.')

      if (body.isPrimary) {
        await tx.update(productImages).set({ isPrimary: false }).where(eq(productImages.productId, productId))
      }

      const [row] = await tx
        .update(productImages)
        .set({
          ...(body.altText !== undefined ? { altText: body.altText } : {}),
          ...(body.isPrimary !== undefined ? { isPrimary: body.isPrimary } : {}),
        })
        .where(eq(productImages.id, imageId))
        .returning()
      return row
    })

    if (!updated) throw notFound('Şəkil tapılmadı.')
    return { ...updated, url: storage.url(updated.storageKey) }
  })
}

type RawPricePoint = { day: string; min_price: string; max_price: string; avg_price: string; samples: number }

async function resolveProductId(idOrSlug: string): Promise<{ id: string }> {
  const isUuid = UUID_RE.test(idOrSlug)
  const [product] = await db
    .select({ id: products.id })
    .from(products)
    .where(isUuid ? eq(products.id, idOrSlug) : eq(products.slug, idOrSlug))
    .limit(1)
  if (!product) throw notFound('Məhsul tapılmadı.')
  return product
}
