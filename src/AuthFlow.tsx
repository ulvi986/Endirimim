import { FormEvent, useEffect, useState } from 'react'
import { ArrowLeft, ArrowRight, Check, CheckCircle2, Eye, EyeOff, LockKeyhole, Mail, ShoppingBag, Store } from 'lucide-react'
import { api, ApiError, homePathFor, login, register, safeNext, type Role } from './api'
import { BusyButton, errorMessage, logoSrc, navigateTo, Notice, useSession } from './ui'

type AccountType = 'user' | 'store'
export type AuthPath = '/login' | '/signup' | '/forgot-password' | '/reset-password'

type AuthFlowProps = { initialPath: AuthPath; onExit: () => void }

const query = () => new URLSearchParams(window.location.search)

/**
 * Set while this page is signing someone in. The session flips to
 * "authenticated" before the form shows its result, and that must not trigger
 * the "already signed in, move along" redirect meant for returning visitors.
 */
let signingInHere = false

/** Where to go after signing in: an explicit safe `?next=`, else the role's workspace. */
function destinationFor(role: Role): string {
  const next = safeNext(query().get('next'))
  if (next && !(role === 'store' && next.startsWith('/dashboard')) && !(role !== 'store' && next.startsWith('/store'))) return next
  return homePathFor(role)
}

function Logo({ onClick }: { onClick: () => void }) {
  return (
    <button className="auth-logo" onClick={onClick} aria-label="Endirimim ana səhifə" type="button">
      <img src={logoSrc} alt="Endirimim" />
      <span>Endirimim</span>
    </button>
  )
}

function AuthAside({ mode }: { mode: 'login' | 'signup' }) {
  return (
    <aside className="auth-aside">
      <div className="auth-aside-pattern" />
      <div className="aside-content">
        <span className="aside-kicker"><span /> ENDİRİMİM İLƏ</span>
        <h2>Daha ağıllı<br /><em>alış-veriş.</em></h2>
        <p>Minlərlə mağazanı müqayisə et, qiymətləri izlə və həqiqətən sərfəli olanı tap.</p>
        <div className="aside-stat"><strong>48k+</strong><span>aktiv endirim hər gün yenilənir</span></div>
      </div>
      <div className="aside-quote">“Ən yaxşı qiyməti tapmaq artıq daha asandır.”<small>Endirimim komandası</small></div>
      <div className="aside-footer"><img src={logoSrc} alt="" /> <span>{mode === 'signup' ? 'Yeni hesabını bir neçə addımda yarat.' : 'Ağıllı alış-verişə davam et.'}</span></div>
    </aside>
  )
}

function AuthHeader({ onExit, onNavigate, mode }: { onExit: () => void; onNavigate: (path: AuthPath) => void; mode: 'login' | 'signup' }) {
  return (
    <div className="auth-mobile-header">
      <Logo onClick={onExit} />
      <span>{mode === 'signup' ? 'Artıq hesabın var?' : 'Hesabın yoxdur?'}</span>
      <button type="button" onClick={() => onNavigate(mode === 'signup' ? '/login' : '/signup')}>{mode === 'signup' ? 'Daxil ol' : 'Qeydiyyat'}</button>
    </div>
  )
}

function Field({ label, type = 'text', name, placeholder, value, onChange, error, required = true, autoComplete }: { label: string; type?: string; name: string; placeholder: string; value: string; onChange: (value: string) => void; error?: string; required?: boolean; autoComplete?: string }) {
  const [visible, setVisible] = useState(false)
  const [capsLock, setCapsLock] = useState(false)
  const isPassword = type === 'password'
  return (
    <label className="auth-field">
      <span>{label}{required && <i>*</i>}</span>
      <div className={`field-control ${error ? 'has-error' : ''}`}>
        <input name={name} type={isPassword && visible ? 'text' : type} placeholder={placeholder} value={value} autoComplete={autoComplete} onChange={(event) => onChange(event.target.value)} aria-invalid={Boolean(error)} onKeyDown={(event) => setCapsLock(event.getModifierState('CapsLock'))} onKeyUp={(event) => setCapsLock(event.getModifierState('CapsLock'))} onBlur={() => setCapsLock(false)} />
        {isPassword && (
          <button type="button" className="password-toggle" onClick={() => setVisible((current) => !current)} aria-label={visible ? 'Şifrəni gizlət' : 'Şifrəni göstər'}>
            {visible ? <EyeOff size={17} /> : <Eye size={17} />}
          </button>
        )}
      </div>
      {isPassword && capsLock && <small className="field-error" role="status">Caps Lock aktivdir.</small>}
      {error && <small className="field-error">{error}</small>}
    </label>
  )
}

