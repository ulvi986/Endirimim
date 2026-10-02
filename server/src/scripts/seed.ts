import { eq } from 'drizzle-orm'
import { closePool, db } from '../db/client.js'
import { brands, categories, merchants, productImages, products, users } from '../db/schema.js'
import { buildObjectKey, storage } from '../storage/index.js'
import { env } from '../config/env.js'
import { hashPassword } from '../lib/password.js'
import { slugify } from '../lib/slug.js'
import { upsertOffer } from '../modules/catalog/offers.service.js'

/**
 * Development demo data. Idempotent: rows are looked up by their unique keys
 * first, so running `npm run db:seed` twice does not duplicate anything.
 * Refuses to run in production.
 */

const ACCOUNTS = [
  { email: 'user@endirimim.az', password: 'Demo12345', role: 'user' as const, firstName: 'Ulvi', lastName: 'Məmmədov' },
  { email: 'store@endirimim.az', password: 'Demo12345', role: 'store' as const, firstName: 'Tech', lastName: 'Bazaar', storeName: 'Tech Bazaar' },
  { email: 'store2@endirimim.az', password: 'Demo12345', role: 'store' as const, firstName: 'Qənaət', lastName: 'Market', storeName: 'Qənaət Market' },
  { email: 'admin@endirimim.az', password: 'Demo12345', role: 'admin' as const, firstName: 'Admin', lastName: 'Endirimim' },
]

const CATEGORIES = ['Telefon', 'Elektronika', 'Ev və mətbəx', 'Kompyuter', 'Moda', 'Gözəllik']
const BRANDS = ['Apple', 'Samsung', 'Sony', 'Philips', 'Nespresso']

const PRODUCTS = [
  { name: 'iPhone 17 256GB', image: 'https://images.unsplash.com/photo-1592899677977-9c10ca588bbd?auto=format&fit=crop&w=900&h=900&q=80&fm=jpg', brand: 'Apple', category: 'Telefon', specs: { yaddaş: '256GB', ekran: '6.3"' }, offers: [[2299, 2499], [2349, null]] },
  { name: 'Galaxy S26 Ultra 512GB', image: 'https://images.unsplash.com/photo-1610792516307-ea5acd9c3b00?auto=format&fit=crop&w=900&h=900&q=80&fm=jpg', brand: 'Samsung', category: 'Telefon', specs: { yaddaş: '512GB', ekran: '6.8"' }, offers: [[2699, 2999], [2649, 2899]] },
  { name: 'WH-1000XM6 Qulaqlıq', image: 'https://images.unsplash.com/photo-1618366712010-f4ae9c647dcb?auto=format&fit=crop&w=900&h=900&q=80&fm=jpg', brand: 'Sony', category: 'Elektronika', specs: { tip: 'Over-ear', batareya: '30 saat' }, offers: [[399, 469], [419, null]] },
  { name: 'Air Fryer 5.5L', image: 'https://images.unsplash.com/photo-1695089028114-ce28248f0ab9?auto=format&fit=crop&w=900&h=900&q=80&fm=jpg', brand: 'Philips', category: 'Ev və mətbəx', specs: { həcm: '5.5L', güc: '1700W' }, offers: [[189, 239], [199, 229]] },
  { name: 'MacBook Air M4 13 inch', image: 'https://images.unsplash.com/photo-1611186871348-b1ce696e52c9?auto=format&fit=crop&w=900&h=900&q=80&fm=jpg', brand: 'Apple', category: 'Kompyuter', specs: { prosessor: 'M4', yaddaş: '512GB' }, offers: [[2499, 2699], [2549, null]] },
  { name: 'Kapsul qəhvə aparatı', image: 'https://images.unsplash.com/photo-1610889556528-9a770e32642f?auto=format&fit=crop&w=900&h=900&q=80&fm=jpg', brand: 'Nespresso', category: 'Ev və mətbəx', specs: { təzyiq: '19 bar' }, offers: [[229, 279], [249, null]] },
] as const

