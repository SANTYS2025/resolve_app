import { useState, useEffect, useRef, Component } from 'react'
import type { ReactNode } from 'react'
import type { Rol } from './lib/api'

export const N = '#0b1c2d', G = '#10b981', GL = '#d1fae5', BG = '#f4fbf7', MU = '#5a7a6a', BD = '#c8e6d8', W = '#ffffff'
export const PRIMARY = 'linear-gradient(135deg, #12D48A, #10b981)'
export const INPUT = 'w-full px-4 py-3 text-sm rounded-2xl border outline-none'
export const INPUT_STYLE = { borderColor: BD, backgroundColor: W }

export type Screen =
  | 'splash' | 'auth' | 'home' | 'worker' | 'request' | 'confirm' | 'rate' | 'orders' | 'agenda'
  | 'profile' | 'admin' | 'face' | 'v1' | 'v2' | 'v3' | 'v4'
export type AuthTab = 'login' | 'register'
export type NavFn = (s: Screen) => void
export type Draft = { name: string; phone: string; cedula: string }
export type FaceCtx = { modo: 'login' | 'trabajo'; solicitudId?: number }

export const CAT_STYLE: Record<string, { bg: string; color: string }> = {
  Electricidad: { bg: '#FEF3C7', color: '#D97706' }, 'Plomería': { bg: '#DBEAFE', color: '#1D4ED8' },
  'Carpintería': { bg: '#FEF9C3', color: '#92400E' }, Pintura: { bg: '#FCE7F3', color: '#9D174D' },
  'Albañilería': { bg: '#FEE2E2', color: '#991B1B' },
}
export const DEFAULT_CAT = { bg: GL, color: '#065F46' }
export const DIAS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb']
export const DIAS_LARGO = ['', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'] // ISO 1..7
export const ESTADO: Record<string, { label: string; bg: string; color: string }> = {
  pendiente: { label: 'Pendiente', bg: '#FEF3C7', color: '#92400E' },
  aceptada: { label: 'Aceptada', bg: '#DBEAFE', color: '#1D4ED8' },
  en_curso: { label: 'En curso', bg: '#E0E7FF', color: '#3730A3' },
  completada: { label: 'Terminada', bg: GL, color: '#065F46' },
  rechazada: { label: 'Rechazada', bg: '#FEE2E2', color: '#991B1B' },
  expirada: { label: 'Sin respuesta', bg: '#F3F4F6', color: '#4B5563' },
  cancelada: { label: 'Cancelada', bg: '#F3F4F6', color: '#4B5563' },
}
export const todayLocal = () => new Date().toLocaleDateString('en-CA')

export function BottomNav({ active, go, rol }: { active: Screen; go: NavFn; rol: Rol }) {
  const tabs: { icon: string; label: string; s: Screen }[] =
    rol === 'admin'
      ? [{ icon: '✅', label: 'Verificaciones', s: 'admin' }, { icon: '👤', label: 'Perfil', s: 'profile' }]
      : rol === 'tecnico'
        ? [{ icon: '📋', label: 'Solicitudes', s: 'orders' }, { icon: '🗓️', label: 'Agenda', s: 'agenda' }, { icon: '👤', label: 'Perfil', s: 'profile' }]
        : [{ icon: '🏠', label: 'Inicio', s: 'home' }, { icon: '📋', label: 'Pedidos', s: 'orders' }, { icon: '👤', label: 'Perfil', s: 'profile' }]
  return (
    <nav className="flex-shrink-0 flex border-t" style={{ borderColor: BD, backgroundColor: W, paddingBottom: 'max(12px, env(safe-area-inset-bottom))' }}>
      {tabs.map(t => (
        <button key={t.label} onClick={() => go(t.s)} className="flex-1 flex flex-col items-center pt-2.5 gap-0.5"
          style={{ color: active === t.s ? G : '#9BB5A8' }}>
          <span className="text-xl leading-none">{t.icon}</span>
          <span className="text-[9px] font-semibold">{t.label}</span>
        </button>
      ))}
    </nav>
  )
}

export function dataUrlToBlob(url: string): Blob {
  const [h, d] = url.split(',')
  const mime = h.match(/:(.*?);/)?.[1] ?? 'image/jpeg'
  const bin = atob(d)
  const u = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i)
  return new Blob([u], { type: mime })
}

/** Reduce y convierte a JPEG (máx. `max` px por lado) para subir menos datos. */
export async function resizeToJpeg(file: Blob, max = 1280): Promise<Blob> {
  const bmp = await createImageBitmap(file)
  const s = Math.min(1, max / Math.max(bmp.width, bmp.height))
  const c = document.createElement('canvas')
  c.width = Math.round(bmp.width * s)
  c.height = Math.round(bmp.height * s)
  c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height)
  return new Promise((res, rej) =>
    c.toBlob(b => (b ? res(b) : rej(new Error('No se pudo procesar la imagen'))), 'image/jpeg', 0.85))
}

