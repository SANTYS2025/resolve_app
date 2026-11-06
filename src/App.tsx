import { Component, createContext, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { Capacitor } from '@capacitor/core'
import { App as CapApp } from '@capacitor/app'
// Copia limpia del logo (recortada, sin el botón de corazón que traía la captura de Figma)
import logo from './imports/logo.png'
// Fotos por defecto según género (recortadas de la guía de perfil de la marca)
import avatarHombre from './imports/avatar-hombre.png'
import avatarMujer from './imports/avatar-mujer.png'
import { supabase } from './lib/supabase'
import {
  calificarSolicitud, cambiarEstado, completarSolicitud, confirmarTecnico, crearSolicitud, ensurePerfil, enviarMensaje, errMsg, fmt, getBarrios, getCategorias, getEstadoSolicitud,
  getHistorial, getDisponibilidades, getEstadoAprobacion, getMiCuentaBancaria, getMiTecnicoId, getMiVerificacion, getPedidos, getTecnicos,
  esCorreo, guardarCuentaBancaria, guardarDiagnostico, guardarGenero, iniciarDesplazamiento, marcarLlegada, normCel, registrarMetodoPago, registrarTecnico,
  soloDigitos, soloDireccion, soloNombre, urlGoogleMaps, useData,
} from './lib/api'
import type { Barrio, Categoria, CuentaBancaria, Disponibilidad, Genero, Pedido, Perfil, Rol, SolicitudEvento, WorkerType } from './lib/api'
import { evaluarAccesoChat, mostrarBotonChat, validarMensaje, MAX_MENSAJE } from './lib/chat'
import {
  METODOS, etiquetaEstadoPago, metodoDiferido, metodoPagoInfo, puedeElegirMetodoPago,
  resumenPagoTecnico, validarSeleccionMetodo,
} from './lib/pagos'
import type { MetodoPago } from './lib/pagos'
import {
  accionDelTecnico, clientePuedeCancelar, disponibilidadTecnico, esperaConfirmacionCliente,
  filtrarSolicitudes, llegadaRegistrada, puedeAceptarSolicitud, puedeFinalizarSolicitud, progresoCliente,
} from './lib/solicitudes'
import { recomendarTecnicos } from './lib/recomendacion'
import { useMensajesEnVivo, useSolicitudesEnVivo } from './lib/realtime'
import { registrarPagoInterno } from './lib/transacciones'
import { registrarPush } from './lib/push'
import { ARRANQUE_FRIO, cerrarSesion, limpiarSesionDeArranque } from './lib/sesion'
import { esEnlaceRecuperacion, mensajeErrorRecuperacion, validarCorreoRecuperacion } from './lib/auth'
import {
  AgendaScreen, CuponBox, EarningsScreen, FavoriteButton, HelpScreen, NotificationsScreen,
  PortfolioScreen, RastreoUbicacion, ReferralsScreen, ReportarProblemaBox, ResetPasswordScreen,
  TransactionsScreen,
} from './features/Extras'

// Paleta derivada del logo (muestreo de píxeles): fondo #000032, verde #2EDF2D.
// GD = verde oscuro SOLO para texto sobre blanco (el verde del logo da contraste 1.8:1, insuficiente).
const N = '#000032', G = '#2EDF2D', GD = '#14802A', GL = '#DDFBDD', BG = '#F4F8F4', MU = '#566A5B', BD = '#D3E2D4', W = '#ffffff'
const PRIMARY = 'linear-gradient(135deg, #3BEF3A, #25C92B)'
// text-base (16px): con menos, iOS Safari hace zoom al enfocar el campo. min-h 48px = área táctil cómoda.
const INPUT = 'w-full px-4 min-h-[48px] py-3 text-base rounded-2xl border outline-none focus:ring-2 focus:ring-[#2EDF2D]'
const INPUT_STYLE = { borderColor: BD, backgroundColor: W }

type Screen = 'splash' | 'auth' | 'home' | 'worker' | 'request' | 'confirm' | 'rate' | 'orders' | 'done' | 'pending' | 'profile' | 'chat' | 'v1' | 'v2' | 'v3'
  | 'help' | 'transactions' | 'notifications' | 'referrals' | 'agenda' | 'portfolio' | 'earnings' | 'reset'
type AuthTab = 'login' | 'register'
type NavFn = (s: Screen) => void
type Draft = { name: string; phone: string; cedula: string; genero: Genero | '' }

const DIAS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb']
const ESTADO: Record<string, { label: string; bg: string; color: string }> = {
  pendiente: { label: 'Pendiente', bg: '#FEF3C7', color: '#92400E' },
  aceptada: { label: 'Técnico aceptó', bg: '#DBEAFE', color: '#1D4ED8' },
  confirmada: { label: 'Confirmada', bg: '#DBEAFE', color: '#1D4ED8' },
  en_camino: { label: 'En camino', bg: '#E0E7FF', color: '#3730A3' },
  en_proceso: { label: 'En proceso', bg: '#E0E7FF', color: '#3730A3' },
  llego: { label: 'Técnico llegó', bg: '#DCFCE7', color: '#166534' },
  completada: { label: 'Terminada', bg: GL, color: '#065F46' },
  rechazada: { label: 'Rechazada', bg: '#FEE2E2', color: '#991B1B' },
  cancelada: { label: 'Cancelada', bg: '#F3F4F6', color: '#4B5563' },
  expirada: { label: 'Expirada', bg: '#F3F4F6', color: '#4B5563' }, // la base de datos las marca al vencer
}
/** Etiquetas del técnico: dicen qué le toca hacer, no solo el estado interno. */
const ESTADO_TEC: Record<string, string> = {
  pendiente: 'Nueva',
  aceptada: 'Aceptada · esperando cliente',
  confirmada: 'Confirmada · ir al domicilio',
  en_camino: 'En camino',
  en_proceso: 'En proceso',
  llego: 'En el domicilio',
  completada: 'Terminada',
}
const todayLocal = () => new Date().toLocaleDateString('en-CA')
/** Fecha máxima permitida en el formulario: un año desde hoy. */
const fechaMax = () => { const d = new Date(); d.setFullYear(d.getFullYear() + 1); return d.toLocaleDateString('en-CA') }

// Estado de tiempo real compartido: lo provee App y lo leen BottomNav (insignia) y OrdersScreen (recarga).
const LiveCtx = createContext<{ version: number; pendientes: number; conectado: boolean; rol: Rol | null }>({ version: 0, pendientes: 0, conectado: true, rol: null })

/* ═════════ Componentes compartidos ═════════ */
function Stars({ r, size = 11 }: { r: number; size?: number }) {
  return (
    <span className="flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map(s => (
        <svg key={s} width={size} height={size} viewBox="0 0 12 12">
          <path d="M6 1l1.2 3.6H11L8.1 6.9l1 3.6L6 8.4l-3.1 2.1 1-3.6L1 4.6h3.8L6 1z" fill={s <= Math.round(r) ? G : BD} />
        </svg>
      ))}
    </span>
  )
}

function VBadge() {
  return (
    <span className="inline-flex items-center gap-0.5 text-[11px] font-bold px-1.5 py-0.5 rounded-full"
      style={{ backgroundColor: GL, color: '#065F46' }}>
      <svg width="7" height="7" viewBox="0 0 8 8">
        <circle cx="4" cy="4" r="3.5" fill={G} />
        <path d="M2.5 4l1.2 1.2 2.3-2.3" stroke="white" strokeWidth="1.1" strokeLinecap="round" />
      </svg>
      Verificado
    </span>
  )
}

/** Foto del técnico. Si no tiene foto (o la URL está rota) se usa la imagen por defecto de su género. */
function Avatar({ w }: { w: { name: string; avatar: string; genero?: Genero } }) {
  const [rota, setRota] = useState(false)
  useEffect(() => { setRota(false) }, [w.avatar])
  if (w.avatar && !rota) {
    return <img src={w.avatar} alt={w.name} loading="lazy" onError={() => setRota(true)} className="w-full h-full object-cover" />
  }
  return (
    <div className="w-full h-full flex items-center justify-center" style={{ backgroundColor: GL }}>
      <img src={w.genero === 'mujer' ? avatarMujer : avatarHombre} alt={w.name} className="w-full h-full object-contain" />
    </div>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <label className="text-xs font-bold mb-1.5 block uppercase tracking-wide" style={{ color: MU }}>{label}</label>
      {children}
    </div>
  )
}

function ErrorBox({ msg, ok = false }: { msg: string; ok?: boolean }) {
  if (!msg) return null
  return (
    <div role="alert" className="px-4 py-3 rounded-2xl text-sm font-semibold"
      style={ok ? { backgroundColor: GL, color: '#0B5D1E', border: `1px solid ${G}80` }
                : { backgroundColor: '#FEF2F2', color: '#B91C1C', border: '1px solid #FECACA' }}>
      {msg}
    </div>
  )
}

/** Botón principal: 52px de alto (área táctil cómoda), degradado del logo, texto navy (contraste alto). */
function PrimaryBtn({ children, onClick, disabled }: { children: ReactNode; onClick: () => void; disabled?: boolean }) {
  return (
    <button onClick={onClick} disabled={disabled} className="w-full min-h-[52px] px-5 rounded-2xl font-extrabold text-base"
      style={{ background: PRIMARY, color: N, opacity: disabled ? 0.55 : 1, cursor: disabled ? 'not-allowed' : 'pointer',
               boxShadow: disabled ? undefined : '0 6px 20px rgba(46,223,45,0.32)' }}>
      {children}
    </button>
  )
}

/** Botón secundario (contorno). `tone="danger"` para acciones destructivas como cerrar sesión. */
function SecondaryBtn({ children, onClick, disabled, tone = 'neutral' }: { children: ReactNode; onClick: () => void; disabled?: boolean; tone?: 'neutral' | 'danger' }) {
  const danger = tone === 'danger'
  return (
    <button onClick={onClick} disabled={disabled} className="w-full min-h-[48px] px-5 rounded-2xl font-bold text-sm border"
      style={{ borderColor: danger ? '#FECACA' : BD, color: danger ? '#B91C1C' : N, backgroundColor: W, opacity: disabled ? 0.6 : 1 }}>
      {children}
    </button>
  )
}

/** Volver: 44px de área táctil + chevrón. `dark` = sobre fondo navy. Acepta etiquetas con "← " delante. */
function BackBtn({ onClick, label = 'Volver', dark = true }: { onClick: () => void; label?: string; dark?: boolean }) {
  return (
    <button onClick={onClick} className="flex items-center gap-1 min-h-[44px] -ml-2 pl-1 pr-3 text-sm font-semibold"
      style={{ color: dark ? 'rgba(255,255,255,0.75)' : MU }}>
      <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true"><path d="M12 4l-6 6 6 6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
      {label.replace(/^←\s*/, '')}
    </button>
  )
}

function DarkHeader({ onBack, backLabel = 'Volver', children }: { onBack?: () => void; backLabel?: string; children?: ReactNode }) {
  return (
    <header className="flex-shrink-0 px-4 pb-4" style={{ background: `linear-gradient(135deg, ${N}, #0A0A55)`, paddingTop: onBack ? 4 : 16 }}>
      {onBack && <BackBtn onClick={onBack} label={backLabel} />}
      {children}
    </header>
  )
}

/** Tarjeta base: esquinas amplias, borde suave y sombra tintada con el azul del logo. */
function Card({ children, className = '', style }: { children: ReactNode; className?: string; style?: React.CSSProperties }) {
  return <div className={`rounded-3xl ${className}`} style={{ backgroundColor: W, border: `1px solid ${BD}`, boxShadow: '0 2px 10px rgba(0,0,50,0.05)', ...style }}>{children}</div>
}

/** Lista de pares etiqueta/valor (perfil del técnico, mi perfil). */
function InfoRows({ rows }: { rows: [string, string][] }) {
  return (
    <div className="rounded-2xl overflow-hidden" style={{ backgroundColor: W, border: `1px solid ${BD}` }}>
      {rows.map(([l, v], i) => (
        <div key={l} className="flex items-center justify-between gap-4 px-4 py-3.5" style={{ borderBottom: i < rows.length - 1 ? `1px solid ${BD}` : undefined }}>
          <span className="text-sm flex-shrink-0" style={{ color: MU }}>{l}</span>
          <span className="text-sm font-bold text-right break-words min-w-0" style={{ color: N }}>{v}</span>
        </div>
      ))}
    </div>
  )
}

function SectionTitle({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="flex items-center justify-between mb-3">
      <h3 className="text-sm font-extrabold uppercase tracking-wider" style={{ color: N }}>{children}</h3>
      {right}
    </div>
  )
}

function SuccessMark({ size = 96 }: { size?: number }) {
  return (
    <div className="rounded-full flex items-center justify-center mb-5" style={{ width: size, height: size, background: PRIMARY, boxShadow: '0 14px 44px rgba(46,223,45,0.4)' }}>
      <svg width={size * 0.44} height={size * 0.44} viewBox="0 0 42 42" aria-hidden="true"><path d="M10 21l9 9 14-14" stroke={N} strokeWidth="3.8" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>
    </div>
  )
}

/** Pantalla de arranque con el logo de Resolve (reemplaza el texto "Cargando…" al abrir la app). */
function BrandLoader() {
  return (
    <div className="flex flex-col items-center justify-center h-full px-6" role="status" aria-label="Cargando Resolve Pasto" style={{ backgroundColor: N }}>
      {/* La entrada va en el contenedor y el latido en el logo: así no compiten dos `transform`. */}
      <div className="splash-in flex flex-col items-center">
        <img src={logo} alt="" className="logo-pulse w-60 max-w-[65%] h-auto" style={{ mixBlendMode: 'lighten' }} />
        {/* El eslogan va como texto aparte para que sea legible aunque venga pequeño dentro del logo. */}
        <p className="mt-5 text-center text-xl font-bold tracking-wide" style={{ color: W, textShadow: '0 2px 14px rgba(0,0,0,0.55)' }}>
          Tu hogar en buenas manos
        </p>
      </div>
    </div>
  )
}

function Loading({ text = 'Cargando…' }: { text?: string }) {
  return <p className="text-sm text-center py-6" role="status" style={{ color: MU }}>{text}</p>
}

/** Placeholder animado mientras llegan los técnicos (evita saltos de layout). */
function SkeletonCard() {
  return (
    <div className="rounded-3xl p-4 animate-pulse" style={{ backgroundColor: W, border: `1px solid ${BD}` }} aria-hidden="true">
      <div className="flex gap-3"><div className="w-14 h-14 rounded-2xl" style={{ backgroundColor: GL }} />
        <div className="flex-1 space-y-2 pt-1"><div className="h-3.5 w-2/3 rounded" style={{ backgroundColor: GL }} /><div className="h-3 w-1/3 rounded" style={{ backgroundColor: GL }} /></div></div>
      <div className="h-11 mt-4 rounded-2xl" style={{ backgroundColor: GL }} />
    </div>
  )
}

function NavIcon({ name, active }: { name: 'home' | 'orders' | 'done' | 'profile'; active: boolean }) {
  const c = active ? N : '#7B8A80'
  const common = { fill: 'none', stroke: c, strokeWidth: 1.9, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true">
      {name === 'home' && <path {...common} d="M4 11l8-7 8 7v8a1 1 0 0 1-1 1h-4v-6H9v6H5a1 1 0 0 1-1-1z" />}
      {name === 'orders' && <><rect {...common} x="5" y="4" width="14" height="17" rx="2.5" /><path {...common} d="M9 4V3h6v1M9 11h6M9 15h4" /></>}
      {name === 'done' && <><circle {...common} cx="12" cy="12" r="8.5" /><path {...common} d="M8.5 12.3l2.4 2.4 4.6-4.9" /></>}
      {name === 'profile' && <><circle {...common} cx="12" cy="8" r="3.5" /><path {...common} d="M5 20c.6-3.6 3.6-5.5 7-5.5s6.4 1.9 7 5.5" /></>}
    </svg>
  )
}

function BottomNav({ active, go }: { active: Screen; go: NavFn }) {
  const { pendientes, rol } = useContext(LiveCtx)
  // El técnico NO tiene "Inicio" (catálogo de clientes): solo Solicitudes, completadas y Perfil.
  const tabs: { icon: 'home' | 'orders' | 'done' | 'profile'; label: string; s: Screen }[] = rol === 'tecnico'
    ? [{ icon: 'orders', label: 'Solicitudes', s: 'orders' }, { icon: 'done', label: 'Ver solicitudes terminadas', s: 'done' }, { icon: 'profile', label: 'Perfil', s: 'profile' }]
    : [{ icon: 'home', label: 'Inicio', s: 'home' }, { icon: 'orders', label: 'Solicitudes', s: 'orders' }, { icon: 'profile', label: 'Perfil', s: 'profile' }]
  return (
    <nav aria-label="Navegación principal" className="flex-shrink-0 flex border-t"
      style={{ borderColor: BD, backgroundColor: W, paddingBottom: 'max(8px, env(safe-area-inset-bottom))' }}>
      {tabs.map(t => {
        const on = active === t.s
        return (
          <button key={t.label} onClick={() => go(t.s)} aria-current={on ? 'page' : undefined}
            className="flex-1 flex flex-col items-center justify-start min-h-[56px] pt-2 gap-1"
            style={{ color: on ? N : '#7B8A80' }}>
            <span className="relative px-4 py-1 rounded-full" style={{ backgroundColor: on ? GL : 'transparent' }}>
              <NavIcon name={t.icon} active={on} />
              {t.s === 'orders' && pendientes > 0 && !on && (
                <span aria-label={`${pendientes} novedades`} className="absolute -top-0.5 right-1.5 min-w-[18px] h-[18px] px-1 rounded-full text-[11px] font-extrabold flex items-center justify-center"
                  style={{ backgroundColor: '#EF4444', color: W, border: `2px solid ${W}` }}>{pendientes > 9 ? '9+' : pendientes}</span>
              )}
            </span>
            <span className="text-[11px] font-bold text-center leading-tight px-1">{t.label}</span>
          </button>
        )
      })}
    </nav>
  )
}