async function ensureUser(account: (typeof ACCOUNTS)[number]) {
  const [existing] = await db.select().from(users).where(eq(users.email, account.email)).limit(1)
  const user =
    existing ??
    (
      await db
        .insert(users)
        .values({
          email: account.email,
          passwordHash: await hashPassword(account.password),
          firstName: account.firstName,
          lastName: account.lastName,
          role: account.role,
          emailVerifiedAt: new Date(),
        })
        .returning()
    )[0]!

  if ('storeName' in account && account.storeName) {
    const [merchant] = await db.select().from(merchants).where(eq(merchants.ownerUserId, user.id)).limit(1)
    if (!merchant) {
      await db.insert(merchants).values({
        ownerUserId: user.id,
        name: account.storeName,
        slug: slugify(account.storeName),
        website: `https://${slugify(account.storeName)}.az`,
        isVerified: true,
        rating: 4.7,
      })
    }
  }
  return user
}

async function ensureBySlug<T extends typeof categories | typeof brands>(table: T, name: string): Promise<string> {
  const slug = slugify(name)
  const [existing] = await db.select({ id: table.id }).from(table as typeof brands).where(eq(table.slug, slug)).limit(1)
  if (existing) return existing.id
  const [created] = await db.insert(table as typeof brands).values({ name, slug }).returning({ id: table.id })
  return created!.id
}

/** Downloads a demo photo into local storage once. Offline seeding still works, just without images. */
async function ensureProductImage(productId: string, slug: string, url: string): Promise<void> {
  const [existing] = await db.select({ id: productImages.id }).from(productImages).where(eq(productImages.productId, productId)).limit(1)
  if (existing) return
  try {
    const response = await fetch(url)
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const body = Buffer.from(await response.arrayBuffer())
    const key = buildObjectKey(`products/${productId}`, `${slug}.jpg`, 'image/jpeg')
    await storage.put({ key, body, contentType: 'image/jpeg' })
    await db.insert(productImages).values({ productId, storageKey: key, altText: slug, sortOrder: 0, isPrimary: true })
  } catch (error) {
    console.warn(`[seed] image skipped for ${slug}: ${(error as Error).message}`)
  }
}

async function main(): Promise<void> {
  // Demo accounts share a published password, so they must never reach a hosted
  // database — even when the operator's shell has NODE_ENV=development.
  const isLocalDatabase = /^pglite:|@(localhost|127\.0\.0\.1|\[::1\])[:/]/.test(env.DATABASE_URL)
  if (env.isProduction || (!isLocalDatabase && process.env.SEED_ALLOW_REMOTE !== '1')) {
    console.error('[seed] refusing to seed a production or remote database (set SEED_ALLOW_REMOTE=1 for a remote staging database)')
    process.exitCode = 1
    return
  }

  for (const account of ACCOUNTS) await ensureUser(account)

  const storeUsers = await Promise.all(
    ['store@endirimim.az', 'store2@endirimim.az'].map(async (email) => {
      const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1)
      const [merchant] = await db.select().from(merchants).where(eq(merchants.ownerUserId, user!.id)).limit(1)
      return merchant!
    }),
  )

  const categoryIds = new Map<string, string>()
  for (const name of CATEGORIES) categoryIds.set(name, await ensureBySlug(categories, name))
  const brandIds = new Map<string, string>()
  for (const name of BRANDS) brandIds.set(name, await ensureBySlug(brands, name))

  for (const item of PRODUCTS) {
    const slug = slugify(item.name)
    const [existing] = await db.select({ id: products.id }).from(products).where(eq(products.slug, slug)).limit(1)
    const productId =
      existing?.id ??
      (
        await db
          .insert(products)
          .values({
            name: item.name,
            slug,
            description: `${item.brand} ${item.name} — Endirimim demo məhsulu.`,
            brandId: brandIds.get(item.brand) ?? null,
            categoryId: categoryIds.get(item.category) ?? null,
            specifications: item.specs,
          })
          .returning({ id: products.id })
      )[0]!.id

    await ensureProductImage(productId, slug, item.image)

    if (existing) continue
    for (const [index, [price, oldPrice]] of item.offers.entries()) {
      const merchant = storeUsers[index]!
      await upsertOffer({
        productId,
        merchantId: merchant.id,
        price,
        oldPrice,
        productUrl: `https://${merchant.slug}.az/p/${slug}`,
        sku: `SKU-${slug.slice(0, 8).toUpperCase()}-${index + 1}`,
      })
    }
  }

  console.log('[seed] done. Demo accounts (password: Demo12345):')
  for (const account of ACCOUNTS) console.log(`  ${account.role.padEnd(5)}  ${account.email}`)
}

main()
  .catch((error) => {
    console.error('[seed] failed', error)
    process.exitCode = 1
  })
  .finally(async () => {
    await closePool()
  })
