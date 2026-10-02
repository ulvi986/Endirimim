import { sql } from 'drizzle-orm'
import {
  bigserial,
  boolean,
  char,
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core'

/**
 * Mirrors database/schema.sql. That file remains the fresh-database bootstrap;
 * Drizzle owns migrations from this point forward, so any change here must be
 * accompanied by a change there and a generated migration in server/drizzle.
 */

export const accountRole = pgEnum('account_role', ['user', 'store', 'admin'])
export const stockStatus = pgEnum('stock_status', ['in_stock', 'out_of_stock', 'preorder'])

const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
const updatedAt = () => timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    email: text('email').notNull().unique(),
    passwordHash: text('password_hash'),
    authProvider: text('auth_provider').notNull().default('password'),
    firstName: text('first_name'),
    lastName: text('last_name'),
    avatarUrl: text('avatar_url'),
    role: accountRole('role').notNull().default('user'),
    emailVerifiedAt: timestamp('email_verified_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [index('users_role_idx').on(table.role)],
)

export const merchants = pgTable(
  'merchants',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ownerUserId: uuid('owner_user_id')
      .notNull()
      .unique()
      .references(() => users.id, { onDelete: 'restrict' }),
    name: text('name').notNull(),
    slug: text('slug').notNull().unique(),
    logoUrl: text('logo_url'),
    coverUrl: text('cover_url'),
    website: text('website'),
    description: text('description'),
    phone: text('phone'),
    rating: numeric('rating', { precision: 3, scale: 2, mode: 'number' }).notNull().default(0),
    isVerified: boolean('is_verified').notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [index('merchants_slug_idx').on(table.slug)],
)

export const categories = pgTable(
  'categories',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    parentId: uuid('parent_id').references((): AnyPgColumn => categories.id, { onDelete: 'set null' }),
    name: text('name').notNull(),
    slug: text('slug').notNull().unique(),
    imageUrl: text('image_url'),
    description: text('description'),
    createdAt: createdAt(),
  },
  (table) => [index('categories_parent_idx').on(table.parentId)],
)

export const brands = pgTable('brands', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  logoUrl: text('logo_url'),
})

export const products = pgTable(
  'products',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    slug: text('slug').notNull().unique(),
    description: text('description'),
    brandId: uuid('brand_id').references(() => brands.id, { onDelete: 'set null' }),
    categoryId: uuid('category_id').references(() => categories.id, { onDelete: 'set null' }),
    rating: numeric('rating', { precision: 3, scale: 2, mode: 'number' }).notNull().default(0),
    reviewCount: integer('review_count').notNull().default(0),
    specifications: jsonb('specifications').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    index('products_name_search_idx').using('gin', sql`to_tsvector('simple', ${table.name})`),
    index('products_category_idx').on(table.categoryId),
    index('products_brand_idx').on(table.brandId),
  ],
)

export const productImages = pgTable(
  'product_images',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    storageKey: text('storage_key').notNull(),
    altText: text('alt_text'),
    sortOrder: integer('sort_order').notNull().default(0),
    isPrimary: boolean('is_primary').notNull().default(false),
    createdAt: createdAt(),
  },
  (table) => [index('product_images_product_idx').on(table.productId, table.sortOrder)],
)

export const productOffers = pgTable(
  'product_offers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    merchantId: uuid('merchant_id')
      .notNull()
      .references(() => merchants.id, { onDelete: 'cascade' }),
    price: numeric('price', { precision: 12, scale: 2, mode: 'number' }).notNull(),
    oldPrice: numeric('old_price', { precision: 12, scale: 2, mode: 'number' }),
    discountPercentage: numeric('discount_percentage', { precision: 5, scale: 2, mode: 'number' }).notNull().default(0),
    currency: char('currency', { length: 3 }).notNull().default('AZN'),
    stockStatus: stockStatus('stock_status').notNull().default('in_stock'),
    shippingPrice: numeric('shipping_price', { precision: 12, scale: 2, mode: 'number' }).notNull().default(0),
    productUrl: text('product_url').notNull(),
    sku: text('sku'),
    lastCheckedAt: timestamp('last_checked_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    unique('product_offers_product_id_merchant_id_key').on(table.productId, table.merchantId),
    check('product_offers_price_check', sql`${table.price} >= 0`),
    check('product_offers_old_price_check', sql`${table.oldPrice} is null or ${table.oldPrice} >= ${table.price}`),
    check('product_offers_shipping_price_check', sql`${table.shippingPrice} >= 0`),
    index('offers_product_price_idx').on(table.productId, table.price),
    index('offers_merchant_idx').on(table.merchantId),
  ],
)

export const priceHistory = pgTable(
  'price_history',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    merchantId: uuid('merchant_id')
      .notNull()
      .references(() => merchants.id, { onDelete: 'cascade' }),
    price: numeric('price', { precision: 12, scale: 2, mode: 'number' }).notNull(),
    recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('price_history_lookup_idx').on(table.productId, table.recordedAt.desc())],
)

export const favorites = pgTable(
  'favorites',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    createdAt: createdAt(),
  },
  (table) => [unique('favorites_user_id_product_id_key').on(table.userId, table.productId)],
)

export const priceAlerts = pgTable(
  'price_alerts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    targetPrice: numeric('target_price', { precision: 12, scale: 2, mode: 'number' }).notNull(),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: createdAt(),
    triggeredAt: timestamp('triggered_at', { withTimezone: true }),
  },
  (table) => [
    index('active_alerts_idx').on(table.productId).where(sql`${table.isActive} = true`),
    // One alert per shopper per product; the API's pre-check alone races.
    unique('price_alerts_user_id_product_id_key').on(table.userId, table.productId),
    check('price_alerts_target_price_check', sql`${table.targetPrice} >= 0`),
  ],
)

