import { eq } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { env } from '../../config/env.js'
import { serializeCookie } from '../../lib/cookies.js'
import { httpUrl } from '../../lib/validation.js'
import { db } from '../../db/client.js'
import { merchants, reviews, users } from '../../db/schema.js'
import { badRequest, notFound, unauthorized } from '../../lib/errors.js'
import { hashPassword, verifyPassword } from '../../lib/password.js'
import { requireAuth } from '../../plugins/auth.js'
import { revokeAllSessions } from '../auth/service.js'
import { recomputeProductRating } from '../catalog/shared.js'
import { toPublicUser } from './serialize.js'

export default async function userRoutes(app: FastifyInstance): Promise<void> {
  app.get('/users/me', { preHandler: app.authenticate }, async (request) => {
    const auth = requireAuth(request)
    const [merchant] = auth.merchantId
      ? await db.select().from(merchants).where(eq(merchants.id, auth.merchantId)).limit(1)
      : []
    return { user: toPublicUser(auth.user), merchant: merchant ?? null }
  })

  app.patch('/users/me', { preHandler: app.authenticate }, async (request) => {
    const auth = requireAuth(request)
    const body = z
      .object({
        firstName: z.string().trim().min(1).max(80).nullish(),
        lastName: z.string().trim().min(1).max(80).nullish(),
        avatarUrl: httpUrl(500).nullish(),
      })
      .parse(request.body)

    // The email used for sign-in is not editable through profile updates.
    const [updated] = await db
      .update(users)
      .set({
        ...(body.firstName !== undefined ? { firstName: body.firstName } : {}),
        ...(body.lastName !== undefined ? { lastName: body.lastName } : {}),
        ...(body.avatarUrl !== undefined ? { avatarUrl: body.avatarUrl } : {}),
        updatedAt: new Date(),
      })
      .where(eq(users.id, auth.user.id))
      .returning()

    if (!updated) throw notFound('İstifadəçi tapılmadı.')
    return { user: toPublicUser(updated) }
  })

  app.patch('/users/me/password', { preHandler: app.authenticate }, async (request) => {
    const auth = requireAuth(request)
    const body = z
      .object({
        currentPassword: z.string().min(1).max(200),
        newPassword: z.string().min(8, 'Şifrə ən azı 8 simvol olmalıdır.').max(200),
      })
      .parse(request.body)

    if (!auth.user.passwordHash) {
      throw badRequest('Hesabınız üçün şifrə təyin edilməyib. Şifrə təyin etmək üçün "şifrəni unutmusunuz" axınını istifadə edin.')
    }

    if (!(await verifyPassword(body.currentPassword, auth.user.passwordHash))) {
      throw unauthorized('Mövcud şifrə yanlışdır.')
    }

    if (body.currentPassword === body.newPassword) {
      throw badRequest('Yeni şifrə mövcud şifrə ilə eyni ola bilməz.')
    }

    const passwordHash = await hashPassword(body.newPassword)
    await db.update(users).set({ passwordHash, updatedAt: new Date() }).where(eq(users.id, auth.user.id))

    // A password change ends every other session; the caller logs in again.
    const revoked = await revokeAllSessions(auth.user.id)
    return { success: true, sessionsRevoked: revoked }
  })

  app.delete('/users/me', { preHandler: app.authenticate }, async (request, reply) => {
    const auth = requireAuth(request)
    const body = z.object({ password: z.string().max(200).optional(), confirm: z.literal(true) }).parse(request.body)

    if (auth.user.passwordHash) {
      if (!body.password) throw badRequest('Hesabı silmək üçün şifrənizi təsdiqləyin.')
      if (!(await verifyPassword(body.password, auth.user.passwordHash))) {
        throw unauthorized('Şifrə yanlışdır.')
      }
    }

    // A merchant owning a store cannot be deleted out from under its offers
    // (merchants.owner_user_id is ON DELETE RESTRICT), so require it be removed
    // first rather than surfacing a raw constraint error.
    const [ownedMerchant] = await db
      .select({ id: merchants.id })
      .from(merchants)
      .where(eq(merchants.ownerUserId, auth.user.id))
      .limit(1)

    if (ownedMerchant) {
      throw badRequest('Mağaza hesabını silməzdən əvvəl mağazanızı bağlayın və ya admin ilə əlaqə saxlayın.')
    }

    await revokeAllSessions(auth.user.id)

    // Reviews cascade with the user, so the derived product ratings must be
    // recomputed in the same transaction or they keep counting ghost reviews.
    await db.transaction(async (tx) => {
      const reviewed = await tx.select({ productId: reviews.productId }).from(reviews).where(eq(reviews.userId, auth.user.id))
      await tx.delete(users).where(eq(users.id, auth.user.id))
      for (const { productId } of reviewed) await recomputeProductRating(productId, tx)
    })

    reply.header('Set-Cookie', serializeCookie('endirimim_rt', '', { path: '/api/v1/auth', maxAge: 0, secure: env.cookie.secure, sameSite: env.cookie.sameSite }))
    reply.status(204)
  })
}
