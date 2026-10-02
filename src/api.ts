/**
 * The one way the web app talks to the API.
 *
 * - The access token lives only in memory; the refresh token is an httpOnly
 *   cookie the browser sends to /api/v1/auth (same origin via the Vite proxy).
 * - A 401 triggers one silent refresh and a retry, so a 15-minute access token
 *   never logs anyone out mid-session.
 * - `endirimim:signed-in` is only a hint ("try to restore a session"), never a
 *   credential. Anonymous visitors therefore make no refresh call at all.
 */

const BASE = '/api/v1'
const SIGNED_IN_HINT = 'endirimim:signed-in'

export type Role = 'user' | 'store' | 'admin'

export type User = {
  id: string
  email: string
  firstName: string | null
  lastName: string | null
  avatarUrl: string | null
  role: Role
  authProvider: string
  hasPassword: boolean
  createdAt: string
}

export type Merchant = {
  id: string
  name: string
  slug: string
  logoUrl: string | null
  coverUrl: string | null
  website: string | null
  description: string | null
  phone: string | null
  rating: number
  isVerified: boolean
  createdAt: string
}

export type Offer = {
  id: string
  merchantId: string
  merchantName: string
  merchantSlug: string
  merchantIsVerified: boolean
  price: number
  oldPrice: number | null
  discountPercentage: number
  currency: string
  stockStatus: 'in_stock' | 'out_of_stock' | 'preorder'
  shippingPrice: number
  totalPrice: number
  productUrl: string
  isCheapest: boolean
}

export type ProductImage = { id: string; url: string; altText: string | null; isPrimary: boolean }

export type Product = {
  id: string
  name: string
  slug: string
  description: string | null
  brand: { id: string; name: string; slug: string } | null
  category: { id: string; name: string; slug: string } | null
  rating: number
  reviewCount: number
  specifications: Record<string, unknown>
  images: ProductImage[]
  primaryImage: ProductImage | null
  offers: Offer[]
  offerCount: number
  bestPrice: number | null
  highestPrice: number | null
  maxDiscountPercentage: number
  currency: string | null
}

export type Paginated<T> = {
  items: T[]
  pagination: { page: number; limit: number; total: number; totalPages: number; hasMore: boolean }
}

export class ApiError extends Error {
  readonly status: number
  readonly code: string
  readonly details?: { field: string; message: string }[]

  constructor(status: number, code: string, message: string, details?: { field: string; message: string }[]) {
    super(message)
    this.status = status
    this.code = code
    this.details = details
  }

  /** First field-level message, falling back to the envelope message. */
  get friendly(): string {
    return this.details?.[0]?.message ?? this.message
  }
}

let accessToken: string | null = null
let refreshInFlight: Promise<boolean> | null = null

function readHint(): boolean {
  try {
    return window.localStorage.getItem(SIGNED_IN_HINT) === '1'
  } catch {
    return false
  }
}

function writeHint(signedIn: boolean): void {
  try {
    if (signedIn) window.localStorage.setItem(SIGNED_IN_HINT, '1')
    else window.localStorage.removeItem(SIGNED_IN_HINT)
    // Old demo-only keys: the app no longer reads them, so don't leave stale state.
    window.localStorage.removeItem('endirimim:session')
  } catch {
    // Storage can be unavailable in private browsing; the cookie still works.
  }
}

async function parse(response: Response): Promise<unknown> {
  if (response.status === 204) return null
  const text = await response.text()
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

function toError(status: number, payload: unknown): ApiError {
  const envelope = (payload as { error?: { code?: string; message?: string; details?: { field: string; message: string }[] } } | null)?.error
  if (envelope) return new ApiError(status, envelope.code ?? 'error', envelope.message ?? 'Xəta baş verdi.', envelope.details)
  if (status === 0 || status >= 500) {
    return new ApiError(status, 'unavailable', 'Server hazırda əlçatan deyil. Bir az sonra yenidən cəhd edin.')
  }
  return new ApiError(status, 'error', 'Gözlənilməz cavab alındı.')
}

/** Single-flight: parallel 401s share one refresh instead of racing each other. */
export function refreshSession(): Promise<boolean> {
  refreshInFlight ??= (async () => {
    try {
      const response = await fetch(`${BASE}/auth/refresh`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
        credentials: 'same-origin',
      })
      if (!response.ok) {
        accessToken = null
        writeHint(false)
        return false
      }
      const payload = (await response.json()) as { accessToken: string }
      accessToken = payload.accessToken
      writeHint(true)
      return true
    } catch {
      return false
    } finally {
      refreshInFlight = null
    }
  })()
  return refreshInFlight
}

type RequestOptions = { method?: string; body?: unknown; form?: FormData; signal?: AbortSignal }

