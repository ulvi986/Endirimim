import { ChangeEvent, FormEvent, useMemo, useRef, useState } from 'react'
import { ArrowRight, BarChart3, Bell, Boxes, CloudUpload, Eye, FileImage, Globe2, Heart, ImagePlus, LayoutDashboard, MousePointerClick, Pause, Pencil, Phone, Play, Plus, Save, Settings, ShieldCheck, Sparkles, Store, Tag, Trash2, TrendingDown } from 'lucide-react'
import { api, initials, loadMe, type Paginated, type Session } from './api'
import { BusyButton, errorMessage, FormField, formatDay, formatLongDate, formatPrice, Modal, Notice, Spinner, useAsync } from './ui'
import { PasswordPanel } from './UserWorkspace'
import { useWorkspaceRoute, WorkspaceShell, type NavItem } from './WorkspaceShell'

type AuthenticatedSession = Extract<Session, { status: 'authenticated' }>

type MerchantOffer = { id: string; price: number; oldPrice: number | null; discountPercentage: number; currency: string; stockStatus: 'in_stock' | 'out_of_stock' | 'preorder'; shippingPrice: number; productUrl: string; sku: string | null; updatedAt: string; productId: string; productName: string; productSlug: string; primaryImageUrl: string | null }
type Dashboard = { offers: { total: number; inStock: number; outOfStock: number; discounted: number; averageDiscount: number }; last30Days: { views: number; offerClicks: number; favorites: number; alerts: number } }
type Analytics = { days: number; totals: Record<string, number>; series: { day: string; view: number; offer_click: number; favorite: number; alert: number }[]; topProducts: { productId: string | null; productName: string | null; views: number; clicks: number; favorites: number; alerts: number }[] }
type Positioning = { offers: { productId: string; productName: string; ownPrice: number; marketBestPrice: number; competitorCount: number; rank: number; isCheapest: boolean; deltaToBest: number }[]; summary: { trackedProducts: number; cheapestCount: number; cheapestRate: number; averageDeltaToBest: number } }
type Campaign = { id: string; title: string; description: string | null; imageUrl: string | null; startDate: string; endDate: string; url: string | null; isActive: boolean }
type MediaAsset = { id: string; url: string; originalName: string | null; mimeType: string | null; sizeBytes: number | null; createdAt: string }
type Taxonomy = { id: string; name: string; slug: string; children?: Taxonomy[] }

const stockLabel = { in_stock: 'Stokda', out_of_stock: 'Bitib', preorder: 'Ön sifariş' } as const
const MAX_UPLOAD_MB = 4

function friendly(error: unknown): string {
  return errorMessage(error)
}

function Thumb({ url, name }: { url: string | null; name: string }) {
  const [failed, setFailed] = useState(false)
  return url && !failed ? <img className="table-thumb-img" src={url} alt="" loading="lazy" onError={() => setFailed(true)} /> : <span className="table-thumb-fallback">{initials(name)}</span>
}

function MetricCard({ label, value, hint, icon: Icon, tone }: { label: string; value: string | number; hint: string; icon: typeof Eye; tone: string }) {
  return <div className="metric-card"><span className={`metric-icon ${tone}`}><Icon size={18} /></span><div><small>{label}</small><strong>{value}</strong><em>{hint}</em></div></div>
}

/** Real series, drawn as a smooth-enough polyline scaled to its own maximum. */
function SeriesChart({ series, field }: { series: Analytics['series']; field: 'view' | 'offer_click' }) {
  if (series.length === 0) return <div className="chart-empty">Bu dövr üçün hələ məlumat yoxdur. Məhsullarınıza baxış və kliklər gəldikcə qrafik dolacaq.</div>
  const values = series.map((point) => point[field] ?? 0)
  const max = Math.max(1, ...values)
  const step = series.length > 1 ? 700 / (series.length - 1) : 700
  const points = values.map((value, index) => `${(series.length > 1 ? index * step : 350).toFixed(1)},${(170 - (value / max) * 150).toFixed(1)}`)
  const line = points.join(' ')
  return (
    <div className="store-chart">
      <svg viewBox="0 0 700 180" preserveAspectRatio="none" role="img" aria-label="Gündəlik baxış qrafiki">
        <defs><linearGradient id="storeChartFill" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="#f97316" stopOpacity=".22" /><stop offset="1" stopColor="#f97316" stopOpacity="0" /></linearGradient></defs>
        <polygon points={`${points[0]!.split(',')[0]},180 ${line} ${points[points.length - 1]!.split(',')[0]},180`} fill="url(#storeChartFill)" />
        <polyline points={line} fill="none" stroke="#f97316" strokeWidth="3" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      </svg>
      <div className="chart-x"><span>{formatDay(series[0]!.day)}</span><span>{formatDay(series[series.length - 1]!.day)}</span></div>
    </div>
  )
}

/* -------------------------------- overview -------------------------------- */

