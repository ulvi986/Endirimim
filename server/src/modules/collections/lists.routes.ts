import { and, count, desc, eq, inArray, sql } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { db } from '../../db/client.js'
import { productImages, shoppingListItems, shoppingLists } from '../../db/schema.js'
import { conflict, notFound } from '../../lib/errors.js'
import { paginate, parsePagination } from '../../lib/pagination.js'
import { storage } from '../../storage/index.js'
import { requireAuth } from '../../plugins/auth.js'
import { loadProductRowsByIds, loadProductSummaries, type ProductListRow } from '../catalog/shared.js'

const listBody = z.object({ name: z.string().trim().min(1).max(120) })
const itemBody = z.object({
  productId: z.uuid(),
  quantity: z.coerce.number().int().min(1).max(999).default(1),
})

/** Loads a list only if it belongs to the caller; otherwise 404 (not 403), so
 *  list ids are not enumerable across accounts. */
async function requireOwnedList(listId: string, userId: string) {
  const [list] = await db
    .select()
    .from(shoppingLists)
    .where(and(eq(shoppingLists.id, listId), eq(shoppingLists.userId, userId)))
    .limit(1)
  if (!list) throw notFound('Siyahı tapılmadı.')
  return list
}

export default async function shoppingListRoutes(app: FastifyInstance): Promise<void> {
  app.get('/lists', { preHandler: app.authenticate }, async (request) => {
    const auth = requireAuth(request)
    const pagination = parsePagination(request.query as Record<string, unknown>)
    const where = eq(shoppingLists.userId, auth.user.id)

    const [rows, countRows] = await Promise.all([
      db
        .select()
        .from(shoppingLists)
        .where(where)
        .orderBy(desc(shoppingLists.updatedAt))
        .limit(pagination.limit)
        .offset(pagination.offset),
      db.select({ total: count() }).from(shoppingLists).where(where),
    ])

    const ids = rows.map((row) => row.id)
    const itemCounts = ids.length
      ? await db
          .select({ listId: shoppingListItems.shoppingListId, total: count() })
          .from(shoppingListItems)
          .where(inArray(shoppingListItems.shoppingListId, ids))
          .groupBy(shoppingListItems.shoppingListId)
      : []
    const countByList = new Map(itemCounts.map((row) => [row.listId, Number(row.total)]))

    // At most three thumbnails per list. A global LIMIT would starve later
    // lists, so pull the ordered images for this page and slice in memory.
    const previews = ids.length
      ? await db
          .select({ listId: shoppingListItems.shoppingListId, storageKey: productImages.storageKey })
          .from(shoppingListItems)
          .innerJoin(productImages, eq(productImages.productId, shoppingListItems.productId))
          .where(inArray(shoppingListItems.shoppingListId, ids))
          .orderBy(productImages.sortOrder)
      : []

    const previewByList = new Map<string, string[]>()
    for (const preview of previews) {
      const list = previewByList.get(preview.listId) ?? []
      if (list.length < 3) list.push(storage.url(preview.storageKey))
      previewByList.set(preview.listId, list)
    }

    return paginate(
      rows.map((row) => ({
        ...row,
        itemCount: countByList.get(row.id) ?? 0,
        previewImageUrls: previewByList.get(row.id) ?? [],
      })),
      Number(countRows[0]?.total ?? 0),
      pagination,
    )
  })

  app.post('/lists', { preHandler: app.authenticate }, async (request, reply) => {
    const auth = requireAuth(request)
    const body = listBody.parse(request.body)

    const [created] = await db.insert(shoppingLists).values({ userId: auth.user.id, name: body.name }).returning()
    reply.status(201)
    return created
  })

  app.get('/lists/:id', { preHandler: app.authenticate }, async (request) => {
    const auth = requireAuth(request)
    const { id } = request.params as { id: string }
    const list = await requireOwnedList(id, auth.user.id)

    const rows = await db
      .select({ productId: shoppingListItems.productId, quantity: shoppingListItems.quantity, createdAt: shoppingListItems.createdAt })
      .from(shoppingListItems)
      .where(eq(shoppingListItems.shoppingListId, id))
      .orderBy(desc(shoppingListItems.createdAt))

    const productsById = await loadProductRowsByIds(rows.map((row) => row.productId))
    const orderedRows = rows
      .map((row) => productsById.get(row.productId))
      .filter((row): row is ProductListRow => row !== undefined)
    const summaries = await loadProductSummaries(orderedRows)
    const quantities = new Map(rows.map((row) => [row.productId, row.quantity]))

    return {
      ...list,
      items: summaries.map((summary) => ({ ...summary, quantity: quantities.get(summary.id) ?? 1 })),
      estimatedTotal: summaries.reduce(
        (total, summary) => total + (summary.bestPrice ?? 0) * (quantities.get(summary.id) ?? 1),
        0,
      ),
    }
  })

  app.patch('/lists/:id', { preHandler: app.authenticate }, async (request) => {
    const auth = requireAuth(request)
    const { id } = request.params as { id: string }
    const body = listBody.parse(request.body)
    await requireOwnedList(id, auth.user.id)

    const [updated] = await db
      .update(shoppingLists)
      .set({ name: body.name, updatedAt: new Date() })
      .where(eq(shoppingLists.id, id))
      .returning()
    return updated
  })

  app.delete('/lists/:id', { preHandler: app.authenticate }, async (request, reply) => {
    const auth = requireAuth(request)
    const { id } = request.params as { id: string }
    await requireOwnedList(id, auth.user.id)

    await db.delete(shoppingLists).where(eq(shoppingLists.id, id))
    reply.status(204)
  })

  app.post('/lists/:id/items', { preHandler: app.authenticate }, async (request, reply) => {
    const auth = requireAuth(request)
    const { id } = request.params as { id: string }
    const body = itemBody.parse(request.body)
    await requireOwnedList(id, auth.user.id)

    const productsById = await loadProductRowsByIds([body.productId])
    if (!productsById.has(body.productId)) throw notFound('Məhsul tapılmadı.')

    const [item] = await db
      .insert(shoppingListItems)
      .values({ shoppingListId: id, productId: body.productId, quantity: body.quantity })
      .onConflictDoUpdate({
        target: [shoppingListItems.shoppingListId, shoppingListItems.productId],
        set: { quantity: body.quantity },
      })
      .returning()

    await db.update(shoppingLists).set({ updatedAt: new Date() }).where(eq(shoppingLists.id, id))

    reply.status(201)
    return item
  })

  app.patch('/lists/:id/items/:productId', { preHandler: app.authenticate }, async (request) => {
    const auth = requireAuth(request)
    const { id, productId } = request.params as { id: string; productId: string }
    const body = z.object({ quantity: z.coerce.number().int().min(1).max(999) }).parse(request.body)
    await requireOwnedList(id, auth.user.id)

    const [updated] = await db
      .update(shoppingListItems)
      .set({ quantity: body.quantity })
      .where(and(eq(shoppingListItems.shoppingListId, id), eq(shoppingListItems.productId, productId)))
      .returning()

    if (!updated) throw notFound('Siyahı elementi tapılmadı.')
    return updated
  })

  app.delete('/lists/:id/items/:productId', { preHandler: app.authenticate }, async (request, reply) => {
    const auth = requireAuth(request)
    const { id, productId } = request.params as { id: string; productId: string }
    await requireOwnedList(id, auth.user.id)

    await db
      .delete(shoppingListItems)
      .where(and(eq(shoppingListItems.shoppingListId, id), eq(shoppingListItems.productId, productId)))
    reply.status(204)
  })

  /** Moves every item of one list into another, de-duplicating quantities. */
  app.post('/lists/:id/merge', { preHandler: app.authenticate }, async (request) => {
    const auth = requireAuth(request)
    const { id } = request.params as { id: string }
    const body = z.object({ targetListId: z.uuid() }).parse(request.body)

    if (id === body.targetListId) throw conflict('Siyahı özü ilə birləşdirilə bilməz.')

    const source = await requireOwnedList(id, auth.user.id)
    await requireOwnedList(body.targetListId, auth.user.id)

    const moved = await db.transaction(async (tx) => {
      const items = await tx.select().from(shoppingListItems).where(eq(shoppingListItems.shoppingListId, source.id))

      for (const item of items) {
        await tx
          .insert(shoppingListItems)
          .values({ shoppingListId: body.targetListId, productId: item.productId, quantity: item.quantity })
          .onConflictDoUpdate({
            target: [shoppingListItems.shoppingListId, shoppingListItems.productId],
            // The same product in both lists keeps both quantities.
            set: { quantity: sql`least(${shoppingListItems.quantity} + ${item.quantity}, 999)` },
          })
      }

      await tx.delete(shoppingListItems).where(eq(shoppingListItems.shoppingListId, source.id))
      await tx.delete(shoppingLists).where(eq(shoppingLists.id, source.id))
      await tx.update(shoppingLists).set({ updatedAt: new Date() }).where(eq(shoppingLists.id, body.targetListId))

      return items.length
    })

    return { success: true, movedItems: moved, sourceListDeleted: true }
  })
}
