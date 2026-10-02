import { avg, count, eq, inArray } from 'drizzle-orm'
import { db, type Executor } from '../../db/client.js'
import { notFound } from '../../lib/errors.js'
import { brands, categories, merchants, priceHistory, productImages, productOffers, products, reviews } from '../../db/schema.js'
import { storage } from '../../storage/index.js'

const round2 = (value: number) => Math.round(value * 100) / 100

export type OfferSummary = {
  id: string
  merchantId: string
  merchantName: string
  merchantSlug: string
  merchantIsVerified: boolean
  merchantRating: number
  price: number
  oldPrice: number | null
  discountPercentage: number
  currency: string
  stockStatus: 'in_stock' | 'out_of_stock' | 'preorder'
  shippingPrice: number
  totalPrice: number
  productUrl: string
  sku: string | null
  lastCheckedAt: Date | null
  isCheapest: boolean
}

export type ImageSummary = { id: string; url: string; altText: string | null; sortOrder: number; isPrimary: boolean }

export type ProductSummary = {
  id: string
  name: string
  slug: string
  description: string | null
  brand: { id: string; name: string; slug: string } | null
  category: { id: string; name: string; slug: string } | null
  rating: number
  reviewCount: number
  specifications: Record<string, unknown>
  images: ImageSummary[]
  primaryImage: ImageSummary | null
  offers: OfferSummary[]
  offerCount: number
  bestPrice: number | null
  highestPrice: number | null
  maxDiscountPercentage: number
  currency: string | null
  createdAt: Date
  updatedAt: Date
}

export type ProductListRow = {
  id: string
  name: string
  slug: string
  description: string | null
  rating: number
  reviewCount: number
  specifications: Record<string, unknown>
  createdAt: Date
  updatedAt: Date
  brandId: string | null
  brandName: string | null
  brandSlug: string | null
  categoryId: string | null
  categoryName: string | null
  categorySlug: string | null
}

/**
 * Two batched queries instead of a lateral join per product, so a page of 100
 * products costs 3 round trips total regardless of page size.
 */
export async function loadOffersForProducts(
  productIds: string[],
  executor: Executor = db,
): Promise<Map<string, OfferSummary[]>> {
  const map = new Map<string, OfferSummary[]>()
  if (productIds.length === 0) return map

  const rows = await executor
    .select({
      id: productOffers.id,
      productId: productOffers.productId,
      merchantId: productOffers.merchantId,
      price: productOffers.price,
      oldPrice: productOffers.oldPrice,
      discountPercentage: productOffers.discountPercentage,
      currency: productOffers.currency,
      stockStatus: productOffers.stockStatus,
      shippingPrice: productOffers.shippingPrice,
      productUrl: productOffers.productUrl,
      sku: productOffers.sku,
      lastCheckedAt: productOffers.lastCheckedAt,
      merchantName: merchants.name,
      merchantSlug: merchants.slug,
      merchantIsVerified: merchants.isVerified,
      merchantRating: merchants.rating,
    })
    .from(productOffers)
    .innerJoin(merchants, eq(merchants.id, productOffers.merchantId))
    .where(inArray(productOffers.productId, productIds))
    .orderBy(productOffers.price)

  for (const row of rows) {
    const list = map.get(row.productId) ?? []
    list.push({
      id: row.id,
      merchantId: row.merchantId,
      merchantName: row.merchantName,
      merchantSlug: row.merchantSlug,
      merchantIsVerified: row.merchantIsVerified,
      merchantRating: Number(row.merchantRating),
      price: Number(row.price),
      oldPrice: row.oldPrice === null ? null : Number(row.oldPrice),
      discountPercentage: Number(row.discountPercentage),
      currency: row.currency.trim(),
      stockStatus: row.stockStatus,
      shippingPrice: Number(row.shippingPrice),
      totalPrice: round2(Number(row.price) + Number(row.shippingPrice)),
      productUrl: row.productUrl,
      sku: row.sku,
      lastCheckedAt: row.lastCheckedAt,
      isCheapest: false,
    })
    map.set(row.productId, list)
  }

  // Cheapest in-stock offer is the headline price; fall back to cheapest overall.
  for (const list of map.values()) {
    const inStock = list.filter((offer) => offer.stockStatus !== 'out_of_stock')
    const winner = (inStock.length > 0 ? inStock : list)[0]
    if (winner) winner.isCheapest = true
    list.sort((a, b) => Number(b.isCheapest) - Number(a.isCheapest) || a.price - b.price)
  }

  return map
}