class Boundary extends Component<{ children: ReactNode }, { err: boolean }> {
  state = { err: false }
  static getDerivedStateFromError() { return { err: true } }
  componentDidCatch(e: unknown) { console.error(e) }
  render() {
    if (!this.state.err) return this.props.children
    return (
      <div className="h-full flex flex-col items-center justify-center gap-3 px-6 text-center" style={{ backgroundColor: BG }}>
        <p className="text-sm font-bold" style={{ color: N }}>Algo salió mal.</p>
        <button onClick={() => window.location.reload()} className="px-5 py-2.5 rounded-2xl text-xs font-extrabold" style={{ background: PRIMARY, color: N }}>
          Recargar
        </button>
      </div>
    )
  }
}

/* ═════════ Splash ═════════ */
function SplashScreen({ openAuth }: { openAuth: (t: AuthTab) => void }) {
  return (
    <div className="relative flex flex-col h-full px-6 overflow-hidden"
      style={{ background: `linear-gradient(160deg, ${N} 0%, #0A0A55 100%)`, paddingBottom: 'max(24px, env(safe-area-inset-bottom))' }}>
      <div className="absolute w-80 h-80 rounded-full pointer-events-none"
        style={{ background: 'radial-gradient(circle, rgba(46,223,45,0.18), transparent 70%)', top: '-90px', right: '-90px' }} />
      {/* El logo ya incluye el nombre y el lema; el h1 queda solo para lectores de pantalla */}
      <div className="relative z-10 flex-1 flex flex-col items-center justify-center min-h-0">
        <h1 className="sr-only">Resolve Pasto — Tu hogar en buenas manos</h1>
        <img src={logo} alt="" className="w-72 max-w-[80%] h-auto" style={{ mixBlendMode: 'lighten' }} />
        {/* Eslogan legible como texto (el del logo puede quedar muy pequeño en pantallas grandes). */}
        <p className="mt-4 text-center text-lg sm:text-xl font-bold tracking-wide" style={{ color: W }}>
          Tu hogar en buenas manos
        </p>
      </div>
      <div className="relative z-10 w-full space-y-3">
        {/* Sin contador de técnicos: el arranque solo invita a registrarse o ingresar. */}
        <PrimaryBtn onClick={() => openAuth('register')}>Registrarme →</PrimaryBtn>
        <button onClick={() => openAuth('login')} className="w-full min-h-[52px] rounded-2xl font-semibold text-base border"
          style={{ borderColor: 'rgba(255,255,255,0.22)', color: 'rgba(255,255,255,0.85)' }}>Ya tengo cuenta · Ingresar</button>
      </div>
    </div>
  )
}

/* ═════════ Auth ═════════ */
function AuthScreen({ initialTab, go, onAuth }: { initialTab: AuthTab; go: NavFn; onAuth: (p: Perfil) => Promise<void> }) {
  const [tab, setTab] = useState<AuthTab>(initialTab)
  const [role, setRole] = useState<'client' | 'worker' | null>(null)
  const [form, setForm] = useState({ name: '', email: '', password: '' })
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')
  const [notice, setNotice] = useState('')

  /**
   * Recuperación de contraseña: Supabase envía un enlace mágico. Al abrirlo,
   * la app recibe PASSWORD_RECOVERY y muestra la pantalla para definir la nueva.
   */
  const enviarRecuperacion = async () => {
    setMessage(''); setNotice('')
    const email = form.email.trim().toLowerCase()
    const err = validarCorreoRecuperacion(email)
    if (err) return setMessage(err)
    setLoading(true)
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}${window.location.pathname}`,
      })
      if (error) throw error
      setNotice('Te enviamos un correo con el enlace para crear una nueva contraseña. Revisa también la carpeta de spam.')
    } catch (e) {
      console.error(e); setMessage(mensajeErrorRecuperacion(e))
    } finally {
      setLoading(false)
    }
  }

  const handleAuth = async () => {
    setMessage(''); setNotice('')
    const email = form.email.trim().toLowerCase()
    const name = form.name.trim()
    if (!esCorreo(email)) return setMessage('Ingresa un correo válido.')
    if (!form.password) return setMessage('Ingresa tu contraseña.')
    if (tab === 'register') {
      if (name.length < 3) return setMessage('Ingresa tu nombre completo.')
      if (!role) return setMessage('Selecciona si buscas un técnico o si eres trabajador.')
      if (form.password.length < 8) return setMessage('La contraseña debe tener mínimo 8 caracteres.')
    }

    setLoading(true)
    try {
      const res = tab === 'register'
        ? await supabase.auth.signUp({ email, password: form.password,
            options: { data: { nombre: name, rol: role === 'worker' ? 'tecnico' : 'cliente' } } })
        : await supabase.auth.signInWithPassword({ email, password: form.password })
      if (res.error) throw res.error

      if (tab === 'register' && !res.data.session) {
        setNotice('Te enviamos un correo para confirmar tu cuenta. Confírmalo y luego ingresa.')
        setTab('login')
        return
      }
      if (!res.data.user) throw new Error('No se pudo iniciar sesión.')
      await onAuth(await ensurePerfil(res.data.user))
    } catch (e) {
      console.error(e)
      setMessage(errMsg(e))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex flex-col h-full" style={{ backgroundColor: BG }}>
      <div className="flex-shrink-0 px-5 pt-1 pb-5" style={{ background: `linear-gradient(160deg, ${N} 0%, #0A0A55 100%)` }}>
        <BackBtn onClick={() => go('splash')} />
        <img src={logo} alt="Resolve Pasto" className="h-16 w-auto mb-3 -ml-1" style={{ mixBlendMode: 'lighten' }} />
        <div className="flex rounded-2xl p-1" style={{ backgroundColor: 'rgba(255,255,255,0.07)' }}>
          {(['register', 'login'] as AuthTab[]).map(t => (
            <button key={t} onClick={() => { setTab(t); setMessage(''); setNotice('') }}
              className="flex-1 min-h-[44px] text-sm font-bold rounded-xl transition-all"
              style={{ backgroundColor: tab === t ? W : 'transparent', color: tab === t ? N : 'rgba(255,255,255,0.6)' }}>
              {t === 'login' ? 'Ingresar' : 'Registrarse'}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-5 pt-5 pb-safe space-y-4" style={{ scrollbarWidth: 'none' }}>
        {tab === 'register' && (
          <Field label="Nombre completo">
            <input type="text" autoComplete="name" autoCapitalize="words" maxLength={60} value={form.name} onChange={e => setForm({ ...form, name: soloNombre(e.target.value) })}
              placeholder="Nombre y apellido" className={INPUT} style={INPUT_STYLE} />
          </Field>
        )}
        <Field label="Correo electrónico">
          <input type="email" inputMode="email" autoComplete="email" autoCapitalize="none" autoCorrect="off" spellCheck={false} maxLength={100}
            value={form.email} onChange={e => setForm({ ...form, email: e.target.value.replace(/\s/g, '') })}
            placeholder="tu@correo.com" className={INPUT} style={INPUT_STYLE} />
        </Field>
        <Field label="Contraseña">
          <input type="password" maxLength={72} autoComplete={tab === 'login' ? 'current-password' : 'new-password'} value={form.password}
            onChange={e => setForm({ ...form, password: e.target.value })}
            onKeyDown={e => { if (e.key === 'Enter' && !loading) handleAuth() }}
            placeholder="Mínimo 8 caracteres" className={INPUT} style={INPUT_STYLE} />
        </Field>

        {tab === 'register' && (
          <Field label="Soy…">
            <div className="grid grid-cols-2 gap-2.5">
              {([['client', '🏠', 'Busco un Técnico', 'Cliente'], ['worker', '🔧', 'Soy Trabajador', 'Técnico']] as const).map(([id, icon, title, sub]) => (
                <button key={id} onClick={() => setRole(id)} className="p-3.5 rounded-2xl border text-left transition-all"
                  style={{ borderColor: role === id ? G : BD, backgroundColor: role === id ? GL : W,
                           boxShadow: role === id ? `0 0 0 1.5px ${G}50` : undefined }}>
                  <div className="text-2xl mb-1.5 leading-none">{icon}</div>
                  <div className="text-sm font-extrabold leading-tight" style={{ color: N }}>{title}</div>
                  <div className="text-xs mt-0.5" style={{ color: MU }}>{sub}</div>
                </button>
              ))}
            </div>
          </Field>
        )}

        <ErrorBox msg={message} />
        <ErrorBox msg={notice} ok />

        <PrimaryBtn onClick={handleAuth} disabled={loading}>
          {loading ? 'Procesando…' : tab === 'login' ? 'Ingresar a mi cuenta →' : role === 'worker' ? 'Crear cuenta y verificar →' : 'Crear cuenta →'}
        </PrimaryBtn>

        {tab === 'login' && (
          <button onClick={enviarRecuperacion} disabled={loading}
            className="w-full min-h-[44px] text-sm font-bold underline" style={{ color: GD }}>
            ¿Olvidaste tu contraseña?
          </button>
        )}

        <p className="text-center text-sm pt-1" style={{ color: MU }}>
          {tab === 'login' ? '¿No tienes cuenta?' : '¿Ya tienes cuenta?'}{' '}
          <button className="font-bold underline min-h-[44px] px-1" style={{ color: GD }}
            onClick={() => { setTab(tab === 'login' ? 'register' : 'login'); setMessage(''); setNotice('') }}>
            {tab === 'login' ? 'Registrarse' : 'Ingresar'}
          </button>
        </p>
      </div>
    </div>
  )
}

/* ═════════ Home ═════════ */
function HomeScreen({ perfil, go, setWorker }: { perfil: Perfil; go: NavFn; setWorker: (w: WorkerType) => void }) {
  const tecnicos = useData(getTecnicos, [], [] as WorkerType[])
  const cats = useData(getCategorias, [], [] as Categoria[])
  const [filter, setFilter] = useState<number | null>(null)
  const [q, setQ] = useState('')
  const [soloDisponibles, setSoloDisponibles] = useState(false)
  const puedeSolicitar = perfil.rol === 'cliente'

  const visible = useMemo(() => {
    const s = q.trim().toLowerCase()
    const base = tecnicos.data.filter(w =>
      (!s || [w.name, w.trade, w.category, w.neighborhood].some(x => x.toLowerCase().includes(s))))
    return recomendarTecnicos(
      base.map(w => ({ ...w, disponible: w.disponibleAhora })),
      { categoriaId: filter, soloDisponibles },
    )
  }, [tecnicos.data, filter, q, soloDisponibles])

  return (
    <div className="flex flex-col h-full" style={{ backgroundColor: BG }}>
      <header className="flex-shrink-0 px-4 pt-4 pb-5" style={{ background: `linear-gradient(135deg, ${N}, #0A0A55)` }}>
        <p className="text-sm" style={{ color: 'rgba(255,255,255,0.65)' }}>Hola, {perfil.nombre.split(' ')[0]} 👋</p>
        <h2 className="text-2xl font-extrabold text-white leading-tight mb-4">¿Qué necesitas resolver hoy?</h2>
        <label className="flex items-center gap-3 px-4 min-h-[48px] rounded-2xl" style={{ backgroundColor: W }}>
          <svg width="18" height="18" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <circle cx="7" cy="7" r="5" stroke={MU} strokeWidth="1.5" /><path d="M11 11l3 3" stroke={MU} strokeWidth="1.5" strokeLinecap="round" />
          </svg>
          {/* 16px: con menos, iOS hace zoom al enfocar */}
          <input type="search" enterKeyHint="search" autoComplete="off" maxLength={40} value={q} onChange={e => setQ(e.target.value)} placeholder="Buscar plomero, electricista, barrio…"
            aria-label="Buscar técnicos" className="flex-1 min-w-0 text-base bg-transparent outline-none" style={{ color: N }} />
        </label>
      </header>

      <div className="flex-1 overflow-y-auto" style={{ scrollbarWidth: 'none' }}>
        {cats.data.length > 0 && (
          /*
           * Filtros visibles de inmediato: antes eran chips en una fila con scroll
           * horizontal y las últimas categorías quedaban escondidas. Ahora se
           * envuelven en varias filas dentro de un panel, sin cambiar la lógica:
           * `filter === null` = Todos y el resto filtra por `categoryId`.
           */
          <div className="px-4 pt-4">
            <div className="rounded-2xl p-3" style={{ backgroundColor: W, border: `1px solid ${BD}` }}>
              <div className="flex items-center justify-between gap-2 mb-2">
                <p className="text-xs font-extrabold uppercase tracking-wider" style={{ color: MU }}>Filtrar por servicio</p>
                {filter !== null && (
                  <button onClick={() => setFilter(null)} className="min-h-[32px] px-2 text-xs font-bold underline" style={{ color: GD }}>
                    Limpiar filtro
                  </button>
                )}
              </div>
              <div className="flex flex-wrap gap-2" role="group" aria-label="Filtrar por servicio">
                {[{ id: null as number | null, nombre: 'Todos', icono: '✨' }, ...cats.data].map(c => {
                  const on = filter === c.id
                  return (
                    <button key={c.id ?? 'todos'} onClick={() => setFilter(c.id)} aria-pressed={on}
                      className="flex items-center gap-1.5 px-3 min-h-[40px] rounded-full text-[13px] font-bold"
                      style={{ backgroundColor: on ? N : GL, color: on ? W : N, border: `1.5px solid ${on ? N : BD}` }}>
                      {c.nombre}
                    </button>
                  )
                })}
              </div>
            </div>
          </div>
        )}

        <div className="px-4 pt-4">
          <button onClick={() => setSoloDisponibles(v => !v)} aria-pressed={soloDisponibles}
            className="flex items-center gap-2 min-h-[44px] px-3.5 rounded-2xl text-sm font-bold w-full"
            style={{ backgroundColor: soloDisponibles ? GL : W, color: N, border: `1.5px solid ${soloDisponibles ? G : BD}` }}>
            <span aria-hidden="true">{soloDisponibles ? '✅' : '🕒'}</span>
            <span className="flex-1 text-left">Solo disponibles ahora</span>
            <span className="text-xs font-semibold" style={{ color: MU }}>{soloDisponibles ? 'Activado' : 'Ver todos'}</span>
          </button>
        </div>

        <div className="px-4 pt-5 pb-4">
          <SectionTitle right={!tecnicos.loading && <span className="text-sm font-semibold" style={{ color: GD }}>{visible.length} {visible.length === 1 ? 'técnico' : 'técnicos'}</span>}>
            Técnicos cerca de ti
          </SectionTitle>
          {tecnicos.loading && <div className="space-y-3"><SkeletonCard /><SkeletonCard /></div>}
          {tecnicos.error && (
            <div className="space-y-2"><ErrorBox msg={tecnicos.error} />
              <button onClick={tecnicos.reload} className="min-h-[44px] text-sm font-bold underline" style={{ color: GD }}>Reintentar</button></div>
          )}
          {!tecnicos.loading && !tecnicos.error && visible.length === 0 && (
            <p className="text-sm text-center py-10" style={{ color: MU }}>
              {tecnicos.data.length === 0 ? 'Aún no hay técnicos aprobados disponibles.' : 'No hay técnicos que coincidan con tu búsqueda.'}
            </p>
          )}
          <div className="space-y-3">
            {visible.map(w => (
              <Card key={w.id} className="p-4">
                <div className="flex items-start gap-3">
                  <div className="w-14 h-14 rounded-2xl overflow-hidden flex-shrink-0"><Avatar w={w} /></div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="font-extrabold text-base leading-tight" style={{ color: N }}>{w.name}</div>
                        <div className="text-sm mt-0.5" style={{ color: MU }}>{w.trade}</div>
                        <span className="inline-flex items-center gap-1 mt-1 text-[10px] font-extrabold px-2 py-0.5 rounded-full"
                          style={{ backgroundColor: w.disponibleAhora ? GL : '#F3F4F6', color: w.disponibleAhora ? '#065F46' : '#4B5563' }}>
                          <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: w.disponibleAhora ? G : '#9CA3AF' }} />
                          {w.disponibleAhora ? 'Disponible ahora' : 'Ocupado'}
                        </span>
                      </div>
                      <div className="flex items-center gap-1 flex-shrink-0">
                        {puedeSolicitar && <FavoriteButton tecnicoId={w.id} />}
                        {w.verified && <VBadge />}
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 mt-2">
                      {w.reviews > 0
                        ? <><Stars r={w.rating} size={12} /><span className="text-sm font-bold" style={{ color: N }}>{w.rating.toFixed(1)}</span>
                            <span className="text-sm" style={{ color: MU }}>({w.reviews})</span></>
                        : <span className="text-sm" style={{ color: MU }}>Sin reseñas aún</span>}
                    </div>
                    <div className="flex flex-wrap gap-x-2 mt-1 text-xs" style={{ color: MU }}>
                      {w.neighborhood && <span>📍 {w.neighborhood}</span>}
                      <span>· {w.jobs} trabajos</span><span>· {w.years} años</span>
                    </div>
                  </div>
                </div>
                <div className="flex items-center justify-between gap-3 mt-3 pt-3 border-t" style={{ borderColor: BD }}>
                  <div>
                    <div className="text-xs" style={{ color: MU }}>desde</div>
                    <div className="text-base font-extrabold" style={{ color: GD }}>{fmt(w.priceMin)}</div>
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => { setWorker(w); go('worker') }} className="min-h-[44px] text-[13px] font-bold px-4 rounded-2xl border"
                      style={{ borderColor: BD, color: N, backgroundColor: W }}>Ver perfil</button>
                    {puedeSolicitar && (
                      <button onClick={() => { setWorker(w); go('request') }} className="min-h-[44px] text-[13px] font-extrabold px-4 rounded-2xl"
                        style={{ backgroundColor: G, color: N }}>Contactar</button>
                    )}
                  </div>
                </div>
              </Card>
            ))}
          </div>
        </div>
      </div>
      <BottomNav active="home" go={go} />
    </div>
  )
}