export const shoppingLists = pgTable(
  'shopping_lists',
  {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
  },
  (table) => [index('shopping_lists_user_idx').on(table.userId, table.updatedAt.desc())],
)

export const shoppingListItems = pgTable(
  'shopping_list_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    shoppingListId: uuid('shopping_list_id')
      .notNull()
      .references(() => shoppingLists.id, { onDelete: 'cascade' }),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    quantity: integer('quantity').notNull().default(1),
    createdAt: createdAt(),
  },
  (table) => [
    unique('shopping_list_items_list_id_product_id_key').on(table.shoppingListId, table.productId),
    check('shopping_list_items_quantity_check', sql`${table.quantity} > 0`),
  ],
)

export const productComparisons = pgTable(
  'product_comparisons',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    createdAt: createdAt(),
  },
  (table) => [unique('product_comparisons_user_id_product_id_key').on(table.userId, table.productId)],
)

export const reviews = pgTable(
  'reviews',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    rating: integer('rating').notNull(),
    title: text('title'),
    content: text('content'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    unique('reviews_user_id_product_id_key').on(table.userId, table.productId),
    index('reviews_product_created_idx').on(table.productId, table.createdAt.desc()),
    check('reviews_rating_check', sql`${table.rating} between 1 and 5`),
  ],
)

export const discountCampaigns = pgTable(
  'discount_campaigns',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    merchantId: uuid('merchant_id')
      .notNull()
      .references(() => merchants.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    description: text('description'),
    imageUrl: text('image_url'),
    startDate: timestamp('start_date', { withTimezone: true }).notNull(),
    endDate: timestamp('end_date', { withTimezone: true }).notNull(),
    url: text('url'),
    isActive: boolean('is_active').notNull().default(false),
    createdAt: createdAt(),
  },
  (table) => [
    index('campaigns_active_dates_idx').on(table.isActive, table.startDate, table.endDate),
    index('campaigns_merchant_idx').on(table.merchantId),
    check('discount_campaigns_dates_check', sql`${table.endDate} > ${table.startDate}`),
  ],
)

export const notifications = pgTable(
  'notifications',
  {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  type: text('type').notNull(),
  title: text('title').notNull(),
  message: text('message').notNull(),
  isRead: boolean('is_read').notNull().default(false),
  createdAt: createdAt(),
  },
  (table) => [index('notifications_user_created_idx').on(table.userId, table.createdAt.desc())],
)

export const mediaAssets = pgTable(
  'media_assets',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    merchantId: uuid('merchant_id')
      .notNull()
      .references(() => merchants.id, { onDelete: 'cascade' }),
    storageKey: text('storage_key').notNull(),
    mediaType: text('media_type').notNull(),
    originalName: text('original_name'),
    mimeType: text('mime_type'),
    sizeBytes: integer('size_bytes'),
    createdAt: createdAt(),
  },
  (table) => [index('media_assets_merchant_idx').on(table.merchantId, table.createdAt.desc())],
)

export const storeAnalyticsEvents = pgTable(
  'store_analytics_events',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    merchantId: uuid('merchant_id')
      .notNull()
      .references(() => merchants.id, { onDelete: 'cascade' }),
    productId: uuid('product_id').references(() => products.id, { onDelete: 'set null' }),
    eventType: text('event_type').notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('analytics_merchant_date_idx').on(table.merchantId, table.occurredAt.desc()),
    check('store_analytics_events_event_type_check', sql`${table.eventType} in ('view', 'offer_click', 'favorite', 'alert')`),
  ],
)

export const seoMetadata = pgTable(
  'seo_metadata',
  {
  productId: uuid('product_id')
    .primaryKey()
    .references(() => products.id, { onDelete: 'cascade' }),
  title: text('title'),
  description: text('description'),
  slug: text('slug').unique(),
  keywords: text('keywords').array(),
  ogImageUrl: text('og_image_url'),
  score: integer('score').notNull().default(0),
  updatedAt: updatedAt(),
  },
  (table) => [check('seo_metadata_score_check', sql`${table.score} between 0 and 100`)],
)

/* -------------------------------------------------------------------------- */
/* Auth session + one-time tokens                                             */
/* -------------------------------------------------------------------------- */

export const refreshTokens = pgTable(
  'refresh_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull().unique(),
    /**
     * Every session descended from one sign-in (rotations and multi-tab grace
     * reissues) shares a family. Signing out revokes the whole family at once.
     * Null only on rows created before the column existed; treat as `id`.
     */
    familyId: uuid('family_id'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    replacedByTokenHash: text('replaced_by_token_hash'),
    userAgent: text('user_agent'),
    ipAddress: text('ip_address'),
    createdAt: createdAt(),
  },
  (table) => [
    index('refresh_tokens_user_idx').on(table.userId),
    index('refresh_tokens_family_idx').on(table.familyId),
    index('refresh_tokens_expiry_idx').on(table.expiresAt),
  ],
)

export const passwordResetTokens = pgTable(
  'password_reset_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull().unique(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (table) => [index('password_reset_user_idx').on(table.userId)],
)

export const emailVerificationTokens = pgTable(
  'email_verification_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull().unique(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (table) => [index('email_verification_user_idx').on(table.userId)],
)

export type User = typeof users.$inferSelect
export type NewUser = typeof users.$inferInsert
export type Merchant = typeof merchants.$inferSelect
export type Product = typeof products.$inferSelect
export type ProductOffer = typeof productOffers.$inferSelect
export type Review = typeof reviews.$inferSelect
export type NotificationRow = typeof notifications.$inferSelect
