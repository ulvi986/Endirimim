import { and, count, desc, eq, gte, lte } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { httpUrl } from '../../lib/validation.js'
import { db } from '../../db/client.js'
import { discountCampaigns, merchants } from '../../db/schema.js'
import { badRequest, forbidden, notFound } from '../../lib/errors.js'
import { paginate, parsePagination } from '../../lib/pagination.js'
import { requireAuth } from '../../plugins/auth.js'

const campaignFields = z.object({
  title: z.string().trim().min(2).max(200),
  description: z.string().trim().max(3000).nullish(),
  imageUrl: httpUrl(500).nullish(),
  startDate: z.coerce.date(),
  endDate: z.coerce.date(),
  url: httpUrl(1000).nullish(),
  isActive: z.boolean(),
})

const campaignBody = campaignFields.extend({ isActive: campaignFields.shape.isActive.default(false) })

// No defaults on updates: `.partial()` keeps them, so renaming a campaign would
// otherwise deactivate it.
const campaignPatchBody = campaignFields.partial()

export default async function campaignRoutes(app: FastifyInstance): Promise<void> {
  /* --------------------------------- public -------------------------------- */

  // "Running now" means flagged active AND inside its date window — a campaign
  // that has not started yet must not appear.
  app.get('/campaigns', async (request) => {
    const pagination = parsePagination(request.query as Record<string, unknown>)
    const now = new Date()
    const where = and(eq(discountCampaigns.isActive, true), lte(discountCampaigns.startDate, now), gte(discountCampaigns.endDate, now))

    const [rows, countRows] = await Promise.all([
      db
        .select({
          id: discountCampaigns.id,
          title: discountCampaigns.title,
          description: discountCampaigns.description,
          imageUrl: discountCampaigns.imageUrl,
          startDate: discountCampaigns.startDate,
          endDate: discountCampaigns.endDate,
          url: discountCampaigns.url,
          merchantId: merchants.id,
          merchantName: merchants.name,
          merchantSlug: merchants.slug,
          merchantIsVerified: merchants.isVerified,
        })
        .from(discountCampaigns)
        .innerJoin(merchants, eq(merchants.id, discountCampaigns.merchantId))
        .where(where)
        .orderBy(desc(discountCampaigns.startDate))
        .limit(pagination.limit)
        .offset(pagination.offset),
      db.select({ total: count() }).from(discountCampaigns).where(where),
    ])

    return paginate(
      rows.map((row) => ({
        id: row.id,
        title: row.title,
        description: row.description,
        imageUrl: row.imageUrl,
        startDate: row.startDate,
        endDate: row.endDate,
        url: row.url,
        merchant: {
          id: row.merchantId,
          name: row.merchantName,
          slug: row.merchantSlug,
          isVerified: row.merchantIsVerified,
        },
      })),
      Number(countRows[0]?.total ?? 0),
      pagination,
    )
  })

  app.get('/merchants/:slug/campaigns', async (request) => {
    const { slug } = request.params as { slug: string }

    const [merchant] = await db.select({ id: merchants.id }).from(merchants).where(eq(merchants.slug, slug)).limit(1)
    if (!merchant) throw notFound('Mağaza tapılmadı.')

    // Same "running now" rule as GET /campaigns: scheduled and expired campaigns
    // stay private to the merchant (GET /merchant/campaigns).
    const now = new Date()
    const rows = await db
      .select({
        id: discountCampaigns.id,
        title: discountCampaigns.title,
        description: discountCampaigns.description,
        imageUrl: discountCampaigns.imageUrl,
        startDate: discountCampaigns.startDate,
        endDate: discountCampaigns.endDate,
        url: discountCampaigns.url,
      })
      .from(discountCampaigns)
      .where(
        and(
          eq(discountCampaigns.merchantId, merchant.id),
          eq(discountCampaigns.isActive, true),
          lte(discountCampaigns.startDate, now),
          gte(discountCampaigns.endDate, now),
        ),
      )
      .orderBy(desc(discountCampaigns.startDate))

    return { items: rows }
  })

  /* -------------------------------- merchant ------------------------------- */

  app.get('/merchant/campaigns', { preHandler: app.requireStore }, async (request) => {
    const auth = requireAuth(request)
    const pagination = parsePagination(request.query as Record<string, unknown>)
    const where = eq(discountCampaigns.merchantId, auth.merchantId!)

    const [rows, countRows] = await Promise.all([
      db
        .select()
        .from(discountCampaigns)
        .where(where)
        .orderBy(desc(discountCampaigns.createdAt))
        .limit(pagination.limit)
        .offset(pagination.offset),
      db.select({ total: count() }).from(discountCampaigns).where(where),
    ])

    return paginate(rows, Number(countRows[0]?.total ?? 0), pagination)
  })

  app.post('/merchant/campaigns', { preHandler: app.requireStore }, async (request, reply) => {
    const auth = requireAuth(request)
    const body = campaignBody.parse(request.body)

    if (body.endDate.getTime() <= body.startDate.getTime()) {
      throw badRequest('Bitmə tarixi başlama tarixindən sonra olmalıdır.')
    }

    const [created] = await db
      .insert(discountCampaigns)
      .values({
        merchantId: auth.merchantId!,
        title: body.title,
        description: body.description ?? null,
        imageUrl: body.imageUrl ?? null,
        startDate: body.startDate,
        endDate: body.endDate,
        url: body.url ?? null,
        // Scheduled campaigns stay flagged; GET /campaigns only lists them once
        // startDate has passed. Forcing false here meant they never went live.
        isActive: body.isActive,
      })
      .returning()

    reply.status(201)
    return created
  })

  app.patch('/campaigns/:id', { preHandler: app.requireStoreOrAdmin }, async (request) => {
    const auth = requireAuth(request)
    const { id } = request.params as { id: string }
    const body = campaignPatchBody.parse(request.body)

    const [existing] = await db.select().from(discountCampaigns).where(eq(discountCampaigns.id, id)).limit(1)
    if (!existing) throw notFound('Kampaniya tapılmadı.')
    if (auth.role !== 'admin' && existing.merchantId !== auth.merchantId) throw forbidden('Bu kampaniya sizə aid deyil.')

    const startDate = body.startDate ?? existing.startDate
    const endDate = body.endDate ?? existing.endDate
    if (endDate.getTime() <= startDate.getTime()) throw badRequest('Bitmə tarixi başlama tarixindən sonra olmalıdır.')

    const [updated] = await db
      .update(discountCampaigns)
      .set({
        ...(body.title !== undefined ? { title: body.title } : {}),
        ...(body.description !== undefined ? { description: body.description } : {}),
        ...(body.imageUrl !== undefined ? { imageUrl: body.imageUrl } : {}),
        ...(body.startDate !== undefined ? { startDate: body.startDate } : {}),
        ...(body.endDate !== undefined ? { endDate: body.endDate } : {}),
        ...(body.url !== undefined ? { url: body.url } : {}),
        ...(body.isActive !== undefined ? { isActive: body.isActive } : {}),
      })
      .where(eq(discountCampaigns.id, id))
      .returning()

    return updated
  })

  app.delete('/campaigns/:id', { preHandler: app.requireStoreOrAdmin }, async (request, reply) => {
    const auth = requireAuth(request)
    const { id } = request.params as { id: string }

    const [existing] = await db.select().from(discountCampaigns).where(eq(discountCampaigns.id, id)).limit(1)
    if (!existing) throw notFound('Kampaniya tapılmadı.')
    if (auth.role !== 'admin' && existing.merchantId !== auth.merchantId) throw forbidden('Bu kampaniya sizə aid deyil.')

    await db.delete(discountCampaigns).where(eq(discountCampaigns.id, id))
    reply.status(204)
  })
}