function Progress({ step }: { step: 1 | 2 }) {
  return (
    <div className="auth-progress" aria-label={`Qeydiyyat addımı ${step} / 2`}>
      <div className="progress-track"><span style={{ width: `${(step - 1) * 100}%` }} /></div>
      {([['Hesab növü', 1], ['Məlumatlar', 2]] as const).map(([label, index]) => (
        <div className={`progress-step ${step >= index ? 'active' : ''}`} key={label}>
          <span>{step > index ? <Check size={13} /> : index}</span>
          <small>{label}</small>
        </div>
      ))}
    </div>
  )
}

function AccountTypeStep({ onChoose }: { onChoose: (type: AccountType) => void }) {
  return (
    <div className="account-step">
      <div className="auth-heading"><span className="auth-kicker">Qeydiyyat</span><h1>Sən hansısan?</h1><p>Endirimim təcrübəni sənə uyğunlaşdırmaq üçün hesab növünü seç.</p></div>
      <div className="account-options">
        <button type="button" className="account-option" onClick={() => onChoose('user')}>
          <span className="account-icon"><ShoppingBag size={27} /></span><span className="option-eyebrow">İSTİFADƏÇİ</span><h2>İstifadəçi</h2>
          <p>Ən yaxşı qiymətləri tapın, məhsulları müqayisə edin və endirimləri izləyin.</p>
          <ul><li><Check size={15} /> Qiymət müqayisəsi</li><li><Check size={15} /> Seçilmişlər və xəbərdarlıqlar</li><li><Check size={15} /> Alış-veriş siyahıları</li><li><Check size={15} /> Məhsul müqayisəsi</li></ul>
          <span className="option-cta">İstifadəçi kimi davam et <ArrowRight size={17} /></span>
        </button>
        <button type="button" className="account-option" onClick={() => onChoose('store')}>
          <span className="account-icon store"><Store size={27} /></span><span className="option-eyebrow">MAĞAZA</span><h2>Mağaza</h2>
          <p>Məhsullarınızı, qiymətlərinizi və kampaniyalarınızı daha çox alıcıya çatdırın.</p>
          <ul><li><Check size={15} /> Məhsul idarəetməsi</li><li><Check size={15} /> Qiymət və təkliflər</li><li><Check size={15} /> Kampaniyalar</li><li><Check size={15} /> Statistikalar</li></ul>
          <span className="option-cta">Mağaza kimi davam et <ArrowRight size={17} /></span>
        </button>
      </div>
    </div>
  )
}

