import { FormEvent, useState } from 'react'
import { ArrowRight, Bell, Check, CheckCircle2, ChevronRight, Heart, LayoutDashboard, ListPlus, LockKeyhole, LogOut, Mail, Pause, Pencil, Play, Plus, Save, Settings, ShieldCheck, ShoppingBag, SlidersHorizontal, Sparkles, Store, Trash2, TrendingDown, X } from 'lucide-react'
import { api, displayName, initials, loadMe, type Paginated, type Product, type Session } from './api'
import { BusyButton, errorMessage, FormField, formatDateTime, formatPrice, Modal, navigateTo, Notice, ProductPhoto, Spinner, useAsync } from './ui'
import { signOut, useWorkspaceRoute, WorkspaceShell, type NavItem } from './WorkspaceShell'

type AuthenticatedSession = Extract<Session, { status: 'authenticated' }>

type Alert = { id: string; targetPrice: number; isActive: boolean; createdAt: string; triggeredAt: string | null; status: 'triggered' | 'paused' | 'met' | 'watching'; currentBestPrice: number | null; gapPercentage: number | null; product: Product | null }
type ShoppingList = { id: string; name: string; updatedAt: string; itemCount: number; previewImageUrls: string[] }
type ListDetail = { id: string; name: string; items: (Product & { quantity: number })[]; estimatedTotal: number }
type Notification = { id: string; type: string; title: string; message: string; isRead: boolean; createdAt: string }
type Matrix = { products: Product[]; specificationKeys: string[]; rows: { key: string; values: unknown[] }[]; priceSpread: number | null }


function EmptyState({ title, description, action, onAction, icon: Icon = ShoppingBag }: { title: string; description: string; action?: string; onAction?: () => void; icon?: typeof ShoppingBag }) {
  return (
    <div className="workspace-empty">
      <span><Icon size={24} /></span>
      <h3>{title}</h3>
      <p>{description}</p>
      {action && <button type="button" className="workspace-primary" onClick={onAction ?? (() => navigateTo('/#products'))}>{action} <ArrowRight size={15} /></button>}
    </div>
  )
}

function ProductMiniCard({ product, onRemove, extra }: { product: Product; onRemove?: () => void; extra?: string }) {
  return (
    <article className="mini-product-card">
      <div className="mini-product-image">
        <ProductPhoto product={product} />
        {product.maxDiscountPercentage > 0 && <span>-{Math.round(product.maxDiscountPercentage)}%</span>}
        {onRemove && <button type="button" onClick={onRemove} aria-label="Sil"><X size={14} /></button>}
      </div>
      <div className="mini-product-body">
        <small>{product.brand?.name ?? product.category?.name ?? ''}</small>
        <strong title={product.name}>{product.name}</strong>
        <div className="mini-product-price"><b>{formatPrice(product.bestPrice)}</b>{product.offers[0]?.oldPrice ? <del>{formatPrice(product.offers[0].oldPrice)}</del> : null}</div>
        <span><Store size={12} /> {extra ?? `${product.offerCount} mağaza`}</span>
      </div>
    </article>
  )
}

const statusLabel: Record<Alert['status'], string> = { triggered: 'Bildiriş göndərildi', paused: 'Dayandırılıb', met: 'Hədəfə çatıb', watching: 'İzlənilir' }

/* -------------------------------- overview -------------------------------- */