/* ═════════ Perfil del técnico ═════════ */
function WorkerScreen({ worker: w, perfil, go }: { worker: WorkerType; perfil: Perfil; go: NavFn }) {
  const disp = useData(() => getDisponibilidades(w.id), [w.id], [] as Disponibilidad[])
  const horario = disp.data.map(d => `${DIAS[d.dia_semana % 7]} ${d.hora_inicio.slice(0, 5)}–${d.hora_fin.slice(0, 5)}`).join(' · ')
  const rows: [string, string][] = [
    ['💰 Tarifa', `${fmt(w.priceMin)} – ${fmt(w.priceMax)} COP`],
    ['📍 Barrio', w.neighborhood ? `${w.neighborhood}, Pasto` : 'No especificado'],
    ['📅 Horario', disp.loading ? 'Cargando…' : horario || 'A convenir'],
    ['🔒 Verificación', w.verified ? 'Identidad verificada' : 'En proceso de verificación'],
  ]
  return (
    <div className="flex flex-col h-full" style={{ backgroundColor: BG }}>
      <div className="flex-1 min-h-0 overflow-y-auto" style={{ scrollbarWidth: 'none' }}>
        <div className="relative h-36 flex-shrink-0" style={{ background: `linear-gradient(135deg, ${N} 0%, #0A0A55 100%)` }}>
          <button onClick={() => go('home')} aria-label="Volver" className="absolute top-2 left-3 w-11 h-11 rounded-full flex items-center justify-center"
            style={{ backgroundColor: 'rgba(255,255,255,0.14)' }}>
            <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true"><path d="M12 4l-6 6 6 6" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </button>
          <div className="absolute left-4 -bottom-9 w-[72px] h-[72px] rounded-3xl overflow-hidden" style={{ boxShadow: `0 0 0 4px ${BG}` }}><Avatar w={w} /></div>
        </div>
        <div className="px-4 pt-12 pb-6">
          <div className="flex items-start justify-between gap-3 mb-2">
            <div className="min-w-0">
              <h2 className="text-xl font-extrabold leading-tight" style={{ color: N }}>{w.name}</h2>
              <p className="text-sm mt-0.5" style={{ color: MU }}>{w.trade}{w.neighborhood && ` · 📍 ${w.neighborhood}`}</p>
            </div>
            <div className="flex items-center gap-1 flex-shrink-0">
              {perfil.rol === 'cliente' && <FavoriteButton tecnicoId={w.id} />}
              {w.verified && <VBadge />}
            </div>
          </div>
          <div className="flex items-center gap-2 mb-4 min-h-[24px]">
            {w.reviews > 0
              ? <><Stars r={w.rating} size={14} /><span className="text-base font-extrabold" style={{ color: N }}>{w.rating.toFixed(1)}</span>
                  <span className="text-sm" style={{ color: MU }}>({w.reviews} reseñas)</span></>
              : <span className="text-sm" style={{ color: MU }}>Sin reseñas aún</span>}
          </div>
          {w.description && <p className="text-sm leading-relaxed mb-5" style={{ color: N }}>{w.description}</p>}
          <div className="grid grid-cols-3 gap-2.5 mb-5">
            {[[w.reviews > 0 ? w.rating.toFixed(1) : '—', 'Rating'], [String(w.jobs), 'Trabajos'], [String(w.years), 'Años']].map(([v, l]) => (
              <div key={l} className="rounded-2xl py-3 text-center" style={{ backgroundColor: W, border: `1px solid ${BD}` }}>
                <div className="font-extrabold text-lg" style={{ color: N }}>{v}</div>
                <div className="text-xs mt-0.5" style={{ color: MU }}>{l}</div>
              </div>
            ))}
          </div>
          <InfoRows rows={rows} />
        </div>
      </div>
      {perfil.rol === 'cliente' && (
        <div className="flex-shrink-0 px-4 pt-3 border-t" style={{ backgroundColor: W, borderColor: BD, paddingBottom: 'max(12px, env(safe-area-inset-bottom))' }}>
          <PrimaryBtn onClick={() => go('request')}>Solicitar servicio</PrimaryBtn>
        </div>
      )}
    </div>
  )
}

/* ═════════ Solicitud ═════════ */
/** Selector de método de pago reutilizado al crear la solicitud y al terminarla. */
function MetodoPagoGrid({ sel, onSelect }: { sel: MetodoPago | null; onSelect: (m: MetodoPago) => void }) {
  return (
    <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Método de pago">
      {METODOS.map((m, i) => {
        const on = sel === m.id
        const diferido = metodoDiferido(m.id)
        return (
          <button key={m.id} type="button" role="radio" aria-checked={on} aria-disabled={diferido}
            disabled={diferido} onClick={() => onSelect(m.id)}
            className={`min-h-[64px] rounded-2xl border px-3 py-2.5 text-left transition-all ${i === METODOS.length - 1 ? 'col-span-2' : ''}`}
            style={{ borderColor: on ? G : BD, backgroundColor: diferido ? '#F3F4F6' : on ? GL : W, opacity: diferido ? 0.65 : 1, boxShadow: on ? `0 0 0 1.5px ${G}50` : undefined }}>
            <div className="flex items-center gap-2">
              <span className="text-lg leading-none" aria-hidden="true">{m.icono}</span>
              <span className="text-[13px] font-extrabold leading-tight" style={{ color: N }}>{m.nombre}</span>
              {diferido && <span className="ml-auto text-[9px] font-extrabold px-1.5 py-0.5 rounded-full" style={{ backgroundColor: '#E5E7EB', color: '#4B5563' }}>Pronto</span>}
            </div>
            <div className="text-[11px] mt-1 leading-tight" style={{ color: MU }}>{m.descripcion}</div>
          </button>
        )
      })}
    </div>
  )
}

function RequestScreen({ worker: w, perfil, go, onCreated }: { worker: WorkerType; perfil: Perfil; go: NavFn; onCreated: (metodo: MetodoPago) => void }) {
  const [form, setForm] = useState({ name: perfil.nombre, phone: perfil.telefono ?? '', address: '', date: '', desc: '' })
  const [metodoPago, setMetodoPago] = useState<MetodoPago | null>(null)
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')
  const infoPago = metodoPagoInfo(metodoPago)

  const enviar = async () => {
    setMessage('')
    const phone = normCel(form.phone)
    if (form.name.trim().length < 3) return setMessage('Ingresa tu nombre completo.')
    if (!phone) return setMessage('Ingresa un celular colombiano válido (10 dígitos, empieza por 3).')
    const direccion = form.address.trim()
    if (direccion.length < 8) return setMessage('Ingresa la dirección de tu residencia (mínimo 8 caracteres) para que el técnico pueda llegar.')
    if (!form.date || form.date < todayLocal()) return setMessage('Elige una fecha de hoy en adelante.')
    if (form.date > fechaMax()) return setMessage('La fecha no puede ser a más de un año.')
    if (form.desc.trim().length < 10) return setMessage('Describe el trabajo con al menos 10 caracteres.')
    if (!metodoPago) return setMessage('Selecciona cómo vas a pagar el servicio.')

    setLoading(true)
    try {
      // El método de pago se guarda con la solicitud; ya no se pregunta solo al final.
      await crearSolicitud({ clienteId: perfil.id, tecnicoId: w.id, nombre: form.name.trim(), telefono: phone, direccion, fecha: form.date, descripcion: form.desc.trim(), metodoPago })
      onCreated(metodoPago)
    } catch (e) {
      console.error(e); setMessage(errMsg(e))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex flex-col h-full" style={{ backgroundColor: BG }}>
      <DarkHeader onBack={() => go('worker')} backLabel="← Volver al perfil">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-2xl overflow-hidden flex-shrink-0" style={{ border: `2px solid ${G}50` }}><Avatar w={w} /></div>
          <div className="flex-1">
            <div className="font-extrabold text-white text-sm">{w.name}</div>
            <div className="text-xs" style={{ color: 'rgba(255,255,255,0.55)' }}>{w.trade}</div>
            <div className="text-xs font-bold mt-0.5" style={{ color: G }}>{fmt(w.priceMin)} – {fmt(w.priceMax)} COP</div>
          </div>
        </div>
      </DarkHeader>
      <div className="flex-1 overflow-y-auto px-4 pt-4 pb-safe space-y-3" style={{ scrollbarWidth: 'none' }}>
        <Field label="Nombre completo *">
          <input type="text" value={form.name} autoComplete="name" autoCapitalize="words" maxLength={60} onChange={e => setForm({ ...form, name: soloNombre(e.target.value) })} className={INPUT} style={INPUT_STYLE} />
        </Field>
        <Field label="Celular de contacto *">
          <input type="tel" inputMode="numeric" pattern="[0-9]*" autoComplete="tel-national" maxLength={12} value={form.phone} onChange={e => setForm({ ...form, phone: soloDigitos(e.target.value, 12) })}
            className={INPUT} style={INPUT_STYLE} />
        </Field>
        <Field label="Dirección de residencia *">
          <input type="text" autoComplete="street-address" autoCapitalize="words" maxLength={150} value={form.address} onChange={e => setForm({ ...form, address: soloDireccion(e.target.value) })}
            className={INPUT} style={INPUT_STYLE} />
          <p className="text-xs mt-1" style={{ color: MU }}>El técnico la usará para llegar a tu domicilio. Incluye barrio y, si aplica, casa o apartamento.</p>
        </Field>
        <Field label="Fecha preferida *">
          <input type="date" value={form.date} min={todayLocal()} max={fechaMax()} onChange={e => setForm({ ...form, date: e.target.value })} className={INPUT} style={INPUT_STYLE} />
        </Field>
        <Field label="Describe el trabajo o problema *">
          <textarea rows={4} maxLength={1000} value={form.desc} onChange={e => setForm({ ...form, desc: e.target.value })}
            className={`${INPUT} resize-none`} style={INPUT_STYLE} />
        </Field>
        <Field label="¿Cómo vas a pagar? *">
          <MetodoPagoGrid sel={metodoPago} onSelect={m => { setMetodoPago(m); setMessage('') }} />
          {infoPago && (
            <div className="mt-2 rounded-2xl px-3.5 py-3" style={{ backgroundColor: GL, border: `1px solid ${G}50` }}>
              <p className="text-xs leading-relaxed" style={{ color: N }}>{infoPago.instruccionCliente}</p>
              {infoPago.requierePasarela && (
                <p className="text-[11px] font-bold mt-1.5" style={{ color: '#92400E' }}>
                  Disponible cuando Resolve active pagos reales
                </p>
              )}
            </div>
          )}
        </Field>
        <div className="flex items-center gap-2.5 px-3.5 py-3 rounded-2xl" style={{ backgroundColor: GL, border: `1px solid ${G}40` }}>
          <span>💰</span>
          <span className="text-xs" style={{ color: '#065F46' }}>Tarifa de referencia: <strong>{fmt(w.priceMin)} – {fmt(w.priceMax)} COP</strong>. El precio final lo acuerdas con el técnico.</span>
        </div>
        <ErrorBox msg={message} />
        <PrimaryBtn onClick={enviar} disabled={loading}>{loading ? 'Enviando…' : 'Enviar solicitud →'}</PrimaryBtn>
      </div>
    </div>
  )
}

function ConfirmScreen({ worker: w, metodoPago, go }: { worker: WorkerType; metodoPago: MetodoPago | null; go: NavFn }) {
  const pago = metodoPagoInfo(metodoPago)
  return (
    <div className="flex flex-col h-full px-5 pt-6 overflow-y-auto" style={{ backgroundColor: BG, scrollbarWidth: 'none', paddingBottom: 'max(20px, env(safe-area-inset-bottom))' }}>
      <div className="flex-1 flex flex-col items-center justify-center text-center py-6">
        <SuccessMark />
        <h2 className="text-2xl font-extrabold mb-2" style={{ color: N }}>¡Solicitud enviada!</h2>
        <p className="text-base leading-relaxed mb-6" style={{ color: MU }}>
          <strong style={{ color: N }}>{w.name}</strong> recibirá tu solicitud al instante y te contactará al celular que indicaste. Sigue el estado en <strong style={{ color: N }}>Solicitudes</strong>.
        </p>
        <Card className="flex items-center gap-3 p-4 w-full text-left">
          <div className="w-12 h-12 rounded-2xl overflow-hidden flex-shrink-0"><Avatar w={w} /></div>
          <div className="flex-1 min-w-0">
            <div className="text-base font-extrabold" style={{ color: N }}>{w.name}</div>
            <div className="text-sm" style={{ color: MU }}>{w.trade}{w.neighborhood && ` · ${w.neighborhood}`}</div>
          </div>
        </Card>
        <div className="mt-3 w-full rounded-2xl p-4 text-left" style={{ backgroundColor: W, border: `1px solid ${BD}` }}>
          <div className="text-xs font-extrabold uppercase tracking-wider mb-1" style={{ color: GD }}>💳 Método de pago</div>
          <div className="flex items-center gap-2">
            <span className="text-xl leading-none" aria-hidden="true">{pago?.icono ?? '💳'}</span>
            <div className="min-w-0">
              <p className="text-sm font-extrabold" style={{ color: N }}>{pago?.nombre ?? 'Por definir'}</p>
              <p className="text-xs" style={{ color: MU }}>{pago?.descripcion ?? 'Podrás elegirlo más adelante.'}</p>
            </div>
          </div>
        </div>
      </div>
      <div className="space-y-2.5">
        <PrimaryBtn onClick={() => go('orders')}>Ver mis solicitudes</PrimaryBtn>
        <SecondaryBtn onClick={() => go('home')}>Volver al inicio</SecondaryBtn>
      </div>
    </div>
  )
}

/* ═════════ Solicitudes (cliente y técnico) ═════════ */
function StatusBadge({ estado }: { estado: string }) {
  const st = ESTADO[estado] ?? { label: estado, bg: '#F3F4F6', color: '#4B5563' }
  return <span className="text-[11px] font-bold px-2.5 py-1 rounded-full whitespace-nowrap" style={{ backgroundColor: st.bg, color: st.color }}>{st.label}</span>
}

/** Punto "En vivo" / "Reconectando…" para que el usuario sepa si lo que ve se actualiza solo. */
function LiveDot({ ok }: { ok: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] font-bold px-2.5 py-1 rounded-full" role="status"
      style={{ backgroundColor: 'rgba(255,255,255,0.10)', color: ok ? G : '#FBBF24' }}>
      <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: ok ? G : '#FBBF24', animation: ok ? 'pulse-dot 2s ease-in-out infinite' : undefined }} />
      {ok ? 'En vivo' : 'Reconectando…'}
    </span>
  )
}

const ROL_TXT: Record<string, string> = { cliente: 'Cliente', tecnico: 'Técnico', admin: 'Admin', sistema: 'Sistema' }
const fechaHora = (iso: string) => new Date(iso).toLocaleString('es-CO', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })

function textoEvento(e: SolicitudEvento): string {
  switch (e.tipo) {
    case 'creada': return 'Solicitud creada'
    case 'asignada': return `Asignada a ${String(e.detalle.tecnico_nombre ?? 'un técnico')}`
    case 'estado_cambiado': return `Estado: ${ESTADO[e.estadoNuevo ?? '']?.label ?? e.estadoNuevo}`
    case 'precio_actualizado': {
      const n = e.detalle.precio_nuevo == null ? NaN : Number(e.detalle.precio_nuevo)
      return Number.isFinite(n) ? `Precio final: ${fmt(n)}` : 'Precio actualizado'
    }
    case 'diagnostico_registrado': return 'Diagnóstico registrado'
    case 'calificada': return 'Servicio calificado'
  }
}

/** Línea de tiempo de auditoría: qué pasó, quién lo hizo y cuándo. Se recarga con cada cambio en vivo. */
function Historial({ id }: { id: number }) {
  const { version } = useContext(LiveCtx)
  const h = useData(() => getHistorial(id), [id, version], [] as SolicitudEvento[])
  if (h.loading && h.data.length === 0) return <Loading text="Cargando historial…" />
  if (h.error) return <ErrorBox msg={h.error} />
  if (h.data.length === 0) return <p className="text-xs py-2" style={{ color: MU }}>Sin eventos registrados.</p>
  return (
    <ol className="mt-3 pt-3 space-y-3" style={{ borderTop: `1px dashed ${BD}` }}>
      {h.data.map((e, i) => (
        <li key={e.id} className="flex gap-3">
          <span className="flex flex-col items-center pt-1.5" aria-hidden="true">
            <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: i === h.data.length - 1 ? G : BD }} />
            {i < h.data.length - 1 && <span className="flex-1 w-px mt-1" style={{ backgroundColor: BD }} />}
          </span>
          <div className="min-w-0 pb-0.5">
            <div className="text-[13px] font-bold" style={{ color: N }}>{textoEvento(e)}</div>
            <div className="text-[11px]" style={{ color: MU }}>{e.actorNombre} ({ROL_TXT[e.actorRol] ?? e.actorRol}) · {fechaHora(e.creadoEn)}</div>
          </div>
        </li>
      ))}
    </ol>
  )
}

function AccionBtn({ label, onClick, disabled, primary }: { label: string; onClick: () => void; disabled?: boolean; primary?: boolean }) {
  return (
    <button disabled={disabled} onClick={onClick} className="flex-1 min-h-[44px] px-4 rounded-2xl text-[13px] font-extrabold border"
      style={primary ? { backgroundColor: G, color: N, borderColor: G, opacity: disabled ? 0.6 : 1 }
                     : { borderColor: BD, color: N, backgroundColor: W, opacity: disabled ? 0.6 : 1 }}>{label}</button>
  )
}

function FilaDato({ l, children }: { l: string; children: ReactNode }) {
  return (
    <div className="flex gap-3 text-sm">
      <span className="w-[84px] flex-shrink-0" style={{ color: MU }}>{l}</span>
      <span className="font-semibold min-w-0 break-words" style={{ color: N }}>{children}</span>
    </div>
  )
}

