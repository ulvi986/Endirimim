import { FormEvent, lazy, Suspense, useEffect, useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { Bell, ChevronRight, CircleUserRound, ExternalLink, GitCompareArrows, Heart, LayoutDashboard, LogIn, Menu, Search, ShoppingBag, Sparkles, Star, Store, Tag, TrendingDown, X } from 'lucide-react'
import type { AuthPath } from './AuthFlow'
import { api, displayName, homePathFor, logout, type Paginated, type Product, type Session } from './api'
import { BusyButton, errorMessage, formatPrice, logoSrc, Modal, navigateTo, Notice, ProductPhoto, Spinner, useAsync, useSession } from './ui'
import './styles.css'
import './connected.css'

// Auth and the workspaces are separate chunks: anonymous visitors on the home
// page never download the dashboard code.
const AuthFlow = lazy(() => import('./AuthFlow'))
const DashboardExperience = lazy(() => import('./DashboardExperience'))

const pageLoading = (label?: string) => (
  <div className="page-loading"><img src={logoSrc} alt="" /><Spinner label={label} /></div>
)

type CategoryNode = { id: string; name: string; slug: string; productCount: number; children: CategoryNode[] }

const AUTH_PATHS: AuthPath[] = ['/login', '/signup', '/forgot-password', '/reset-password']
const USER_PATHS = ['/dashboard', '/favorites', '/lists', '/alerts', '/comparisons', '/profile', '/notifications']
const STORE_PATHS = ['/store', '/store/products', '/store/offers', '/store/campaigns', '/store/discounts', '/store/analytics', '/store/media', '/store/profile', '/store/settings']
const MAX_COMPARE = 4

const categoryIcons: Record<string, string> = { telefon: '◉', elektronika: '⌁', 'ev-ve-metbex': '⌂', kompyuter: '▣', moda: '◇', gozellik: '✦' }

const loginUrl = (next = window.location.pathname + window.location.search) => `/login?next=${encodeURIComponent(next)}`

function useDebounced<T>(value: T, delay = 300): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delay)
    return () => window.clearTimeout(timer)
  }, [value, delay])
  return debounced
}

function ProductCard({ product, saved, compared, onSave, onCompare, onOpen }: { product: Product; saved: boolean; compared: boolean; onSave: () => void; onCompare: () => void; onOpen: () => void }) {
  const best = product.offers.find((offer) => offer.isCheapest) ?? product.offers[0]
  return (
    <article className="product-card">
      <div className="product-image">
        <button type="button" className="product-image-link" onClick={onOpen} aria-label={`${product.name} təkliflərinə bax`}>
          <ProductPhoto product={product} />
        </button>
        {product.maxDiscountPercentage > 0 && <span className="discount-badge">-{Math.round(product.maxDiscountPercentage)}%</span>}
        <button type="button" className={`icon-button save-button ${saved ? 'saved' : ''}`} onClick={onSave} aria-pressed={saved} aria-label={saved ? 'Seçilmişlərdən çıxar' : 'Seçilmişlərə əlavə et'}>
          <Heart size={18} fill={saved ? 'currentColor' : 'none'} />
        </button>
      </div>
      <div className="product-content">
        <span className="product-brand">{product.brand?.name ?? product.category?.name ?? 'Endirimim'}</span>
        <h3><button type="button" onClick={onOpen} title={product.name}>{product.name}</button></h3>
        <div className="rating">
          <Star size={14} fill={product.reviewCount ? 'currentColor' : 'none'} />
          <strong>{product.reviewCount ? product.rating.toFixed(1) : 'Yeni'}</strong>
          <span>({product.reviewCount} rəy)</span>
        </div>
        <div className="price-row">
          <span className="old-price">{best?.oldPrice ? formatPrice(best.oldPrice) : ' '}</span>
          <span className="merchant-count">{product.offerCount} mağaza</span>
        </div>
        <div className="current-price">{formatPrice(product.bestPrice)}</div>
        <button type="button" className={`compare-button ${compared ? 'active' : ''}`} onClick={onCompare} aria-pressed={compared}>
          <GitCompareArrows size={15} /> {compared ? 'Müqayisədədir' : 'Müqayisə et'}
        </button>
      </div>
    </article>
  )
}

