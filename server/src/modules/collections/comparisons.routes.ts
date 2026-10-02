import { and, desc, eq } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { db } from '../../db/client.js'
import { productComparisons } from '../../db/schema.js'
import { badRequest } from '../../lib/errors.js'
import { requireAuth } from '../../plugins/auth.js'
import { loadProductRowsByIds, loadProductSummaries, resolveProductId, type ProductListRow } from '../catalog/shared.js'

const MAX_COMPARISON_SIZE = 6

export default async function comparisonRoutes(app: FastifyInstance): Promise<void> {
  app.get('/comparisons', { preHandler: app.authenticate }, async (request) => {
    const auth = requireAuth(request)
    const rows = await db
      .select({ productId: productComparisons.productId, createdAt: productComparisons.createdAt })
      .from(productComparisons)
      .where(eq(productComparisons.userId, auth.user.id))
      .orderBy(desc(productComparisons.createdAt))

    const productsById = await loadProductRowsByIds(rows.map((row) => row.productId))
    const orderedRows = rows
      .map((row) => productsById.get(row.productId))
      .filter((row): row is ProductListRow => row !== undefined)

    const summaries = await loadProductSummaries(orderedRows)
    const addedAt = new Map(rows.map((row) => [row.productId, row.createdAt]))

    return { items: summaries.map((summary) => ({ ...summary, addedAt: addedAt.get(summary.id) ?? null })) }
  })

  app.post('/comparisons', { preHandler: app.authenticate }, async (request, reply) => {
    const auth = requireAuth(request)
    const body = z
      .object({ productIds: z.array(z.uuid()).min(1).max(MAX_COMPARISON_SIZE) })
      .parse(request.body)

    const unique = [...new Set(body.productIds)]
    const productsById = await loadProductRowsByIds(unique)
    if (productsById.size !== unique.length) throw badRequest('Bəzi məhsullar tapılmadı.')

    const current = await db
      .select({ productId: productComparisons.productId })
      .from(productComparisons)
      .where(eq(productComparisons.userId, auth.user.id))
    const combined = new Set([...current.map((row) => row.productId), ...unique])
    if (combined.size > MAX_COMPARISON_SIZE) {
      throw badRequest(`Ən çoxu ${MAX_COMPARISON_SIZE} məhsul müqayisə edilə bilər.`)
    }

    await db
      .insert(productComparisons)
      .values(unique.map((productId) => ({ userId: auth.user.id, productId })))
      .onConflictDoNothing({ target: [productComparisons.userId, productComparisons.productId] })

    reply.status(201)
    return { success: true, productIds: unique }
  })

  app.delete('/comparisons/:productId', { preHandler: app.authenticate }, async (request, reply) => {
    const auth = requireAuth(request)
    const { productId } = request.params as { productId: string }

    await db
      .delete(productComparisons)
      .where(and(eq(productComparisons.userId, auth.user.id), eq(productComparisons.productId, productId)))
    reply.status(204)
  })

  app.delete('/comparisons', { preHandler: app.authenticate }, async (request, reply) => {
    const auth = requireAuth(request)
    await db.delete(productComparisons).where(eq(productComparisons.userId, auth.user.id))
    reply.status(204)
  })

  /**
   * Side-by-side matrix. Unions the specification keys across the selection so
   * the client can render a real comparison table instead of guessing columns.
   */
  app.get('/comparisons/matrix', async (request) => {
    const query = z.object({ ids: z.string().min(1) }).parse(request.query)
    const ids = [...new Set(query.ids.split(',').map((id) => id.trim()).filter(Boolean))]

    if (ids.length === 0) throw badRequest('Müqayisə üçün ən azı bir məhsul seçin.')
    if (ids.length > MAX_COMPARISON_SIZE) throw badRequest(`Ən çoxu ${MAX_COMPARISON_SIZE} məhsul müqayisə edilə bilər.`)

    const resolvedIds = await Promise.all(ids.map((id) => resolveProductId(id)))
    const productsById = await loadProductRowsByIds(resolvedIds)
    const orderedRows = resolvedIds
      .map((id) => productsById.get(id))
      .filter((row): row is ProductListRow => row !== undefined)
    const summaries = await loadProductSummaries(orderedRows)

    const specificationKeys = [
      ...new Set(summaries.flatMap((summary) => Object.keys(summary.specifications ?? {}))),
    ].sort()

    return {
      products: summaries,
      specificationKeys,
      rows: specificationKeys.map((key) => ({
        key,
        values: summaries.map((summary) => summary.specifications?.[key] ?? null),
      })),
      priceSpread:
        summaries.length > 0 && summaries.every((summary) => summary.bestPrice !== null)
          ? Math.max(...summaries.map((summary) => summary.bestPrice as number)) -
            Math.min(...summaries.map((summary) => summary.bestPrice as number))
          : null,
    }
  })

  /** Server-side check used by the UI to decide whether "add" is still allowed. */
  app.get('/comparisons/capacity', { preHandler: app.authenticate }, async (request) => {
    const auth = requireAuth(request)
    const rows = await db
      .select({ productId: productComparisons.productId })
      .from(productComparisons)
      .where(eq(productComparisons.userId, auth.user.id))

    return { count: rows.length, max: MAX_COMPARISON_SIZE, canAddMore: rows.length < MAX_COMPARISON_SIZE }
  })
}
