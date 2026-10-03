import type { FastifyError } from 'fastify'
import fp from 'fastify-plugin'
import { ZodError } from 'zod'
import { env } from '../config/env.js'
import { driverErrorCode } from '../lib/db-errors.js'
import { AppError } from '../lib/errors.js'
import { installZodMessages } from '../lib/zod-messages.js'

installZodMessages()

function mapDatabaseError(error: unknown): AppError | undefined {
  switch (driverErrorCode(error)) {
    // invalid_text_representation: e.g. a malformed uuid in a path parameter.
    case '22P02':
      return new AppError(404, 'not_found', 'Resurs tapılmadı.')
    case '23505':
      return new AppError(409, 'conflict', 'Bu məlumat artıq mövcuddur.')
    case '23503':
      return new AppError(409, 'conflict', 'Əlaqəli resurs mövcud deyil və ya hələ istifadə olunur.')
    case '23514':
    case '22003':
      return new AppError(400, 'validation_failed', 'Göndərilən dəyər icazə verilən həddən kənardır.')
    default:
      return undefined
  }
}

type ErrorBody = {
  error: { code: string; message: string; details?: unknown }
}

/**
 * The one place errors become HTTP responses. Handlers throw; nothing else
 * formats an error. Internal messages are never leaked in production.
 */
export default fp(
  async (app) => {
    app.setNotFoundHandler((request, reply) => {
      reply.status(404).send({
        error: { code: 'not_found', message: `Marşrut tapılmadı: ${request.method} ${request.url}` },
      } satisfies ErrorBody)
    })

    app.setErrorHandler((error: FastifyError, request, reply) => {
      if (error instanceof AppError) {
        reply.status(error.statusCode).send({
          error: { code: error.code, message: error.message, details: error.details },
        } satisfies ErrorBody)
        return
      }

      if (error instanceof ZodError) {
        reply.status(400).send({
          error: {
            code: 'validation_failed',
            message: 'Göndərilən məlumatlar düzgün deyil.',
            details: error.issues.map((issue) => ({
              field: issue.path.join('.'),
              message: issue.message,
            })),
          },
        } satisfies ErrorBody)
        return
      }

      // Constraint violations are expected outcomes of bad input or races, not
      // server faults. Drizzle wraps the driver error, so walk the cause chain.
      const dbError = mapDatabaseError(error)
      if (dbError) {
        reply.status(dbError.statusCode).send({
          error: { code: dbError.code, message: dbError.message },
        } satisfies ErrorBody)
        return
      }

      // Fastify's own schema/body-limit errors carry a statusCode already.
      const status = typeof error.statusCode === 'number' ? error.statusCode : 500

      if (error.code === 'FST_ERR_CTP_BODY_TOO_LARGE') {
        reply.status(413).send({
          error: { code: 'payload_too_large', message: 'Sorğu gövdəsi həddi aşıdı.' },
        } satisfies ErrorBody)
        return
      }

      if (error.validation) {
        reply.status(400).send({
          error: { code: 'validation_failed', message: error.message },
        } satisfies ErrorBody)
        return
      }

      if (status >= 400 && status < 500) {
        reply.status(status).send({
          error: { code: error.code ?? 'request_error', message: error.message },
        } satisfies ErrorBody)
        return
      }

      request.log.error({ err: error }, 'unhandled request error')
      reply.status(500).send({
        error: {
          code: 'internal_error',
          message: env.isProduction ? 'Daxili xəta baş verdi.' : error.message,
        },
      } satisfies ErrorBody)
    })
  },
  { name: 'errors' },
)