function ProductOffersModal({ product, onClose }: { product: Product; onClose: () => void }) {
  const [error, setError] = useState('')
  useEffect(() => {
    void api(`/products/${product.id}`).catch(() => undefined)
  }, [product.id])
  const openOffer = async (offerId: string) => {
    setError('')
    // Open synchronously so the popup is not blocked, then point it at the store.
    // (`noopener` would make window.open return null, so the opener is cut manually.)
    const tab = window.open('about:blank', '_blank')
    if (tab) tab.opener = null
    try {
      const { url } = await api<{ url: string }>(`/offers/${offerId}/click`, { method: 'POST', body: {} })
      if (tab) tab.location.href = url
      else window.location.href = url
    } catch (caught) {
      tab?.close()
      setError(errorMessage(caught))
    }
  }
  return (
    <Modal kicker={product.brand?.name.toLocaleUpperCase('az-AZ')} title={product.name} description={product.description ?? undefined} onClose={onClose}>
      <div className="offer-modal-photo"><ProductPhoto product={product} /></div>
      {error && <Notice>{error}</Notice>}
      <div className="offer-list">
        {product.offers.length === 0 && <p className="muted">Bu məhsul üçün hələ təklif yoxdur.</p>}
        {product.offers.map((offer) => (
          <div className={`offer-row ${offer.isCheapest ? 'best' : ''}`} key={offer.id}>
            <div>
              <strong>{offer.merchantName}</strong>
              <small>{offer.stockStatus === 'in_stock' ? 'Stokda var' : offer.stockStatus === 'preorder' ? 'Ön sifariş' : 'Stokda yoxdur'}{offer.shippingPrice > 0 ? ` · Çatdırılma ${formatPrice(offer.shippingPrice)}` : ' · Pulsuz çatdırılma'}</small>
            </div>
            <div className="offer-price">
              {offer.isCheapest && <em>Ən sərfəli</em>}
              <b>{formatPrice(offer.price)}</b>
              {offer.oldPrice && <del>{formatPrice(offer.oldPrice)}</del>}
            </div>
            <button type="button" className="workspace-primary" disabled={offer.stockStatus === 'out_of_stock'} onClick={() => openOffer(offer.id)}>
              Mağazaya keç <ExternalLink size={13} />
            </button>
          </div>
        ))}
      </div>
    </Modal>
  )
}

function AlertModal({ products, initialProductId, onClose }: { products: Product[]; initialProductId?: string; onClose: () => void }) {
  const [productId, setProductId] = useState(initialProductId ?? products[0]?.id ?? '')
  const selected = products.find((product) => product.id === productId)
  const [target, setTarget] = useState(() => (selected?.bestPrice ? String(Math.floor(selected.bestPrice * 0.9)) : ''))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    const targetPrice = Number(target.replace(',', '.'))
    if (!productId) return setError('Məhsul seçin.')
    if (!Number.isFinite(targetPrice) || targetPrice <= 0) return setError('Düzgün hədəf qiymət daxil edin.')
    setBusy(true)
    setError('')
    try {
      await api('/alerts', { method: 'POST', body: { productId, targetPrice } })
      setDone(true)
    } catch (caught) {
      setError(errorMessage(caught))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <form className="alert-modal" onSubmit={submit} onMouseDown={(event) => event.stopPropagation()} noValidate>
        <button type="button" className="modal-close" onClick={onClose} aria-label="Bağla"><X size={18} /></button>
        <span className="modal-icon"><Bell size={22} /></span>
        <h2>Qiymət xəbərdarlığı</h2>
        {done ? (
          <>
            <Notice tone="success">Xəbərdarlıq aktivdir. Qiymət hədəfə çatanda bildiriş alacaqsınız.</Notice>
            <button type="button" className="orange-button full" onClick={() => navigateTo('/alerts')}>Xəbərdarlıqlarıma bax</button>
          </>
        ) : (
          <>
            <p>Məhsulu seç və hədəf qiyməti yaz. Qiymət bu həddə çatanda sənə xəbər verəcəyik.</p>
            {error && <Notice>{error}</Notice>}
            <label>Məhsul
              <select value={productId} onChange={(event) => {
                setProductId(event.target.value)
                const next = products.find((product) => product.id === event.target.value)
                if (next?.bestPrice) setTarget(String(Math.floor(next.bestPrice * 0.9)))
              }}>
                {products.map((product) => <option value={product.id} key={product.id}>{product.name} — {formatPrice(product.bestPrice)}</option>)}
              </select>
            </label>
            <label>Hədəf qiymət (₼)<input inputMode="decimal" value={target} onChange={(event) => setTarget(event.target.value)} /></label>
            <BusyButton busy={busy} className="orange-button full">Xəbərdarlığı aktiv et</BusyButton>
          </>
        )}
      </form>
    </div>
  )
}

