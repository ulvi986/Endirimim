import { eq } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { httpUrl } from '../../lib/validation.js'
import { db } from '../../db/client.js'
import { seoMetadata } from '../../db/schema.js'
import { notFound } from '../../lib/errors.js'
import { uniqueSlug } from '../../lib/slug.js'
import { resolveProductId } from '../catalog/shared.js'

const seoBody = z.object({
  title: z.string().trim().max(200).nullish(),
  description: z.string().trim().max(500).nullish(),
  slug: z.string().trim().max(120).nullish(),
  keywords: z.array(z.string().trim().min(1).max(60)).max(25).nullish(),
  ogImageUrl: httpUrl(500).nullish(),
})

/**
 * Scoring rewards the fields that actually change click-through. Title length is
 * graded on the 50-60 character range search results render in full.
 */
function scoreSeo(input: {
  title?: string | null
  description?: string | null
  slug?: string | null
  keywords?: string[] | null
  ogImageUrl?: string | null
}): number {
  let score = 0

  if (input.title) {
    const length = input.title.length
    score += length >= 50 && length <= 60 ? 30 : 18
  }
  if (input.description) {
    const length = input.description.length
    score += length >= 120 && length <= 160 ? 30 : 18
  }
  if (input.slug) score += 15
  if (input.keywords && input.keywords.length >= 3) score += 15
  if (input.ogImageUrl) score += 10

  return Math.min(100, score)
}

export default async function seoRoutes(app: FastifyInstance): Promise<void> {
  app.get('/products/:idOrSlug/seo', async (request) => {
    const { idOrSlug } = request.params as { idOrSlug: string }
    const productId = await resolveProductId(idOrSlug)

    const [record] = await db.select().from(seoMetadata).where(eq(seoMetadata.productId, productId)).limit(1)
    return { productId, metadata: record ?? null }
  })

  app.put('/products/:id/seo', { preHandler: app.requireRole(['admin']) }, async (request) => {
    const { id } = request.params as { id: string }
    const body = seoBody.parse(request.body)

    // resolveProductId validates existence and gives a clean 404 for bad ids.
    const productId = await resolveProductId(id)

    let slug = body.slug ?? null
    if (slug) {
      slug = await uniqueSlug(slug, async (candidate) => {
        const [taken] = await db
          .select({ productId: seoMetadata.productId })
          .from(seoMetadata)
          .where(eq(seoMetadata.slug, candidate))
          .limit(1)
        return taken ? taken.productId !== productId : false
      })
    }

    const values = {
      productId,
      title: body.title ?? null,
      description: body.description ?? null,
      slug,
      keywords: body.keywords ?? null,
      ogImageUrl: body.ogImageUrl ?? null,
      updatedAt: new Date(),
    }

    const [saved] = await db
      .insert(seoMetadata)
      .values({ ...values, score: scoreSeo(values) })
      .onConflictDoUpdate({
        target: seoMetadata.productId,
        set: { ...values, score: scoreSeo(values) },
      })
      .returning()

    if (!saved) throw notFound('Məhsul tapılmadı.')
    return saved
  })
}