function Overview({ session, go }: { session: AuthenticatedSession; go: (id: string) => void }) {
  const data = useAsync(async () => {
    const [favorites, alerts, lists, notifications, deals] = await Promise.all([
      api<Paginated<Product>>('/favorites?limit=3'),
      api<Paginated<Alert>>('/alerts?limit=50'),
      api<Paginated<ShoppingList>>('/lists?limit=50'),
      api<Paginated<Notification> & { unreadCount: number }>('/notifications?limit=1'),
      api<Paginated<Product>>('/products?limit=4&sort=biggest_discount&hasDiscount=true'),
    ])
    return { favorites, alerts, lists, notifications, deals }
  }, [])

  const firstName = session.user.firstName || displayName(session.user)
  const d = data.data
  const activeAlerts = d?.alerts.items.filter((alert) => alert.isActive) ?? []
  const itemsInLists = d?.lists.items.reduce((total, list) => total + list.itemCount, 0) ?? 0

  return (
    <>
      <section className="welcome-banner">
        <div>
          <span className="workspace-eyebrow">ŞƏXSİ PANELİNİZ</span>
          <h2>Salam, {firstName} <span>👋</span></h2>
          <p>{d ? <>Hazırda <strong>{d.deals.pagination.total} endirimli məhsul</strong> var. Kəşfə hazırsınız?</> : 'Alış-veriş səyahətinizə buradan davam edin.'}</p>
          <button type="button" className="workspace-primary" onClick={() => navigateTo('/#products')}>Məhsulları kəşf et <ArrowRight size={16} /></button>
        </div>
        <div className="welcome-orbit"><Sparkles size={24} /><strong>{d?.notifications.unreadCount ?? 0}</strong><small>yeni bildiriş</small></div>
      </section>
      {data.error && <Notice>{data.error}</Notice>}
      <div className="user-kpi-grid">
        <button type="button" onClick={() => go('favorites')}><span className="kpi-icon orange"><Heart size={17} /></span><small>Seçilmiş məhsullar</small><strong>{d?.favorites.pagination.total ?? '—'}</strong><em>Seçilmişlərə bax</em></button>
        <button type="button" onClick={() => go('alerts')}><span className="kpi-icon green"><TrendingDown size={17} /></span><small>Hədəfə çatanlar</small><strong>{d ? d.alerts.items.filter((alert) => alert.status === 'met' || alert.status === 'triggered').length : '—'}</strong><em>Qiymət xəbərdarlıqları</em></button>
        <button type="button" onClick={() => go('alerts')}><span className="kpi-icon blue"><Bell size={17} /></span><small>Aktiv xəbərdarlıqlar</small><strong>{d ? activeAlerts.length : '—'}</strong><em>İdarə et</em></button>
        <button type="button" onClick={() => go('lists')}><span className="kpi-icon purple"><ListPlus size={17} /></span><small>Alış-veriş siyahıları</small><strong>{d?.lists.pagination.total ?? '—'}</strong><em>{itemsInLists} məhsul</em></button>
      </div>
      <div className="workspace-two-col">
        <section className="workspace-panel">
          <div className="panel-heading"><div><span className="workspace-eyebrow">SEÇİLMİŞLƏR</span><h2>Yadda saxladıqlarınız</h2></div><button type="button" onClick={() => go('favorites')}>Hamısına bax <ChevronRight size={15} /></button></div>
          {data.loading ? <Spinner /> : d && d.favorites.items.length > 0 ? (
            <div className="mini-product-grid">{d.favorites.items.map((product) => <ProductMiniCard product={product} key={product.id} />)}</div>
          ) : <EmptyState icon={Heart} title="Hələ seçilmiş məhsul yoxdur" description="Ana səhifədə ürək işarəsinə basaraq məhsulları saxlayın." action="Məhsul kəşf et" />}
        </section>
        <section className="workspace-panel alert-panel">
          <div className="panel-heading"><div><span className="workspace-eyebrow">QİYMƏT RADARINIZ</span><h2>Aktiv xəbərdarlıqlar</h2></div><button type="button" onClick={() => go('alerts')}>İdarə et <ChevronRight size={15} /></button></div>
          {data.loading ? <Spinner /> : activeAlerts.length > 0 ? (
            <div className="alert-list">
              {activeAlerts.slice(0, 4).map((alert) => (
                <div key={alert.id}>
                  <span className="alert-product-dot">{initials(alert.product?.name ?? '?')}</span>
                  <div><strong>{alert.product?.name ?? 'Məhsul silinib'}</strong><small>Hədəf: {formatPrice(alert.targetPrice)}</small></div>
                  <b>{formatPrice(alert.currentBestPrice)}</b>
                  <i>{alert.status === 'watching' && alert.gapPercentage !== null ? `${Math.max(0, alert.gapPercentage).toFixed(1)}% qalıb` : statusLabel[alert.status]}</i>
                </div>
              ))}
            </div>
          ) : <p className="muted">Aktiv xəbərdarlığınız yoxdur. Ana səhifədən “Qiymət xəbərdarlığı qur” ilə başlayın.</p>}
        </section>
      </div>
      <section className="workspace-panel deals-panel">
        <div className="panel-heading"><div><span className="workspace-eyebrow">SİZƏ UYĞUN</span><h2>Bu günün ən sərfəli təklifləri</h2></div><button type="button" onClick={() => navigateTo('/#products')}>Hamısına bax <ChevronRight size={15} /></button></div>
        {data.loading ? <Spinner /> : <div className="mini-product-grid four">{d?.deals.items.map((product) => <ProductMiniCard product={product} key={product.id} />)}</div>}
      </section>
    </>
  )
}

/* -------------------------------- favorites ------------------------------- */