function AccountLink({ session }: { session: Session }) {
  if (session.status === 'authenticated') {
    return (
      <a className="nav-action account-action" href={homePathFor(session.user.role)}>
        <CircleUserRound size={20} />
        <span>{session.user.role === 'store' ? session.merchant?.name ?? 'Mağazam' : displayName(session.user).split(' ')[0]}</span>
      </a>
    )
  }
  return (
    <a className="nav-action account-action" href={session.status === 'loading' ? '#' : '/login'}>
      <CircleUserRound size={20} />
      <span>{session.status === 'loading' ? '…' : 'Daxil ol'}</span>
    </a>
  )
}

function MobileMenu({ session, categories, onPick, onClose }: { session: Session; categories: CategoryNode[]; onPick: (slug: string) => void; onClose: () => void }) {
  return (
    <div className="mobile-drawer-backdrop" onMouseDown={onClose}>
      <nav className="mobile-drawer" aria-label="Menyu" onMouseDown={(event) => event.stopPropagation()}>
        <div className="mobile-drawer-head">
          <span className="logo"><img className="brand-logo-image" src={logoSrc} alt="" /><span>Endirimim<span className="logo-dot">.</span></span></span>
          <button type="button" onClick={onClose} aria-label="Menyunu bağla"><X size={20} /></button>
        </div>
        {session.status === 'authenticated' ? (
          <div className="mobile-drawer-account">
            <strong>{displayName(session.user)}</strong>
            <small>{session.user.email}</small>
            <a className="workspace-primary" href={homePathFor(session.user.role)}><LayoutDashboard size={15} /> {session.user.role === 'store' ? 'Mağaza paneli' : 'Hesabım'}</a>
            <button type="button" className="workspace-secondary" onClick={() => void logout().then(onClose)}>Çıxış</button>
          </div>
        ) : (
          <div className="mobile-drawer-account">
            <strong>Hesabına daxil ol</strong>
            <small>Seçilmişlər, xəbərdarlıqlar və siyahılar üçün.</small>
            <a className="workspace-primary" href="/login"><LogIn size={15} /> Daxil ol</a>
            <a className="workspace-secondary" href="/signup">Qeydiyyat</a>
          </div>
        )}
        <span className="nav-label">KATEQORİYALAR</span>
        <button type="button" onClick={() => onPick('')}>Hamısı</button>
        {categories.map((category) => <button type="button" key={category.id} onClick={() => onPick(category.slug)}>{category.name}<small>{category.productCount}</small></button>)}
      </nav>
    </div>
  )
}

