import { and, count, desc, eq, sql } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { db } from '../../db/client.js'
import { notifications } from '../../db/schema.js'
import { notFound } from '../../lib/errors.js'
import { paginate, parsePagination } from '../../lib/pagination.js'
import { requireAuth } from '../../plugins/auth.js'

export default async function notificationRoutes(app: FastifyInstance): Promise<void> {
  app.get('/notifications', { preHandler: app.authenticate }, async (request) => {
    const auth = requireAuth(request)
    const query = z
      .object({ unreadOnly: z.enum(['true', 'false']).optional() })
      .parse(request.query)
    const pagination = parsePagination(request.query as Record<string, unknown>)

    const filters = [eq(notifications.userId, auth.user.id)]
    if (query.unreadOnly === 'true') filters.push(eq(notifications.isRead, false))
    const where = and(...filters)

    const [rows, countRows, unreadRows] = await Promise.all([
      db
        .select()
        .from(notifications)
        .where(where)
        .orderBy(desc(notifications.createdAt))
        .limit(pagination.limit)
        .offset(pagination.offset),
      db.select({ total: count() }).from(notifications).where(where),
      // Unread badge must reflect all unread rows, not just this page.
      db
        .select({ total: count() })
        .from(notifications)
        .where(and(eq(notifications.userId, auth.user.id), eq(notifications.isRead, false))),
    ])

    return {
      ...paginate(rows, Number(countRows[0]?.total ?? 0), pagination),
      unreadCount: Number(unreadRows[0]?.total ?? 0),
    }
  })

  app.patch('/notifications/:id/read', { preHandler: app.authenticate }, async (request) => {
    const auth = requireAuth(request)
    const { id } = request.params as { id: string }
    const body = z.object({ isRead: z.boolean().default(true) }).parse(request.body ?? {})

    const [updated] = await db
      .update(notifications)
      .set({ isRead: body.isRead })
      .where(and(eq(notifications.id, id), eq(notifications.userId, auth.user.id)))
      .returning()

    if (!updated) throw notFound('Bildiriş tapılmadı.')
    return updated
  })

  app.post('/notifications/read-all', { preHandler: app.authenticate }, async (request) => {
    const auth = requireAuth(request)
    const updated = await db
      .update(notifications)
      .set({ isRead: true })
      .where(and(eq(notifications.userId, auth.user.id), eq(notifications.isRead, false)))
      .returning({ id: notifications.id })
    return { success: true, updated: updated.length }
  })

  app.delete('/notifications/:id', { preHandler: app.authenticate }, async (request, reply) => {
    const auth = requireAuth(request)
    const { id } = request.params as { id: string }

    const [deleted] = await db
      .delete(notifications)
      .where(and(eq(notifications.id, id), eq(notifications.userId, auth.user.id)))
      .returning({ id: notifications.id })

    if (!deleted) throw notFound('Bildiriş tapılmadı.')
    reply.status(204)
  })

  /** Bulk cleanup used by the "clear read notifications" action. */
  app.delete('/notifications', { preHandler: app.authenticate }, async (request, reply) => {
    const auth = requireAuth(request)
    const query = z.object({ onlyRead: z.enum(['true', 'false']).default('true') }).parse(request.query)

    await db
      .delete(notifications)
      .where(
        query.onlyRead === 'true'
          ? and(eq(notifications.userId, auth.user.id), eq(notifications.isRead, true))
          : sql`${notifications.userId} = ${auth.user.id}`,
      )
    reply.status(204)
  })
}
