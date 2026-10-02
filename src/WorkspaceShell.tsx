import { ReactNode, useEffect, useState } from 'react'
import { Bell, ChevronLeft, LogOut, type LucideIcon } from 'lucide-react'
import { api, displayName, initials, logout, type Session } from './api'
import { logoSrc, navigateTo } from './ui'

export type NavItem = { id: string; path: string; label: string; icon: LucideIcon; badge?: number | null; section?: string; mobile?: boolean }

type AuthenticatedSession = Extract<Session, { status: 'authenticated' }>

/** Keeps the active page in the URL, so refresh and back/forward land where they should. */
export function useWorkspaceRoute(items: NavItem[], fallback: string): [string, (id: string) => void] {
  const idFor = (pathname: string) => items.find((item) => item.path === pathname)?.id ?? fallback
  const [active, setActive] = useState(() => idFor(window.location.pathname))

  useEffect(() => {
    const onPop = () => setActive(idFor(window.location.pathname))
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const go = (id: string) => {
    const item = items.find((candidate) => candidate.id === id)
    if (item && window.location.pathname !== item.path) window.history.pushState({}, '', item.path)
    setActive(id)
    window.scrollTo({ top: 0 })
  }
  return [active, go]
}

export function useUnreadCount(): number {
  const [count, setCount] = useState(0)
  useEffect(() => {
    let cancelled = false
    const load = () =>
      api<{ unreadCount: number }>('/notifications?limit=1')
        .then((page) => !cancelled && setCount(page.unreadCount))
        .catch(() => undefined)
    void load()
    const timer = window.setInterval(load, 60_000)
    window.addEventListener('endirimim:notifications', load)
    return () => {
      cancelled = true
      window.clearInterval(timer)
      window.removeEventListener('endirimim:notifications', load)
    }
  }, [])
  return count
}

export async function signOut(): Promise<void> {
  await logout()
  navigateTo('/')
}

export function WorkspaceShell({ mode, session, items, active, onNavigate, title, subtitle, headerActions, children }: {
  mode: 'user' | 'store'
  session: AuthenticatedSession
  items: NavItem[]
  active: string
  onNavigate: (id: string) => void
  title: string
  subtitle: string
  headerActions?: ReactNode
  children: ReactNode
}) {
  const [signingOut, setSigningOut] = useState(false)
  const name = mode === 'store' ? session.merchant?.name ?? 'Mağazam' : displayName(session.user)
  const unread = useUnreadCount()
  const sections = [...new Set(items.map((item) => item.section ?? ''))]

  const exit = async () => {
    setSigningOut(true)
    await signOut()
  }

  const identity = (
    <div className={mode === 'store' ? 'store-identity' : 'profile-mini'}>
      <span className={mode === 'store' ? 'store-avatar' : 'avatar user-avatar'}>{initials(name)}</span>
      <div>
        <strong title={name}>{name}</strong>
        <small>
          {mode === 'store'
            ? 'Mağaza hesabı'
            : session.user.role === 'admin' ? 'Admin hesabı' : 'İstifadəçi hesabı'}
        </small>
      </div>
    </div>
  )

  return (
    <div className={`workspace ${mode === 'store' ? 'store-workspace' : 'user-workspace'}`}>
      <aside className={`workspace-sidebar ${mode === 'store' ? 'store-sidebar' : 'user-sidebar'}`}>
        {/* The brand goes home; it never signs anyone out. */}
        <a className="workspace-brand" href="/"><img src={logoSrc} alt="Endirimim" /><strong>Endirimim<span>.</span></strong></a>
        {identity}
        {mode === 'store' && session.merchant && (
          <a className="store-public-link" href="/" title="Ana səhifədə mağaza təklifləriniz görünür"><ChevronLeft size={15} /> Sayta qayıt</a>
        )}
        <nav className="workspace-nav">
          {sections.map((section, index) => (
            <div key={section || index}>
              {section && <span className={`nav-label ${index > 0 ? 'second' : ''}`}>{section}</span>}
              {items.filter((item) => (item.section ?? '') === section).map(({ id, label, icon: Icon, badge }) => (
                <button type="button" className={active === id ? 'active' : ''} onClick={() => onNavigate(id)} key={id} aria-current={active === id ? 'page' : undefined}>
                  <Icon size={18} />{label}{badge ? <b>{badge}</b> : null}
                </button>
              ))}
            </div>
          ))}
        </nav>
        <button type="button" className="workspace-logout" onClick={() => void exit()} disabled={signingOut}><LogOut size={17} />{signingOut ? 'Çıxılır…' : 'Çıxış'}</button>
      </aside>
      <main className="workspace-main">
        <header className={`workspace-header ${mode === 'store' ? 'store-header' : ''}`}>
          <div>
            <span className="mobile-brand"><a className="workspace-brand" href="/"><img src={logoSrc} alt="Endirimim" /><strong>Endirimim<span>.</span></strong></a></span>
            <h1>{title}</h1>
            <p>{subtitle}</p>
          </div>
          <div className="workspace-header-actions">
            {headerActions}
            {mode === 'user' && (
              <button type="button" className="workspace-icon notification" onClick={() => onNavigate('notifications')} aria-label={`Bildirişlər${unread ? ` (${unread} oxunmamış)` : ''}`}>
                <Bell size={18} />{unread > 0 && <i />}
              </button>
            )}
            <button type="button" className={mode === 'store' ? 'store-avatar small' : 'avatar user-avatar'} onClick={() => onNavigate(mode === 'store' ? 'profile' : 'profile')} aria-label="Profil">{initials(name)}</button>
          </div>
        </header>
        <div className="workspace-content">{children}</div>
      </main>
      <nav className="mobile-bottom-nav">
        {items.filter((item) => item.mobile).map(({ id, label, icon: Icon }) => (
          <button type="button" className={active === id ? 'active' : ''} onClick={() => onNavigate(id)} key={id}><Icon size={19} /><span>{label}</span></button>
        ))}
      </nav>
    </div>
  )
}