function Favorites({ go }: { go: (id: string) => void }) {
  const favorites = useAsync(() => api<Paginated<Product>>('/favorites?limit=100'), [])
  const [error, setError] = useState('')

  const remove = async (productId: string) => {
    if (!favorites.data) return
    const previous = favorites.data
    favorites.setData({ ...previous, items: previous.items.filter((item) => item.id !== productId), pagination: { ...previous.pagination, total: previous.pagination.total - 1 } })
    try {
      await api(`/favorites/${productId}`, { method: 'DELETE' })
    } catch (caught) {
      favorites.setData(previous)
      setError(errorMessage(caught))
    }
  }

  return (
    <>
      <div className="page-title-row">
        <div><span className="workspace-eyebrow">ŞƏXSİ KOLLEKSİYANIZ</span><h2>Seçilmişlərim</h2><p>Qiymətini izlədiyiniz və sonra baxmaq üçün saxladığınız məhsullar.</p></div>
        <button type="button" className="workspace-primary" onClick={() => go('lists')}><Plus size={16} /> Siyahılara keç</button>
      </div>
      {(error || favorites.error) && <Notice onClose={() => setError('')}>{error || favorites.error}</Notice>}
      {favorites.loading ? <Spinner /> : favorites.data && favorites.data.items.length > 0 ? (
        <div className="collection-grid">{favorites.data.items.map((product) => <ProductMiniCard key={product.id} product={product} onRemove={() => void remove(product.id)} />)}</div>
      ) : <EmptyState icon={Heart} title="Seçilmiş məhsulunuz yoxdur" description="Bəyəndiyiniz məhsulları ana səhifədə ürək işarəsi ilə burada saxlaya bilərsiniz." action="Məhsul kəşf et" />}
    </>
  )
}

/* ---------------------------------- lists --------------------------------- */

function Lists() {
  const lists = useAsync(() => api<Paginated<ShoppingList>>('/lists?limit=100'), [])
  const [creating, setCreating] = useState(false)
  const [openId, setOpenId] = useState<string | null>(null)
  const [error, setError] = useState('')

  return (
    <>
      <div className="page-title-row">
        <div><span className="workspace-eyebrow">PLANLAMA</span><h2>Alış-veriş siyahılarım</h2><p>Məhsullarınızı məqsədinə görə qruplaşdırın.</p></div>
        <button type="button" className="workspace-primary" onClick={() => setCreating(true)}><Plus size={16} /> Yeni siyahı</button>
      </div>
      {(error || lists.error) && <Notice onClose={() => setError('')}>{error || lists.error}</Notice>}
      {lists.loading ? <Spinner /> : (
        <div className="list-cards">
          {lists.data?.items.map((list, index) => (
            <div className={`list-card ${index === 0 ? 'featured' : ''}`} key={list.id}>
              <span><ShoppingBag size={19} /></span>
              <strong>{list.name}</strong>
              <small>{list.itemCount} məhsul · {formatDateTime(list.updatedAt)}</small>
              <div className="list-avatars">{list.previewImageUrls.map((url) => <img src={url} alt="" key={url} />)}</div>
              <button type="button" onClick={() => setOpenId(list.id)}>Siyahını aç <ArrowRight size={15} /></button>
            </div>
          ))}
          <button type="button" className="new-list-card" onClick={() => setCreating(true)}><Plus size={20} /><strong>Öz siyahını yarat</strong><small>Məhsullarını istədiyin kimi qrupla</small></button>
        </div>
      )}
      {creating && <ListNameModal onClose={() => setCreating(false)} onSaved={() => { setCreating(false); void lists.reload() }} />}
      {openId && <ListDetailModal listId={openId} onClose={() => { setOpenId(null); void lists.reload() }} onError={setError} />}
    </>
  )
}

function ListNameModal({ list, onClose, onSaved }: { list?: { id: string; name: string }; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(list?.name ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!name.trim()) return setError('Siyahı adı tələb olunur.')
    setBusy(true)
    try {
      await api(list ? `/lists/${list.id}` : '/lists', { method: list ? 'PATCH' : 'POST', body: { name: name.trim() } })
      onSaved()
    } catch (caught) {
      setError(errorMessage(caught))
      setBusy(false)
    }
  }
  return (
    <Modal kicker="SİYAHI" title={list ? 'Siyahının adını dəyiş' : 'Yeni siyahı yarat'} onClose={onClose}>
      <form className="ui-form" onSubmit={submit}>
        {error && <Notice>{error}</Notice>}
        <FormField label="Siyahı adı"><input autoFocus value={name} maxLength={120} onChange={(event) => setName(event.target.value)} placeholder="Məsələn, Ev üçün texnika" /></FormField>
        <div className="modal-actions"><button type="button" className="workspace-secondary" onClick={onClose}>Ləğv et</button><BusyButton busy={busy}><Save size={15} /> Yadda saxla</BusyButton></div>
      </form>
    </Modal>
  )
}