/** Cámara frontal en vivo (no permite elegir fotos de la galería). */
export function Camera({ onCapture }: { onCapture: (b64: string, blob: Blob) => void }) {
  const video = useRef<HTMLVideoElement>(null)
  const [err, setErr] = useState('')
  const [ready, setReady] = useState(false)

  useEffect(() => {
    let stream: MediaStream | null = null
    let alive = true
    if (!navigator.mediaDevices?.getUserMedia) {
      setErr('Tu navegador no permite usar la cámara (se requiere HTTPS).')
      return
    }
    navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 720 } }, audio: false })
      .then(s => {
        if (!alive) { s.getTracks().forEach(t => t.stop()); return }
        stream = s
        if (video.current) { video.current.srcObject = s; setReady(true) }
      })
      .catch(() => setErr('No pudimos acceder a la cámara. Revisa los permisos del navegador.'))
    return () => { alive = false; stream?.getTracks().forEach(t => t.stop()) }
  }, [])

  const tomar = () => {
    const v = video.current
    if (!v || !v.videoWidth) return
    const s = Math.min(1, 800 / v.videoWidth)
    const c = document.createElement('canvas')
    c.width = Math.round(v.videoWidth * s)
    c.height = Math.round(v.videoHeight * s)
    c.getContext('2d')!.drawImage(v, 0, 0, c.width, c.height)
    const url = c.toDataURL('image/jpeg', 0.85)
    onCapture(url.split(',')[1], dataUrlToBlob(url))
  }

  if (err) return <div className="px-3 py-3 rounded-2xl text-xs font-semibold" style={{ backgroundColor: '#FEF2F2', color: '#B91C1C' }}>{err}</div>
  return (
    <div className="space-y-3">
      <div className="rounded-3xl overflow-hidden" style={{ backgroundColor: N, aspectRatio: '3 / 4' }}>
        <video ref={video} playsInline muted autoPlay className="w-full h-full object-cover" style={{ transform: 'scaleX(-1)' }} />
      </div>
      <button onClick={tomar} disabled={!ready} className="w-full py-3.5 rounded-2xl font-extrabold text-sm"
        style={{ background: ready ? PRIMARY : BD, color: N }}>📸 Tomar foto</button>
    </div>
  )
}

export function Stars({ r, size = 11 }: { r: number; size?: number }) {
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

export function VBadge() {
  return (
    <span className="inline-flex items-center gap-0.5 text-[9px] font-bold px-1.5 py-0.5 rounded-full"
      style={{ backgroundColor: GL, color: '#065F46' }}>
      <svg width="7" height="7" viewBox="0 0 8 8">
        <circle cx="4" cy="4" r="3.5" fill={G} />
        <path d="M2.5 4l1.2 1.2 2.3-2.3" stroke="white" strokeWidth="1.1" strokeLinecap="round" />
      </svg>
      Verificado
    </span>
  )
}

export function Avatar({ w }: { w: { name: string; avatar: string } }) {
  return w.avatar
    ? <img src={w.avatar} alt={w.name} loading="lazy" className="w-full h-full object-cover" />
    : <div className="w-full h-full flex items-center justify-center font-extrabold text-white" style={{ backgroundColor: G }}>
        {w.name.charAt(0).toUpperCase()}
      </div>
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <label className="text-[10px] font-bold mb-1.5 block uppercase" style={{ color: MU }}>{label}</label>
      {children}
    </div>
  )
}

export function ErrorBox({ msg, ok = false }: { msg: string; ok?: boolean }) {
  if (!msg) return null
  return (
    <div role="alert" className="px-3.5 py-3 rounded-2xl text-xs font-semibold"
      style={ok ? { backgroundColor: GL, color: '#065F46', border: `1px solid ${G}60` }
                : { backgroundColor: '#FEF2F2', color: '#B91C1C', border: '1px solid #FECACA' }}>
      {msg}
    </div>
  )
}

export function PrimaryBtn({ children, onClick, disabled }: { children: ReactNode; onClick: () => void; disabled?: boolean }) {
  return (
    <button onClick={onClick} disabled={disabled} className="w-full py-4 rounded-2xl font-extrabold text-sm"
      style={{ background: disabled ? BD : PRIMARY, color: N, cursor: disabled ? 'wait' : 'pointer',
               boxShadow: disabled ? undefined : '0 6px 20px rgba(16,185,129,0.32)' }}>
      {children}
    </button>
  )
}

export function DarkHeader({ onBack, backLabel = '← Volver', children }: { onBack?: () => void; backLabel?: string; children?: ReactNode }) {
  return (
    <div className="flex-shrink-0 px-4 pt-3 pb-4" style={{ background: `linear-gradient(135deg, ${N}, #0e2840)` }}>
      {onBack && <button onClick={onBack} className="text-[10px] mb-2" style={{ color: 'rgba(255,255,255,0.5)' }}>{backLabel}</button>}
      {children}
    </div>
  )
}

export function Loading({ text = 'Cargando…' }: { text?: string }) {
  return <p className="text-xs text-center py-6" style={{ color: MU }}>{text}</p>
}

export class Boundary extends Component<{ children: ReactNode }, { err: boolean }> {
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