function Home() {
  const session = useSession()
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('')
  const [showAlert, setShowAlert] = useState<{ productId?: string } | null>(null)
  const [openProduct, setOpenProduct] = useState<Product | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set())
  const [compared, setCompared] = useState<string[]>([])
  const [actionError, setActionError] = useState('')
  const [comparing, setComparing] = useState(false)
  const search = useDebounced(query.trim())

  const categories = useAsync(async () => (await api<{ items: CategoryNode[] }>('/categories')).items, [])
  const products = useAsync(async () => {
    const params = new URLSearchParams({ limit: '12', sort: search ? 'best_price' : 'biggest_discount' })
    if (search) params.set('q', search)
    if (category) params.set('category', category)
    return api<Paginated<Product>>(`/products?${params}`)
  }, [search, category])
  const featured = useAsync(async () => (await api<Paginated<Product>>('/products?limit=24&sort=biggest_discount')).items, [])

  useEffect(() => {
    if (session.status !== 'authenticated') {
      setSavedIds(new Set())
      return
    }
    api<Paginated<Product>>('/favorites?limit=100')
      .then((page) => setSavedIds(new Set(page.items.map((item) => item.id))))
      .catch(() => undefined)
  }, [session.status])

  const heroProduct = useMemo(() => (featured.data ?? []).find((product) => product.bestPrice !== null), [featured.data])
  const rootCategories = categories.data ?? []
  const allProducts = featured.data ?? []

  const requireLogin = () => {
    if (session.status === 'authenticated') return true
    navigateTo(loginUrl('/'))
    return false
  }

  const toggleSaved = async (productId: string) => {
    if (!requireLogin()) return
    const wasSaved = savedIds.has(productId)
    const next = new Set(savedIds)
    if (wasSaved) next.delete(productId)
    else next.add(productId)
    setSavedIds(next)
    setActionError('')
    try {
      if (wasSaved) await api(`/favorites/${productId}`, { method: 'DELETE' })
      else await api('/favorites', { method: 'POST', body: { productId } })
    } catch (caught) {
      setSavedIds(savedIds)
      setActionError(errorMessage(caught))
    }
  }

  const toggleCompared = (productId: string) => {
    setCompared((items) => (items.includes(productId) ? items.filter((item) => item !== productId) : items.length < MAX_COMPARE ? [...items, productId] : items))
  }

  const startComparison = async () => {
    if (!requireLogin()) return
    setComparing(true)
    setActionError('')
    try {
      await api('/comparisons', { method: 'DELETE' })
      await api('/comparisons', { method: 'POST', body: { productIds: compared } })
      navigateTo('/comparisons')
    } catch (caught) {
      setActionError(errorMessage(caught))
      setComparing(false)
    }
  }

  const pickCategory = (slug: string) => {
    setCategory(slug)
    setMenuOpen(false)
    document.getElementById('products')?.scrollIntoView({ behavior: 'smooth' })
  }

  const categoryName = rootCategories.find((item) => item.slug === category)?.name

  return (
    <div className="app-shell">
      <div className="announcement"><span><Sparkles size={14} /> Bu həftə yeni endirimləri kəşf et</span><a href="#products">Endirimlərə bax <ChevronRight size={14} /></a></div>
      <header className="site-header">
        <div className="header-main container">
          <button type="button" className="mobile-menu icon-button" aria-label="Menyu" aria-expanded={menuOpen} onClick={() => setMenuOpen(true)}><Menu size={22} /></button>
          <a className="logo" href="/"><img className="brand-logo-image" src={logoSrc} alt="Endirimim" /><span>Endirimim<span className="logo-dot">.</span></span></a>
          <div className="search-wrap"><Search size={20} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Məhsul, marka və ya kateqoriya axtar..." aria-label="Axtarış" />{query && <button type="button" className="search-clear" onClick={() => setQuery('')} aria-label="Axtarışı təmizlə"><X size={15} /></button>}</div>
          <nav className="header-actions">
            <a className="nav-action" href={session.status === 'authenticated' ? '/favorites' : loginUrl('/favorites')}><Heart size={19} /><span>Seçilmişlər</span>{savedIds.size > 0 && <b>{savedIds.size}</b>}</a>
            <AccountLink session={session} />
          </nav>
        </div>
        <div className="category-nav">
          <div className="container nav-inner">
            <button type="button" className={`all-categories ${category === '' ? 'active' : ''}`} onClick={() => pickCategory('')}><Menu size={17} /> Bütün kateqoriyalar</button>
            {rootCategories.map((item) => <button type="button" key={item.id} className={category === item.slug ? 'active' : ''} onClick={() => pickCategory(item.slug)}>{item.name}</button>)}
            <button type="button" className="nav-deal" onClick={() => pickCategory('')}><Tag size={15} /> Günün endirimləri</button>
          </div>
        </div>
      </header>

      <main id="top">
        <section className="hero container">
          <div className="hero-copy">
            <div className="eyebrow"><span className="eyebrow-line" /> Ağıllı alış-verişin yeni ünvanı</div>
            <h1>Ən yaxşı qiyməti<br /><em>birlikdə</em> tap.</h1>
            <p>Mağazaları saniyələr içində müqayisə et. Sənin üçün ən sərfəli seçimi tap, qiymətləri izlə və daha ağıllı alış-veriş et.</p>
            <form className="hero-search" onSubmit={(event) => { event.preventDefault(); document.getElementById('products')?.scrollIntoView({ behavior: 'smooth' }) }}>
              <Search size={21} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Nə axtarırsan? Məsələn, iPhone 17..." aria-label="Məhsul axtar" /><button type="submit">Axtar</button>
            </form>
            <div className="quick-search"><span>Populyar:</span>{['iPhone', 'Galaxy', 'MacBook'].map((term) => <button type="button" key={term} onClick={() => { setQuery(term); document.getElementById('products')?.scrollIntoView({ behavior: 'smooth' }) }}>{term}</button>)}</div>
          </div>
          <div className="hero-art">
            <div className="hero-orbit orbit-one" /><div className="hero-orbit orbit-two" />
            {heroProduct ? (
              <>
                <button type="button" className="hero-product" onClick={() => setOpenProduct(heroProduct)} aria-label={`${heroProduct.name} təkliflərinə bax`}><ProductPhoto product={heroProduct} /></button>
                <div className="hero-price-card">
                  <span>Bu günün ən sərfəli təklifi</span>
                  <strong>{formatPrice(heroProduct.bestPrice)}</strong>
                  <small>{heroProduct.name}</small>
                  {heroProduct.maxDiscountPercentage > 0 && <div className="price-drop"><TrendingDown size={14} /> {Math.round(heroProduct.maxDiscountPercentage)}% endirim</div>}
                </div>
              </>
            ) : (
              <div className="hero-phone"><div className="phone-camera" /><div className="phone-screen"><span>Endirimim</span><strong>-%</strong></div></div>
            )}
          </div>
        </section>

        <section className="category-section container">
          <div className="section-heading"><div><span className="section-kicker">Kəşf et</span><h2>Kateqoriyalar</h2></div></div>
          {categories.error && <Notice>{categories.error}</Notice>}
          <div className="category-grid">
            {rootCategories.map((item) => (
              <button type="button" className={`category-card ${category === item.slug ? 'active' : ''}`} key={item.id} onClick={() => pickCategory(item.slug)}>
                <span className="category-icon">{categoryIcons[item.slug] ?? '◆'}</span>
                <span><strong>{item.name}</strong><small>{item.productCount} məhsul</small></span>
                <ChevronRight size={17} />
              </button>
            ))}
          </div>
        </section>

        <section className="products-section" id="products">
          <div className="container">
            <div className="section-heading">
              <div>
                <span className="section-kicker orange">{search ? 'Axtarış nəticələri' : 'Seçilmiş təkliflər'}</span>
                <h2>{search ? `“${search}”` : categoryName ?? 'Bu günün ən yaxşıları'}</h2>
              </div>
              <div className="filter-tabs">
                <button type="button" className={category === '' ? 'active' : ''} onClick={() => setCategory('')}>Hamısı</button>
                {rootCategories.filter((item) => item.productCount > 0).slice(0, 4).map((item) => <button type="button" className={category === item.slug ? 'active' : ''} onClick={() => setCategory(item.slug)} key={item.id}>{item.name}</button>)}
              </div>
            </div>
            {actionError && <Notice onClose={() => setActionError('')}>{actionError}</Notice>}
            {products.error && <Notice>{products.error} <button type="button" className="text-link-inline" onClick={() => void products.reload()}>Yenidən cəhd et</button></Notice>}
            {products.loading && !products.data ? (
              <Spinner label="Məhsullar yüklənir…" />
            ) : products.data && products.data.items.length > 0 ? (
              <div className={`product-grid ${products.loading ? 'is-refreshing' : ''}`}>
                {products.data.items.map((product) => (
                  <ProductCard key={product.id} product={product} saved={savedIds.has(product.id)} compared={compared.includes(product.id)} onSave={() => void toggleSaved(product.id)} onCompare={() => toggleCompared(product.id)} onOpen={() => setOpenProduct(product)} />
                ))}
              </div>
            ) : (
              !products.error && (
                <div className="empty-state"><Search size={30} /><strong>Bu axtarışla məhsul tapılmadı</strong><span>Başqa bir marka və ya kateqoriya yoxla.</span>{(search || category) && <button type="button" className="outline-button" onClick={() => { setQuery(''); setCategory('') }}>Filtrləri təmizlə</button>}</div>
              )
            )}
          </div>
        </section>

        <section className="insight-section container">
          <div className="insight-copy">
            <span className="section-kicker">Endirimim Radar</span>
            <h2>Qiymət düşəndə<br /><em>sənə xəbər edək.</em></h2>
            <p>İzləmək istədiyin məhsulu seç, hədəf qiymətini təyin et. Qiymət düşən kimi ilk sən bil.</p>
            <button type="button" className="orange-button" onClick={() => requireLogin() && setShowAlert({ productId: heroProduct?.id })}><Bell size={17} /> Qiymət xəbərdarlığı qur</button>
          </div>
          <div className="insight-chart">
            <div className="chart-header"><span>{heroProduct?.name ?? 'Qiymət tarixçəsi'}</span>{heroProduct && heroProduct.maxDiscountPercentage > 0 && <strong>-{Math.round(heroProduct.maxDiscountPercentage)}%</strong>}</div>
            <div className="chart-price">{formatPrice(heroProduct?.bestPrice)} <small>ən aşağı qiymət</small></div>
            <svg viewBox="0 0 500 150" preserveAspectRatio="none" aria-hidden="true"><path d="M0 115 C35 110 48 95 82 105 S124 128 160 88 S202 94 230 77 S278 92 315 60 S354 76 389 40 S434 53 500 18" fill="none" stroke="#f97316" strokeWidth="4" strokeLinecap="round" /><path d="M0 115 C35 110 48 95 82 105 S124 128 160 88 S202 94 230 77 S278 92 315 60 S354 76 389 40 S434 53 500 18 V150 H0Z" fill="url(#chartFill)" opacity=".14" /><defs><linearGradient id="chartFill" x1="0" x2="0" y1="0" y2="1"><stop stopColor="#f97316" /><stop offset="1" stopColor="#fff" /></linearGradient></defs></svg>
            <div className="chart-labels"><span>30 gün əvvəl</span><span>Bu gün</span></div>
          </div>
        </section>

        <section className="trust-section"><div className="container trust-row"><div><ShoppingBag size={23} /><strong>{products.data?.pagination.total ?? '—'}</strong><span>məhsul</span></div><div><Store size={23} /><strong>{new Set(allProducts.flatMap((product) => product.offers.map((offer) => offer.merchantId))).size || '—'}</strong><span>mağaza</span></div><div><Tag size={23} /><strong>{allProducts.filter((product) => product.maxDiscountPercentage > 0).length}</strong><span>aktiv endirim</span></div><div><Star size={23} /><strong>100%</strong><span>real qiymətlər</span></div></div></section>
      </main>

      {compared.length > 0 && (
        <div className="compare-tray">
          <div><GitCompareArrows size={20} /><strong>Müqayisə üçün {compared.length} məhsul seçildi{compared.length < 2 ? ' (ən azı 2)' : ''}</strong></div>
          <BusyButton busy={comparing} type="button" className="orange-button" disabled={compared.length < 2} onClick={() => void startComparison()}>Müqayisə et <ChevronRight size={15} /></BusyButton>
          <button type="button" className="tray-close" onClick={() => setCompared([])} aria-label="Müqayisəni təmizlə"><X size={18} /></button>
        </div>
      )}
      {showAlert && allProducts.length > 0 && <AlertModal products={allProducts} initialProductId={showAlert.productId} onClose={() => setShowAlert(null)} />}
      {openProduct && <ProductOffersModal product={openProduct} onClose={() => setOpenProduct(null)} />}
      {menuOpen && <MobileMenu session={session} categories={rootCategories} onPick={pickCategory} onClose={() => setMenuOpen(false)} />}
      <footer><div className="container footer-inner"><a className="logo" href="/"><img className="brand-logo-image" src={logoSrc} alt="Endirimim" /><span>Endirimim<span className="logo-dot">.</span></span></a><span>Ən yaxşı qiymət, daha ağıllı seçim.</span><span className="footer-copy">© 2026 Endirimim</span></div></footer>
    </div>
  )
}