function ListDetailModal({ listId, onClose, onError }: { listId: string; onClose: () => void; onError: (message: string) => void }) {
  const detail = useAsync(() => api<ListDetail>(`/lists/${listId}`), [listId])
  const catalog = useAsync(async () => (await api<Paginated<Product>>('/products?limit=100&sort=name')).items, [])
  const [adding, setAdding] = useState('')
  const [renaming, setRenaming] = useState(false)
  const [busy, setBusy] = useState(false)

  const act = async (action: () => Promise<unknown>) => {
    setBusy(true)
    try {
      await action()
      await detail.reload()
    } catch (caught) {
      onError(errorMessage(caught))
    } finally {
      setBusy(false)
    }
  }

  if (renaming && detail.data) return <ListNameModal list={detail.data} onClose={() => setRenaming(false)} onSaved={() => { setRenaming(false); void detail.reload() }} />

  const inList = new Set(detail.data?.items.map((item) => item.id))
  return (
    <Modal kicker="SİYAHI" title={detail.data?.name ?? 'Siyahı'} description={detail.data ? `${detail.data.items.length} məhsul · Təxmini cəm ${formatPrice(detail.data.estimatedTotal)}` : undefined} onClose={onClose}>
      {detail.loading && !detail.data ? <Spinner /> : detail.error ? <Notice>{detail.error}</Notice> : (
        <>
          <div className="list-detail">
            {detail.data?.items.length === 0 && <p className="muted">Siyahı boşdur. Aşağıdan məhsul əlavə edin.</p>}
            {detail.data?.items.map((item) => (
              <div className="list-detail-row" key={item.id}>
                <span className="list-detail-photo"><ProductPhoto product={item} /></span>
                <div><strong>{item.name}</strong><small>{formatPrice(item.bestPrice)}</small></div>
                <div className="qty">
                  <button type="button" disabled={busy || item.quantity <= 1} onClick={() => void act(() => api(`/lists/${listId}/items/${item.id}`, { method: 'PATCH', body: { quantity: item.quantity - 1 } }))} aria-label="Azalt">−</button>
                  <span>{item.quantity}</span>
                  <button type="button" disabled={busy} onClick={() => void act(() => api(`/lists/${listId}/items/${item.id}`, { method: 'PATCH', body: { quantity: item.quantity + 1 } }))} aria-label="Artır">+</button>
                </div>
                <button type="button" className="icon-danger" disabled={busy} onClick={() => void act(() => api(`/lists/${listId}/items/${item.id}`, { method: 'DELETE' }))} aria-label="Siyahıdan sil"><Trash2 size={15} /></button>
              </div>
            ))}
          </div>
          <div className="inline-add">
            <select value={adding} onChange={(event) => setAdding(event.target.value)} aria-label="Əlavə ediləcək məhsul">
              <option value="">Məhsul seçin…</option>
              {catalog.data?.filter((product) => !inList.has(product.id)).map((product) => <option key={product.id} value={product.id}>{product.name} — {formatPrice(product.bestPrice)}</option>)}
            </select>
            <BusyButton busy={busy} type="button" disabled={!adding} onClick={() => void act(async () => { await api(`/lists/${listId}/items`, { method: 'POST', body: { productId: adding, quantity: 1 } }); setAdding('') })}><Plus size={15} /> Əlavə et</BusyButton>
          </div>
          <div className="modal-actions spread">
            <button type="button" className="danger-link" disabled={busy} onClick={() => void act(async () => { await api(`/lists/${listId}`, { method: 'DELETE' }); onClose() })}><Trash2 size={14} /> Siyahını sil</button>
            <div><button type="button" className="workspace-secondary" onClick={() => setRenaming(true)}><Pencil size={14} /> Adını dəyiş</button> <button type="button" className="workspace-primary" onClick={onClose}>Hazırdır</button></div>
          </div>
        </>
      )}
    </Modal>
  )
}

/* --------------------------------- alerts --------------------------------- */