function Overview({ session, go }: { session: AuthenticatedSession; go: (id: string) => void }) {
  const data = useAsync(async () => {
    const [dashboard, analytics, positioning] = await Promise.all([
      api<Dashboard>('/merchant/dashboard'),
      api<Analytics>('/merchant/analytics?days=30'),
      api<Positioning>('/merchant/positioning'),
    ])
    return { dashboard, analytics, positioning }
  }, [])
  const d = data.data
  const score = d ? Math.round(d.positioning.summary.cheapestRate) : 0

  return (
    <>
      <section className="store-hero">
        <div>
          <span className="workspace-eyebrow">MAĞAZA İCMALI · {formatLongDate(new Date()).toLocaleUpperCase('az-AZ')}</span>
          <h2>Xoş gəldiniz, <em>{session.merchant?.name}</em></h2>
          <p>Son 30 günün performansı və bazardakı qiymət mövqeyiniz.</p>
        </div>
        <button type="button" className="workspace-primary" onClick={() => go('products')}><Plus size={16} /> Məhsul əlavə et</button>
      </section>
      {data.error && <Notice>{data.error}</Notice>}
      {data.loading || !d ? <Spinner /> : (
        <>
          <div className="metric-grid">
            <MetricCard label="Məhsul baxışı" value={d.dashboard.last30Days.views} hint="son 30 gün" icon={Eye} tone="orange" />
            <MetricCard label="Təklif klikləri" value={d.dashboard.last30Days.offerClicks} hint="son 30 gün" icon={MousePointerClick} tone="blue" />
            <MetricCard label="Seçilmişlərə əlavə" value={d.dashboard.last30Days.favorites} hint="son 30 gün" icon={Heart} tone="pink" />
            <MetricCard label="Qiymət xəbərdarlığı" value={d.dashboard.last30Days.alerts} hint="son 30 gün" icon={Bell} tone="green" />
          </div>
          <div className="store-dashboard-grid">
            <section className="workspace-panel performance-panel">
              <div className="panel-heading"><div><span className="workspace-eyebrow">MAĞAZA PERFORMANSI</span><h2>Məhsul baxışları</h2></div><button type="button" onClick={() => go('analytics')}>Analitika <ArrowRight size={14} /></button></div>
              <div className="chart-stat"><strong>{d.analytics.totals.view ?? 0}</strong><span>baxış · {d.analytics.totals.offer_click ?? 0} klik</span></div>
              <SeriesChart series={d.analytics.series} field="view" />
            </section>
            <section className="workspace-panel competitive-panel">
              <div className="panel-heading"><div><span className="workspace-eyebrow">QİYMƏT RƏQABƏTİ</span><h2>Bazar mövqeyiniz</h2></div></div>
              <div className="competitive-score">
                <div className="score-ring" style={{ ['--score' as string]: `${score * 3.6}deg` }}><strong>{score}</strong><small>%</small></div>
                <div><strong>{d.positioning.summary.trackedProducts === 0 ? 'Hələ təklifiniz yoxdur' : score >= 50 ? 'Yaxşı mövqedəsiniz' : 'Qiymətləri yoxlayın'}</strong><p>{d.positioning.summary.cheapestCount} / {d.positioning.summary.trackedProducts} məhsulda ən ucuz sizsiniz</p></div>
              </div>
              <div className="market-bar"><span style={{ width: `${score}%` }} /></div>
              <div className="market-labels"><span>Orta fərq: {formatPrice(d.positioning.summary.averageDeltaToBest)}</span><span>{d.dashboard.offers.discounted} endirimli təklif</span></div>
            </section>
          </div>
          <section className="workspace-panel performance-table">
            <div className="panel-heading"><div><span className="workspace-eyebrow">MƏHSUL MÖVQEYİ</span><h2>Təklifləriniz bazarda</h2></div><button type="button" onClick={() => go('products')}>Hamısına bax <ArrowRight size={14} /></button></div>
            {d.positioning.offers.length === 0 ? <p className="muted">Hələ təklifiniz yoxdur. “Məhsul əlavə et” ilə başlayın.</p> : (
              <div className="store-product-table">
                <div className="table-head"><span>Məhsul</span><span>Sizin qiymət</span><span>Bazar ən ucuz</span><span>Mağaza sayı</span><span>Mövqe</span></div>
                {d.positioning.offers.slice(0, 6).map((offer) => (
                  <div className="table-row" key={offer.productId}>
                    <div className="table-product"><span className={`product-rank rank-${Math.min(offer.rank, 3)}`}>{offer.rank}</span><strong>{offer.productName}</strong></div>
                    <span>{formatPrice(offer.ownPrice)}</span>
                    <span>{formatPrice(offer.marketBestPrice)}</span>
                    <span>{offer.competitorCount}</span>
                    <em className={offer.isCheapest ? 'best-position' : ''}>{offer.isCheapest ? 'Ən ucuz' : `+${formatPrice(offer.deltaToBest)}`}</em>
                  </div>
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </>
  )
}

/* ------------------------------ products/offers --------------------------- */

function Products({ discountsOnly = false, session }: { discountsOnly?: boolean; session: AuthenticatedSession }) {
  const offers = useAsync(() => api<Paginated<MerchantOffer>>('/merchant/offers?limit=100'), [])
  const [modal, setModal] = useState<{ kind: 'create' } | { kind: 'edit'; offer: MerchantOffer } | { kind: 'images'; offer: MerchantOffer } | null>(null)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<'all' | 'in_stock' | 'out_of_stock'>('all')

  const all = offers.data?.items ?? []
  const base = discountsOnly ? all.filter((offer) => offer.discountPercentage > 0) : all
  const visible = base.filter((offer) => (filter === 'all' || offer.stockStatus === filter) && offer.productName.toLocaleLowerCase('az-AZ').includes(search.trim().toLocaleLowerCase('az-AZ')))

  const remove = async (offer: MerchantOffer) => {
    setError('')
    try {
      await api(`/offers/${offer.id}`, { method: 'DELETE' })
      await offers.reload()
    } catch (caught) {
      setError(friendly(caught))
    }
  }

  return (
    <>
      <div className="page-title-row store-title">
        <div>
          <span className="workspace-eyebrow">{discountsOnly ? 'ENDİRİMLƏR' : 'KATALOQ İDARƏETMƏSİ'}</span>
          <h2>{discountsOnly ? 'Endirimlərim' : 'Məhsullar və təkliflər'}</h2>
          <p>{discountsOnly ? 'Köhnə qiyməti olan təklifləriniz. Endirim faizi avtomatik hesablanır.' : `${all.length} təklifinizin qiymətini, stokunu və şəkillərini idarə edin.`}</p>
        </div>
        <button type="button" className="workspace-primary" onClick={() => setModal({ kind: 'create' })}><Plus size={16} /> Yeni məhsul əlavə et</button>
      </div>
      <div className="store-product-toolbar">
        <div className="stat-filter">
          <button type="button" className={filter === 'all' ? 'active' : ''} onClick={() => setFilter('all')}>Hamısı <b>{base.length}</b></button>
          <button type="button" className={filter === 'in_stock' ? 'active' : ''} onClick={() => setFilter('in_stock')}>Stokda <b>{base.filter((offer) => offer.stockStatus === 'in_stock').length}</b></button>
          <button type="button" className={filter === 'out_of_stock' ? 'active' : ''} onClick={() => setFilter('out_of_stock')}>Bitib <b>{base.filter((offer) => offer.stockStatus === 'out_of_stock').length}</b></button>
        </div>
        <label className="toolbar-search"><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Məhsul axtar…" aria-label="Məhsul axtar" /></label>
      </div>
      {(error || offers.error) && <Notice onClose={() => setError('')}>{error || offers.error}</Notice>}
      <section className="workspace-panel performance-table">
        {offers.loading ? <Spinner /> : visible.length === 0 ? (
          <div className="workspace-empty"><span><Boxes size={24} /></span><h3>{all.length === 0 ? 'Hələ təklifiniz yoxdur' : 'Uyğun təklif tapılmadı'}</h3><p>{all.length === 0 ? 'İlk məhsulunuzu əlavə edin — alıcılar onu dərhal müqayisədə görəcək.' : 'Filtri və ya axtarışı dəyişin.'}</p>{all.length === 0 && <button type="button" className="workspace-primary" onClick={() => setModal({ kind: 'create' })}><Plus size={15} /> Məhsul əlavə et</button>}</div>
        ) : (
          <div className="store-product-table detailed">
            <div className="table-head"><span>Məhsul</span><span>Qiymət</span><span>Endirim</span><span>Stok</span><span>Yenilənib</span><span /></div>
            {visible.map((offer) => (
              <div className="table-row" key={offer.id}>
                <div className="table-product"><Thumb url={offer.primaryImageUrl} name={offer.productName} /><div><strong>{offer.productName}</strong><small>{offer.sku ? `SKU: ${offer.sku}` : 'SKU yoxdur'}{offer.shippingPrice > 0 ? ` · Çatdırılma ${formatPrice(offer.shippingPrice)}` : ''}</small></div></div>
                <div><b>{formatPrice(offer.price)}</b>{offer.oldPrice ? <del className="table-del">{formatPrice(offer.oldPrice)}</del> : null}</div>
                <em className="discount-text">{offer.discountPercentage > 0 ? `-${Math.round(offer.discountPercentage)}%` : '—'}</em>
                <span className={`stock-pill ${offer.stockStatus}`}>{stockLabel[offer.stockStatus]}</span>
                <span className="muted">{formatDay(offer.updatedAt)}</span>
                <div className="row-actions">
                  <button type="button" onClick={() => setModal({ kind: 'edit', offer })} aria-label="Təklifi redaktə et"><Pencil size={15} /></button>
                  <button type="button" onClick={() => setModal({ kind: 'images', offer })} aria-label="Şəkil əlavə et"><ImagePlus size={15} /></button>
                  <button type="button" className="icon-danger" onClick={() => void remove(offer)} aria-label="Təklifi sil"><Trash2 size={15} /></button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
      {modal?.kind === 'create' && <CreateProductModal existingProductIds={new Set(all.map((offer) => offer.productId))} onClose={() => setModal(null)} onSaved={() => { setModal(null); void offers.reload() }} />}
      {modal?.kind === 'edit' && <EditOfferModal offer={modal.offer} onClose={() => setModal(null)} onSaved={() => { setModal(null); void offers.reload() }} />}
      {modal?.kind === 'images' && <ImageUploadModal productId={modal.offer.productId} productName={modal.offer.productName} onClose={() => { setModal(null); void offers.reload() }} />}
    </>
  )
}

type OfferForm = { price: string; oldPrice: string; stockStatus: MerchantOffer['stockStatus']; shippingPrice: string; productUrl: string; sku: string }

function parseOffer(form: OfferForm): { body: Record<string, unknown> } | { error: string } {
  const number = (value: string) => Number(value.replace(',', '.'))
  const price = number(form.price)
  if (!form.price || !Number.isFinite(price) || price < 0) return { error: 'Düzgün qiymət daxil edin.' }
  const oldPrice = form.oldPrice ? number(form.oldPrice) : null
  if (oldPrice !== null && (!Number.isFinite(oldPrice) || oldPrice < price)) return { error: 'Köhnə qiymət cari qiymətdən az ola bilməz.' }
  const shippingPrice = form.shippingPrice ? number(form.shippingPrice) : 0
  if (!Number.isFinite(shippingPrice) || shippingPrice < 0) return { error: 'Çatdırılma qiyməti düzgün deyil.' }
  if (!/^https?:\/\//i.test(form.productUrl.trim())) return { error: 'Məhsul keçidi http:// və ya https:// ilə başlamalıdır.' }
  return { body: { price, oldPrice, stockStatus: form.stockStatus, shippingPrice, productUrl: form.productUrl.trim(), sku: form.sku.trim() || null } }
}

function OfferFields({ form, setForm }: { form: OfferForm; setForm: (form: OfferForm) => void }) {
  const set = (key: keyof OfferForm) => (event: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm({ ...form, [key]: event.target.value })
  const discount = Number(form.oldPrice) > Number(form.price) && Number(form.price) > 0 ? Math.round(((Number(form.oldPrice) - Number(form.price)) / Number(form.oldPrice)) * 100) : 0
  return (
    <div className="ui-grid">
      <FormField label="Qiymət (₼) *"><input inputMode="decimal" value={form.price} onChange={set('price')} placeholder="0.00" /></FormField>
      <FormField label="Köhnə qiymət (₼)" hint={discount > 0 ? `Endirim: -${discount}%` : 'Endirim yoxdursa boş saxlayın'}><input inputMode="decimal" value={form.oldPrice} onChange={set('oldPrice')} placeholder="məs. 2499" /></FormField>
      <FormField label="Stok vəziyyəti"><select value={form.stockStatus} onChange={set('stockStatus')}><option value="in_stock">Stokda</option><option value="preorder">Ön sifariş</option><option value="out_of_stock">Stokda yoxdur</option></select></FormField>
      <FormField label="Çatdırılma (₼)"><input inputMode="decimal" value={form.shippingPrice} onChange={set('shippingPrice')} placeholder="0" /></FormField>
      <FormField label="Məhsul keçidi *"><input value={form.productUrl} onChange={set('productUrl')} placeholder="https://magazaniz.az/mehsul" /></FormField>
      <FormField label="SKU"><input value={form.sku} onChange={set('sku')} placeholder="məs. IP17-256" /></FormField>
    </div>
  )
}

function CreateProductModal({ existingProductIds, onClose, onSaved }: { existingProductIds: Set<string>; onClose: () => void; onSaved: () => void }) {
  const [mode, setMode] = useState<'new' | 'existing'>('new')
  const taxonomy = useAsync(async () => {
    const [categories, brands, catalog] = await Promise.all([
      api<{ items: Taxonomy[] }>('/categories'),
      api<{ items: Taxonomy[] }>('/brands'),
      api<Paginated<{ id: string; name: string; bestPrice: number | null }>>('/products?limit=100&sort=name'),
    ])
    const flat = categories.items.flatMap((category) => [category, ...(category.children ?? []).map((child) => ({ ...child, name: `${category.name} › ${child.name}` }))])
    return { categories: flat, brands: brands.items, catalog: catalog.items }
  }, [])
  const [details, setDetails] = useState({ name: '', description: '', categoryId: '', brandId: '', existingProductId: '' })
  const [offer, setOffer] = useState<OfferForm>({ price: '', oldPrice: '', stockStatus: 'in_stock', shippingPrice: '', productUrl: '', sku: '' })
  const [files, setFiles] = useState<File[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setError('')
    const parsed = parseOffer(offer)
    if ('error' in parsed) return setError(parsed.error)
    if (mode === 'new' && details.name.trim().length < 2) return setError('Məhsul adı ən azı 2 simvol olmalıdır.')
    if (mode === 'existing' && !details.existingProductId) return setError('Kataloqdan məhsul seçin.')
    setBusy(true)
    try {
      let productId = details.existingProductId
      if (mode === 'new') {
        const created = await api<{ product: { id: string } }>('/products', {
          method: 'POST',
          body: { name: details.name.trim(), description: details.description.trim() || null, categoryId: details.categoryId || null, brandId: details.brandId || null, offer: parsed.body },
        })
        productId = created.product.id
      } else {
        await api(`/products/${productId}/offers`, { method: 'POST', body: parsed.body })
      }
      for (const file of files) {
        const form = new FormData()
        form.append('file', file)
        await api(`/products/${productId}/images`, { method: 'POST', form })
      }
      onSaved()
    } catch (caught) {
      setError(friendly(caught))
      setBusy(false)
    }
  }

  const available = taxonomy.data?.catalog.filter((product) => !existingProductIds.has(product.id)) ?? []

  return (
    <Modal kicker="YENİ TƏKLİF" title="Məhsul əlavə et" description="Yeni məhsul yaradın və ya kataloqda olan məhsula öz qiymətinizi əlavə edin." onClose={onClose}>
      <form className="ui-form" onSubmit={submit}>
        <div className="segmented" role="tablist">
          <button type="button" role="tab" aria-selected={mode === 'new'} className={mode === 'new' ? 'active' : ''} onClick={() => setMode('new')}>Yeni məhsul</button>
          <button type="button" role="tab" aria-selected={mode === 'existing'} className={mode === 'existing' ? 'active' : ''} onClick={() => setMode('existing')}>Kataloqdakı məhsul</button>
        </div>
        {error && <Notice>{error}</Notice>}
        {taxonomy.loading ? <Spinner /> : mode === 'new' ? (
          <div className="ui-grid">
            <FormField label="Məhsul adı *"><input autoFocus value={details.name} maxLength={250} onChange={(event) => setDetails({ ...details, name: event.target.value })} placeholder="məs. iPhone 17 256GB" /></FormField>
            <FormField label="Kateqoriya"><select value={details.categoryId} onChange={(event) => setDetails({ ...details, categoryId: event.target.value })}><option value="">Seçin…</option>{taxonomy.data?.categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></FormField>
            <FormField label="Marka"><select value={details.brandId} onChange={(event) => setDetails({ ...details, brandId: event.target.value })}><option value="">Seçin…</option>{taxonomy.data?.brands.map((brand) => <option key={brand.id} value={brand.id}>{brand.name}</option>)}</select></FormField>
            <FormField label="Qısa təsvir"><input value={details.description} maxLength={500} onChange={(event) => setDetails({ ...details, description: event.target.value })} placeholder="İsteğe bağlı" /></FormField>
          </div>
        ) : (
          <FormField label="Kataloqdakı məhsul *" hint={available.length === 0 ? 'Bütün kataloq məhsullarına artıq təklifiniz var.' : undefined}>
            <select value={details.existingProductId} onChange={(event) => setDetails({ ...details, existingProductId: event.target.value })}>
              <option value="">Seçin…</option>
              {available.map((product) => <option key={product.id} value={product.id}>{product.name}{product.bestPrice !== null ? ` — bazar: ${formatPrice(product.bestPrice)}` : ''}</option>)}
            </select>
          </FormField>
        )}
        <OfferFields form={offer} setForm={setOffer} />
        <FilePicker files={files} setFiles={setFiles} onError={setError} />
        <div className="modal-actions"><button type="button" className="workspace-secondary" onClick={onClose}>Ləğv et</button><BusyButton busy={busy}><Save size={15} /> Yayımla</BusyButton></div>
      </form>
    </Modal>
  )
}

function FilePicker({ files, setFiles, onError, multiple = true }: { files: File[]; setFiles: (files: File[]) => void; onError: (message: string) => void; multiple?: boolean }) {
  const previews = useMemo(() => files.map((file) => ({ file, url: URL.createObjectURL(file) })), [files])
  const pick = (event: ChangeEvent<HTMLInputElement>) => {
    const chosen = Array.from(event.target.files ?? [])
    const tooBig = chosen.find((file) => file.size > MAX_UPLOAD_MB * 1024 * 1024)
    const wrongType = chosen.find((file) => !['image/jpeg', 'image/png', 'image/webp', 'image/avif'].includes(file.type))
    if (tooBig) return onError(`${tooBig.name} ${MAX_UPLOAD_MB}MB-dan böyükdür.`)
    if (wrongType) return onError(`${wrongType.name}: yalnız JPG, PNG, WEBP və AVIF qəbul olunur.`)
    setFiles(multiple ? [...files, ...chosen].slice(0, 6) : chosen.slice(0, 1))
    event.target.value = ''
  }
  return (
    <>
      <label className="dropzone compact-dropzone">
        <input type="file" accept="image/png,image/jpeg,image/webp,image/avif" multiple={multiple} onChange={pick} />
        <CloudUpload size={24} />
        <strong>Şəkil seçin</strong>
        <span>JPG, PNG, WEBP · {MAX_UPLOAD_MB}MB-a qədər{multiple ? ' · 6 şəkilə qədər' : ''}</span>
      </label>
      {previews.length > 0 && (
        <div className="upload-previews">
          {previews.map(({ file, url }) => (
            <button type="button" key={url} className="upload-preview" onClick={() => setFiles(files.filter((candidate) => candidate !== file))} aria-label={`${file.name} sil`}>
              <img src={url} alt="" /><Trash2 size={13} />
            </button>
          ))}
        </div>
      )}
    </>
  )
}

function EditOfferModal({ offer, onClose, onSaved }: { offer: MerchantOffer; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState<OfferForm>({ price: String(offer.price), oldPrice: offer.oldPrice ? String(offer.oldPrice) : '', stockStatus: offer.stockStatus, shippingPrice: String(offer.shippingPrice), productUrl: offer.productUrl, sku: offer.sku ?? '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    const parsed = parseOffer(form)
    if ('error' in parsed) return setError(parsed.error)
    setBusy(true)
    try {
      await api(`/offers/${offer.id}`, { method: 'PATCH', body: parsed.body })
      onSaved()
    } catch (caught) {
      setError(friendly(caught))
      setBusy(false)
    }
  }
  return (
    <Modal kicker="TƏKLİFİ REDAKTƏ ET" title={offer.productName} description="Qiymət dəyişikliyi qiymət tarixçəsinə yazılır və izləyən alıcılara bildiriş göndərə bilər." onClose={onClose}>
      <form className="ui-form" onSubmit={submit}>
        {error && <Notice>{error}</Notice>}
        <OfferFields form={form} setForm={setForm} />
        <div className="modal-actions"><button type="button" className="workspace-secondary" onClick={onClose}>Ləğv et</button><BusyButton busy={busy}><Save size={15} /> Yadda saxla</BusyButton></div>
      </form>
    </Modal>
  )
}

function ImageUploadModal({ productId, productName, onClose }: { productId: string; productName: string; onClose: () => void }) {
  const [files, setFiles] = useState<File[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(0)
  const upload = async () => {
    setBusy(true)
    setError('')
    try {
      for (const file of files) {
        const form = new FormData()
        form.append('file', file)
        await api(`/products/${productId}/images`, { method: 'POST', form })
        setDone((count) => count + 1)
      }
      onClose()
    } catch (caught) {
      setError(friendly(caught))
      setBusy(false)
    }
  }
  return (
    <Modal kicker="ŞƏKİLLƏR" title={productName} description="İlk yüklənən şəkil məhsulun əsas şəkli olur." onClose={onClose}>
      {error && <Notice>{error}</Notice>}
      <FilePicker files={files} setFiles={setFiles} onError={setError} />
      <div className="modal-actions"><button type="button" className="workspace-secondary" onClick={onClose}>Bağla</button><BusyButton busy={busy} type="button" disabled={files.length === 0} onClick={() => void upload()}><CloudUpload size={15} /> {busy ? `${done}/${files.length} yüklənir` : 'Yüklə'}</BusyButton></div>
    </Modal>
  )
}

/* -------------------------------- campaigns ------------------------------- */

const toInputDate = (iso: string) => iso.slice(0, 10)

function Campaigns({ session }: { session: AuthenticatedSession }) {
  const campaigns = useAsync(() => api<Paginated<Campaign>>('/merchant/campaigns?limit=100'), [])
  const [editing, setEditing] = useState<Campaign | 'new' | null>(null)
  const [error, setError] = useState('')
  const now = Date.now()

  const act = async (action: () => Promise<unknown>) => {
    setError('')
    try {
      await action()
      await campaigns.reload()
    } catch (caught) {
      setError(friendly(caught))
    }
  }

  const stateOf = (campaign: Campaign) => {
    if (!campaign.isActive) return ['Dayandırılıb', 'paused']
    if (new Date(campaign.startDate).getTime() > now) return ['Planlaşdırılıb', 'scheduled']
    if (new Date(campaign.endDate).getTime() < now) return ['Bitib', 'ended']
    return ['Aktiv', 'live']
  }

  return (
    <>
      <div className="page-title-row">
        <div><span className="workspace-eyebrow">MARKETİNQ</span><h2>Kampaniyalar</h2><p>Aktiv kampaniyalar ana səhifədə və mağaza profilinizdə göstərilir.</p></div>
        <button type="button" className="workspace-primary" onClick={() => setEditing('new')}><Plus size={16} /> Yeni kampaniya</button>
      </div>
      {(error || campaigns.error) && <Notice onClose={() => setError('')}>{error || campaigns.error}</Notice>}
      {campaigns.loading ? <Spinner /> : (campaigns.data?.items.length ?? 0) === 0 ? (
        <div className="workspace-empty"><span><Sparkles size={24} /></span><h3>Hələ kampaniyanız yoxdur</h3><p>Endirim həftəsi, bayram təklifi və s. üçün kampaniya yaradın.</p><button type="button" className="workspace-primary" onClick={() => setEditing('new')}><Plus size={15} /> Kampaniya yarat</button></div>
      ) : (
        <div className="campaign-grid">
          {campaigns.data?.items.map((campaign) => {
            const [label, tone] = stateOf(campaign)
            return (
              <article className="workspace-panel campaign-card" key={campaign.id}>
                <div className="campaign-top"><span className={`status-pill status-${tone}`}>{label}</span><div className="row-actions">
                  <button type="button" onClick={() => setEditing(campaign)} aria-label="Redaktə et"><Pencil size={15} /></button>
                  <button type="button" onClick={() => void act(() => api(`/campaigns/${campaign.id}`, { method: 'PATCH', body: { isActive: !campaign.isActive } }))} aria-label={campaign.isActive ? 'Dayandır' : 'Aktivləşdir'}>{campaign.isActive ? <Pause size={15} /> : <Play size={15} />}</button>
                  <button type="button" className="icon-danger" onClick={() => void act(() => api(`/campaigns/${campaign.id}`, { method: 'DELETE' }))} aria-label="Sil"><Trash2 size={15} /></button>
                </div></div>
                <h3>{campaign.title}</h3>
                {campaign.description && <p>{campaign.description}</p>}
                <small>{formatDay(campaign.startDate)} — {formatDay(campaign.endDate)}</small>
              </article>
            )
          })}
        </div>
      )}
      {editing && <CampaignModal campaign={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); void campaigns.reload() }} />}
    </>
  )
}

function CampaignModal({ campaign, onClose, onSaved }: { campaign?: Campaign; onClose: () => void; onSaved: () => void }) {
  const today = new Date().toISOString().slice(0, 10)
  const inTwoWeeks = new Date(Date.now() + 14 * 86_400_000).toISOString().slice(0, 10)
  const [form, setForm] = useState({ title: campaign?.title ?? '', description: campaign?.description ?? '', startDate: campaign ? toInputDate(campaign.startDate) : today, endDate: campaign ? toInputDate(campaign.endDate) : inTwoWeeks, url: campaign?.url ?? '', isActive: campaign?.isActive ?? true })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (form.title.trim().length < 2) return setError('Başlıq ən azı 2 simvol olmalıdır.')
    if (form.endDate <= form.startDate) return setError('Bitmə tarixi başlama tarixindən sonra olmalıdır.')
    if (form.url && !/^https?:\/\//i.test(form.url)) return setError('Keçid http:// və ya https:// ilə başlamalıdır.')
    setBusy(true)
    try {
      const body = { title: form.title.trim(), description: form.description.trim() || null, startDate: new Date(`${form.startDate}T00:00:00`).toISOString(), endDate: new Date(`${form.endDate}T23:59:59`).toISOString(), url: form.url.trim() || null, isActive: form.isActive }
      await api(campaign ? `/campaigns/${campaign.id}` : '/merchant/campaigns', { method: campaign ? 'PATCH' : 'POST', body })
      onSaved()
    } catch (caught) {
      setError(friendly(caught))
      setBusy(false)
    }
  }

  return (
    <Modal kicker="KAMPANİYA" title={campaign ? 'Kampaniyanı redaktə et' : 'Yeni kampaniya'} onClose={onClose}>
      <form className="ui-form" onSubmit={submit}>
        {error && <Notice>{error}</Notice>}
        <FormField label="Başlıq *"><input autoFocus value={form.title} maxLength={200} onChange={(event) => setForm({ ...form, title: event.target.value })} placeholder="məs. Payız endirim həftəsi" /></FormField>
        <FormField label="Təsvir"><textarea rows={3} value={form.description} maxLength={3000} onChange={(event) => setForm({ ...form, description: event.target.value })} /></FormField>
        <div className="ui-grid">
          <FormField label="Başlama tarixi"><input type="date" value={form.startDate} onChange={(event) => setForm({ ...form, startDate: event.target.value })} /></FormField>
          <FormField label="Bitmə tarixi"><input type="date" value={form.endDate} onChange={(event) => setForm({ ...form, endDate: event.target.value })} /></FormField>
        </div>
        <FormField label="Kampaniya keçidi"><input value={form.url} onChange={(event) => setForm({ ...form, url: event.target.value })} placeholder="https://magazaniz.az/kampaniya" /></FormField>
        <label className="ui-check"><input type="checkbox" checked={form.isActive} onChange={(event) => setForm({ ...form, isActive: event.target.checked })} /> Tarix gələndə avtomatik göstər</label>
        <div className="modal-actions"><button type="button" className="workspace-secondary" onClick={onClose}>Ləğv et</button><BusyButton busy={busy}><Save size={15} /> Yadda saxla</BusyButton></div>
      </form>
    </Modal>
  )
}

/* -------------------------------- analytics ------------------------------- */

function AnalyticsPage() {
  const [days, setDays] = useState(30)
  const analytics = useAsync(() => api<Analytics>(`/merchant/analytics?days=${days}`), [days])
  const d = analytics.data
  return (
    <>
      <div className="page-title-row">
        <div><span className="workspace-eyebrow">ANALİTİKA</span><h2>Performans</h2><p>Baxış, klik, seçilmiş və xəbərdarlıq hadisələri. Eyni ziyarətçinin təkrar baxışları sayılmır.</p></div>
        <div className="period-tabs">{[7, 30, 90].map((value) => <button type="button" key={value} className={days === value ? 'active' : ''} onClick={() => setDays(value)}>{value} gün</button>)}</div>
      </div>
      {analytics.error && <Notice>{analytics.error}</Notice>}
      {analytics.loading || !d ? <Spinner /> : (
        <>
          <div className="metric-grid">
            <MetricCard label="Baxışlar" value={d.totals.view ?? 0} hint={`son ${days} gün`} icon={Eye} tone="orange" />
            <MetricCard label="Kliklər" value={d.totals.offer_click ?? 0} hint={d.totals.view ? `${(((d.totals.offer_click ?? 0) / d.totals.view) * 100).toFixed(1)}% klik nisbəti` : 'klik nisbəti —'} icon={MousePointerClick} tone="blue" />
            <MetricCard label="Seçilmişlər" value={d.totals.favorite ?? 0} hint={`son ${days} gün`} icon={Heart} tone="pink" />
            <MetricCard label="Xəbərdarlıqlar" value={d.totals.alert ?? 0} hint={`son ${days} gün`} icon={Bell} tone="green" />
          </div>
          <section className="workspace-panel performance-panel">
            <div className="panel-heading"><div><span className="workspace-eyebrow">GÜNDƏLİK</span><h2>Baxışlar</h2></div></div>
            <SeriesChart series={d.series} field="view" />
          </section>
          <section className="workspace-panel performance-table">
            <div className="panel-heading"><div><span className="workspace-eyebrow">MƏHSULLAR</span><h2>Ən çox baxılanlar</h2></div></div>
            {d.topProducts.length === 0 ? <p className="muted">Hələ məlumat yoxdur.</p> : (
              <div className="store-product-table">
                <div className="table-head"><span>Məhsul</span><span>Baxış</span><span>Klik</span><span>Seçilmiş</span><span>Xəbərdarlıq</span></div>
                {d.topProducts.map((product, index) => (
                  <div className="table-row" key={product.productId ?? index}>
                    <div className="table-product"><span className={`product-rank rank-${Math.min(index + 1, 3)}`}>{index + 1}</span><strong>{product.productName ?? 'Silinmiş məhsul'}</strong></div>
                    <span>{product.views}</span><span>{product.clicks}</span><span>{product.favorites}</span><span>{product.alerts}</span>
                  </div>
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </>
  )
}

/* ---------------------------------- media --------------------------------- */

function Media({ session }: { session: AuthenticatedSession }) {
  const media = useAsync(() => api<Paginated<MediaAsset>>('/merchant/media?limit=100'), [])
  const [files, setFiles] = useState<File[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState('')

  const upload = async () => {
    setBusy(true)
    setError('')
    try {
      for (const file of files) {
        const form = new FormData()
        form.append('file', file)
        await api('/merchant/media', { method: 'POST', form })
      }
      setFiles([])
      await media.reload()
    } catch (caught) {
      setError(friendly(caught))
    } finally {
      setBusy(false)
    }
  }

  const remove = async (id: string) => {
    try {
      await api(`/merchant/media/${id}`, { method: 'DELETE' })
      await media.reload()
    } catch (caught) {
      setError(friendly(caught))
    }
  }

  const copy = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(url)
      window.setTimeout(() => setCopied(''), 2000)
    } catch {
      setError('Keçid kopyalana bilmədi.')
    }
  }

  return (
    <>
      <div className="page-title-row"><div><span className="workspace-eyebrow">MEDİA</span><h2>Media kitabxanası</h2><p>Loqo, üz qabığı və kampaniya şəkilləriniz. Keçidi kopyalayıb profilinizdə istifadə edə bilərsiniz.</p></div></div>
      {(error || media.error) && <Notice onClose={() => setError('')}>{error || media.error}</Notice>}
      <section className="workspace-panel">
        <FilePicker files={files} setFiles={setFiles} onError={setError} />
        {files.length > 0 && <div className="modal-actions"><BusyButton busy={busy} type="button" onClick={() => void upload()}><CloudUpload size={15} /> {files.length} şəkli yüklə</BusyButton></div>}
      </section>
      {media.loading ? <Spinner /> : (media.data?.items.length ?? 0) === 0 ? (
        <div className="workspace-empty"><span><FileImage size={24} /></span><h3>Media kitabxanası boşdur</h3><p>Yuxarıdan ilk şəklinizi yükləyin.</p></div>
      ) : (
        <div className="media-grid">
          {media.data?.items.map((asset) => (
            <figure className="media-card" key={asset.id}>
              <img src={asset.url} alt={asset.originalName ?? ''} loading="lazy" />
              <figcaption>
                <span title={asset.originalName ?? ''}>{asset.originalName ?? 'şəkil'}</span>
                <small>{asset.sizeBytes ? `${Math.round(asset.sizeBytes / 1024)} KB` : ''}</small>
              </figcaption>
              <div className="row-actions">
                <button type="button" onClick={() => void copy(asset.url)}>{copied === asset.url ? 'Kopyalandı' : 'Keçidi kopyala'}</button>
                <button type="button" className="icon-danger" onClick={() => void remove(asset.id)} aria-label="Sil"><Trash2 size={15} /></button>
              </div>
            </figure>
          ))}
        </div>
      )}
    </>
  )
}

/* --------------------------------- profile -------------------------------- */

function Profile({ session }: { session: AuthenticatedSession }) {
  const merchant = session.merchant!
  const initial = { name: merchant.name, website: merchant.website ?? '', phone: merchant.phone ?? '', description: merchant.description ?? '', logoUrl: merchant.logoUrl ?? '' }
  const [form, setForm] = useState(initial)
  const [editing, setEditing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<{ tone: 'success' | 'error'; text: string } | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (form.name.trim().length < 2) return setNotice({ tone: 'error', text: 'Mağaza adı ən azı 2 simvol olmalıdır.' })
    if (form.logoUrl && !/^https?:\/\//i.test(form.logoUrl)) return setNotice({ tone: 'error', text: 'Loqo keçidi http:// və ya https:// ilə başlamalıdır.' })
    setBusy(true)
    try {
      await api('/merchant', { method: 'PATCH', body: { name: form.name.trim(), website: form.website.trim() || null, phone: form.phone.trim() || null, description: form.description.trim() || null, logoUrl: form.logoUrl.trim() || null } })
      await loadMe()
      setEditing(false)
      setNotice({ tone: 'success', text: 'Mağaza profili yadda saxlanıldı.' })
    } catch (caught) {
      setNotice({ tone: 'error', text: friendly(caught) })
    } finally {
      setBusy(false)
    }
  }

  const uploadLogo = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    setBusy(true)
    try {
      const form = new FormData()
      form.append('file', file)
      const asset = await api<MediaAsset>('/merchant/media', { method: 'POST', form })
      await api('/merchant', { method: 'PATCH', body: { logoUrl: asset.url } })
      await loadMe()
      setForm((current) => ({ ...current, logoUrl: asset.url }))
      setNotice({ tone: 'success', text: 'Loqo yeniləndi.' })
    } catch (caught) {
      setNotice({ tone: 'error', text: friendly(caught) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="store-profile-page">
      <div className="store-profile-cover">
        <div className="store-cover-content">
          <span className="store-avatar profile-store-avatar">{merchant.logoUrl ? <img src={merchant.logoUrl} alt="" /> : <Store size={26} />}</span>
          <div><span className="workspace-eyebrow">MAĞAZA PROFİLİ</span><h2>{merchant.name}</h2><p>{merchant.isVerified ? <><ShieldCheck size={14} /> Təsdiqlənmiş mağaza</> : 'Mağaza təsdiqi gözlənilir'}{merchant.rating > 0 ? ` · ${merchant.rating.toFixed(1)} reytinq` : ''}</p></div>
        </div>
        <input ref={fileInput} type="file" hidden accept="image/png,image/jpeg,image/webp" onChange={(event) => void uploadLogo(event)} />
        <button type="button" className="cover-edit" onClick={() => fileInput.current?.click()} disabled={busy}><ImagePlus size={15} /> Loqonu dəyiş</button>
      </div>
      <div className="store-profile-layout">
        <form className="workspace-panel store-profile-form" onSubmit={submit}>
          <div className="panel-heading"><div><span className="workspace-eyebrow">ÜMUMİ MƏLUMATLAR</span><h2>Mağaza məlumatları</h2></div>{!editing && <button type="button" className="profile-edit" onClick={() => { setEditing(true); setNotice(null) }}><Pencil size={14} /> Düzəliş et</button>}</div>
          {notice && <Notice tone={notice.tone} onClose={() => setNotice(null)}>{notice.text}</Notice>}
          <div className="profile-fields">
            <label className="wide"><span>Mağaza adı</span><input disabled={!editing} value={form.name} maxLength={160} onChange={(event) => setForm({ ...form, name: event.target.value })} /></label>
            <label><span>Vebsayt</span><div className="profile-input-icon"><Globe2 size={15} /><input disabled={!editing} value={form.website} maxLength={300} onChange={(event) => setForm({ ...form, website: event.target.value })} placeholder="https://" /></div></label>
            <label><span>Telefon</span><div className="profile-input-icon"><Phone size={15} /><input disabled={!editing} value={form.phone} maxLength={40} onChange={(event) => setForm({ ...form, phone: event.target.value })} /></div></label>
            <label className="wide"><span>Hesab emaili</span><input disabled value={session.user.email} /></label>
            <label className="wide"><span>Mağaza təsviri</span><textarea disabled={!editing} value={form.description} maxLength={3000} onChange={(event) => setForm({ ...form, description: event.target.value })} rows={4} /></label>
          </div>
          {editing && <div className="profile-form-actions"><button type="button" className="workspace-secondary" onClick={() => { setEditing(false); setForm(initial) }}>Ləğv et</button><BusyButton busy={busy}><Save size={15} /> Dəyişiklikləri saxla</BusyButton></div>}
        </form>
        <aside className="profile-side-stack">
          <section className="workspace-panel store-profile-stats">
            <div className="panel-heading"><div><span className="workspace-eyebrow">İCTİMAİ PROFİL</span><h2>Mağaza xülasəsi</h2></div><Eye size={19} /></div>
            <div><strong>{merchant.rating > 0 ? merchant.rating.toFixed(1) : '—'}</strong><span>reytinq</span></div>
            <div><strong>{new Date(merchant.createdAt).getFullYear()}</strong><span>qoşulma ili</span></div>
          </section>
        </aside>
      </div>
    </div>
  )
}

function SettingsPage({ session }: { session: AuthenticatedSession }) {
  return (
    <>
      <div className="page-title-row"><div><span className="workspace-eyebrow">AYARLAR</span><h2>Hesab ayarları</h2><p>Email təsdiqi, şifrə və sessiya.</p></div></div>
      <div className="settings-grid"><PasswordPanel session={session} /></div>
    </>
  )
}

/* -------------------------------- workspace ------------------------------- */

const titles: Record<string, [string, string]> = {
  overview: ['İcmal', 'Mağazanızın performansını izləyin.'],
  products: ['Məhsullar', 'Təkliflərinizi idarə edin.'],
  discounts: ['Endirimlərim', 'Endirimli təklifləriniz.'],
  campaigns: ['Kampaniyalar', 'Marketinq kampaniyalarınız.'],
  analytics: ['Analitika', 'Baxış və klik statistikası.'],
  media: ['Media kitabxanası', 'Şəkillərinizi idarə edin.'],
  profile: ['Mağaza profili', 'Alıcıların gördüyü məlumatlar.'],
  settings: ['Ayarlar', 'Hesab təhlükəsizliyi.'],
}

export default function StoreWorkspace({ session }: { session: AuthenticatedSession }) {
  const items: NavItem[] = [
    { id: 'overview', path: '/store', label: 'İcmal', icon: LayoutDashboard, section: 'MAĞAZA İŞLƏRİ', mobile: true },
    { id: 'products', path: '/store/products', label: 'Məhsullar', icon: Boxes, section: 'MAĞAZA İŞLƏRİ', mobile: true },
    { id: 'discounts', path: '/store/discounts', label: 'Endirimlərim', icon: TrendingDown, section: 'MAĞAZA İŞLƏRİ' },
    { id: 'campaigns', path: '/store/campaigns', label: 'Kampaniyalar', icon: Sparkles, section: 'MAĞAZA İŞLƏRİ' },
    { id: 'analytics', path: '/store/analytics', label: 'Analitika', icon: BarChart3, section: 'MAĞAZA İŞLƏRİ', mobile: true },
    { id: 'media', path: '/store/media', label: 'Media kitabxanası', icon: FileImage, section: 'MAĞAZA İŞLƏRİ' },
    { id: 'profile', path: '/store/profile', label: 'Mağaza profili', icon: Store, section: 'MAĞAZA HESABI' },
    { id: 'settings', path: '/store/settings', label: 'Ayarlar', icon: Settings, section: 'MAĞAZA HESABI', mobile: true },
  ]
  // Old links: /store/offers now lives under products.
  const [active, go] = useWorkspaceRoute([...items, { id: 'products', path: '/store/offers', label: '', icon: Tag }], 'overview')
  const [title, subtitle] = titles[active] ?? titles.overview!

  if (!session.merchant) {
    return <div className="page-loading"><Notice>Bu hesaba bağlı mağaza tapılmadı. Dəstək ilə əlaqə saxlayın.</Notice></div>
  }

  return (
    <WorkspaceShell mode="store" session={session} items={items} active={active} onNavigate={go} title={title} subtitle={subtitle}
      headerActions={active === 'campaigns' ? undefined : <button type="button" className="workspace-primary" onClick={() => go('campaigns')}><Plus size={16} /> Yeni kampaniya</button>}>
      {active === 'products' ? <Products session={session} />
        : active === 'discounts' ? <Products session={session} discountsOnly />
        : active === 'campaigns' ? <Campaigns session={session} />
        : active === 'analytics' ? <AnalyticsPage />
        : active === 'media' ? <Media session={session} />
        : active === 'profile' ? <Profile session={session} />
        : active === 'settings' ? <SettingsPage session={session} />
        : <Overview session={session} go={go} />}
    </WorkspaceShell>
  )
}

