import { and, eq, isNull, min, ne } from 'drizzle-orm'
import { z } from 'zod'
import { db, type Executor } from '../../db/client.js'
import { notifications, priceAlerts, productOffers, products } from '../../db/schema.js'
import { badRequest } from '../../lib/errors.js'
import { httpUrl } from '../../lib/validation.js'
import { deriveDiscount, recordPriceHistory } from './shared.js'

const offerFields = z.object({
  price: z.coerce.number().nonnegative().max(99_999_999),
  oldPrice: z.coerce.number().positive().max(99_999_999).nullish(),
  currency: z.string().trim().length(3).toUpperCase(),
  stockStatus: z.enum(['in_stock', 'out_of_stock', 'preorder']),
  shippingPrice: z.coerce.number().nonnegative().max(99_999_999),
  productUrl: httpUrl(1000),
  sku: z.string().trim().max(120).nullish(),
})

/** The one offer payload shape, shared by product creation and offer upserts. */
export const offerBody = offerFields.extend({
  currency: offerFields.shape.currency.default('AZN'),
  stockStatus: offerFields.shape.stockStatus.default('in_stock'),
  shippingPrice: offerFields.shape.shippingPrice.default(0),
})

/**
 * Partial updates must not carry defaults: `.partial()` keeps `.default()`, so an
 * omitted field would silently reset the stored value (e.g. back to in_stock).
 */
export const offerPatchBody = offerFields.partial()

export type StockStatusValue = 'in_stock' | 'out_of_stock' | 'preorder'

export type OfferInput = {
  price: number
  oldPrice?: number | null
  currency?: string
  stockStatus?: StockStatusValue
  shippingPrice?: number
  productUrl: string
  sku?: string | null
}

export type UpsertOfferInput = OfferInput & { productId: string; merchantId: string }

/**
 * Single write path for merchant prices. Enforces the two invariants the
 * catalog depends on: discount is derived, and every price change is appended
 * to price_history.
 */
export async function upsertOffer(input: UpsertOfferInput, executor: Executor = db) {
  const oldPrice = input.oldPrice ?? null
  if (oldPrice !== null && oldPrice < input.price) {
    throw badRequest('Köhnə qiymət cari qiymətdən aşağı ola bilməz.')
  }
  const values = {
    productId: input.productId,
    merchantId: input.merchantId,
    price: input.price,
    oldPrice,
    discountPercentage: deriveDiscount(input.price, oldPrice),
    currency: input.currency ?? 'AZN',
    stockStatus: input.stockStatus ?? ('in_stock' as StockStatusValue),
    shippingPrice: input.shippingPrice ?? 0,
    productUrl: input.productUrl,
    sku: input.sku ?? null,
    lastCheckedAt: new Date(),
    updatedAt: new Date(),
  }

  const [offer] = await executor
    .insert(productOffers)
    .values(values)
    .onConflictDoUpdate({
      target: [productOffers.productId, productOffers.merchantId],
      set: {
        price: values.price,
        oldPrice: values.oldPrice,
        discountPercentage: values.discountPercentage,
        currency: values.currency,
        stockStatus: values.stockStatus,
        shippingPrice: values.shippingPrice,
        productUrl: values.productUrl,
        sku: values.sku,
        lastCheckedAt: values.lastCheckedAt,
        updatedAt: values.updatedAt,
      },
    })
    .returning()

  await recordPriceHistory(
    [{ productId: input.productId, merchantId: input.merchantId, price: input.price }],
    executor,
  )
  await triggerPriceAlerts(input.productId, executor)

  return offer
}

/**
 * Notifies shoppers whose target price has now been met. `triggeredAt` is the
 * idempotency key: an alert notifies once, so a merchant flipping a price up and
 * down cannot spam anyone.
 */
export async function triggerPriceAlerts(productId: string, executor: Executor = db): Promise<number> {
  const [cheapest] = await executor
    .select({ price: min(productOffers.price) })
    .from(productOffers)
    .where(and(eq(productOffers.productId, productId), ne(productOffers.stockStatus, 'out_of_stock')))

  if (!cheapest?.price) return 0
  const bestPrice = Number(cheapest.price)

  const pending = await executor
    .select()
    .from(priceAlerts)
    .where(and(eq(priceAlerts.productId, productId), eq(priceAlerts.isActive, true), isNull(priceAlerts.triggeredAt)))

  const hit = pending.filter((alert) => bestPrice <= Number(alert.targetPrice))
  if (hit.length === 0) return 0

  const [product] = await executor.select({ name: products.name }).from(products).where(eq(products.id, productId)).limit(1)
  const productName = product?.name ?? 'İzlədiyiniz məhsul'

  const now = new Date()
  await executor.insert(notifications).values(
    hit.map((alert) => ({
      userId: alert.userId,
      type: 'price_drop',
      title: 'Qiymət hədəfinizə çatdı',
      message: `${productName} indi ${bestPrice} ₼-dır (hədəfiniz: ${alert.targetPrice} ₼).`,
    })),
  )

  for (const alert of hit) {
    await executor.update(priceAlerts).set({ triggeredAt: now }).where(eq(priceAlerts.id, alert.id))
  }

  return hit.length
}