function Alerts() {
  const alerts = useAsync(() => api<Paginated<Alert>>('/alerts?limit=100'), [])
  const [error, setError] = useState('')
  const [editing, setEditing] = useState<Alert | null>(null)
  const items = alerts.data?.items ?? []

  const act = async (action: () => Promise<unknown>) => {
    setError('')
    try {
      await action()
      await alerts.reload()
    } catch (caught) {
      setError(errorMessage(caught))
    }
  }

  return (
    <>
      <div className="page-title-row">
        <div><span className="workspace-eyebrow">QİYMƏT İZLƏMƏ</span><h2>Qiymət xəbərdarlıqlarım</h2><p>Hədəf qiymətinizə yaxınlaşan məhsulları bir yerdə izləyin.</p></div>
        <button type="button" className="workspace-secondary" onClick={() => navigateTo('/#products')}><Plus size={16} /> Yeni xəbərdarlıq</button>
      </div>
      <div className="alert-summary">
        <div><TrendingDown size={19} /><strong>{items.filter((alert) => alert.status === 'met' || alert.status === 'triggered').length}</strong><span>Hədəfə çatıb</span></div>
        <div><Bell size={19} /><strong>{items.filter((alert) => alert.isActive).length}</strong><span>Aktiv izləmə</span></div>
        <div><Check size={19} /><strong>{items.filter((alert) => alert.triggeredAt).length}</strong><span>Bildiriş göndərilib</span></div>
      </div>
      {(error || alerts.error) && <Notice onClose={() => setError('')}>{error || alerts.error}</Notice>}
      <section className="workspace-panel table-panel">
        <div className="panel-heading"><h2>İzlədiyiniz məhsullar</h2></div>
        {alerts.loading ? <Spinner /> : items.length === 0 ? (
          <EmptyState icon={Bell} title="Xəbərdarlığınız yoxdur" description="Ana səhifədə “Qiymət xəbərdarlığı qur” düyməsi ilə məhsulu izləməyə başlayın." action="Məhsul seç" />
        ) : (
          <div className="alert-table">
            <div className="table-head alert-grid"><span>Məhsul</span><span>Cari qiymət</span><span>Hədəf qiymət</span><span>Vəziyyət</span><span /></div>
            {items.map((alert) => (
              <div className="table-row alert-grid" key={alert.id}>
                <div className="table-product">{alert.product && <span className="table-thumb"><ProductPhoto product={alert.product} /></span>}<strong>{alert.product?.name ?? 'Məhsul silinib'}</strong></div>
                <b>{formatPrice(alert.currentBestPrice)}</b>
                <span>{formatPrice(alert.targetPrice)}</span>
                <em className={`status-pill status-${alert.status}`}>{statusLabel[alert.status]}</em>
                <div className="row-actions">
                  <button type="button" onClick={() => setEditing(alert)} aria-label="Hədəfi dəyiş"><Pencil size={15} /></button>
                  <button type="button" onClick={() => void act(() => api(`/alerts/${alert.id}`, { method: 'PATCH', body: { isActive: !alert.isActive || Boolean(alert.triggeredAt) } }))} aria-label={alert.isActive && !alert.triggeredAt ? 'Dayandır' : 'Yenidən aktivləşdir'}>{alert.isActive && !alert.triggeredAt ? <Pause size={15} /> : <Play size={15} />}</button>
                  <button type="button" className="icon-danger" onClick={() => void act(() => api(`/alerts/${alert.id}`, { method: 'DELETE' }))} aria-label="Sil"><Trash2 size={15} /></button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
      {editing && <AlertEditModal alert={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); void alerts.reload() }} />}
    </>
  )
}

function AlertEditModal({ alert, onClose, onSaved }: { alert: Alert; onClose: () => void; onSaved: () => void }) {
  const [target, setTarget] = useState(String(alert.targetPrice))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    const targetPrice = Number(target.replace(',', '.'))
    if (!Number.isFinite(targetPrice) || targetPrice <= 0) return setError('Düzgün qiymət daxil edin.')
    setBusy(true)
    try {
      await api(`/alerts/${alert.id}`, { method: 'PATCH', body: { targetPrice, isActive: true } })
      window.dispatchEvent(new Event('endirimim:notifications'))
      onSaved()
    } catch (caught) {
      setError(errorMessage(caught))
      setBusy(false)
    }
  }
  return (
    <Modal kicker="XƏBƏRDARLIQ" title={alert.product?.name ?? 'Xəbərdarlıq'} description={`Cari ən aşağı qiymət: ${formatPrice(alert.currentBestPrice)}`} onClose={onClose}>
      <form className="ui-form" onSubmit={submit}>
        {error && <Notice>{error}</Notice>}
        <FormField label="Hədəf qiymət (₼)" hint="Dəyişiklik xəbərdarlığı yenidən aktivləşdirir."><input autoFocus inputMode="decimal" value={target} onChange={(event) => setTarget(event.target.value)} /></FormField>
        <div className="modal-actions"><button type="button" className="workspace-secondary" onClick={onClose}>Ləğv et</button><BusyButton busy={busy}><Save size={15} /> Yadda saxla</BusyButton></div>
      </form>
    </Modal>
  )
}

/* ------------------------------- comparisons ------------------------------ */

function Comparisons() {
  const matrix = useAsync(async () => {
    const saved = await api<{ items: Product[] }>('/comparisons')
    if (saved.items.length === 0) return null
    return api<Matrix>(`/comparisons/matrix?ids=${saved.items.map((item) => item.id).join(',')}`)
  }, [])
  const [error, setError] = useState('')

  const act = async (action: () => Promise<unknown>) => {
    try {
      await action()
      await matrix.reload()
    } catch (caught) {
      setError(errorMessage(caught))
    }
  }

  const products = matrix.data?.products ?? []
  const cheapest = products.length ? Math.min(...products.map((product) => product.bestPrice ?? Infinity)) : null

  return (
    <>
      <div className="page-title-row">
        <div><span className="workspace-eyebrow">MÜQAYİSƏ</span><h2>Müqayisələr</h2><p>Seçdiyiniz məhsulları qiymət və xüsusiyyətlərə görə yan-yana görün.</p></div>
        {products.length > 0 && <button type="button" className="workspace-secondary" onClick={() => void act(() => api('/comparisons', { method: 'DELETE' }))}><Trash2 size={15} /> Hamısını təmizlə</button>}
      </div>
      {(error || matrix.error) && <Notice onClose={() => setError('')}>{error || matrix.error}</Notice>}
      {matrix.loading ? <Spinner /> : products.length === 0 ? (
        <EmptyState icon={SlidersHorizontal} title="Müqayisəniz boşdur" description="Ana səhifədə məhsul kartlarındakı “Müqayisə et” düyməsi ilə ən azı iki məhsul seçin." action="Məhsul seç" />
      ) : (
        <section className="workspace-panel compare-panel">
          <div className="compare-table" style={{ gridTemplateColumns: `160px repeat(${products.length}, minmax(170px, 1fr))` }}>
            <span className="compare-label" />
            {products.map((product) => (
              <div className="compare-product" key={product.id}>
                <button type="button" className="compare-remove" onClick={() => void act(() => api(`/comparisons/${product.id}`, { method: 'DELETE' }))} aria-label="Müqayisədən çıxar"><X size={14} /></button>
                <span className="compare-photo"><ProductPhoto product={product} /></span>
                <strong>{product.name}</strong>
              </div>
            ))}
            <span className="compare-label">Ən yaxşı qiymət</span>
            {products.map((product) => <b className={`compare-cell ${product.bestPrice === cheapest ? 'winner' : ''}`} key={product.id}>{formatPrice(product.bestPrice)}{product.bestPrice === cheapest && products.length > 1 ? <em>ən ucuz</em> : null}</b>)}
            <span className="compare-label">Mağaza sayı</span>
            {products.map((product) => <span className="compare-cell" key={product.id}>{product.offerCount}</span>)}
            <span className="compare-label">Endirim</span>
            {products.map((product) => <span className="compare-cell" key={product.id}>{product.maxDiscountPercentage > 0 ? `-${Math.round(product.maxDiscountPercentage)}%` : '—'}</span>)}
            <span className="compare-label">Reytinq</span>
            {products.map((product) => <span className="compare-cell" key={product.id}>{product.reviewCount ? `${product.rating.toFixed(1)} (${product.reviewCount})` : '—'}</span>)}
            {matrix.data?.rows.map((row) => (
              <FragmentRow key={row.key} label={row.key} values={row.values} />
            ))}
          </div>
          {matrix.data?.priceSpread !== null && matrix.data?.priceSpread !== undefined && <p className="muted compare-foot">Qiymət fərqi: {formatPrice(matrix.data.priceSpread)}</p>}
        </section>
      )}
    </>
  )
}

function FragmentRow({ label, values }: { label: string; values: unknown[] }) {
  return (
    <>
      <span className="compare-label">{label}</span>
      {values.map((value, index) => <span className="compare-cell" key={index}>{value === null || value === undefined ? '—' : String(value)}</span>)}
    </>
  )
}

/* ------------------------------ notifications ----------------------------- */

function Notifications() {
  const notes = useAsync(() => api<Paginated<Notification> & { unreadCount: number }>('/notifications?limit=100'), [])
  const [error, setError] = useState('')
  const act = async (action: () => Promise<unknown>) => {
    try {
      await action()
      await notes.reload()
      window.dispatchEvent(new Event('endirimim:notifications'))
    } catch (caught) {
      setError(errorMessage(caught))
    }
  }
  const items = notes.data?.items ?? []
  return (
    <>
      <div className="page-title-row">
        <div><span className="workspace-eyebrow">BİLDİRİŞLƏR</span><h2>Bildirişlər</h2><p>Qiymət düşüşləri və hesab yenilikləri.</p></div>
        <div className="title-actions">
          {(notes.data?.unreadCount ?? 0) > 0 && <button type="button" className="workspace-secondary" onClick={() => void act(() => api('/notifications/read-all', { method: 'POST', body: {} }))}><CheckCircle2 size={15} /> Hamısını oxunmuş et</button>}
          {items.some((item) => item.isRead) && <button type="button" className="workspace-secondary" onClick={() => void act(() => api('/notifications?onlyRead=true', { method: 'DELETE' }))}><Trash2 size={15} /> Oxunmuşları sil</button>}
        </div>
      </div>
      {(error || notes.error) && <Notice onClose={() => setError('')}>{error || notes.error}</Notice>}
      {notes.loading ? <Spinner /> : items.length === 0 ? (
        <EmptyState icon={Bell} title="Bildiriş yoxdur" description="Qiymət xəbərdarlığınız hədəfə çatanda bildiriş burada görünəcək." />
      ) : (
        <section className="workspace-panel notification-list">
          {items.map((item) => (
            <div className={`notification-row ${item.isRead ? '' : 'unread'}`} key={item.id}>
              <span className="kpi-icon green"><TrendingDown size={16} /></span>
              <div><strong>{item.title}</strong><p>{item.message}</p><small>{formatDateTime(item.createdAt)}</small></div>
              <div className="row-actions">
                {!item.isRead && <button type="button" onClick={() => void act(() => api(`/notifications/${item.id}/read`, { method: 'PATCH', body: { isRead: true } }))} aria-label="Oxunmuş et"><Check size={15} /></button>}
                <button type="button" className="icon-danger" onClick={() => void act(() => api(`/notifications/${item.id}`, { method: 'DELETE' }))} aria-label="Sil"><Trash2 size={15} /></button>
              </div>
            </div>
          ))}
        </section>
      )}
    </>
  )
}

/* --------------------------------- profile -------------------------------- */

export function PasswordPanel({ session }: { session: AuthenticatedSession }) {
  const [open, setOpen] = useState(false)
  const [values, setValues] = useState({ currentPassword: '', newPassword: '', confirm: '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const hasPassword = session.user.hasPassword

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (values.newPassword.length < 8) return setError('Yeni şifrə ən azı 8 simvol olmalıdır.')
    if (values.newPassword !== values.confirm) return setError('Şifrələr uyğun gəlmir.')
    setBusy(true)
    setError('')
    try {
      await api('/users/me/password', { method: 'PATCH', body: { currentPassword: values.currentPassword, newPassword: values.newPassword } })
      // Every session is revoked by design; sign in again with the new password.
      navigateTo('/login?passwordChanged=1')
    } catch (caught) {
      setError(errorMessage(caught))
      setBusy(false)
    }
  }

  return (
    <section className="workspace-panel account-security">
      <div className="panel-heading"><div><span className="workspace-eyebrow">TƏHLÜKƏSİZLİK</span><h2>Hesab təhlükəsizliyi</h2></div><ShieldCheck size={20} /></div>
      <div className="security-row"><LockKeyhole size={17} /><div><strong>Şifrə</strong><small>{hasPassword ? 'Dəyişdikdən sonra bütün cihazlardan çıxış edilir' : 'Şifrə təyin edilməyib'}</small></div>{hasPassword ? <button type="button" onClick={() => setOpen(true)}>Dəyiş</button> : <button type="button" onClick={() => navigateTo('/forgot-password')}>Şifrə təyin et</button>}</div>
      <div className="security-row"><LogOut size={17} /><div><strong>Çıxış</strong><small>Bu cihazda hesabdan çıxın</small></div><button type="button" onClick={() => void signOut()}>Çıxış</button></div>
      {open && (
        <Modal kicker="TƏHLÜKƏSİZLİK" title="Şifrəni dəyiş" description="Dəyişiklikdən sonra yenidən daxil olmalısınız." onClose={() => setOpen(false)}>
          <form className="ui-form" onSubmit={submit}>
            {error && <Notice>{error}</Notice>}
            <FormField label="Mövcud şifrə"><input type="password" autoComplete="current-password" value={values.currentPassword} onChange={(event) => setValues({ ...values, currentPassword: event.target.value })} /></FormField>
            <FormField label="Yeni şifrə"><input type="password" autoComplete="new-password" value={values.newPassword} onChange={(event) => setValues({ ...values, newPassword: event.target.value })} /></FormField>
            <FormField label="Yeni şifrəni təsdiqlə"><input type="password" autoComplete="new-password" value={values.confirm} onChange={(event) => setValues({ ...values, confirm: event.target.value })} /></FormField>
            <div className="modal-actions"><button type="button" className="workspace-secondary" onClick={() => setOpen(false)}>Ləğv et</button><BusyButton busy={busy}><Save size={15} /> Şifrəni yenilə</BusyButton></div>
          </form>
        </Modal>
      )}
    </section>
  )
}

function Profile({ session }: { session: AuthenticatedSession }) {
  const [editing, setEditing] = useState(false)
  const [values, setValues] = useState({ firstName: session.user.firstName ?? '', lastName: session.user.lastName ?? '' })
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<{ tone: 'success' | 'error'; text: string } | null>(null)
  const name = displayName(session.user)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!values.firstName.trim()) return setNotice({ tone: 'error', text: 'Ad boş ola bilməz.' })
    setBusy(true)
    try {
      await api('/users/me', { method: 'PATCH', body: { firstName: values.firstName.trim(), lastName: values.lastName.trim() || null } })
      await loadMe()
      setEditing(false)
      setNotice({ tone: 'success', text: 'Profil məlumatları yadda saxlanıldı.' })
    } catch (caught) {
      setNotice({ tone: 'error', text: errorMessage(caught) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="profile-page">
      <div className="profile-cover">
        <div className="profile-cover-grid" />
        <div className="profile-avatar-wrap"><span className="profile-avatar">{initials(name)}</span></div>
        <div className="profile-cover-copy"><span className="workspace-eyebrow">ŞƏXSİ HESAB</span><h2>{name}</h2><p>Endirimim istifadəçisi · {new Date(session.user.createdAt).getFullYear()}-ci ildən</p></div>
      </div>
      <div className="profile-layout">
        <form className="workspace-panel profile-form" onSubmit={submit}>
          <div className="panel-heading"><div><span className="workspace-eyebrow">HESAB MƏLUMATLARI</span><h2>Profil məlumatları</h2></div>{!editing && <button type="button" className="profile-edit" onClick={() => { setEditing(true); setNotice(null) }}><Pencil size={14} /> Düzəliş et</button>}</div>
          {notice && <Notice tone={notice.tone} onClose={() => setNotice(null)}>{notice.text}</Notice>}
          <div className="profile-fields">
            <label><span>Ad</span><input disabled={!editing} value={values.firstName} maxLength={80} onChange={(event) => setValues({ ...values, firstName: event.target.value })} /></label>
            <label><span>Soyad</span><input disabled={!editing} value={values.lastName} maxLength={80} onChange={(event) => setValues({ ...values, lastName: event.target.value })} /></label>
            <label className="wide"><span>Email ünvanı</span><div className="profile-input-icon"><Mail size={15} /><input disabled value={session.user.email} /></div></label>
          </div>
          {editing && <div className="profile-form-actions"><button type="button" className="workspace-secondary" onClick={() => { setEditing(false); setValues({ firstName: session.user.firstName ?? '', lastName: session.user.lastName ?? '' }) }}>Ləğv et</button><BusyButton busy={busy}><Save size={15} /> Dəyişiklikləri saxla</BusyButton></div>}
        </form>
        <aside className="profile-side-stack">
          <PasswordPanel session={session} />
        </aside>
      </div>
    </div>
  )
}

/* -------------------------------- workspace ------------------------------- */

const titles: Record<string, [string, string]> = {
  overview: ['Ana səhifə', 'Alış-veriş səyahətinizə buradan davam edin.'],
  favorites: ['Seçilmişlərim', 'Saxladığınız məhsullar.'],
  lists: ['Alış-veriş siyahılarım', 'Məhsullarınızı qruplaşdırın.'],
  alerts: ['Qiymət xəbərdarlıqları', 'Hədəf qiymətlərinizi izləyin.'],
  comparisons: ['Müqayisələr', 'Məhsulları yan-yana görün.'],
  notifications: ['Bildirişlər', 'Son yenilikləriniz.'],
  profile: ['Profil və ayarlar', 'Hesab məlumatlarınızı idarə edin.'],
}

export default function UserWorkspace({ session }: { session: AuthenticatedSession }) {
  const items: NavItem[] = [
    { id: 'overview', path: '/dashboard', label: 'Ana səhifə', icon: LayoutDashboard, section: 'MƏNİM ALIŞ-VERİŞİM', mobile: true },
    { id: 'favorites', path: '/favorites', label: 'Seçilmişlərim', icon: Heart, section: 'MƏNİM ALIŞ-VERİŞİM', mobile: true },
    { id: 'lists', path: '/lists', label: 'Alış-veriş siyahılarım', icon: ListPlus, section: 'MƏNİM ALIŞ-VERİŞİM' },
    { id: 'alerts', path: '/alerts', label: 'Qiymət xəbərdarlıqları', icon: Bell, section: 'MƏNİM ALIŞ-VERİŞİM', mobile: true },
    { id: 'comparisons', path: '/comparisons', label: 'Müqayisələr', icon: SlidersHorizontal, section: 'MƏNİM ALIŞ-VERİŞİM' },
    { id: 'notifications', path: '/notifications', label: 'Bildirişlər', icon: Bell, section: 'MƏNİM ALIŞ-VERİŞİM' },
    { id: 'profile', path: '/profile', label: 'Profil və ayarlar', icon: Settings, section: 'HESAB', mobile: true },
  ]
  const [active, go] = useWorkspaceRoute(items, 'overview')
  const [title, subtitle] = titles[active] ?? titles.overview!

  return (
    <WorkspaceShell mode="user" session={session} items={items} active={active} onNavigate={go} title={title} subtitle={subtitle}>
      {active === 'favorites' ? <Favorites go={go} />
        : active === 'lists' ? <Lists />
        : active === 'alerts' ? <Alerts />
        : active === 'comparisons' ? <Comparisons />
        : active === 'notifications' ? <Notifications />
        : active === 'profile' ? <Profile session={session} />
        : <Overview session={session} go={go} />}
    </WorkspaceShell>
  )
}