/** Lo que el técnico necesita para ir al domicilio. Solo se muestra DESPUÉS de aceptar. */
function DatosServicio({ p, onNavigate }: { p: Pedido; onNavigate?: () => void }) {
  return (
    <div className="mt-3 rounded-2xl p-3.5 space-y-2.5" style={{ backgroundColor: GL, border: `1px solid ${G}55` }}>
      <div className="text-xs font-extrabold uppercase tracking-wider" style={{ color: GD }}>Datos del servicio</div>
      <FilaDato l="Cliente">{p.nombreContacto}</FilaDato>
      <FilaDato l="Celular"><a href={`tel:${p.telefonoContacto}`} className="underline">{p.telefonoContacto}</a></FilaDato>
      <FilaDato l="Dirección">{p.direccion ?? 'No registrada (solicitud anterior)'}</FilaDato>
      <FilaDato l="Fecha">{new Date(p.fecha + 'T00:00:00').toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long' })}</FilaDato>
      <FilaDato l="Servicio">{p.descripcion}</FilaDato>
      {p.precioFinal != null
        ? <FilaDato l="Precio final">{fmt(p.precioFinal)}</FilaDato>
        : p.precioMin != null && p.precioMax != null && <FilaDato l="Referencia">{fmt(p.precioMin)} – {fmt(p.precioMax)}</FilaDato>}
      {p.direccion && (
        onNavigate ? (
          /*
           * El clic abre la ruta en Google Maps y, al mismo tiempo, registra
           * `en_camino` en el servidor. Así el cliente ve "Técnico dirigiéndose
           * a su domicilio" sin que el técnico tenga que tocar otro botón.
           */
          <a href={urlGoogleMaps(p.direccion)} target="_blank" rel="noopener noreferrer" onClick={onNavigate}
            className="flex items-center justify-center gap-2 min-h-[48px] rounded-2xl text-sm font-extrabold text-center px-3" style={{ backgroundColor: N, color: W }}>
            🧭 Usar Google Maps para ir al domicilio
          </a>
        ) : (
          <a href={urlGoogleMaps(p.direccion)} target="_blank" rel="noopener noreferrer"
            className="flex items-center justify-center gap-2 min-h-[48px] rounded-2xl text-sm font-extrabold" style={{ backgroundColor: N, color: W }}>
            📍 Cómo llegar en Google Maps
          </a>
        )
      )}
    </div>
  )
}

/** Secuencia que ve el cliente desde que el técnico acepta hasta que llega. */
function SeguimientoCliente({ p }: { p: Pedido }) {
  const prog = progresoCliente(p.estado)
  if (!prog.aceptado) return null
  const pasos = [
    { label: 'Técnico aceptó tu solicitud', hecho: prog.aceptado },
    { label: 'Técnico dirigiéndose a su domicilio', hecho: prog.enCamino },
    { label: 'Técnico llegó', hecho: prog.llego },
  ]
  return (
    <div className="mt-3 rounded-2xl p-3.5" style={{ backgroundColor: W, border: `1px solid ${BD}` }}>
      <div className="text-xs font-extrabold uppercase tracking-wider mb-2" style={{ color: N }}>Seguimiento del servicio</div>
      <ol className="space-y-2.5">
        {pasos.map((paso, i) => (
          <li key={paso.label} className="flex items-center gap-2.5">
            <span className="w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 text-[11px] font-extrabold"
              style={{ backgroundColor: paso.hecho ? G : '#EEF2EE', color: paso.hecho ? N : MU }}>
              {paso.hecho ? '✓' : i + 1}
            </span>
            <span className="text-sm font-semibold" style={{ color: paso.hecho ? N : MU }}>{paso.label}</span>
          </li>
        ))}
      </ol>
      {p.estado === 'completada' && <p className="text-xs mt-2.5" style={{ color: GD }}>Servicio terminado. ¡Gracias por usar Resolve!</p>}
    </div>
  )
}

/** Tarjeta que exige la confirmación del cliente antes de que el servicio avance. */
function ConfirmacionCliente({ p, busy, onConfirmar }: { p: Pedido; busy: boolean; onConfirmar: () => void }) {
  if (!esperaConfirmacionCliente(p.estado)) return null
  return (
    <div className="mt-3 rounded-2xl p-3.5" style={{ backgroundColor: GL, border: `1.5px solid ${G}70` }}>
      <div className="text-xs font-extrabold uppercase tracking-wider mb-1" style={{ color: GD }}>✅ Confirma a tu técnico</div>
      <p className="text-sm leading-relaxed mb-3" style={{ color: N }}>
        <strong>{p.tecnicoNombre}</strong> está disponible para atenderte. Confirma para que pueda dirigirse a tu domicilio.
      </p>
      <AccionBtn primary label={busy ? 'Confirmando…' : 'Confirmar técnico'} disabled={busy} onClick={onConfirmar} />
    </div>
  )
}


function DiagnosticoBox({ pedido, onSaved }: { pedido: Pedido; onSaved: () => void }) {
  const [txt, setTxt] = useState(pedido.diagnostico ?? '')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [ok, setOk] = useState(false)
  // Si llega un diagnóstico nuevo desde el servidor (otro dispositivo), se actualiza el cuadro
  useEffect(() => { setTxt(pedido.diagnostico ?? '') }, [pedido.diagnostico])
  const sinCambios = txt.trim() === (pedido.diagnostico ?? '').trim()

  const guardar = async () => {
    setBusy(true); setMsg(''); setOk(false)
    try { await guardarDiagnostico(pedido.id, txt.trim()); setOk(true); onSaved() }
    catch (e) { console.error(e); setMsg(errMsg(e)) }
    finally { setBusy(false) }
  }
  return (
    <div className="mt-3 rounded-2xl p-3.5" style={{ backgroundColor: W, border: `1.5px solid ${BD}` }}>
      <label htmlFor={`diag-${pedido.id}`} className="text-xs font-extrabold uppercase tracking-wider block mb-1" style={{ color: N }}>🩺 Diagnóstico del daño</label>
      <p className="text-xs mb-2" style={{ color: MU }}>Cuéntale al cliente qué encontraste y qué se necesita. Él lo verá en su solicitud.</p>
      <textarea id={`diag-${pedido.id}`} rows={4} maxLength={1000} value={txt} onChange={e => { setTxt(e.target.value); setOk(false) }}
        placeholder="Ej: La fuga viene del sifón del lavamanos; se necesita cambiar la pieza y sellar la unión…"
        className={`${INPUT} resize-none`} style={INPUT_STYLE} />
      <div className="flex items-center justify-between text-xs mt-1 mb-2" style={{ color: MU }}>
        <span>{txt.trim().length < 10 ? 'Mínimo 10 caracteres' : ' '}</span><span>{txt.length}/1000</span>
      </div>
      <ErrorBox msg={msg} />
      {ok && <ErrorBox ok msg="Diagnóstico guardado. El cliente ya puede verlo." />}
      <div className="mt-2"><PrimaryBtn onClick={guardar} disabled={busy || txt.trim().length < 10 || sinCambios}>{busy ? 'Guardando…' : pedido.diagnostico ? 'Actualizar diagnóstico' : 'Guardar diagnóstico'}</PrimaryBtn></div>
    </div>
  )
}

/** Lo que ve el cliente: el diagnóstico del técnico, para darle tranquilidad. */
function DiagnosticoVista({ p }: { p: Pedido }) {
  if (!p.diagnostico) return null
  return (
    <div className="mt-3 rounded-2xl p-3.5" style={{ backgroundColor: GL, border: `1px solid ${G}55` }}>
      <div className="text-xs font-extrabold uppercase tracking-wider mb-1" style={{ color: GD }}>🩺 Diagnóstico del técnico</div>
      <p className="text-sm leading-relaxed whitespace-pre-wrap" style={{ color: N }}>{p.diagnostico}</p>
      {p.diagnosticoEn && <p className="text-xs mt-1.5" style={{ color: MU }}>Registrado el {fechaHora(p.diagnosticoEn)}</p>}
    </div>
  )
}

/** Lo que el cliente calificó, visible para el técnico. */
function CalificacionRecibida({ c }: { c: NonNullable<Pedido['calificacionCliente']> }) {
  return (
    <div className="mt-3 rounded-2xl p-3.5" style={{ backgroundColor: W, border: `1px solid ${BD}` }}>
      <div className="text-xs font-extrabold uppercase tracking-wider mb-1.5" style={{ color: N }}>Calificación del cliente</div>
      <div className="flex items-center gap-2 mb-1"><Stars r={c.puntuacion} size={14} /><span className="text-sm font-bold" style={{ color: N }}>{c.puntuacion}/5</span></div>
      <p className="text-xs" style={{ color: MU }}>Puntualidad {c.puntualidad}/5 · Trato {c.trato}/5 · Cumplimiento {c.cumplimiento}/5</p>
      {c.comentario && <p className="text-sm mt-2 leading-relaxed" style={{ color: N }}>“{c.comentario}”</p>}
    </div>
  )
}

const PAGO_COLOR: Record<string, { bg: string; color: string }> = {
  pendiente: { bg: '#FEF3C7', color: '#92400E' },
  pendiente_pasarela: { bg: '#DBEAFE', color: '#1D4ED8' },
  pagado: { bg: GL, color: '#065F46' },
  efectivo: { bg: GL, color: '#065F46' },
  cancelado: { bg: '#F3F4F6', color: '#4B5563' },
}

function PagoBadge({ estado }: { estado: string }) {
  const c = PAGO_COLOR[estado] ?? PAGO_COLOR.pendiente
  return (
    <span className="text-[11px] font-bold px-2.5 py-1 rounded-full whitespace-nowrap" style={{ backgroundColor: c.bg, color: c.color }}>
      {etiquetaEstadoPago(estado)}
    </span>
  )
}

/**
 * Pago del servicio.
 *
 * El método se elige al CREAR la solicitud y se guarda en la solicitud; esta
 * tarjeta lo muestra durante todo el flujo. Cuando el servicio termina, el
 * cliente todavía puede cambiarlo (la RPC del servidor solo lo permite en
 * `completada`), y si es tarjeta/Google Pay se intenta el cobro automático.
 * El técnico ve el método y su estado, nunca datos bancarios del cliente.
 */
function PagoBox({ pedido, onSaved, onAbrirChat }: { pedido: Pedido; onSaved: () => void; onAbrirChat?: () => void }) {
  const [sel, setSel] = useState<MetodoPago | null>(pedido.metodoPago)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [ok, setOk] = useState('')
  const info = metodoPagoInfo(sel)
  const infoGuardado = metodoPagoInfo(pedido.metodoPago)
  const yaGuardado = sel !== null && sel === pedido.metodoPago
  const bruto = pedido.precioFinal ?? pedido.precioMax ?? pedido.precioMin
  const descuento = pedido.precioFinal != null
    ? Math.min(pedido.precioFinal, (pedido.descuentoCentavos ?? 0) / 100)
    : 0
  const total = bruto != null ? Math.max(0, bruto - descuento) : null
  const pagado = pedido.pagoEstado === 'pagado'
  const elegible = puedeElegirMetodoPago(pedido.estado, pedido.pagoEstado)

  // Si el método cambia desde otro dispositivo, se refleja aquí.
  useEffect(() => { setSel(pedido.metodoPago) }, [pedido.metodoPago])

  if (!elegible && !pedido.metodoPago) return null

  const confirmar = async () => {
    if (!sel) return setMsg('Selecciona un método de pago.')
    const err = validarSeleccionMetodo(sel, pedido.estado, pedido.pagoEstado)
    if (err) return setMsg(err)
    setBusy(true); setMsg(''); setOk('')
    try {
      await registrarMetodoPago(pedido.id, sel)
      setOk(sel === 'efectivo'
        ? 'Pago en efectivo guardado. El técnico lo confirmará al recibirlo.'
        : 'Método de pago guardado. El técnico ya puede verlo y confirmará cuando reciba el dinero.')
      onSaved()
    } catch (e) {
      console.error(e); setMsg(errMsg(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mt-3 rounded-2xl p-4" style={{ backgroundColor: W, border: `1.5px solid ${G}70`, boxShadow: '0 4px 18px rgba(46,223,45,0.12)' }}>
      <div className="flex items-start justify-between gap-2 mb-1">
        <div>
          <div className="text-xs font-extrabold uppercase tracking-wider" style={{ color: GD }}>💳 Pago del servicio</div>
          <div className="text-lg font-extrabold mt-0.5" style={{ color: N }}>
            {total != null ? fmt(total) : 'Precio a acordar'}
          </div>
          <div className="text-[11px]" style={{ color: MU }}>{pedido.precioFinal != null ? 'Total acordado con el técnico' : 'Tarifa de referencia'}</div>
          {descuento > 0 && (
            <div className="text-[11px] font-bold mt-0.5" style={{ color: GD }}>
              Cupón{pedido.cuponCodigo ? ` ${pedido.cuponCodigo}` : ''} · −{fmt(descuento)}
            </div>
          )}
        </div>
        {pedido.metodoPago && <PagoBadge estado={pedido.pagoEstado} />}
      </div>

      {pagado ? (
        <div className="mt-3 rounded-2xl px-3.5 py-3" style={{ backgroundColor: GL, border: `1px solid ${G}50` }}>
          <p className="text-sm font-bold" style={{ color: '#065F46' }}>✓ Pago confirmado</p>
          <p className="text-xs mt-0.5" style={{ color: MU }}>{metodoPagoInfo(pedido.metodoPago)?.nombre ?? 'Pago'} · {etiquetaEstadoPago(pedido.pagoEstado)}</p>
        </div>
      ) : !elegible ? (
        /* Antes de terminar el servicio solo se muestra lo elegido al crear la solicitud. */
        <div className="mt-2 rounded-2xl px-3.5 py-3" style={{ backgroundColor: '#F7FAF7', border: `1px solid ${BD}` }}>
          <p className="text-xs font-extrabold uppercase tracking-wider mb-1" style={{ color: MU }}>Método elegido</p>
          <div className="flex items-center gap-2">
            <span className="text-xl leading-none" aria-hidden="true">{infoGuardado?.icono ?? '💳'}</span>
            <div className="min-w-0">
              <p className="text-sm font-extrabold" style={{ color: N }}>{infoGuardado?.nombre ?? pedido.metodoPago}</p>
              <p className="text-xs" style={{ color: MU }}>{etiquetaEstadoPago(pedido.pagoEstado)}</p>
            </div>
          </div>
          {infoGuardado && <p className="text-xs mt-2 leading-relaxed" style={{ color: MU }}>{infoGuardado.instruccionCliente}</p>}
          {infoGuardado?.grupo === 'transferencia' && onAbrirChat && (
            <button onClick={onAbrirChat} className="mt-2 min-h-[44px] px-3.5 rounded-xl text-xs font-extrabold" style={{ backgroundColor: N, color: W }}>
              💬 Pedirle los datos al técnico
            </button>
          )}
          <p className="text-[11px] mt-2" style={{ color: MU }}>Podrás cambiarlo cuando el servicio esté terminado.</p>
        </div>
      ) : (
        <>
          <p className="text-xs mt-1 mb-3" style={{ color: MU }}>Método elegido al crear la solicitud. Puedes cambiarlo hasta que el pago se confirme.</p>

          <MetodoPagoGrid sel={sel} onSelect={m => { setSel(m); setMsg(''); setOk('') }} />

          {info && (
            <div className="mt-3 rounded-2xl px-3.5 py-3" style={{ backgroundColor: '#F7FAF7', border: `1px solid ${BD}` }}>
              <p className="text-xs leading-relaxed" style={{ color: N }}>{info.instruccionCliente}</p>
              {info.requierePasarela && (
                <p className="text-[11px] font-bold mt-1.5" style={{ color: '#92400E' }}>
                  Disponible cuando Resolve active pagos reales
                </p>
              )}
              {info.grupo === 'transferencia' && onAbrirChat && (
                <button onClick={onAbrirChat} className="mt-2 min-h-[44px] px-3.5 rounded-xl text-xs font-extrabold" style={{ backgroundColor: N, color: W }}>
                  💬 Pedirle los datos al técnico
                </button>
              )}
            </div>
          )}

          <ErrorBox msg={msg} />
          {ok && <div className="mt-2"><ErrorBox ok msg={ok} /></div>}
          <div className="mt-3">
            <PrimaryBtn onClick={confirmar} disabled={busy || !sel}>
              {busy ? 'Guardando…' : yaGuardado ? 'Método guardado · actualizar' : 'Confirmar método de pago'}
            </PrimaryBtn>
          </div>
          <p className="text-[11px] text-center mt-2" style={{ color: MU }}>
            El técnico verá el método y su estado, nunca tus datos bancarios.
          </p>
        </>
      )}
      {elegible && <CuponBox pedido={pedido} onApplied={onSaved} />}
    </div>
  )
}

/** Lo que ve el técnico: método elegido por el cliente y estado del pago (sin datos sensibles). */
function PagoResumenTecnico({ p, onSaved }: { p: Pedido; onSaved?: () => void }) {
  const info = metodoPagoInfo(p.metodoPago)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [ok, setOk] = useState('')
  const puedeConfirmar = p.estado === 'completada' && p.pagoEstado !== 'pagado' &&
    p.pagoEstado !== 'cancelado' && !!info && !info.requierePasarela

  const confirmar = async () => {
    if (!p.metodoPago) return setMsg('El cliente aún no ha elegido método de pago.')
    setBusy(true); setMsg(''); setOk('')
    try {
      const tx = await registrarPagoInterno(p.id, p.metodoPago)
      setOk(`Pago registrado. Tu neto: ${fmt(tx.netoCentavos / 100)}.`)
      onSaved?.()
    } catch (e) {
      console.error(e); setMsg(errMsg(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mt-3 rounded-2xl p-3.5" style={{ backgroundColor: W, border: `1px solid ${BD}` }}>
      <div className="flex items-center justify-between gap-2 mb-1">
        <div className="text-xs font-extrabold uppercase tracking-wider" style={{ color: N }}>💳 Pago del cliente</div>
        {p.metodoPago && <PagoBadge estado={p.pagoEstado} />}
      </div>
      <p className="text-sm font-bold" style={{ color: N }}>{resumenPagoTecnico(p.metodoPago, p.pagoEstado)}</p>
      {info ? (
        <p className="text-xs mt-1 leading-relaxed" style={{ color: MU }}>{info.instruccionTecnico}</p>
      ) : (
        <p className="text-xs mt-1" style={{ color: MU }}>Todavía no ha elegido cómo pagar. Puedes recordárselo por el chat.</p>
      )}
      {info?.requierePasarela && (
        <p className="text-[11px] font-bold mt-1.5" style={{ color: '#92400E' }}>
          Los pagos con tarjeta están diferidos hasta que Resolve active pagos reales. Pídele al cliente un método manual.
        </p>
      )}
      {puedeConfirmar && (
        <div className="mt-3">
          <ErrorBox msg={msg} />
          {ok && <div className="mb-2"><ErrorBox ok msg={ok} /></div>}
          <PrimaryBtn onClick={confirmar} disabled={busy}>
            {busy ? 'Registrando…' : '✓ Confirmar pago recibido'}
          </PrimaryBtn>
          <p className="text-[11px] text-center mt-2" style={{ color: MU }}>
            Confirma solo cuando ya tengas el dinero. Queda en el historial con la comisión de Resolve.
          </p>
        </div>
      )}
    </div>
  )
}

/**
 * Cierre del servicio en dos pasos.
 *
 *  1. "Finalizar solicitud" abre el diálogo "¿Recibiste el pago?".
 *  2. Solo la respuesta "Sí" habilita el botón que realmente cierra la solicitud.
 *     "No" deja el botón deshabilitado (la solicitud sigue abierta).
 *
 * Si el cliente ya pagó (`pagoEstado === 'pagado'`), la respuesta se da por
 * confirmada para no repetir la pregunta.
 */
function FinalizarSolicitudBox({ p, busy, onFinalizar }: { p: Pedido; busy: boolean; onFinalizar: () => Promise<void> }) {
  const yaPagado = p.pagoEstado === 'pagado'
  const [dialogo, setDialogo] = useState(false)
  const [confirmado, setConfirmado] = useState(yaPagado)
  const [respondioNo, setRespondioNo] = useState(false)

  // Si el pago se registra mientras la tarjeta está abierta, no volvemos a preguntar.
  useEffect(() => {
    if (yaPagado) { setConfirmado(true); setRespondioNo(false) }
  }, [yaPagado])

  const habilitado = puedeFinalizarSolicitud(p.estado, confirmado)

  const responder = (si: boolean) => {
    setDialogo(false)
    setConfirmado(si)
    setRespondioNo(!si)
  }

  return (
    <div className="mt-3 rounded-2xl p-3.5" style={{ backgroundColor: W, border: `1px solid ${BD}` }}>
      <div className="text-xs font-extrabold uppercase tracking-wider mb-1" style={{ color: N }}>Cierre del servicio</div>
      <p className="text-xs leading-relaxed" style={{ color: MU }}>
        {habilitado
          ? 'Pago confirmado. Puedes cerrar la solicitud y quedar disponible para nuevos servicios.'
          : respondioNo
            ? 'No confirmaste el pago. La solicitud seguirá abierta hasta que lo confirmes.'
            : 'Antes de cerrar, confirma que recibiste el pago del cliente.'}
      </p>

      <div className="flex gap-2 mt-3 flex-wrap">
        {habilitado ? (
          <AccionBtn primary label={busy ? 'Finalizando…' : '✓ Finalizar solicitud'} disabled={busy}
            onClick={() => { void onFinalizar() }} />
        ) : respondioNo ? (
          <>
            <AccionBtn label="Finalizar solicitud" disabled onClick={() => {}} />
            <button onClick={() => setDialogo(true)} className="flex-1 min-h-[44px] px-4 rounded-2xl text-[13px] font-extrabold border"
              style={{ borderColor: BD, color: N, backgroundColor: W }}>
              Responder de nuevo
            </button>
          </>
        ) : (
          <AccionBtn primary label="Finalizar solicitud" disabled={busy} onClick={() => setDialogo(true)} />
        )}
      </div>

      {dialogo && (
        <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center p-4"
          role="dialog" aria-modal="true" aria-labelledby={`pago-${p.id}`}>
          <div className="absolute inset-0 dialog-backdrop-in" style={{ backgroundColor: 'rgba(0,0,50,0.55)' }} onClick={() => setDialogo(false)} />
          <div className="relative w-full max-w-[380px] rounded-3xl p-5 dialog-in" style={{ backgroundColor: W, boxShadow: '0 18px 50px rgba(0,0,50,0.35)' }}>
            <h4 id={`pago-${p.id}`} className="text-lg font-extrabold" style={{ color: N }}>¿Recibiste el pago?</h4>
            <p className="text-sm mt-1.5 leading-relaxed" style={{ color: MU }}>
              Confirma solo si el cliente ya te pagó. Al finalizar, la solicitud se cierra y quedas disponible para nuevos servicios.
            </p>
            <div className="flex gap-2 mt-4">
              <button onClick={() => responder(true)} className="flex-1 min-h-[48px] px-4 rounded-2xl text-sm font-extrabold"
                style={{ backgroundColor: G, color: N }}>
                Sí, recibí el pago
              </button>
              <button onClick={() => responder(false)} className="flex-1 min-h-[48px] px-4 rounded-2xl text-sm font-extrabold border"
                style={{ borderColor: BD, color: N, backgroundColor: W }}>
                No
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

/* ═════════ Chat por solicitud ═════════ */
function ChatScreen({ pedido, perfil, go, volver }: { pedido: Pedido; perfil: Perfil; go: NavFn; volver: Screen }) {
  const live = useContext(LiveCtx)
  const estado = useData(() => getEstadoSolicitud(pedido.id), [pedido.id, live.version], pedido.estado)
  const chat = useMensajesEnVivo(pedido.id)
  const [texto, setTexto] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState('')
  const fin = useRef<HTMLDivElement>(null)

  const estadoActual = estado.data ?? pedido.estado
  const acceso = evaluarAccesoChat(estadoActual, chat.data.length > 0)
  const otro = perfil.rol === 'tecnico' ? pedido.nombreContacto : pedido.tecnicoNombre
  const esTec = perfil.rol === 'tecnico'

  useEffect(() => { fin.current?.scrollIntoView({ block: 'end' }) }, [chat.data.length])

  const enviar = async () => {
    if (!acceso.puedeEscribir) return setError(acceso.motivo)
    const err = validarMensaje(texto)
    if (err) return setError(err)
    setEnviando(true); setError('')
    try {
      await enviarMensaje(pedido.id, texto)
      setTexto('')
      chat.refrescar()
    } catch (e) {
      console.error(e); setError(errMsg(e))
    } finally {
      setEnviando(false)
    }
  }

  return (
    <div className="flex flex-col h-full" style={{ backgroundColor: BG }}>
      <DarkHeader onBack={() => go(volver)} backLabel={volver === 'done' ? '← Volver a terminadas' : '← Volver a solicitudes'}>
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-lg font-extrabold text-white leading-tight truncate">{otro}</h2>
            <p className="text-xs mt-0.5 truncate" style={{ color: 'rgba(255,255,255,0.6)' }}>
              Solicitud #{pedido.id} · {esTec ? 'Cliente' : 'Técnico'} · {pedido.descripcion}
            </p>
          </div>
          <LiveDot ok={chat.conectado} />
        </div>
      </DarkHeader>

      <div className="flex-1 min-h-0 flex flex-col">
        {acceso.motivo && (
          <div className="flex-shrink-0 px-4 pt-3">
            <div className="rounded-2xl px-3.5 py-3 text-xs font-semibold" style={{ backgroundColor: acceso.puedeVer ? '#FEF3C7' : '#FEF2F2', color: acceso.puedeVer ? '#92400E' : '#991B1B' }}>
              {acceso.puedeVer ? '🔒 ' : '⚠️ '}{acceso.motivo}
            </div>
          </div>
        )}

        <div className="flex-1 min-h-0 overflow-y-auto px-4 py-4 space-y-3" style={{ scrollbarWidth: 'none' }}>
          {chat.loading && chat.data.length === 0 && <Loading text="Cargando mensajes…" />}
          {chat.error && (
            <div className="space-y-2">
              <ErrorBox msg={chat.error} />
              <button onClick={chat.refrescar} className="min-h-[44px] text-sm font-bold underline" style={{ color: GD }}>Reintentar</button>
            </div>
          )}
          {!chat.loading && !chat.error && chat.data.length === 0 && (
            <div className="text-center py-10">
              <div className="text-4xl mb-2" aria-hidden="true">💬</div>
              <p className="text-sm" style={{ color: MU }}>
                {acceso.puedeEscribir ? 'Aún no hay mensajes. Coordina con la otra persona aquí, sin compartir tu número si no quieres.' : 'No hay mensajes en esta solicitud.'}
              </p>
            </div>
          )}
          {chat.data.map(m => {
            const mio = m.autorId === perfil.id
            return (
              <div key={m.id} className={`flex ${mio ? 'justify-end' : 'justify-start'}`}>
                <div className="max-w-[84%] px-3.5 py-2.5"
                  style={mio
                    ? { backgroundColor: G, color: N, borderRadius: 18, borderBottomRightRadius: 5 }
                    : { backgroundColor: W, color: N, borderRadius: 18, borderBottomLeftRadius: 5, border: `1px solid ${BD}` }}>
                  {!mio && (
                    <div className="text-[10px] font-extrabold uppercase tracking-wider mb-0.5" style={{ color: GD }}>
                      {m.autorRol === 'tecnico' ? 'Técnico' : 'Cliente'}
                    </div>
                  )}
                  <p className="text-sm leading-relaxed whitespace-pre-wrap break-words">{m.contenido}</p>
                  <div className="text-[10px] mt-1 text-right" style={{ color: mio ? 'rgba(0,0,50,0.55)' : MU }}>{fechaHora(m.creadoEn)}</div>
                </div>
              </div>
            )
          })}
          <div ref={fin} />
        </div>

        {acceso.puedeEscribir ? (
          <div className="flex-shrink-0 px-4 pt-3 border-t" style={{ backgroundColor: W, borderColor: BD, paddingBottom: 'max(12px, env(safe-area-inset-bottom))' }}>
            <ErrorBox msg={error} />
            <div className="flex items-end gap-2">
              <textarea rows={1} maxLength={MAX_MENSAJE} value={texto} onChange={e => { setTexto(e.target.value); setError('') }}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); if (!enviando) enviar() } }}
                placeholder="Escribe un mensaje…" aria-label="Mensaje"
                className={`${INPUT} resize-none max-h-28`} style={{ ...INPUT_STYLE, minHeight: 48 }} />
              <button onClick={enviar} disabled={enviando || !texto.trim()} aria-label="Enviar mensaje"
                className="min-w-[52px] min-h-[48px] rounded-2xl font-extrabold text-sm flex items-center justify-center"
                style={{ background: PRIMARY, color: N, opacity: enviando || !texto.trim() ? 0.55 : 1 }}>
                {enviando ? '…' : 'Enviar'}
              </button>
            </div>
            <p className="text-[10px] mt-1 text-center" style={{ color: MU }}>{texto.length}/{MAX_MENSAJE} · Solo lo ven ustedes dos</p>
          </div>
        ) : (
          <div className="flex-shrink-0 px-4 pt-3 border-t" style={{ backgroundColor: W, borderColor: BD, paddingBottom: 'max(12px, env(safe-area-inset-bottom))' }}>
            <ErrorBox msg={error} />
            <p className="text-xs text-center font-semibold" style={{ color: MU }}>🔒 Chat en solo lectura. El historial se conserva.</p>
          </div>
        )}
      </div>
    </div>
  )
}


type AccionSolicitud = 'aceptar' | 'rechazar' | 'cancelar' | 'confirmar' | 'navegar' | 'llegar' | 'completar'

const OK_ACCION: Record<AccionSolicitud, string> = {
  aceptar: '✓ Solicitud aceptada. El cliente debe confirmarla para que puedas ir al domicilio.',
  rechazar: 'Solicitud rechazada.',
  cancelar: 'Solicitud cancelada.',
  confirmar: '✓ Confirmaste al técnico. Te avisaremos cuando se dirija a tu domicilio.',
  navegar: '✓ Ahora estás dirigiéndote al domicilio del cliente.',
  llegar: '✓ Llegada registrada. El cliente ya ve que estás en el domicilio.',
  completar: '✓ Solicitud finalizada. Ya estás disponible para recibir nuevas solicitudes.',
}

function OrdersScreen({ perfil, go, onRate, onChat, modo = 'activas' }: { perfil: Perfil; go: NavFn; onRate: (p: Pedido) => void; onChat: (p: Pedido, volver: Screen) => void; modo?: 'activas' | 'completadas' }) {
  const live = useContext(LiveCtx)
  // Se recarga sola cada vez que Realtime reporta un cambio (live.version)
  const pedidos = useData(() => getPedidos(perfil), [perfil.id, perfil.rol, live.version], [] as Pedido[])
  const [busy, setBusy] = useState<number | null>(null)
  const [message, setMessage] = useState('')
  const [okMessage, setOkMessage] = useState('')
  const [abiertos, setAbiertos] = useState<Set<number>>(new Set())
  const [nuevos, setNuevos] = useState<Set<number>>(new Set())
  const vistos = useRef<Set<number> | null>(null)
  const esTec = perfil.rol === 'tecnico'
  /*
   * Las dos listas del técnico son excluyentes:
   *   · vigentes  → todo lo que sigue en curso.
   *   · historial → completadas, canceladas, rechazadas o expiradas.
   * Una solicitud terminada ya no puede aparecer en "Solicitudes vigentes".
   */
  const lista = useMemo(
    () => !esTec ? pedidos.data : filtrarSolicitudes(pedidos.data, modo === 'completadas' ? 'historial' : 'vigentes'),
    [pedidos.data, esTec, modo],
  )
  // Disponibilidad derivada de las solicitudes activas, no de una columna que pueda quedar vieja.
  const disponibilidad = useMemo(() => disponibilidadTecnico(pedidos.data), [pedidos.data])

  // Resalta unos segundos las solicitudes que acaban de aparecer (la primera carga no cuenta)
  useEffect(() => {
    if (pedidos.loading) return
    const ids = new Set(pedidos.data.map(p => p.id))
    if (vistos.current) {
      const frescos = new Set([...ids].filter(id => !vistos.current!.has(id)))
      if (frescos.size) { setNuevos(frescos); setTimeout(() => setNuevos(new Set()), 5000) }
    }
    vistos.current = ids
  }, [pedidos.data, pedidos.loading])

  const ejecutar = async (id: number, accion: AccionSolicitud) => {
    if (busy !== null) return // evita doble toque mientras llega la respuesta
    setMessage(''); setOkMessage(''); setBusy(id)
    try {
      switch (accion) {
        case 'aceptar': {
          // Mientras haya otro servicio activo, la nueva se conserva pero no se puede aceptar.
          const permiso = puedeAceptarSolicitud(pedidos.data, id)
          if (!permiso.puede) throw new Error(permiso.motivo)
          await cambiarEstado(id, 'aceptada')
          break
        }
        case 'rechazar': await cambiarEstado(id, 'rechazada'); break
        case 'cancelar': await cambiarEstado(id, 'cancelada'); break
        case 'confirmar': await confirmarTecnico(id); break
        case 'navegar': await iniciarDesplazamiento(id); break
        case 'llegar': await marcarLlegada(id); break
        case 'completar': {
          await completarSolicitud(id)
          /*
           * El pago interno solo se puede registrar cuando la solicitud ya está
           * `completada` (lo exige `registrar_pago_interno`). Por eso va después.
           * Si falla, el cierre NO se revierte: el técnico queda libre igualmente
           * y se le avisa para que lo revise.
           */
          const pedido = pedidos.data.find(x => x.id === id)
          if (pedido?.metodoPago) {
            try {
              await registrarPagoInterno(id, pedido.metodoPago)
            } catch (e) {
              console.warn('No se pudo registrar el pago interno:', e)
              setMessage(`La solicitud se cerró, pero no se pudo registrar el pago: ${errMsg(e)}`)
            }
          }
          break
        }
      }
      setOkMessage(OK_ACCION[accion])
      pedidos.reload()
    }
    catch (e) { console.error(e); setMessage(errMsg(e)) }
    finally { setBusy(null) }
  }
  const alternar = (id: number) => setAbiertos(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n })
  const abrirChat = (p: Pedido) => onChat(p, modo === 'completadas' ? 'done' : 'orders')

  const titulo = esTec
    ? (modo === 'completadas' ? 'Historial de solicitudes finalizadas' : 'Solicitudes vigentes')
    : 'Mis solicitudes'
  const vacio = esTec
    ? (modo === 'completadas'
        ? 'Aún no tienes solicitudes finalizadas.'
        : disponibilidad.estado === 'ocupado'
          ? 'Estás ocupado con un servicio. Las solicitudes nuevas quedan registradas aquí y podrás aceptarlas cuando termines.'
          : 'Estás disponible. Cuando llegue una solicitud, aparecerá aquí al instante.')
    : 'Todavía no has solicitado ningún servicio.'

  return (
    <div className="flex flex-col h-full" style={{ backgroundColor: BG }}>
      <DarkHeader>
        <div className="flex items-center justify-between gap-3">
          <h2 className={`font-extrabold text-white leading-tight ${esTec ? 'text-lg' : 'text-xl'}`}>{titulo}</h2>
          <LiveDot ok={live.conectado} />
        </div>
      </DarkHeader>
      <div className="flex-1 overflow-y-auto px-4 pt-4 pb-safe space-y-3" style={{ scrollbarWidth: 'none' }}>
        {esTec && modo === 'activas' && !pedidos.loading && (
          <div className="rounded-2xl px-4 py-3 flex items-center gap-3" style={{ backgroundColor: W, border: `1px solid ${BD}` }}>
            <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: disponibilidad.estado === 'disponible' ? G : '#F59E0B' }} />
            <div className="min-w-0">
              <p className="text-sm font-extrabold" style={{ color: N }}>
                {disponibilidad.estado === 'disponible' ? 'Disponible' : 'Ocupado'}
              </p>
              <p className="text-xs" style={{ color: MU }}>
                {disponibilidad.estado === 'disponible'
                  ? 'No tienes servicios activos.'
                  : `Atendiendo la solicitud #${disponibilidad.solicitud.id}. Las nuevas quedan registradas sin interrumpir.`}
              </p>
            </div>
          </div>
        )}
        <ErrorBox msg={message} />
        {okMessage && <ErrorBox msg={okMessage} ok />}
        {pedidos.loading && lista.length === 0 && <Loading />}
        {pedidos.error && <ErrorBox msg={pedidos.error} />}
        {!pedidos.loading && !pedidos.error && lista.length === 0 && (
          <p className="text-sm text-center py-10" style={{ color: MU }}>{vacio}</p>
        )}
        {lista.map(p => {
          const accion = esTec ? accionDelTecnico(p.estado) : null
          // Dirección y contacto completos: solo después de aceptar (no en pendiente ni cerradas).
          const verDatos = esTec && ['aceptada', 'confirmada', 'en_camino', 'en_proceso', 'llego', 'completada'].includes(p.estado)
          const permisoAceptar = esTec && p.estado === 'pendiente' ? puedeAceptarSolicitud(pedidos.data, p.id) : null
          const puedeEscribirChat = evaluarAccesoChat(p.estado).puedeEscribir
          return (
            <article key={p.id} className={`rounded-3xl p-4 ${nuevos.has(p.id) ? 'flash-in' : ''}`}
              style={{ backgroundColor: W, border: `1px solid ${nuevos.has(p.id) ? G : BD}`, boxShadow: '0 2px 10px rgba(0,0,50,0.05)' }}>
              <div className="flex items-start justify-between gap-2 mb-1.5">
                <h3 className="text-base font-extrabold leading-snug" style={{ color: N }}>{esTec ? p.nombreContacto : p.tecnicoNombre}</h3>
                <StatusBadge estado={p.estado} />
              </div>

              {verDatos ? <DatosServicio p={p} onNavigate={accion === 'navegar' ? () => ejecutar(p.id, 'navegar') : undefined} /> : (
                <>
                  <div className="text-xs mb-2" style={{ color: MU }}>
                    📅 {new Date(p.fecha + 'T00:00:00').toLocaleDateString('es-CO', { day: 'numeric', month: 'long' })}
                    {esTec && <> · <a href={`tel:${p.telefonoContacto}`} className="underline font-semibold">📞 {p.telefonoContacto}</a></>}
                  </div>
                  <p className="text-sm leading-relaxed" style={{ color: N }}>{p.descripcion}</p>
                  {!esTec && p.direccion && <p className="text-xs mt-1.5" style={{ color: MU }}>📍 {p.direccion}</p>}
                  {esTec && p.estado === 'pendiente' && <p className="text-xs mt-1.5" style={{ color: MU }}>📍 La dirección completa se muestra cuando aceptas la solicitud.</p>}
                  {p.precioFinal != null
                    ? <div className="text-sm font-bold mt-2" style={{ color: GD }}>Precio final: {fmt(p.precioFinal)}</div>
                    : p.precioMin != null && p.precioMax != null && <div className="text-xs mt-2" style={{ color: MU }}>Referencia: {fmt(p.precioMin)} – {fmt(p.precioMax)}</div>}
                </>
              )}

              {/* Cliente: secuencia exacta después de que el técnico acepta */}
              {!esTec && <ConfirmacionCliente p={p} busy={busy === p.id} onConfirmar={() => ejecutar(p.id, 'confirmar')} />}
              {!esTec && <SeguimientoCliente p={p} />}
              {p.estado === 'en_camino' && <RastreoUbicacion pedido={p} perfil={perfil} />}

              {/* Técnico: tras aceptar escribe el diagnóstico; cliente: lo lee */}
              {esTec && ['aceptada', 'confirmada', 'en_camino', 'en_proceso', 'llego'].includes(p.estado) && <DiagnosticoBox pedido={p} onSaved={pedidos.reload} />}
              {(!esTec || p.estado === 'completada') && <DiagnosticoVista p={p} />}
              {esTec && p.estado === 'completada' && p.calificacionCliente && <CalificacionRecibida c={p.calificacionCliente} />}

              {/* Pago: el método elegido al crear la solicitud se muestra en todo el flujo */}
              {!esTec && <PagoBox pedido={p} onSaved={pedidos.reload} onAbrirChat={() => abrirChat(p)} />}
              {!esTec && p.estado === 'completada' && <ReportarProblemaBox pedido={p} />}
              {esTec && <PagoResumenTecnico p={p} onSaved={pedidos.reload} />}

              {esTec && llegadaRegistrada(p.estado) && (
                <div className="mt-3 flex items-center gap-2 rounded-2xl px-3.5 py-2.5 text-xs font-extrabold"
                  style={{ backgroundColor: GL, color: '#0B5D1E', border: `1px solid ${G}80` }}>
                  <span className="w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0" style={{ backgroundColor: G, color: N }}>✓</span>
                  Llegada registrada
                </div>
              )}

              {esTec && accion === 'completar' && (
                <FinalizarSolicitudBox p={p} busy={busy === p.id} onFinalizar={() => ejecutar(p.id, 'completar')} />
              )}

              <div className="flex gap-2 mt-3 flex-wrap">
                {esTec && p.estado === 'pendiente' && (
                  <>
                    <AccionBtn primary label={busy === p.id ? 'Aceptando…' : 'Aceptar'}
                      disabled={busy !== null || !permisoAceptar?.puede} onClick={() => ejecutar(p.id, 'aceptar')} />
                    <AccionBtn label="Rechazar" disabled={busy !== null} onClick={() => ejecutar(p.id, 'rechazar')} />
                  </>
                )}
                {esTec && p.estado === 'aceptada' && (
                  <p className="text-xs font-semibold self-center px-1" style={{ color: MU }}>
                    Esperando que el cliente confirme el servicio.
                  </p>
                )}
                {esTec && accion === 'navegar' && !p.direccion && (
                  <AccionBtn primary label={busy === p.id ? 'Actualizando…' : 'Ya voy en camino'} disabled={busy !== null} onClick={() => ejecutar(p.id, 'navegar')} />
                )}
                {esTec && accion === 'llegar' && (
                  <AccionBtn primary label={busy === p.id ? 'Registrando…' : 'Llegué a la dirección'} disabled={busy !== null} onClick={() => ejecutar(p.id, 'llegar')} />
                )}
                {!esTec && clientePuedeCancelar(p.estado) && (
                  <AccionBtn label="Cancelar solicitud" disabled={busy !== null} onClick={() => ejecutar(p.id, 'cancelar')} />
                )}
                {p.estado === 'completada' && !p.calificada && (
                  <button onClick={() => { onRate(p); go('rate') }} className="flex-1 min-h-[44px] px-4 rounded-2xl text-[13px] font-extrabold" style={{ backgroundColor: G, color: N }}>
                    {esTec ? 'Calificar al cliente ★' : 'Calificar al técnico ★'}
                  </button>
                )}
                {p.estado === 'completada' && p.calificada && <span className="text-xs font-semibold self-center" style={{ color: MU }}>✓ Ya calificaste</span>}
              </div>

              {/* Aviso cuando hay otro servicio activo: la nueva queda registrada, sin aceptar. */}
              {esTec && p.estado === 'pendiente' && permisoAceptar && !permisoAceptar.puede && (
                <p className="text-xs mt-2 rounded-xl px-3 py-2" style={{ backgroundColor: '#FEF3C7', color: '#92400E' }}>{permisoAceptar.motivo}</p>
              )}
              {esTec && accion === 'navegar' && p.direccion && (
                <p className="text-[11px] mt-2 text-center" style={{ color: MU }}>
                  Al abrir Google Maps, el cliente verá “Técnico dirigiéndose a su domicilio”.
                </p>
              )}

              {/* Chat privado: se escribe en todos los estados activos; después queda el historial */}
              {mostrarBotonChat(p.estado) && (
                <button onClick={() => abrirChat(p)} className="mt-2 w-full min-h-[44px] px-4 rounded-2xl text-[13px] font-extrabold border flex items-center justify-center gap-2"
                  style={{ borderColor: BD, color: N, backgroundColor: W }}>
                  💬 {puedeEscribirChat ? `Chat con ${esTec ? 'el cliente' : 'el técnico'}` : 'Ver chat (solo lectura)'}
                </button>
              )}

              {/* El historial queda en la base de datos (auditoría); en la vista del cliente no se muestra */}
              {esTec && (
                <>
                  <button onClick={() => alternar(p.id)} aria-expanded={abiertos.has(p.id)} className="mt-3 min-h-[36px] text-xs font-bold flex items-center gap-1" style={{ color: GD }}>
                    {abiertos.has(p.id) ? 'Ocultar historial ▴' : 'Ver historial ▾'}
                  </button>
                  {abiertos.has(p.id) && <Historial id={p.id} />}
                </>
              )}
            </article>
          )
        })}
      </div>
      <BottomNav active={modo === 'completadas' ? 'done' : 'orders'} go={go} />
    </div>
  )
}

/* ═════════ Técnico pendiente de aprobación ═════════ */
function PendingScreen({ perfil, onRefresh, onLogout }: { perfil: Perfil; onRefresh: () => Promise<boolean>; onLogout: () => Promise<void> }) {
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const revisar = async () => {
    setBusy(true); setMsg('')
    try { if (!(await onRefresh())) setMsg('Tu cuenta sigue en revisión. Te avisaremos cuando esté aprobada.') }
    catch (e) { console.error(e); setMsg(errMsg(e)) }
    finally { setBusy(false) }
  }
  return (
    <div className="flex flex-col h-full px-5 pt-6" style={{ backgroundColor: BG, paddingBottom: 'max(20px, env(safe-area-inset-bottom))' }}>
      <div className="flex-1 flex flex-col items-center justify-center text-center">
        <div className="w-24 h-24 rounded-full flex items-center justify-center mb-5" style={{ backgroundColor: '#FEF3C7' }} aria-hidden="true">
          <svg width="44" height="44" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" fill="none" stroke="#B45309" strokeWidth="2" /><path d="M12 7v5l3 2" fill="none" stroke="#B45309" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </div>
        <h2 className="text-2xl font-extrabold mb-2" style={{ color: N }}>Pendiente de aprobación</h2>
        <p className="text-base leading-relaxed" style={{ color: MU }}>
          Hola, <strong style={{ color: N }}>{perfil.nombre.split(' ')[0]}</strong>. Estamos revisando tu cuenta. Cuando sea aprobada podrás recibir solicitudes: entra de nuevo o toca “Revisar estado”.
        </p>
        <div className="w-full mt-4"><ErrorBox msg={msg} ok /></div>
      </div>
      <div className="space-y-2.5">
        <PrimaryBtn onClick={revisar} disabled={busy}>{busy ? 'Revisando…' : 'Revisar estado'}</PrimaryBtn>
        <SecondaryBtn tone="danger" onClick={onLogout}>Cerrar sesión</SecondaryBtn>
      </div>
    </div>
  )
}

/* ═════════ Calificación ═════════ */
const NIVEL = ['', 'Muy mal', 'Regular', 'Bien', 'Muy bien', 'Excelente']
type Aspecto = 'puntualidad' | 'trato' | 'cumplimiento'
// Mismas tres dimensiones en ambos sentidos; cambia el enunciado según quién califica.
const PREGUNTAS: Record<'cliente' | 'tecnico', { k: Aspecto; q: string }[]> = {
  cliente: [
    { k: 'puntualidad', q: '¿Llegó a la hora acordada?' },
    { k: 'trato', q: '¿Cómo fue su trato contigo?' },
    { k: 'cumplimiento', q: '¿Cumplió con el servicio acordado?' },
  ],
  tecnico: [
    { k: 'puntualidad', q: '¿Estuvo disponible a la hora acordada?' },
    { k: 'trato', q: '¿Cómo fue su trato contigo?' },
    { k: 'cumplimiento', q: '¿La dirección y la descripción eran correctas?' },
  ],
}

function StarRow({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <div role="radiogroup" aria-label={label} className="rounded-2xl px-3.5 py-3" style={{ backgroundColor: W, border: `1px solid ${BD}` }}>
      <div className="flex items-center justify-between gap-2 mb-1">
        <span className="text-sm font-bold" style={{ color: N }}>{label}</span>
        <span className="text-xs font-semibold" style={{ color: value ? GD : MU }}>{NIVEL[value] || 'Sin responder'}</span>
      </div>
      <div className="flex gap-1">
        {[1, 2, 3, 4, 5].map(v => (
          <button key={v} role="radio" aria-checked={value === v} aria-label={`${v} de 5`} onClick={() => onChange(v)} className="w-11 h-11 flex items-center justify-center">
            <svg width="30" height="30" viewBox="0 0 40 40"><path d="M20 3l4 12H37L27 22.5l4.5 12.5L20 27l-11.5 8L13 22.5 3 15h13L20 3z" fill={value >= v ? G : BD} /></svg>
          </button>
        ))}
      </div>
    </div>
  )
}

/** Califica el servicio. Si quien entra es el cliente califica al técnico; si es el técnico, califica al cliente. */
function RateScreen({ pedido, perfil, go }: { pedido: Pedido; perfil: Perfil; go: NavFn }) {
  const modo: 'cliente' | 'tecnico' = perfil.rol === 'tecnico' ? 'tecnico' : 'cliente'
  const [stars, setStars] = useState(0)
  const [resp, setResp] = useState<Record<Aspecto, number>>({ puntualidad: 0, trato: 0, cumplimiento: 0 })
  const [comment, setComment] = useState('')
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')
  const [done, setDone] = useState(false)
  const completo = stars > 0 && PREGUNTAS[modo].every(x => resp[x.k] > 0)

  const enviar = async () => {
    if (!completo) return
    setLoading(true); setMessage('')
    try {
      await calificarSolicitud({ solicitudId: pedido.id, puntuacion: stars, puntualidad: resp.puntualidad, trato: resp.trato, cumplimiento: resp.cumplimiento, comentario: comment })
      setDone(true)
    } catch (e) {
      console.error(e); setMessage(errMsg(e))
    } finally {
      setLoading(false)
    }
  }

  if (done) return (
    <div className="flex flex-col h-full" style={{ backgroundColor: BG }}>
      <div className="flex-1 overflow-y-auto px-4 pt-6 pb-safe" style={{ scrollbarWidth: 'none' }}>
        <div className="text-center">
          <SuccessMark />
          <h3 className="text-2xl font-extrabold mb-2" style={{ color: N }}>¡Gracias!</h3>
          <p className="text-base mb-2" style={{ color: MU }}>
            {modo === 'cliente' ? 'Tu reseña ayuda a otros vecinos de Pasto, y el técnico recibirá tu retroalimentación.' : 'Tu calificación ayuda a mantener una comunidad confiable.'}
          </p>
        </div>

        {/*
         * El método de pago se eligió al crear la solicitud. Aquí solo se
         * muestra (y se permite ajustar si el cliente cambió de idea); no se
         * vuelve a preguntar como si no existiera.
         */}
        {modo === 'cliente' && (
          <>
            <p className="text-sm font-extrabold text-center mt-4 mb-1" style={{ color: N }}>Revisa o cambia tu método de pago</p>
            <PagoBox pedido={pedido} onSaved={() => { /* el método ya quedó guardado en la base de datos */ }} />
          </>
        )}

        <div className="mt-4">
          <PrimaryBtn onClick={() => go('orders')}>{modo === 'cliente' ? 'Ir a mis solicitudes' : 'Volver a solicitudes'}</PrimaryBtn>
        </div>
      </div>
    </div>
  )

  return (
    <div className="flex flex-col h-full" style={{ backgroundColor: BG }}>
      <DarkHeader onBack={() => go(modo === 'tecnico' ? 'done' : 'orders')}>
        <h2 className="text-lg font-extrabold text-white">{modo === 'cliente' ? '¿Cómo estuvo el servicio?' : '¿Cómo fue el cliente?'}</h2>
        <p className="text-sm mt-0.5" style={{ color: 'rgba(255,255,255,0.65)' }}>Califica a {modo === 'cliente' ? pedido.tecnicoNombre : pedido.nombreContacto}</p>
      </DarkHeader>
      <div className="flex-1 overflow-y-auto px-4 pt-5 pb-safe space-y-4" style={{ scrollbarWidth: 'none' }}>
        <div>
          <p className="text-center text-sm font-extrabold uppercase tracking-wide mb-1" style={{ color: N }}>Calificación general</p>
          <div className="flex justify-center gap-1.5" role="radiogroup" aria-label="Calificación general">
            {[1, 2, 3, 4, 5].map(v => (
              <button key={v} role="radio" aria-checked={stars === v} aria-label={`${v} estrellas`} onClick={() => setStars(v)} className="w-12 h-12 flex items-center justify-center transition-transform"
                style={{ transform: stars >= v ? 'scale(1.1)' : 'scale(1)' }}>
                <svg width="40" height="40" viewBox="0 0 40 40"><path d="M20 3l4 12H37L27 22.5l4.5 12.5L20 27l-11.5 8L13 22.5 3 15h13L20 3z" fill={stars >= v ? G : BD} /></svg>
              </button>
            ))}
          </div>
          <p className="text-center text-sm font-bold" style={{ color: stars ? GD : MU }}>{NIVEL[stars] || 'Toca para calificar'}</p>
        </div>

        <div className="space-y-2.5">
          {PREGUNTAS[modo].map(x => <StarRow key={x.k} label={x.q} value={resp[x.k]} onChange={v => setResp({ ...resp, [x.k]: v })} />)}
        </div>

        <Field label={modo === 'cliente' ? 'Retroalimentación para el técnico (opcional)' : 'Observaciones sobre el cliente (opcional)'}>
          <textarea rows={4} maxLength={500} value={comment} onChange={e => setComment(e.target.value)}
            placeholder={modo === 'cliente' ? 'Ej: Llegó puntual, explicó el daño con claridad y dejó todo limpio…' : 'Ej: Estaba en casa a la hora acordada y la dirección era correcta…'}
            className={`${INPUT} resize-none`} style={INPUT_STYLE} />
          <p className="text-xs mt-1" style={{ color: MU }}>{modo === 'cliente' ? 'El técnico verá tu comentario.' : 'Solo lo ve el equipo de Resolve; el cliente no lo ve.'}</p>
        </Field>

        <ErrorBox msg={message} />
        <PrimaryBtn onClick={enviar} disabled={!completo || loading}>{loading ? 'Enviando…' : 'Enviar calificación'}</PrimaryBtn>
        {!completo && <p className="text-xs text-center" style={{ color: MU }}>Responde la calificación general y las 3 preguntas para enviar.</p>}
      </div>
    </div>
  )
}

/* ═════════ Cuenta bancaria del técnico ═════════ */
/**
 * El técnico registra dónde quiere recibir los pagos con tarjeta / Google Pay.
 * La cuenta es privada: RLS solo deja verla al propio técnico; los clientes nunca la leen.
 */
function CuentaBancariaBox({ perfil }: { perfil: Perfil }) {
  const cuenta = useData(() => getMiCuentaBancaria(perfil.id), [perfil.id], null as CuentaBancaria | null)
  const [form, setForm] = useState({ banco: '', tipoCuenta: 'ahorros' as 'ahorros' | 'corriente', numeroCuenta: '', titular: '', documento: '' })
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [ok, setOk] = useState('')

  useEffect(() => {
    if (cuenta.loading || !cuenta.data) return
    setForm({
      banco: cuenta.data.banco, tipoCuenta: cuenta.data.tipoCuenta, numeroCuenta: cuenta.data.numeroCuenta,
      titular: cuenta.data.titular, documento: cuenta.data.documento ?? '',
    })
  }, [cuenta.loading, cuenta.data])

  const guardar = async () => {
    setMsg(''); setOk('')
    const banco = form.banco.trim()
    const numero = form.numeroCuenta.replace(/\D/g, '')
    const titular = form.titular.trim()
    const documento = form.documento.replace(/\D/g, '')
    if (banco.length < 3) return setMsg('Escribe el nombre del banco.')
    if (!/^\d{6,20}$/.test(numero)) return setMsg('El número de cuenta debe tener entre 6 y 20 dígitos.')
    if (titular.length < 3) return setMsg('Escribe el nombre completo del titular.')
    if (documento && !/^\d{5,15}$/.test(documento)) return setMsg('La cédula del titular debe tener entre 5 y 15 dígitos.')

    setBusy(true)
    try {
      await guardarCuentaBancaria({ banco, tipoCuenta: form.tipoCuenta, numeroCuenta: numero, titular, documento })
      setOk('Cuenta bancaria guardada. La usarás para recibir los pagos con tarjeta y Google Pay.')
      cuenta.reload()
    } catch (e) {
      console.error(e); setMsg(errMsg(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card className="p-4">
      <div className="text-xs font-extrabold uppercase tracking-wider mb-1" style={{ color: N }}>🏦 Cuenta bancaria para recibir pagos</div>
      <p className="text-xs mb-3 leading-relaxed" style={{ color: MU }}>
        Aquí se transferirán los pagos con tarjeta o Google Pay cuando se confirme el cobro. Solo tú puedes ver estos datos: los clientes nunca los ven.
      </p>

      {cuenta.loading ? <Loading text="Cargando cuenta…" /> : (
        <>
          {cuenta.data && (
            <div className="rounded-2xl px-3.5 py-3 mb-3" style={{ backgroundColor: GL, border: `1px solid ${G}50` }}>
              <p className="text-sm font-bold" style={{ color: '#065F46' }}>{cuenta.data.banco} · {cuenta.data.tipoCuenta === 'ahorros' ? 'Ahorros' : 'Corriente'}</p>
              <p className="text-xs mt-0.5" style={{ color: MU }}>Cuenta terminada en {cuenta.data.numeroCuenta.slice(-4)} · Titular: {cuenta.data.titular}</p>
            </div>
          )}
          {cuenta.error && <div className="mb-3"><ErrorBox msg={cuenta.error} /></div>}

          <div className="space-y-3">
            <Field label="Banco *">
              <input type="text" maxLength={60} autoComplete="organization" value={form.banco} onChange={e => setForm({ ...form, banco: e.target.value })}
                placeholder="Ej: Bancolombia, Davivienda, Nequi…" className={INPUT} style={INPUT_STYLE} />
            </Field>
            <Field label="Tipo de cuenta *">
              <select value={form.tipoCuenta} onChange={e => setForm({ ...form, tipoCuenta: e.target.value as 'ahorros' | 'corriente' })} className={INPUT} style={INPUT_STYLE}>
                <option value="ahorros">Ahorros</option>
                <option value="corriente">Corriente</option>
              </select>
            </Field>
            <Field label="Número de cuenta *">
              <input type="text" inputMode="numeric" pattern="[0-9]*" maxLength={20} value={form.numeroCuenta}
                onChange={e => setForm({ ...form, numeroCuenta: soloDigitos(e.target.value, 20) })} placeholder="Solo números" className={INPUT} style={INPUT_STYLE} />
            </Field>
            <Field label="Titular de la cuenta *">
              <input type="text" autoComplete="name" autoCapitalize="words" maxLength={80} value={form.titular}
                onChange={e => setForm({ ...form, titular: soloNombre(e.target.value, 80) })} placeholder="Nombre completo" className={INPUT} style={INPUT_STYLE} />
            </Field>
            <Field label="Cédula del titular (opcional)">
              <input type="text" inputMode="numeric" pattern="[0-9]*" maxLength={15} value={form.documento}
                onChange={e => setForm({ ...form, documento: soloDigitos(e.target.value, 15) })} placeholder="Solo números" className={INPUT} style={INPUT_STYLE} />
            </Field>
          </div>

          <ErrorBox msg={msg} />
          {ok && <div className="mt-2"><ErrorBox ok msg={ok} /></div>}
          <div className="mt-3">
            <PrimaryBtn onClick={guardar} disabled={busy}>{busy ? 'Guardando…' : cuenta.data ? 'Actualizar cuenta' : 'Guardar cuenta'}</PrimaryBtn>
          </div>
        </>
      )}
    </Card>
  )
}

/* ═════════ Perfil / sesión ═════════ */
function ProfileScreen({ perfil, go, onLogout }: { perfil: Perfil; go: NavFn; onLogout: () => Promise<void> }) {
  const ver = useData(() => perfil.rol === 'tecnico' ? getMiVerificacion(perfil.id) : Promise.resolve(null), [perfil.id], null)
  /*
   * Disponibilidad del técnico: se deriva de sus solicitudes activas, igual que
   * en la lista de Solicitudes. No hay columna persistida que pueda quedar vieja:
   * al terminar el servicio la solicitud sale de los estados activos y el técnico
   * vuelve a "Disponible" automáticamente.
   */
  const pedidosTec = useData(
    () => perfil.rol === 'tecnico' ? getPedidos(perfil) : Promise.resolve([] as Pedido[]),
    [perfil.id, perfil.rol],
    [] as Pedido[],
  )
  const disp = useMemo(() => disponibilidadTecnico(pedidosTec.data), [pedidosTec.data])
  const [busy, setBusy] = useState(false)
  const estadoVer = ver.data ? (ver.data.verificado ? 'Verificado ✓' : `En revisión${ver.data.estado ? ` (${ver.data.estado})` : ''}`) : null
  const rows: [string, string][] = [['Correo', perfil.email], ['Tipo de cuenta', perfil.rol === 'tecnico' ? 'Técnico' : 'Cliente']]
  if (perfil.telefono) rows.push(['Celular', perfil.telefono])
  if (estadoVer) rows.push(['Verificación', estadoVer])
  return (
    <div className="flex flex-col h-full" style={{ backgroundColor: BG }}>
      <DarkHeader>
        <div className="flex items-center gap-4">
          <div className="w-16 h-16 rounded-full flex items-center justify-center text-2xl font-extrabold flex-shrink-0" style={{ backgroundColor: G, color: N }} aria-hidden="true">
            {perfil.nombre.charAt(0).toUpperCase()}
          </div>
          <div className="min-w-0">
            <h2 className="text-xl font-extrabold text-white leading-tight break-words">{perfil.nombre}</h2>
            <p className="text-sm" style={{ color: 'rgba(255,255,255,0.65)' }}>{perfil.rol === 'tecnico' ? 'Técnico' : 'Cliente'}</p>
          </div>
        </div>
      </DarkHeader>
      <div className="flex-1 overflow-y-auto px-4 pt-4 pb-safe space-y-4" style={{ scrollbarWidth: 'none' }}>
        {perfil.rol === 'tecnico' && !pedidosTec.loading && (
          <div className="rounded-2xl px-4 py-3 flex items-center gap-3" style={{ backgroundColor: W, border: `1px solid ${BD}` }}>
            <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: disp.estado === 'disponible' ? G : '#F59E0B' }} />
            <div className="min-w-0">
              <p className="text-sm font-extrabold" style={{ color: N }}>{disp.estado === 'disponible' ? 'Disponible' : 'Ocupado'}</p>
              <p className="text-xs" style={{ color: MU }}>
                {disp.estado === 'disponible'
                  ? 'Puedes recibir y aceptar solicitudes.'
                  : `Atendiendo la solicitud #${disp.solicitud.id}. Al terminarla volverás a estar disponible.`}
              </p>
            </div>
          </div>
        )}
        <InfoRows rows={rows} />
        <Card className="overflow-hidden">
          {([
            ...(perfil.rol === 'tecnico'
              ? [
                  { s: 'earnings' as Screen, icon: '💰', label: 'Ganancias', desc: 'Ingresos, comisión y ticket promedio.' },
                  { s: 'agenda' as Screen, icon: '🗓️', label: 'Mi agenda', desc: 'Horario semanal y días bloqueados.' },
                  { s: 'portfolio' as Screen, icon: '🖼️', label: 'Portafolio y documentos', desc: 'Muestra tu trabajo y mantén tus papeles al día.' },
                ]
              : []),
            { s: 'transactions' as Screen, icon: '🧾', label: perfil.rol === 'tecnico' ? 'Pagos y comisiones' : 'Pagos y reembolsos', desc: 'Historial con cada cobro, comisión y reembolso.' },
            { s: 'notifications' as Screen, icon: '🔔', label: 'Notificaciones', desc: 'Preferencias, bandeja y push del dispositivo.' },
            { s: 'referrals' as Screen, icon: '🎁', label: 'Invita y gana', desc: 'Tu código, recompensas y cobertura por barrio.' },
            { s: 'help' as Screen, icon: '🛟', label: 'Ayuda y soporte', desc: 'Preguntas frecuentes y tickets.' },
          ]).map(item => (
            <button key={item.s} onClick={() => go(item.s)}
              className="w-full flex items-center gap-3 px-4 py-3.5 text-left"
              style={{ borderBottom: `1px solid ${BD}` }}>
              <span className="text-xl leading-none" aria-hidden="true">{item.icon}</span>
              <span className="flex-1 min-w-0">
                <span className="block text-sm font-extrabold" style={{ color: N }}>{item.label}</span>
                <span className="block text-xs mt-0.5" style={{ color: MU }}>{item.desc}</span>
              </span>
              <span className="text-lg" style={{ color: MU }} aria-hidden="true">›</span>
            </button>
          ))}
        </Card>
        {perfil.rol === 'tecnico' && ver.data?.verificado && <CuentaBancariaBox perfil={perfil} />}
        <SecondaryBtn tone="danger" disabled={busy} onClick={async () => { setBusy(true); await onLogout() }}>
          {busy ? 'Cerrando sesión…' : 'Cerrar sesión'}
        </SecondaryBtn>
      </div>
      <BottomNav active="profile" go={go} />
    </div>
  )
}

/* ═════════ Registro de técnico (3 pasos) ═════════ */
function Steps({ n, label }: { n: number; label: string }) {
  return (
    <>
      <div className="flex gap-1.5 mb-2 mt-2" role="progressbar" aria-valuenow={n} aria-valuemin={1} aria-valuemax={3} aria-label="Progreso del registro">
        {[1, 2, 3].map(s => <div key={s} className="flex-1 h-1.5 rounded-full" style={{ backgroundColor: s <= n ? G : 'rgba(255,255,255,0.2)' }} />)}
      </div>
      <div className="text-sm" style={{ color: 'rgba(255,255,255,0.7)' }}>Paso {n} de 3 · {label}</div>
    </>
  )
}

function V1Screen({ perfil, draft, setDraft, go }: { perfil: Perfil; draft: Draft; setDraft: (d: Draft) => void; go: NavFn }) {
  const [form, setForm] = useState<Draft>({ name: draft.name || perfil.nombre, phone: draft.phone || perfil.telefono || '', cedula: draft.cedula, genero: draft.genero })
  const [message, setMessage] = useState('')
  const siguiente = () => {
    const phone = normCel(form.phone)
    if (form.name.trim().length < 3) return setMessage('Ingresa tu nombre completo.')
    if (!phone) return setMessage('Ingresa un celular colombiano válido (10 dígitos, empieza por 3).')
    if (!/^\d{6,10}$/.test(form.cedula.trim())) return setMessage('La cédula debe tener entre 6 y 10 dígitos.')
    if (!form.genero) return setMessage('Selecciona tu género.')
    setDraft({ name: form.name.trim(), phone, cedula: form.cedula.trim(), genero: form.genero })
    go('v2')
  }
  return (
    <div className="flex flex-col h-full" style={{ backgroundColor: BG }}>
      <DarkHeader onBack={() => go('profile')} backLabel="← Salir del registro">
        <div className="text-xl font-extrabold text-white">Registra tu oficio</div>
        <Steps n={1} label="Datos personales" />
      </DarkHeader>
      <div className="flex-1 overflow-y-auto px-4 pt-4 pb-safe space-y-3" style={{ scrollbarWidth: 'none' }}>
        <Field label="Nombre completo *"><input type="text" autoComplete="name" autoCapitalize="words" maxLength={60} value={form.name} onChange={e => setForm({ ...form, name: soloNombre(e.target.value) })} className={INPUT} style={INPUT_STYLE} /></Field>
        <Field label="Celular (WhatsApp) *"><input type="tel" inputMode="numeric" pattern="[0-9]*" autoComplete="tel-national" maxLength={12} value={form.phone} onChange={e => setForm({ ...form, phone: soloDigitos(e.target.value, 12) })} placeholder="3105551234" className={INPUT} style={INPUT_STYLE} /></Field>
        <Field label="Número de cédula *"><input type="text" inputMode="numeric" pattern="[0-9]*" autoComplete="off" maxLength={10} value={form.cedula} onChange={e => setForm({ ...form, cedula: soloDigitos(e.target.value, 10) })} placeholder="Solo números" className={INPUT} style={INPUT_STYLE} /></Field>
        <Field label="Género *">
          <div className="flex gap-2" role="radiogroup" aria-label="Género">
            {([['hombre', 'Hombre'], ['mujer', 'Mujer']] as [Genero, string][]).map(([v, l]) => (
              <button key={v} role="radio" aria-checked={form.genero === v} onClick={() => setForm({ ...form, genero: v })}
                className="flex-1 min-h-[48px] rounded-2xl text-base font-bold border-2"
                style={{ borderColor: form.genero === v ? G : BD, backgroundColor: form.genero === v ? GL : W, color: N }}>{l}</button>
            ))}
          </div>
        </Field>
        <ErrorBox msg={message} />
        <PrimaryBtn onClick={siguiente}>Siguiente →</PrimaryBtn>
      </div>
    </div>
  )
}

function V2Screen({ draft, go, usuarioId }: { draft: Draft; go: NavFn; usuarioId: string }) {
  const cats = useData(getCategorias, [], [] as Categoria[])
  const barrios = useData(getBarrios, [], [] as Barrio[])
  const [f, setF] = useState({ categoriaId: '', barrioId: '', years: '', especialidad: '', descripcion: '', precioMin: '', precioMax: '' })
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value })
  const setNum = (k: keyof typeof f, max: number) => (e: { target: { value: string } }) => setF({ ...f, [k]: soloDigitos(e.target.value, max) })

  const guardar = async () => {
    setMessage('')
    const min = Number(f.precioMin), max = Number(f.precioMax), years = Number(f.years)
    if (!f.categoriaId || !f.barrioId || !f.especialidad.trim() || !f.years || !f.precioMin || !f.precioMax) return setMessage('Completa todos los campos obligatorios.')
    if (!Number.isFinite(min) || !Number.isFinite(max) || min < 0 || max < min) return setMessage('El precio mínimo no puede ser mayor al máximo.')
    if (!Number.isInteger(years) || years < 0 || years > 60) return setMessage('Los años de experiencia deben estar entre 0 y 60.')
    setLoading(true)
    try {
      await registrarTecnico({ nombre: draft.name, telefono: draft.phone, cedula: draft.cedula, categoriaId: Number(f.categoriaId), barrioId: Number(f.barrioId),
        especialidad: f.especialidad.trim(), descripcion: f.descripcion.trim(), precioMin: min, precioMax: max, anios: years })
      if (draft.genero) await guardarGenero(usuarioId, draft.genero) // mejor esfuerzo; no bloquea el registro
      go('v3')
    } catch (e) {
      console.error(e); setMessage(errMsg(e))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex flex-col h-full" style={{ backgroundColor: BG }}>
      <DarkHeader onBack={() => go('v1')} backLabel="← Atrás">
        <div className="text-xl font-extrabold text-white">Registra tu oficio</div>
        <Steps n={2} label="Oficio y cobertura" />
      </DarkHeader>
      <div className="flex-1 overflow-y-auto px-4 pt-4 pb-safe space-y-3" style={{ scrollbarWidth: 'none' }}>
        <Field label="Categoría de oficio *">
          <select value={f.categoriaId} onChange={set('categoriaId')} className={INPUT} style={INPUT_STYLE}>
            <option value="">Seleccionar…</option>{cats.data.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
          </select>
        </Field>
        <Field label="Especialidad *"><input value={f.especialidad} maxLength={80} onChange={set('especialidad')} placeholder="Ej: Electricista residencial" className={INPUT} style={INPUT_STYLE} /></Field>
        <Field label="Barrio principal de Pasto *">
          <select value={f.barrioId} onChange={set('barrioId')} className={INPUT} style={INPUT_STYLE}>
            <option value="">Seleccionar…</option>{barrios.data.map(b => <option key={b.id} value={b.id}>{b.nombre}</option>)}
          </select>
        </Field>
        <Field label="Años de experiencia *"><input type="text" inputMode="numeric" pattern="[0-9]*" maxLength={2} value={f.years} onChange={setNum('years', 2)} placeholder="Ej: 5" className={INPUT} style={INPUT_STYLE} /></Field>
        <div className="grid grid-cols-2 gap-2.5">
          <Field label="Tarifa mínima (COP) *"><input type="text" inputMode="numeric" pattern="[0-9]*" maxLength={7} value={f.precioMin} onChange={setNum('precioMin', 7)} placeholder="Ej: 30000" className={INPUT} style={INPUT_STYLE} /></Field>
          <Field label="Tarifa máxima (COP) *"><input type="text" inputMode="numeric" pattern="[0-9]*" maxLength={7} value={f.precioMax} onChange={setNum('precioMax', 7)} placeholder="Ej: 120000" className={INPUT} style={INPUT_STYLE} /></Field>
        </div>
        <Field label="Cuéntanos sobre tu trabajo (opcional)">
          <textarea rows={3} maxLength={500} value={f.descripcion} onChange={set('descripcion')} className={`${INPUT} resize-none`} style={INPUT_STYLE} />
        </Field>
        <ErrorBox msg={message} />
        <PrimaryBtn onClick={guardar} disabled={loading}>{loading ? 'Guardando…' : 'Enviar para verificación →'}</PrimaryBtn>
      </div>
    </div>
  )
}

function V3Screen({ go }: { go: NavFn }) {
  return (
    <div className="flex flex-col h-full px-5 pt-5" style={{ backgroundColor: BG, paddingBottom: 'max(20px, env(safe-area-inset-bottom))' }}>
      <div className="flex gap-1.5" aria-hidden="true">{[1, 2, 3].map(s => <div key={s} className="flex-1 h-1.5 rounded-full" style={{ backgroundColor: G }} />)}</div>
      <div className="flex-1 flex flex-col items-center justify-center text-center">
        <SuccessMark size={112} />
        <h2 className="text-2xl font-extrabold mb-2" style={{ color: N }}>¡Solicitud en revisión!</h2>
        <p className="text-base leading-relaxed" style={{ color: MU }}>
          Revisaremos tu cédula y, cuando la aprobemos, tu perfil mostrará la insignia <strong style={{ color: GD }}>“Verificado”</strong>. Podrás recibir solicitudes cuando tu cuenta sea aprobada.
        </p>
      </div>
      <PrimaryBtn onClick={() => go('orders')}>Entendido</PrimaryBtn>
    </div>
  )
}

/* ═════════ App ═════════ */
/** Cliente → inicio. Técnico → nunca el inicio de clientes: registro, "pendiente" o conexión (Solicitudes). */
async function destinoInicial(p: Perfil): Promise<{ dest: Screen; aprobado: boolean }> {
  if (p.rol !== 'tecnico') return { dest: 'home', aprobado: true }
  const e = await getEstadoAprobacion(p.id)
  if (!e.tieneFicha) return { dest: 'v1', aprobado: false }
  return { dest: e.aprobado ? 'orders' : 'pending', aprobado: e.aprobado }
}

export default function App() {
  const [screen, setScreen] = useState<Screen>('splash')
  const [booting, setBooting] = useState(true)
  const [authTab, setAuthTab] = useState<AuthTab>('register')
  const [perfil, setPerfil] = useState<Perfil | null>(null)
  const [worker, setWorker] = useState<WorkerType | null>(null)
  const [pedidoRate, setPedidoRate] = useState<Pedido | null>(null)
  const [pedidoChat, setPedidoChat] = useState<Pedido | null>(null)
  const [chatOrigen, setChatOrigen] = useState<Screen>('orders')
  // Método de pago elegido en el formulario; se muestra en la pantalla de confirmación.
  const [metodoPago, setMetodoPago] = useState<MetodoPago | null>(null)
  const [aprobado, setAprobado] = useState(true) // solo relevante para técnicos
  const [draft, setDraft] = useState<Draft>({ name: '', phone: '', cedula: '', genero: '' })
  /*
   * Navegación con historial.
   *
   * Antes `go` solo cambiaba el estado de React: el WebView no tenía entradas
   * en `window.history`, así que el botón/gesto atrás de Android cerraba la
   * Activity. Ahora cada pantalla apila una entrada y `popstate` (o el evento
   * `backButton` de Capacitor) retrocede en la pila. En la raíz se cierra la
   * sesión y se sale de la app.
   */
  const pilaRef = useRef<Screen[]>(['splash'])
  const go: NavFn = s => {
    const pila = pilaRef.current
    if (s === pila[pila.length - 1]) return
    // Si la pantalla ya está en la pila, se trata de un "volver": se recorta.
    // El historial del WebView conserva entradas de más, pero `popstate` solo
    // usa esta pila, así que nunca muestra una pantalla vieja.
    const indice = pila.lastIndexOf(s)
    if (indice >= 0) {
      pilaRef.current = pila.slice(0, indice + 1)
      setScreen(s)
      return
    }
    pilaRef.current = [...pila, s]
    window.history.pushState({ resolve: pilaRef.current.length }, '')
    setScreen(s)
  }
  // Reemplaza la pila: login, logout y arranque no deben poder "volver" atrás.
  const resetNav: NavFn = s => {
    pilaRef.current = [s]
    window.history.replaceState({ resolve: 1 }, '')
    setScreen(s)
  }
  const saliendoRef = useRef(false)
  const salirDeLaApp = async () => {
    if (saliendoRef.current) return
    saliendoRef.current = true
    try {
      await cerrarSesion()
    } finally {
      if (Capacitor.isNativePlatform()) await CapApp.exitApp()
      else saliendoRef.current = false
    }
  }

  useEffect(() => {
    const onPop = () => {
      if (pilaRef.current.length > 1) {
        pilaRef.current = pilaRef.current.slice(0, -1)
        setScreen(pilaRef.current[pilaRef.current.length - 1])
        return
      }
      // Entrada vieja (p. ej. login anterior al cierre de sesión): no volvemos
      // a ella. En Android, atrás en la raíz cierra la app.
      if (Capacitor.isNativePlatform()) void salirDeLaApp()
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return
    let cancelado = false
    let listener: { remove: () => Promise<void> } | undefined
    void CapApp.addListener('backButton', () => {
      if (pilaRef.current.length > 1) window.history.back()
      else void salirDeLaApp()
    }).then(l => {
      if (cancelado) void l.remove()
      else listener = l
    })
    return () => { cancelado = true; void listener?.remove() }
  }, [])
  // Un técnico sin aprobar no se suscribe a solicitudes
  const live = useSolicitudesEnVivo(perfil && perfil.rol === 'tecnico' && !aprobado ? null : perfil)
  const { limpiarPendientes } = live
  // Entrar a Solicitudes = ya vio las novedades
  useEffect(() => { if (screen === 'orders') limpiarPendientes() }, [screen, limpiarPendientes])

  // Restaura la sesión al abrir la app y reacciona al cierre de sesión.
  //
  // Supabase entrega la sesión guardada por dos caminos a la vez: la promesa de
  // getSession() y el evento INITIAL_SESSION. Si solo escucháramos getSession(),
  // un fallo/orden distinto de esa promesa dejaría la app en el splash aunque la
  // sesión existiera. Aquí ambos caminos llaman a `restaurar`, que se ejecuta una
  // sola vez y solo apaga el splash cuando terminó.
  useEffect(() => {
    let alive = true
    let enCurso = false
    let hecho = false
    /*
     * Arranque en frío: el WebView es nuevo, así que la app se había cerrado
     * (salida, deslizar desde recientes o muerte del proceso). Se limpian los
     * tokens antes de restaurar. Los enlaces de recuperación son la excepción:
     * necesitan la sesión temporal que crea Supabase.
     */
    const recuperacion = esEnlaceRecuperacion(window.location.hash, window.location.search)
    const limpiarArranque = ARRANQUE_FRIO && !recuperacion
    const restaurar = async (session: Session | null) => {
      if (!alive || !session || enCurso || hecho) return
      enCurso = true
      try {
        const p = await ensurePerfil(session.user)
        // El perfil se aplica de inmediato: si falla la consulta de aprobación,
        // la persona no queda atrapada en el splash con una sesión válida.
        if (alive) setPerfil(p)
        let dest: Screen = p.rol === 'tecnico' ? 'pending' : 'home'
        let ok = p.rol !== 'tecnico'
        try {
          const r = await destinoInicial(p)
          dest = r.dest; ok = r.aprobado
        } catch (e) { console.error(e) }
        hecho = true
        if (alive) { setAprobado(ok); resetNav(dest) }
      } catch (e) { console.error(e) }
      finally { enCurso = false; if (alive) setBooting(false) }
    }
    ;(async () => {
      try {
        if (limpiarArranque) await limpiarSesionDeArranque()
        const { data: { session } } = await supabase.auth.getSession()
        // En arranque en frío no se restaura nada: la sesión anterior se cerró.
        if (!limpiarArranque) await restaurar(session)
      } catch (e) { console.error(e) }
      finally { if (alive && !enCurso) setBooting(false) }
    })()
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT') {
        setPerfil(null); setWorker(null); setPedidoRate(null); setPedidoChat(null); setMetodoPago(null); resetNav('splash')
        hecho = false
        return
      }
      // PASSWORD_RECOVERY: el usuario abrió el enlace del correo. Se le pide la nueva contraseña.
      if (event === 'PASSWORD_RECOVERY') {
        resetNav('reset')
        return
      }
      // INITIAL_SESSION llega con la sesión persistida; cubre la carrera con getSession().
      if (event === 'INITIAL_SESSION' && !limpiarArranque) void restaurar(session)
    })
    return () => { alive = false; sub.subscription.unsubscribe() }
  }, [])

  // Enlaces vencidos o abiertos sin sesión: igual mostramos la pantalla de recuperación.
  useEffect(() => {
    if (esEnlaceRecuperacion(window.location.hash, window.location.search)) resetNav('reset')
  }, [])

  const onAuth = async (p: Perfil) => {
    const { dest, aprobado: ok } = await destinoInicial(p)
    setPerfil(p); setAprobado(ok); resetNav(dest)
    // El registro de push es opcional (solo app nativa); no bloquea el ingreso.
    registrarPush().catch(e => console.warn('Push no disponible:', e))
  }
  // Botón "Revisar estado": vuelve a consultar y, si ya fue aprobado, entra directo a Solicitudes
  const revisarAprobacion = async (): Promise<boolean> => {
    if (!perfil) return false
    const e = await getEstadoAprobacion(perfil.id)
    if (e.aprobado) { setAprobado(true); resetNav('orders') }
    return e.aprobado
  }
  const logout = async () => {
    await cerrarSesion()
    // Si la red falló, `signOut` no emite SIGNED_OUT: limpiamos la UI aquí.
    setPerfil(null); setWorker(null); setPedidoRate(null); setPedidoChat(null); setMetodoPago(null); resetNav('splash')
  }
  // Al terminar la recuperación, la sesión de Supabase ya es válida: entramos a la app.
  const finalizarRecuperacion = async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) { resetNav('auth'); return }
      const p = await ensurePerfil(session.user)
      const { dest, aprobado: ok } = await destinoInicial(p)
      setPerfil(p); setAprobado(ok); resetNav(dest)
    } catch (e) { console.error(e); resetNav('auth') }
  }
  const abrirChat = (p: Pedido, volver: Screen) => { setPedidoChat(p); setChatOrigen(volver); go('chat') }

  // Cuando el técnico marca el servicio como terminado, el cliente pasa directo a calificar.
  // Se espera a que esté en una pantalla segura para no perder un formulario o un mensaje del chat.
  // Depende de Supabase Realtime (migración 20261020). Si el canal no está disponible,
  // el cliente igual puede calificar desde el botón "Calificar al técnico" en Solicitudes.
  const autoRateRef = useRef<string>('')
  useEffect(() => {
    const cambio = live.ultimoCambio
    if (!perfil || perfil.rol !== 'cliente' || !cambio || cambio.estado !== 'completada') return
    if (!['home', 'orders', 'done', 'profile'].includes(screen)) return

    const clave = `${cambio.id}:${cambio.ts}`
    if (autoRateRef.current === clave) return
    autoRateRef.current = clave

    ;(async () => {
      try {
        const lista = await getPedidos(perfil)
        const p = lista.find(x => x.id === cambio.id)
        if (!p) return
        setPedidoRate(p)
        // Si ya había calificado, no se le repite el formulario: va al pago en Solicitudes.
        go(p.calificada ? 'orders' : 'rate')
      } catch (e) { console.error(e) }
    })()
  }, [live.ultimoCambio, perfil, screen])

  const needsSession = screen !== 'splash' && screen !== 'auth' && screen !== 'reset'
  let current: Screen = needsSession && !perfil ? 'splash' : screen
  // El técnico no ve nunca las pantallas de cliente; y sin aprobación no entra a la conexión.
  if (perfil?.rol === 'tecnico') {
    if (['home', 'worker', 'request', 'confirm'].includes(current)) current = 'orders' // 'rate' sí: el técnico califica al cliente
    if ((current === 'orders' || current === 'done') && !aprobado) current = 'pending'
  }
  const needsWorker = current === 'worker' || current === 'request' || current === 'confirm'

  let content: ReactNode
  if (booting) content = <BrandLoader />
  else if (current === 'splash') content = <SplashScreen openAuth={t => { setAuthTab(t); go('auth') }} />
  else if (current === 'auth') content = <AuthScreen initialTab={authTab} go={go} onAuth={onAuth} />
  else if (current === 'reset') content = <ResetPasswordScreen onDone={finalizarRecuperacion} />
  else if (!perfil || (needsWorker && !worker) || (current === 'rate' && !pedidoRate) || (current === 'chat' && !pedidoChat)) content = <SplashScreen openAuth={t => { setAuthTab(t); go('auth') }} />
  else {
    switch (current) {
      case 'home': content = <HomeScreen perfil={perfil} go={go} setWorker={setWorker} />; break
      case 'worker': content = <WorkerScreen worker={worker!} perfil={perfil} go={go} />; break
      case 'request': content = <RequestScreen worker={worker!} perfil={perfil} go={go} onCreated={m => { setMetodoPago(m); go('confirm') }} />; break
      case 'confirm': content = <ConfirmScreen worker={worker!} metodoPago={metodoPago} go={go} />; break
      case 'orders': content = <OrdersScreen perfil={perfil} go={go} onRate={setPedidoRate} onChat={abrirChat} />; break
      case 'done': content = <OrdersScreen perfil={perfil} go={go} onRate={setPedidoRate} onChat={abrirChat} modo="completadas" />; break
      case 'pending': content = <PendingScreen perfil={perfil} onRefresh={revisarAprobacion} onLogout={logout} />; break
      case 'rate': content = <RateScreen pedido={pedidoRate!} perfil={perfil} go={go} />; break
      case 'chat': content = <ChatScreen pedido={pedidoChat!} perfil={perfil} go={go} volver={chatOrigen} />; break
      case 'profile': content = <ProfileScreen perfil={perfil} go={go} onLogout={logout} />; break
      case 'help': content = <HelpScreen perfil={perfil} go={go} />; break
      case 'transactions': content = <TransactionsScreen perfil={perfil} go={go} />; break
      case 'notifications': content = <NotificationsScreen perfil={perfil} go={go} />; break
      case 'referrals': content = <ReferralsScreen perfil={perfil} go={go} />; break
      case 'agenda': content = <AgendaScreen perfil={perfil} go={go} />; break
      case 'portfolio': content = <PortfolioScreen perfil={perfil} go={go} />; break
      case 'earnings': content = <EarningsScreen perfil={perfil} go={go} />; break
      case 'v1': content = <V1Screen perfil={perfil} draft={draft} setDraft={setDraft} go={go} />; break
      case 'v2': content = <V2Screen draft={draft} go={go} usuarioId={perfil.id} />; break
      default: content = <V3Screen go={go} />
    }
  }

  return (
    <div className="h-[100dvh] w-full flex justify-center items-stretch md:items-center" style={{ background: `linear-gradient(160deg, #00001E 0%, ${N} 55%, #0A0A4A 100%)` }}>
      <div className="relative w-full max-w-[430px] h-full md:h-[860px] md:max-h-[94dvh] md:rounded-[32px] md:border overflow-hidden flex flex-col"
        style={{ backgroundColor: current === 'splash' || booting ? N : BG, borderColor: '#2a3535', paddingTop: 'env(safe-area-inset-top)' }}>
        <LiveCtx.Provider value={{ version: live.version, pendientes: live.pendientes, conectado: live.conectado, rol: perfil?.rol ?? null }}>
          <div className="flex-1 min-h-0 overflow-hidden"><Boundary>{content}</Boundary></div>
        </LiveCtx.Provider>
        {live.aviso && (
          <button key={live.aviso.id} role="status" aria-live="polite" className="toast-in absolute left-3 right-3 z-50 flex items-center gap-3 px-4 py-3.5 rounded-2xl text-left"
            style={{ top: 'max(12px, env(safe-area-inset-top))', backgroundColor: N, color: W, border: `1px solid ${G}`, boxShadow: '0 12px 32px rgba(0,0,50,0.35)' }}
            onClick={() => { live.cerrarAviso(); go('orders') }}>
            <span className="flex-1 text-sm font-bold">{live.aviso.texto}</span>
            <span className="text-xs font-extrabold px-3 py-1.5 rounded-xl" style={{ backgroundColor: G, color: N }}>Ver</span>
          </button>
        )}
      </div>
    </div>
  )
}