export async function api<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const send = () => {
    const headers: Record<string, string> = {}
    if (accessToken) headers.authorization = `Bearer ${accessToken}`
    let body: BodyInit | undefined
    if (options.form) body = options.form
    else if (options.body !== undefined) {
      headers['content-type'] = 'application/json'
      body = JSON.stringify(options.body)
    }
    return fetch(`${BASE}${path}`, { method: options.method ?? 'GET', headers, body, credentials: 'same-origin', signal: options.signal })
  }

  let response: Response
  try {
    response = await send()
    if (response.status === 401 && !path.startsWith('/auth/') && (accessToken || readHint())) {
      if (await refreshSession()) response = await send()
    }
  } catch (error) {
    if ((error as Error).name === 'AbortError') throw error
    throw new ApiError(0, 'network', 'Serverə qoşulmaq alınmadı. İnternet bağlantınızı və ya API-nin işlədiyini yoxlayın.')
  }

  const payload = await parse(response)
  if (!response.ok) throw toError(response.status, payload)
  return payload as T
}

/* ------------------------------ session store ----------------------------- */

export type Session =
  | { status: 'loading' }
  | { status: 'anonymous' }
  | { status: 'authenticated'; user: User; merchant: Merchant | null }

let session: Session = { status: 'loading' }
const listeners = new Set<(session: Session) => void>()

function setSession(next: Session): void {
  session = next
  for (const listener of listeners) listener(session)
}

export function getSession(): Session {
  return session
}

export function subscribe(listener: (session: Session) => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export async function loadMe(): Promise<Session> {
  try {
    const me = await api<{ user: User; merchant: Merchant | null }>('/users/me')
    setSession({ status: 'authenticated', user: me.user, merchant: me.merchant })
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      accessToken = null
      writeHint(false)
      setSession({ status: 'anonymous' })
    } else {
      throw error
    }
  }
  return session
}

let bootstrapped: Promise<Session> | null = null

/** Restores the session once per page load. */
export function bootstrapSession(): Promise<Session> {
  bootstrapped ??= (async () => {
    if (!readHint()) {
      setSession({ status: 'anonymous' })
      return session
    }
    if (!(await refreshSession())) {
      setSession({ status: 'anonymous' })
      return session
    }
    try {
      return await loadMe()
    } catch {
      // API down: treat as signed out for rendering, but keep the hint so the
      // session comes back once the server is reachable again.
      setSession({ status: 'anonymous' })
      return session
    }
  })()
  return bootstrapped
}

type AuthResponse = { user: User; merchant?: Merchant | null; accessToken: string }

async function adopt(response: AuthResponse): Promise<void> {
  accessToken = response.accessToken
  writeHint(true)
  await loadMe()
}

export async function login(email: string, password: string): Promise<User> {
  const response = await api<AuthResponse>('/auth/login', { method: 'POST', body: { email, password } })
  await adopt(response)
  return response.user
}

export type RegisterInput = {
  email: string
  password: string
  accountType: 'user' | 'store'
  firstName?: string
  lastName?: string
  storeName?: string
  phone?: string
  website?: string
}

export async function register(input: RegisterInput): Promise<AuthResponse> {
  const response = await api<AuthResponse>('/auth/register', { method: 'POST', body: input })
  await adopt(response)
  return response
}

export async function logout(): Promise<void> {
  try {
    await api('/auth/logout', { method: 'POST', body: {} })
  } catch {
    // Signing out locally must work even when the API is unreachable.
  }
  accessToken = null
  writeHint(false)
  setSession({ status: 'anonymous' })
}

// Another tab signed in or out: follow it.
window.addEventListener('storage', (event) => {
  if (event.key !== SIGNED_IN_HINT) return
  if (event.newValue === '1' && session.status !== 'authenticated') {
    void refreshSession().then((ok) => (ok ? loadMe() : undefined))
  } else if (event.newValue !== '1' && session.status === 'authenticated') {
    accessToken = null
    setSession({ status: 'anonymous' })
  }
})

/* --------------------------------- helpers -------------------------------- */

export function displayName(user: Pick<User, 'firstName' | 'lastName' | 'email'>): string {
  return [user.firstName, user.lastName].filter(Boolean).join(' ') || user.email.split('@')[0] || 'İstifadəçi'
}

export function initials(value: string): string {
  const parts = value.trim().split(/\s+/).filter(Boolean)
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toLocaleUpperCase('az-AZ') || 'E'
}

export function homePathFor(role: Role): string {
  return role === 'store' ? '/store' : '/dashboard'
}

/** Only same-site relative paths are honoured, so `?next=` cannot redirect off-site. */
export function safeNext(raw: string | null): string | null {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//')) return null
  return raw
}