/** Workspaces require a session and the matching role; everything else is public. */
function Workspace({ path }: { path: string }) {
  const session = useSession()
  const wantsStore = path.startsWith('/store')

  useEffect(() => {
    if (session.status === 'anonymous') navigateTo(loginUrl(path))
    if (session.status !== 'authenticated') return
    const isStore = session.user.role === 'store'
    if (wantsStore && !isStore) navigateTo('/dashboard')
    if (!wantsStore && isStore) navigateTo('/store')
  }, [session, path, wantsStore])

  if (session.status !== 'authenticated' || wantsStore !== (session.user.role === 'store')) {
    return pageLoading('Hesabınız yüklənir…')
  }
  return (
    <Suspense fallback={pageLoading('Hesabınız yüklənir…')}>
      <DashboardExperience mode={wantsStore ? 'store' : 'user'} session={session} />
    </Suspense>
  )
}

function App() {
  const path = window.location.pathname.replace(/\/+$/, '') || '/'
  if ((AUTH_PATHS as string[]).includes(path)) {
    return (
      <Suspense fallback={pageLoading()}>
        <AuthFlow initialPath={path as AuthPath} onExit={() => navigateTo('/')} />
      </Suspense>
    )
  }
  if (USER_PATHS.includes(path) || STORE_PATHS.includes(path)) return <Workspace path={path} />
  return <Home />
}

export default App

createRoot(document.getElementById('root')!).render(<App />)