function SignupForm({ accountType, onBack, onComplete }: { accountType: AccountType; onBack: () => void; onComplete: (result: { role: Role }) => void }) {
  const [values, setValues] = useState<Record<string, string>>({})
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [accepted, setAccepted] = useState(false)
  const [busy, setBusy] = useState(false)
  const [serverError, setServerError] = useState('')
  const isStore = accountType === 'store'
  const setValue = (name: string) => (value: string) => setValues((current) => ({ ...current, [name]: value }))

  const validate = () => {
    const next: Record<string, string> = {}
    const email = (values.email ?? '').trim()
    const password = values.password ?? ''
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) next.email = 'Email ünvanı düzgün deyil.'
    if (password.length < 8) next.password = 'Şifrə ən azı 8 simvoldan ibarət olmalıdır.'
    if (password !== values.confirmPassword) next.confirmPassword = 'Şifrələr uyğun gəlmir.'
    if (isStore && (values.storeName ?? '').trim().length < 2) next.storeName = 'Mağaza adı ən azı 2 simvol olmalıdır.'
    if (!isStore && !(values.firstName ?? '').trim()) next.firstName = 'Ad tələb olunur.'
    if (!accepted) next.terms = 'Davam etmək üçün şərtləri qəbul edin.'
    setErrors(next)
    return Object.keys(next).length === 0
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setServerError('')
    if (!validate()) return
    signingInHere = true
    setBusy(true)
    try {
      const [contactFirst, ...contactRest] = (values.contact ?? '').trim().split(/\s+/)
      const trimmed = (key: string) => (values[key] ?? '').trim() || undefined
      const response = await register({
        email: (values.email ?? '').trim(),
        password: values.password ?? '',
        accountType,
        firstName: isStore ? contactFirst || undefined : trimmed('firstName'),
        lastName: isStore ? contactRest.join(' ') || undefined : trimmed('lastName'),
        storeName: isStore ? trimmed('storeName') : undefined,
        phone: isStore ? trimmed('phone') : undefined,
        website: isStore ? trimmed('website') : undefined,
      })
      onComplete({ role: response.user.role })
    } catch (error) {
      signingInHere = false
      if (error instanceof ApiError && error.code === 'conflict') setErrors({ email: error.message })
      else setServerError(errorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="signup-form" onSubmit={submit} noValidate>
      <button className="back-link" type="button" onClick={onBack}><ArrowLeft size={16} /> Hesab növünə qayıt</button>
      <div className="auth-heading compact"><span className="auth-kicker">{isStore ? 'Mağaza hesabı' : 'İstifadəçi hesabı'}</span><h1>Hesabını yarat.</h1><p>{isStore ? 'Mağazanızı Endirimim alıcıları ilə tanış edin.' : 'Ən sərfəli alış-veriş təcrübəsinə bir addım qalıb.'}</p></div>
      {serverError && <Notice>{serverError}</Notice>}
      <div className="form-grid">
        {isStore ? (
          <>
            <Field label="Mağaza adı" name="storeName" placeholder="Məsələn, Tech Store" value={values.storeName ?? ''} onChange={setValue('storeName')} error={errors.storeName} autoComplete="organization" />
            <Field label="Əlaqələndirici şəxs" name="contact" placeholder="Ad və soyad" value={values.contact ?? ''} onChange={setValue('contact')} required={false} autoComplete="name" />
            <Field label="Telefon" name="phone" type="tel" placeholder="+994 50 000 00 00" value={values.phone ?? ''} onChange={setValue('phone')} required={false} autoComplete="tel" />
            <Field label="Vebsayt" name="website" placeholder="https://magazaniz.az" value={values.website ?? ''} onChange={setValue('website')} required={false} autoComplete="url" />
          </>
        ) : (
          <>
            <Field label="Ad" name="firstName" placeholder="Adınız" value={values.firstName ?? ''} onChange={setValue('firstName')} error={errors.firstName} autoComplete="given-name" />
            <Field label="Soyad" name="lastName" placeholder="Soyadınız" value={values.lastName ?? ''} onChange={setValue('lastName')} required={false} autoComplete="family-name" />
          </>
        )}
        <Field label="Email" name="email" type="email" placeholder="siz@email.com" value={values.email ?? ''} onChange={setValue('email')} error={errors.email} autoComplete="email" />
        <Field label="Şifrə" name="password" type="password" placeholder="Ən azı 8 simvol" value={values.password ?? ''} onChange={setValue('password')} error={errors.password} autoComplete="new-password" />
        <Field label="Şifrəni təsdiqlə" name="confirmPassword" type="password" placeholder="Şifrənizi yenidən yazın" value={values.confirmPassword ?? ''} onChange={setValue('confirmPassword')} error={errors.confirmPassword} autoComplete="new-password" />
      </div>
      <label className={`terms-check ${errors.terms ? 'terms-error' : ''}`}>
        <input type="checkbox" checked={accepted} onChange={(event) => setAccepted(event.target.checked)} />
        <span><Check size={13} /> Mən istifadə şərtləri və məxfilik siyasəti ilə razıyam.</span>
      </label>
      {errors.terms && <small className="field-error terms-message">{errors.terms}</small>}
      <BusyButton busy={busy} className="auth-primary">Hesab yarat <ArrowRight size={17} /></BusyButton>
    </form>
  )
}

function SignupDone({ result }: { result: { role: Role } }) {
  return (
    <div className="success-state">
      <span className="success-icon"><CheckCircle2 size={27} /></span>
      <div className="auth-heading compact">
        <span className="auth-kicker">Hesab yaradıldı</span>
        <h1>Xoş gəldin!</h1>
        <p>Hesabın hazırdır və artıq daxil olmusan. Panelinə keçərək başlaya bilərsən.</p>
      </div>
      <button type="button" className="auth-primary" onClick={() => navigateTo(homePathFor(result.role))}>
        {result.role === 'store' ? 'Mağaza panelinə keç' : 'Panelimə keç'} <ArrowRight size={17} />
      </button>
    </div>
  )
}

function LoginForm({ onNavigate }: { onNavigate: (path: AuthPath) => void }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!email.includes('@')) return setError('Email ünvanı düzgün deyil.')
    if (!password) return setError('Şifrəni daxil edin.')
    setError('')
    signingInHere = true
    setBusy(true)
    try {
      const user = await login(email.trim(), password)
      navigateTo(destinationFor(user.role))
    } catch (caught) {
      signingInHere = false
      setError(errorMessage(caught))
      setBusy(false)
    }
  }

  return (
    <form className="login-form" onSubmit={submit} noValidate>
      <div className="auth-heading"><span className="auth-kicker">Xoş gəldin</span><h1>Hesabına daxil ol.</h1><p>Seçilmişlərin, xəbərdarlıqların və siyahıların səni gözləyir.</p></div>
      {error && <Notice>{error}</Notice>}
      <Field label="Email" name="email" type="email" placeholder="siz@email.com" value={email} onChange={setEmail} autoComplete="email" />
      <Field label="Şifrə" name="password" type="password" placeholder="Şifrəniz" value={password} onChange={setPassword} autoComplete="current-password" />
      <div className="form-meta">
        <span />
        <button type="button" onClick={() => onNavigate('/forgot-password')}>Şifrəni unutmusunuz?</button>
      </div>
      <BusyButton busy={busy} className="auth-primary">Daxil ol <ArrowRight size={17} /></BusyButton>
      <p className="switch-auth">Hesabınız yoxdur? <button type="button" onClick={() => onNavigate('/signup')}>Qeydiyyatdan keçin</button></p>
    </form>
  )
}

