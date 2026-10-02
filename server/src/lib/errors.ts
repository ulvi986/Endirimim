/**
 * Every expected failure is an AppError. The error plugin is the single place
 * that turns one into an HTTP response, so handlers only throw.
 */
export class AppError extends Error {
  readonly statusCode: number
  readonly code: string
  readonly details?: unknown

  constructor(statusCode: number, code: string, message: string, details?: unknown) {
    super(message)
    this.name = 'AppError'
    this.statusCode = statusCode
    this.code = code
    this.details = details
  }
}

export const badRequest = (message: string, details?: unknown) => new AppError(400, 'bad_request', message, details)
export const unauthorized = (message = 'Autentifikasiya tələb olunur.') => new AppError(401, 'unauthorized', message)
export const forbidden = (message = 'Bu əməliyyat üçün icazəniz yoxdur.') => new AppError(403, 'forbidden', message)
export const notFound = (message = 'Resurs tapılmadı.') => new AppError(404, 'not_found', message)
export const conflict = (message: string, details?: unknown) => new AppError(409, 'conflict', message, details)
export const payloadTooLarge = (message = 'Fayl ölçüsü həddi aşıldı.') => new AppError(413, 'payload_too_large', message)
export const tooManyRequests = (message = 'Çox sayda sorğu göndərdiniz. Bir az sonra yenidən cəhd edin.') =>
  new AppError(429, 'rate_limited', message)
export const internal = (message = 'Gözlənilməz xəta baş verdi.') => new AppError(500, 'internal_error', message)
