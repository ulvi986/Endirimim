import { ReactNode, useCallback, useEffect, useState } from 'react'
import { AlertTriangle, CheckCircle2, ImageOff, Loader2, X } from 'lucide-react'
import { ApiError, bootstrapSession, getSession, subscribe, type Product, type Session } from './api'

export const logoSrc = '/IMG_2835.PNG'

/*
 * Browsers often ship without Azerbaijani locale data, so Intl('az-AZ') silently
 * falls back to things like "M09 14" and "2,649.5". Formatting is done by hand.
 */
const MONTHS = ['yan', 'fev', 'mar', 'apr', 'may', 'iyn', 'iyl', 'avq', 'sen', 'okt', 'noy', 'dek']
const MONTHS_LONG = ['yanvar', 'fevral', 'mart', 'aprel', 'may', 'iyun', 'iyul', 'avqust', 'sentyabr', 'oktyabr', 'noyabr', 'dekabr']
const pad = (value: number) => String(value).padStart(2, '0')

export function formatNumber(value: number): string {
  const [whole, fraction] = (Math.round(value * 100) / 100).toFixed(2).split('.') as [string, string]
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ' ')
  return fraction === '00' ? grouped : `${grouped},${fraction}`
}

export const formatPrice = (price: number | null | undefined) => (price === null || price === undefined ? '—' : `${formatNumber(price)} ₼`)

export function formatDay(value: string | Date): string {
  const date = new Date(value)
  return `${date.getDate()} ${MONTHS[date.getMonth()]}`
}

export function formatDateTime(value: string | Date): string {
  const date = new Date(value)
  return `${formatDay(date)}, ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

export function formatLongDate(value: string | Date): string {
  const date = new Date(value)
  return `${date.getDate()} ${MONTHS_LONG[date.getMonth()]} ${date.getFullYear()}`
}

export const errorMessage = (error: unknown) =>
  error instanceof ApiError ? error.friendly : 'Gözlənilməz xəta baş verdi. Yenidən cəhd edin.'

export function useSession(): Session {
  const [session, setSession] = useState<Session>(getSession)
  useEffect(() => {
    const unsubscribe = subscribe(setSession)
    void bootstrapSession()
    return () => {
      unsubscribe()
    }
  }, [])
  return session
}

type AsyncState<T> = { data: T | undefined; error: string | null; loading: boolean; reload: () => Promise<void>; setData: (value: T) => void }

/** Loads data on mount (and whenever `deps` change) with loading/error state. */
export function useAsync<T>(load: () => Promise<T>, deps: unknown[] = []): AsyncState<T> {
  const [data, setData] = useState<T>()
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const run = useCallback(load, deps)

  const reload = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setData(await run())
    } catch (caught) {
      setError(errorMessage(caught))
    } finally {
      setLoading(false)
    }
  }, [run])

  useEffect(() => {
    void reload()
  }, [reload])

  return { data, error, loading, reload, setData }
}

/**
 * Product photos come in every aspect ratio. They always fill their frame
 * (object-fit: cover) and fall back to a neutral tile instead of a broken icon.
 */
export function ProductPhoto({ product, className = '' }: { product: Pick<Product, 'name' | 'primaryImage'>; className?: string }) {
  const [failed, setFailed] = useState(false)
  const url = product.primaryImage?.url
  if (!url || failed) {
    return (
      <span className={`photo-fallback ${className}`} aria-label={product.name}>
        <ImageOff size={22} />
        <small>{product.name.slice(0, 1).toLocaleUpperCase('az-AZ')}</small>
      </span>
    )
  }
  return <img className={`product-photo ${className}`} src={url} alt={product.primaryImage?.altText || product.name} loading="lazy" onError={() => setFailed(true)} />
}

export function Spinner({ label = 'Yüklənir…' }: { label?: string }) {
  return (
    <div className="ui-loading" role="status">
      <Loader2 size={20} className="spin" />
      <span>{label}</span>
    </div>
  )
}

export function Notice({ tone = 'error', children, onClose }: { tone?: 'error' | 'success' | 'info'; children: ReactNode; onClose?: () => void }) {
  return (
    <div className={`ui-notice ${tone}`} role={tone === 'error' ? 'alert' : 'status'}>
      {tone === 'success' ? <CheckCircle2 size={16} /> : <AlertTriangle size={16} />}
      <span>{children}</span>
      {onClose && (
        <button type="button" onClick={onClose} aria-label="Bağla">
          <X size={14} />
        </button>
      )}
    </div>
  )
}

export function Modal({ kicker, title, description, onClose, children }: { kicker?: string; title: string; description?: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="workspace-modal-backdrop" onMouseDown={onClose}>
      <div className="workspace-modal" role="dialog" aria-modal="true" aria-label={title} onMouseDown={(event) => event.stopPropagation()}>
        <button className="modal-x" type="button" onClick={onClose} aria-label="Bağla">
          <X size={18} />
        </button>
        {kicker && <span className="modal-kicker">{kicker}</span>}
        <h2>{title}</h2>
        {description && <p>{description}</p>}
        {children}
      </div>
    </div>
  )
}

/** In-page confirmation for destructive actions; `window.confirm` blocks the page and cannot be styled. */
export function ConfirmModal({ title, description, confirmLabel = 'Sil', busy = false, error, onConfirm, onClose }: { title: string; description: string; confirmLabel?: string; busy?: boolean; error?: string; onConfirm: () => void; onClose: () => void }) {
  return (
    <Modal kicker="TƏSDİQ" title={title} description={description} onClose={busy ? () => undefined : onClose}>
      {error && <Notice>{error}</Notice>}
      <div className="modal-actions">
        <button type="button" className="workspace-secondary" onClick={onClose} disabled={busy}>Ləğv et</button>
        <BusyButton busy={busy} type="button" className="workspace-danger" onClick={onConfirm}>{confirmLabel}</BusyButton>
      </div>
    </Modal>
  )
}

export function FormField({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="ui-field">
      <span>{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  )
}

/** A button that shows progress and cannot be double-submitted. */
export function BusyButton({ busy, children, className = 'workspace-primary', type = 'submit', onClick, disabled }: { busy: boolean; children: ReactNode; className?: string; type?: 'submit' | 'button'; onClick?: () => void; disabled?: boolean }) {
  return (
    <button className={className} type={type} onClick={onClick} disabled={busy || disabled} aria-busy={busy}>
      {busy && <Loader2 size={15} className="spin" />}
      {children}
    </button>
  )
}

export function navigateTo(path: string): void {
  window.location.href = path
}
