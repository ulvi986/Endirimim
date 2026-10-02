export type CookieOptions = {
  maxAge?: number
  path?: string
  httpOnly?: boolean
  secure?: boolean
  sameSite?: 'Strict' | 'Lax' | 'None'
}

export function serializeCookie(name: string, value: string, options: CookieOptions = {}): string {
  const parts = [`${name}=${encodeURIComponent(value)}`]
  parts.push(`Path=${options.path ?? '/'}`)
  if (options.maxAge !== undefined) parts.push(`Max-Age=${Math.max(0, Math.floor(options.maxAge))}`)
  if (options.httpOnly ?? true) parts.push('HttpOnly')
  if (options.secure) parts.push('Secure')
  parts.push(`SameSite=${options.sameSite ?? 'Lax'}`)
  return parts.join('; ')
}

export function parseCookies(header: string | undefined): Record<string, string> {
  if (!header) return {}
  const cookies: Record<string, string> = {}

  for (const pair of header.split(';')) {
    const index = pair.indexOf('=')
    if (index === -1) continue
    const name = pair.slice(0, index).trim()
    if (!name) continue
    try {
      cookies[name] = decodeURIComponent(pair.slice(index + 1).trim())
    } catch {
      // Malformed percent-encoding: ignore this cookie rather than failing the request.
    }
  }

  return cookies
}
