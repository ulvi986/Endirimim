import { asc, count, eq, isNull, sql } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { httpUrl } from '../../lib/validation.js'
import { db } from '../../db/client.js'
import { brands, categories, products } from '../../db/schema.js'
import { conflict, notFound } from '../../lib/errors.js'
import { uniqueSlug } from '../../lib/slug.js'

const taxonomyBody = z.object({
  name: z.string().trim().min(1).max(120),
  slug: z.string().trim().min(1).max(120).optional(),
  description: z.string().trim().max(2000).optional(),
  imageUrl: httpUrl(500).optional(),
  logoUrl: httpUrl(500).optional(),
  parentId: z.uuid().optional(),
})

export default async function taxonomyRoutes(app: FastifyInstance): Promise<void> {
  /* ------------------------------- categories ------------------------------ */

  app.get('/categories', async () => {
    const rows = await db
      .select({
        id: categories.id,
        parentId: categories.parentId,
        name: categories.name,
        slug: categories.slug,
        imageUrl: categories.imageUrl,
        description: categories.description,
      })
      .from(categories)
      .orderBy(asc(categories.name))

    const counts = await db
      .select({ categoryId: products.categoryId, total: count() })
      .from(products)
      .groupBy(products.categoryId)

    const countByCategory = new Map(counts.map((row) => [row.categoryId, Number(row.total)]))
    const withCounts = rows.map((row) => ({ ...row, productCount: countByCategory.get(row.id) ?? 0 }))
    const roots = withCounts.filter((row) => row.parentId === null)

    // Return the tree the UI actually renders, with orphans promoted to roots.
    const tree = roots.map((root) => ({
      ...root,
      children: withCounts.filter((row) => row.parentId === root.id),
    }))
    const known = new Set(tree.map((node) => node.id))
    const orphans = withCounts.filter((row) => row.parentId !== null && !known.has(row.parentId) && !known.has(row.id))

    return { items: tree, orphaned: orphans.length > 0 ? orphans : undefined }
  })

  app.get('/categories/:slug', async (request) => {
    const { slug } = request.params as { slug: string }
    const [category] = await db.select().from(categories).where(eq(categories.slug, slug)).limit(1)
    if (!category) throw notFound('Kateqoriya tapılmadı.')

    const children = await db.select().from(categories).where(eq(categories.parentId, category.id))
    const [totalRow] = await db
      .select({ total: count() })
      .from(products)
      .where(eq(products.categoryId, category.id))

    return { ...category, children, productCount: Number(totalRow?.total ?? 0) }
  })

  app.post('/categories', { preHandler: app.requireRole(['admin']) }, async (request, reply) => {
    const body = taxonomyBody.parse(request.body)
    const slug = await uniqueSlug(body.slug ?? body.name, async (candidate) => {
      const [existing] = await db.select({ id: categories.id }).from(categories).where(eq(categories.slug, candidate)).limit(1)
      return Boolean(existing)
    })

    if (body.parentId) {
      const [parent] = await db.select({ id: categories.id }).from(categories).where(eq(categories.id, body.parentId)).limit(1)
      if (!parent) throw notFound('Üst kateqoriya tapılmadı.')
    }

    const [created] = await db
      .insert(categories)
      .values({
        name: body.name,
        slug,
        description: body.description ?? null,
        imageUrl: body.imageUrl ?? null,
        parentId: body.parentId ?? null,
      })
      .returning()

    reply.status(201)
    return created
  })

  app.patch('/categories/:id', { preHandler: app.requireRole(['admin']) }, async (request) => {
    const { id } = request.params as { id: string }
    const body = taxonomyBody.partial().parse(request.body)

    if (body.parentId === id) throw conflict('Kateqoriya özünün üst kateqoriyası ola bilməz.')

    if (body.parentId) {
      // Walk up from the new parent: reaching this category means the move would
      // create a cycle (A→B→A), which drops both out of the rendered tree.
      const seen = new Set<string>()
      let cursor: string | null = body.parentId
      while (cursor) {
        if (cursor === id) throw conflict('Kateqoriya öz alt kateqoriyasının altına köçürülə bilməz.')
        if (seen.has(cursor)) break
        seen.add(cursor)
        const [ancestor]: { parentId: string | null }[] = await db
          .select({ parentId: categories.parentId })
          .from(categories)
          .where(eq(categories.id, cursor))
          .limit(1)
        if (!ancestor) {
          if (cursor === body.parentId) throw notFound('Üst kateqoriya tapılmadı.')
          break
        }
        cursor = ancestor.parentId
      }
    }

    const [updated] = await db
      .update(categories)
      .set({
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.slug !== undefined ? { slug: body.slug } : {}),
        ...(body.description !== undefined ? { description: body.description } : {}),
        ...(body.imageUrl !== undefined ? { imageUrl: body.imageUrl } : {}),
        ...(body.parentId !== undefined ? { parentId: body.parentId } : {}),
      })
      .where(eq(categories.id, id))
      .returning()

    if (!updated) throw notFound('Kateqoriya tapılmadı.')
    return updated
  })

  // Children are promoted and products become uncategorised (both ON DELETE SET
  // NULL); /admin/uncategorised-products then surfaces what needs re-filing.
  app.delete('/categories/:id', { preHandler: app.requireRole(['admin']) }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const [deleted] = await db.delete(categories).where(eq(categories.id, id)).returning({ id: categories.id })
    if (!deleted) throw notFound('Kateqoriya tapılmadı.')
    reply.status(204)
  })

  /* --------------------------------- brands -------------------------------- */

  app.get('/brands', async () => {
    const rows = await db.select().from(brands).orderBy(asc(brands.name))
    const counts = await db.select({ brandId: products.brandId, total: count() }).from(products).groupBy(products.brandId)
    const countByBrand = new Map(counts.map((row) => [row.brandId, Number(row.total)]))
    return { items: rows.map((row) => ({ ...row, productCount: countByBrand.get(row.id) ?? 0 })) }
  })

  app.get('/brands/:slug', async (request) => {
    const { slug } = request.params as { slug: string }
    const [brand] = await db.select().from(brands).where(eq(brands.slug, slug)).limit(1)
    if (!brand) throw notFound('Marka tapılmadı.')
    const [totalRow] = await db.select({ total: count() }).from(products).where(eq(products.brandId, brand.id))
    return { ...brand, productCount: Number(totalRow?.total ?? 0) }
  })

  app.post('/brands', { preHandler: app.requireRole(['admin']) }, async (request, reply) => {
    const body = taxonomyBody.parse(request.body)
    const slug = await uniqueSlug(body.slug ?? body.name, async (candidate) => {
      const [existing] = await db.select({ id: brands.id }).from(brands).where(eq(brands.slug, candidate)).limit(1)
      return Boolean(existing)
    })
    const [created] = await db
      .insert(brands)
      .values({ name: body.name, slug, logoUrl: body.logoUrl ?? null })
      .returning()
    reply.status(201)
    return created
  })

  app.patch('/brands/:id', { preHandler: app.requireRole(['admin']) }, async (request) => {
    const { id } = request.params as { id: string }
    const body = taxonomyBody.partial().parse(request.body)
    const [updated] = await db
      .update(brands)
      .set({
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.slug !== undefined ? { slug: body.slug } : {}),
        ...(body.logoUrl !== undefined ? { logoUrl: body.logoUrl } : {}),
      })
      .where(eq(brands.id, id))
      .returning()
    if (!updated) throw notFound('Marka tapılmadı.')
    return updated
  })

  app.delete('/brands/:id', { preHandler: app.requireRole(['admin']) }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const [deleted] = await db.delete(brands).where(eq(brands.id, id)).returning({ id: brands.id })
    if (!deleted) throw notFound('Marka tapılmadı.')
    reply.status(204)
  })

  /* ------------------------------- maintenance ----------------------------- */

  // Products with no category are invisible to category browsing; surface them
  // so an admin can fix the catalog instead of silently losing listings.
  app.get('/admin/uncategorised-products', { preHandler: app.requireRole(['admin']) }, async () => {
    const rows = await db
      .select({ id: products.id, name: products.name, slug: products.slug })
      .from(products)
      .where(isNull(products.categoryId))
      .orderBy(asc(products.name))
      .limit(200)
    return { items: rows, total: rows.length }
  })

  app.get('/admin/catalog-health', { preHandler: app.requireRole(['admin']) }, async () => {
    const [orphans] = await db
      .select({ total: count() })
      .from(products)
      .where(isNull(products.categoryId))
    const [unsearchable] = await db
      .select({ total: count() })
      .from(products)
      .where(sql`${products.name} = ''`)
    return {
      uncategorisedProducts: Number(orphans?.total ?? 0),
      unnamedProducts: Number(unsearchable?.total ?? 0),
    }
  })
}