function RecoveryForm({ onNavigate }: { onNavigate: (path: AuthPath) => void }) {
  const [sent, setSent] = useState(false)
  const [email, setEmail] = useState('')
  const [devPath, setDevPath] = useState<string>()
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!email.includes('@')) return setError('Email ünvanı düzgün deyil.')
    setError('')
    setBusy(true)
    try {
      const response = await api<{ devResetPath?: string }>('/auth/password/forgot', { method: 'POST', body: { email: email.trim() } })
      setDevPath(response.devResetPath)
      setSent(true)
    } catch (caught) {
      setError(errorMessage(caught))
    } finally {
      setBusy(false)
    }
  }

  if (sent) {
    return (
      <div className="success-state">
        <span className="success-icon"><Mail size={27} /></span>
        <div className="auth-heading compact"><span className="auth-kicker">Sorğu qəbul edildi</span><h1>Inboxunu yoxla.</h1><p>Əgər <strong>{email}</strong> qeydiyyatdadırsa, şifrəni yeniləmək üçün keçid göndərdik.</p></div>
        {devPath && <Notice tone="info">Email hələ real göndərilmir (dev rejimi).</Notice>}
        {devPath && <button className="auth-primary" type="button" onClick={() => navigateTo(devPath)}>Şifrəni yeniləmə səhifəsini aç <ArrowRight size={17} /></button>}
        <button className="back-link centered" type="button" onClick={() => onNavigate('/login')}><ArrowLeft size={16} /> Girişə qayıt</button>
      </div>
    )
  }

  return (
    <form className="recovery-form" onSubmit={submit} noValidate>
      <div className="auth-heading"><span className="auth-kicker">Şifrəni bərpa et</span><h1>Yenidən giriş əldə et.</h1><p>Email ünvanını yaz, sənə təhlükəsiz bərpa keçidi göndərək.</p></div>
      {error && <Notice>{error}</Notice>}
      <Field label="Email" name="email" type="email" placeholder="siz@email.com" value={email} onChange={setEmail} autoComplete="email" />
      <BusyButton busy={busy} className="auth-primary">Bərpa keçidi göndər <ArrowRight size={17} /></BusyButton>
      <button className="back-link centered" type="button" onClick={() => onNavigate('/login')}><ArrowLeft size={16} /> Girişə qayıt</button>
    </form>
  )
}