export async function loadImagesForProducts(
  productIds: string[],
  executor: Executor = db,
): Promise<Map<string, ImageSummary[]>> {
  const map = new Map<string, ImageSummary[]>()
  if (productIds.length === 0) return map

  const rows = await executor
    .select({
      id: productImages.id,
      productId: productImages.productId,
      storageKey: productImages.storageKey,
      altText: productImages.altText,
      sortOrder: productImages.sortOrder,
      isPrimary: productImages.isPrimary,
    })
    .from(productImages)
    .where(inArray(productImages.productId, productIds))
    .orderBy(productImages.sortOrder)

  for (const row of rows) {
    const list = map.get(row.productId) ?? []
    list.push({
      id: row.id,
      // Only the object key is persisted; the public URL is derived on read so
      // the storage backend can change without a data migration.
      url: storage.url(row.storageKey),
      altText: row.altText,
      sortOrder: row.sortOrder,
      isPrimary: row.isPrimary,
    })
    map.set(row.productId, list)
  }

  return map
}

export function summarizeProduct(
  row: ProductListRow,
  offers: OfferSummary[] = [],
  images: ImageSummary[] = [],
): ProductSummary {
  const bestPrice = offers.length > 0 ? Math.min(...offers.map((offer) => offer.price)) : null
  const highestPrice = offers.length > 0 ? Math.max(...offers.map((offer) => offer.price)) : null

  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    description: row.description,
    brand: row.brandId && row.brandName && row.brandSlug ? { id: row.brandId, name: row.brandName, slug: row.brandSlug } : null,
    category:
      row.categoryId && row.categoryName && row.categorySlug
        ? { id: row.categoryId, name: row.categoryName, slug: row.categorySlug }
        : null,
    rating: Number(row.rating),
    reviewCount: row.reviewCount,
    specifications: row.specifications ?? {},
    images,
    primaryImage: images.find((image) => image.isPrimary) ?? images[0] ?? null,
    offers,
    offerCount: offers.length,
    bestPrice,
    highestPrice,
    maxDiscountPercentage: offers.length > 0 ? Math.max(...offers.map((offer) => offer.discountPercentage)) : 0,
    currency: offers[0]?.currency ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

export async function loadProductSummaries(rows: ProductListRow[], executor: Executor = db): Promise<ProductSummary[]> {
  const ids = rows.map((row) => row.id)
  const [offers, images] = await Promise.all([
    loadOffersForProducts(ids, executor),
    loadImagesForProducts(ids, executor),
  ])
  return rows.map((row) => summarizeProduct(row, offers.get(row.id) ?? [], images.get(row.id) ?? []))
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value)
}

/** Accepts either a uuid or a slug so public URLs can stay human-readable. */
export async function resolveProductId(idOrSlug: string, executor: Executor = db): Promise<string> {
  const [product] = await executor
    .select({ id: products.id })
    .from(products)
    .where(isUuid(idOrSlug) ? eq(products.id, idOrSlug) : eq(products.slug, idOrSlug))
    .limit(1)

  if (!product) throw notFound('Məhsul tapılmadı.')
  return product.id
}

/**
 * The one product projection. Every module (catalog, favorites, lists, alerts)
 * selects through this so a product looks identical in every response.
 */
export const productRowColumns = {
  id: products.id,
  name: products.name,
  slug: products.slug,
  description: products.description,
  rating: products.rating,
  reviewCount: products.reviewCount,
  specifications: products.specifications,
  createdAt: products.createdAt,
  updatedAt: products.updatedAt,
  brandId: brands.id,
  brandName: brands.name,
  brandSlug: brands.slug,
  categoryId: categories.id,
  categoryName: categories.name,
  categorySlug: categories.slug,
} as const

/**
 * Returns a map rather than an array: callers reach products through an
 * ordered join (favorites, lists) and re-order from their own rows.
 */
export async function loadProductRowsByIds(
  ids: string[],
  executor: Executor = db,
): Promise<Map<string, ProductListRow>> {
  const map = new Map<string, ProductListRow>()
  if (ids.length === 0) return map

  const rows = await executor
    .select(productRowColumns)
    .from(products)
    .leftJoin(brands, eq(brands.id, products.brandId))
    .leftJoin(categories, eq(categories.id, products.categoryId))
    .where(inArray(products.id, ids))

  for (const row of rows) map.set(row.id, row as ProductListRow)
  return map
}

/**
 * Discount is always derived server-side from old_price, never trusted from the
 * client, so a merchant cannot display a fake "-90%".
 */
export function deriveDiscount(price: number, oldPrice: number | null | undefined): number {
  if (!oldPrice || oldPrice <= price) return 0
  return round2(((oldPrice - price) / oldPrice) * 100)
}

export async function recordPriceHistory(
  entries: { productId: string; merchantId: string; price: number }[],
  executor: Executor = db,
): Promise<void> {
  if (entries.length === 0) return
  await executor.insert(priceHistory).values(entries)
}

/** Keeps products.rating / review_count derived from the reviews table. */
export async function recomputeProductRating(productId: string, executor: Executor = db): Promise<void> {
  const [row] = await executor
    .select({ average: avg(reviews.rating), total: count() })
    .from(reviews)
    .where(eq(reviews.productId, productId))

  await executor
    .update(products)
    .set({ rating: round2(Number(row?.average ?? 0)), reviewCount: Number(row?.total ?? 0), updatedAt: new Date() })
    .where(eq(products.id, productId))
}