function ResetForm({ onNavigate }: { onNavigate: (path: AuthPath) => void }) {
  const token = query().get('token') ?? ''
  const [done, setDone] = useState(false)
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  if (!token) {
    return (
      <div className="success-state">
        <span className="success-icon"><LockKeyhole size={27} /></span>
        <div className="auth-heading compact"><span className="auth-kicker">Keçid tapılmadı</span><h1>Bərpa keçidi lazımdır.</h1><p>Şifrəni yeniləmək üçün emailinə göndərilən keçidi aç və ya yeni keçid istə.</p></div>
        <button className="auth-primary" type="button" onClick={() => onNavigate('/forgot-password')}>Yeni keçid istə <ArrowRight size={17} /></button>
      </div>
    )
  }

  if (done) {
    return (
      <div className="success-state">
        <span className="success-icon"><CheckCircle2 size={27} /></span>
        <div className="auth-heading compact"><span className="auth-kicker">Hazırdır</span><h1>Şifrən yeniləndi.</h1><p>Təhlükəsizlik üçün bütün cihazlardan çıxış edildi. Yeni şifrənlə daxil ol.</p></div>
        <button className="auth-primary" type="button" onClick={() => navigateTo('/login')}>Daxil ol <ArrowRight size={17} /></button>
      </div>
    )
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (password.length < 8) return setError('Şifrə ən azı 8 simvol olmalıdır.')
    if (password !== confirm) return setError('Şifrələr uyğun gəlmir.')
    setError('')
    setBusy(true)
    try {
      await api('/auth/password/reset', { method: 'POST', body: { token, password } })
      setDone(true)
    } catch (caught) {
      setError(errorMessage(caught))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="recovery-form" onSubmit={submit} noValidate>
      <div className="auth-heading"><span className="auth-kicker">Yeni şifrə</span><h1>Güclü şifrə seç.</h1><p>Hesabını qorumaq üçün ən azı 8 simvolluq şifrə istifadə et.</p></div>
      {error && <Notice>{error}</Notice>}
      <Field label="Yeni şifrə" name="password" type="password" placeholder="Ən azı 8 simvol" value={password} onChange={setPassword} autoComplete="new-password" />
      <Field label="Şifrəni təsdiqlə" name="confirm" type="password" placeholder="Şifrənizi yenidən yazın" value={confirm} onChange={setConfirm} autoComplete="new-password" />
      <BusyButton busy={busy} className="auth-primary">Şifrəni yenilə <ArrowRight size={17} /></BusyButton>
    </form>
  )
}

export default function AuthFlow({ initialPath, onExit }: AuthFlowProps) {
  const session = useSession()
  const [path, setPath] = useState<AuthPath>(initialPath)
  const [accountType, setAccountType] = useState<AccountType | null>(null)
  const [signupResult, setSignupResult] = useState<{ role: Role } | null>(null)

  const onNavigate = (nextPath: AuthPath) => {
    window.history.pushState({}, '', nextPath)
    setPath(nextPath)
  }

  useEffect(() => {
    const onPop = () => setPath(window.location.pathname as AuthPath)
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  // Already signed in: login/signup pages are a dead end, send them on.
  const alreadySignedIn = !signingInHere && session.status === 'authenticated' && (path === '/login' || (path === '/signup' && !signupResult))
  useEffect(() => {
    if (alreadySignedIn && session.status === 'authenticated') navigateTo(destinationFor(session.user.role))
  }, [alreadySignedIn, session])

  const mode = path === '/signup' ? 'signup' : 'login'

  const renderPanel = () => {
    if (alreadySignedIn || (session.status === 'loading' && (path === '/login' || path === '/signup'))) {
      return <div className="auth-heading compact"><span className="auth-kicker">Bir saniyə</span><h1>Hesabın yoxlanılır…</h1></div>
    }
    if (path === '/signup' && signupResult) return <SignupDone result={signupResult} />
    if (path === '/signup' && !accountType) return <><Progress step={1} /><AccountTypeStep onChoose={setAccountType} /></>
    if (path === '/signup' && accountType) return <><Progress step={2} /><SignupForm accountType={accountType} onBack={() => setAccountType(null)} onComplete={setSignupResult} /></>
    if (path === '/forgot-password') return <RecoveryForm onNavigate={onNavigate} />
    if (path === '/reset-password') return <ResetForm onNavigate={onNavigate} />
    return <LoginForm onNavigate={onNavigate} />
  }

  return (
    <div className="auth-shell">
      <AuthAside mode={mode} />
      <section className="auth-main">
        <AuthHeader onExit={onExit} onNavigate={onNavigate} mode={mode} />
        <div className="auth-panel">
          <Logo onClick={onExit} />
          {renderPanel()}
          <div className="auth-legal">Davam etməklə İstifadə şərtləri və Məxfilik siyasəti ilə razılaşırsınız.</div>
        </div>
      </section>
    </div>
  )
}
