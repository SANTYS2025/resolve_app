/**
 * Pantallas y bloques de las funciones 7–30.
 *
 * Se mantienen en un módulo aparte para no reescribir `App.tsx`. Usan las
 * mismas convenciones visuales y solo llaman a las capas `src/lib/*`; ninguna
 * llave de pasarela ni token de FCM vive aquí.
 */

import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import type { Pedido, Perfil } from '../lib/api'
import { errMsg, fmt, getMiTecnicoId, useData } from '../lib/api'
import { supabase } from '../lib/supabase'
import { CATEGORIAS_REPORTE, getMisFavoritos, getReportesSolicitud, reportarProblema, alternarFavorito } from '../lib/clientesExtras'
import type { ReporteProblema } from '../lib/clientesExtras'
import { buscarFaq, CATEGORIAS_TICKET, nombreCategoria, validarTicket } from '../lib/soporte'
import type { CategoriaTicket } from '../lib/soporte'
import { crearTicket, getMisTickets } from '../lib/soporteApi'
import type { TicketSoporte } from '../lib/soporteApi'
import {
  getMisTransacciones, getEventosTransaccion, getReembolsos, solicitarReembolso,
} from '../lib/transacciones'
import type { Reembolso, Transaccion, TransaccionEvento } from '../lib/transacciones'
import { resumenGanancias, resumenGastos } from '../lib/ganancias'
import type { TransaccionResumen } from '../lib/ganancias'
import { etiquetaEta, urlUbicacionTecnico } from '../lib/geo'
import type { Punto } from '../lib/geo'
import { usePublicarUbicacion, useUbicacionEnVivo } from '../lib/ubicacion'
import { getPreferencias, guardarPreferencias, marcarNotificacionLeida, marcarTodasLeidas, useNotificacionesEnVivo } from '../lib/notificacionesApi'
import type { PreferenciasNotificacion } from '../lib/notificaciones'
import { etiquetaTipoNotificacion } from '../lib/notificaciones'
import { registrarPush } from '../lib/push'
import { aplicarCuponSolicitud, getCobertura, getMiCodigoReferido, getMisReferidos, validarCuponServidor, vincularReferido } from '../lib/crecimiento'
import type { Cobertura, Referido } from '../lib/crecimiento'
import { enlaceReferido, recompensaReferido } from '../lib/referidos'
import {
  crearBloqueo, eliminarBloqueo, eliminarPortafolio, getDisponibilidadReal, getMisDocumentos,
  getPortafolio, guardarDocumento, guardarPortafolio, subirArchivoTecnico,
  TIPOS_DOCUMENTO, urlFirmadaDocumento, urlPublicaPortafolio,
} from '../lib/tecnicosExtras'
import type { DocumentoTecnico, PortafolioItem } from '../lib/tecnicosExtras'
import { resumenAgenda } from '../lib/disponibilidad'
import { validarNuevaPassword } from '../lib/auth'

/* ═════════ Primitivas visuales (mismas convenciones de App.tsx) ═════════ */
const N = '#000032', G = '#2EDF2D', GD = '#14802A', GL = '#DDFBDD', BG = '#F4F8F4', MU = '#566A5B', BD = '#D3E2D4', W = '#ffffff'
const PRIMARY = 'linear-gradient(135deg, #3BEF3A, #25C92B)'
const INPUT = 'w-full px-4 min-h-[48px] py-3 text-base rounded-2xl border outline-none focus:ring-2 focus:ring-[#2EDF2D]'
const INPUT_STYLE = { borderColor: BD, backgroundColor: W }

const cop = (centavos: number) => fmt(Math.round(centavos / 100))
const fechaHora = (iso: string) => new Date(iso).toLocaleString('es-CO', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })
const hoy = () => new Date().toLocaleDateString('en-CA')

function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-3xl ${className}`} style={{ backgroundColor: W, border: `1px solid ${BD}`, boxShadow: '0 2px 10px rgba(0,0,50,0.05)' }}>{children}</div>
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
        : { backgroundColor: '#FEF2F2', color: '#B91C1C', border: '1px solid #FECACA' }}>{msg}</div>
  )
}

function PrimaryBtn({ children, onClick, disabled }: { children: ReactNode; onClick: () => void; disabled?: boolean }) {
  return (
    <button onClick={onClick} disabled={disabled} className="w-full min-h-[52px] px-5 rounded-2xl font-extrabold text-base"
      style={{ background: PRIMARY, color: N, opacity: disabled ? 0.55 : 1, cursor: disabled ? 'not-allowed' : 'pointer' }}>{children}</button>
  )
}

function SecondaryBtn({ children, onClick, disabled, tone = 'neutral' }: { children: ReactNode; onClick: () => void; disabled?: boolean; tone?: 'neutral' | 'danger' }) {
  const danger = tone === 'danger'
  return (
    <button onClick={onClick} disabled={disabled} className="w-full min-h-[48px] px-5 rounded-2xl font-bold text-sm border"
      style={{ borderColor: danger ? '#FECACA' : BD, color: danger ? '#B91C1C' : N, backgroundColor: W, opacity: disabled ? 0.6 : 1 }}>{children}</button>
  )
}

function BackBtn({ onClick, label = 'Volver' }: { onClick: () => void; label?: string }) {
  return (
    <button onClick={onClick} className="flex items-center gap-1 min-h-[44px] -ml-2 pl-1 pr-3 text-sm font-semibold" style={{ color: 'rgba(255,255,255,0.75)' }}>
      <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true"><path d="M12 4l-6 6 6 6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
      {label.replace(/^←\s*/, '')}
    </button>
  )
}

function DarkHeader({ onBack, backLabel = 'Volver', children }: { onBack: () => void; backLabel?: string; children: ReactNode }) {
  return (
    <header className="flex-shrink-0 px-4 pb-4" style={{ background: `linear-gradient(135deg, ${N}, #0A0A55)`, paddingTop: 4 }}>
      <BackBtn onClick={onBack} label={backLabel} />
      {children}
    </header>
  )
}

function Loading({ text = 'Cargando…' }: { text?: string }) {
  return <p className="text-sm text-center py-6" role="status" style={{ color: MU }}>{text}</p>
}

function SectionTitle({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="flex items-center justify-between mb-3">
      <h3 className="text-sm font-extrabold uppercase tracking-wider" style={{ color: N }}>{children}</h3>
      {right}
    </div>
  )
}

function Toggle({ on, onChange, label, description }: { on: boolean; onChange: (v: boolean) => void; label: string; description?: string }) {
  return (
    <button type="button" role="switch" aria-checked={on} onClick={() => onChange(!on)}
      className="w-full flex items-center gap-3 px-4 py-3.5 text-left" style={{ borderBottom: `1px solid ${BD}` }}>
      <span className="flex-1 min-w-0">
        <span className="block text-sm font-bold" style={{ color: N }}>{label}</span>
        {description && <span className="block text-xs mt-0.5" style={{ color: MU }}>{description}</span>}
      </span>
      <span className="w-12 h-7 rounded-full flex-shrink-0 relative transition-colors" style={{ backgroundColor: on ? G : '#D1D5DB' }}>
        <span className="absolute top-1 w-5 h-5 rounded-full bg-white transition-all" style={{ left: on ? 24 : 4, boxShadow: '0 1px 4px rgba(0,0,0,0.25)' }} />
      </span>
    </button>
  )
}

/* ═════════ Centro de ayuda y soporte ═════════ */
export function HelpScreen({ go, perfil, solicitudId }: { go: (s: 'profile') => void; perfil: Perfil; solicitudId?: number | null }) {
  const [q, setQ] = useState('')
  const [cat, setCat] = useState<CategoriaTicket | null>(null)
  const [form, setForm] = useState<{ categoria: CategoriaTicket; asunto: string; descripcion: string }>({ categoria: 'pago', asunto: '', descripcion: '' })
  const [version, setVersion] = useState(0)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [ok, setOk] = useState('')
  const tickets = useData(getMisTickets, [perfil.id, version], [] as TicketSoporte[])
  const faqs = useMemo(() => buscarFaq(q, cat), [q, cat])

  const enviar = async () => {
    setMsg(''); setOk('')
    const err = validarTicket({ ...form, solicitudId })
    if (err) return setMsg(err)
    setBusy(true)
    try {
      await crearTicket({ ...form, solicitudId })
      setOk('Ticket creado. Te responderemos por la bandeja de notificaciones.')
      setForm({ categoria: form.categoria, asunto: '', descripcion: '' })
      setVersion(v => v + 1)
    } catch (e) { console.error(e); setMsg(errMsg(e)) }
    finally { setBusy(false) }
  }

  return (
    <div className="flex flex-col h-full" style={{ backgroundColor: BG }}>
      <DarkHeader onBack={() => go('profile')} backLabel="← Perfil">
        <h2 className="text-xl font-extrabold text-white">Ayuda y soporte</h2>
        <p className="text-xs mt-1" style={{ color: 'rgba(255,255,255,0.65)' }}>Respuestas rápidas y un canal para contarnos qué pasó.</p>
      </DarkHeader>
      <div className="flex-1 overflow-y-auto px-4 pt-4 pb-safe space-y-4" style={{ scrollbarWidth: 'none' }}>
        <input type="search" value={q} onChange={e => setQ(e.target.value)} placeholder="Buscar en las preguntas frecuentes…"
          aria-label="Buscar ayuda" className={INPUT} style={INPUT_STYLE} />
        <div className="flex flex-wrap gap-2">
          <button onClick={() => setCat(null)} className="min-h-[40px] px-3 rounded-full text-xs font-bold"
            style={{ backgroundColor: cat === null ? N : GL, color: cat === null ? W : N, border: `1px solid ${BD}` }}>Todo</button>
          {CATEGORIAS_TICKET.map(c => (
            <button key={c.id} onClick={() => setCat(c.id)} className="min-h-[40px] px-3 rounded-full text-xs font-bold"
              style={{ backgroundColor: cat === c.id ? N : GL, color: cat === c.id ? W : N, border: `1px solid ${BD}` }}>{c.icono} {c.nombre}</button>
          ))}
        </div>

        <div>
          <SectionTitle>{faqs.length} respuestas</SectionTitle>
          <div className="space-y-2">
            {faqs.map(f => (
              <details key={f.id} className="rounded-2xl px-4 py-3" style={{ backgroundColor: W, border: `1px solid ${BD}` }}>
                <summary className="text-sm font-bold cursor-pointer" style={{ color: N }}>{f.pregunta}</summary>
                <p className="text-sm leading-relaxed mt-2" style={{ color: MU }}>{f.respuesta}</p>
              </details>
            ))}
            {faqs.length === 0 && <p className="text-sm text-center py-6" style={{ color: MU }}>No encontramos respuestas para esa búsqueda. Escríbenos abajo.</p>}
          </div>
        </div>

        <Card className="p-4 space-y-3">
          <SectionTitle>Crear un ticket</SectionTitle>
          <Field label="Categoría">
            <select value={form.categoria} onChange={e => setForm({ ...form, categoria: e.target.value as CategoriaTicket })} className={INPUT} style={INPUT_STYLE}>
              {CATEGORIAS_TICKET.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
            </select>
          </Field>
          <Field label="Asunto *">
            <input value={form.asunto} maxLength={120} onChange={e => setForm({ ...form, asunto: e.target.value })} placeholder="Resumen corto" className={INPUT} style={INPUT_STYLE} />
          </Field>
          <Field label="¿Qué pasó? *">
            <textarea rows={4} maxLength={2000} value={form.descripcion} onChange={e => setForm({ ...form, descripcion: e.target.value })}
              placeholder="Cuéntanos con detalle (mínimo 20 caracteres)…" className={`${INPUT} resize-none`} style={INPUT_STYLE} />
          </Field>
          {solicitudId && <p className="text-xs" style={{ color: MU }}>Se vinculará a la solicitud #{solicitudId}.</p>}
          <ErrorBox msg={msg} />
          {ok && <ErrorBox ok msg={ok} />}
          <PrimaryBtn onClick={enviar} disabled={busy}>{busy ? 'Enviando…' : 'Enviar ticket'}</PrimaryBtn>
        </Card>

        <div>
          <SectionTitle right={tickets.data.length > 0 ? <span className="text-xs" style={{ color: MU }}>{tickets.data.length} en total</span> : undefined}>Mis tickets</SectionTitle>
          {tickets.loading && tickets.data.length === 0 && <Loading />}
          {tickets.error && <ErrorBox msg={tickets.error} />}
          {!tickets.loading && tickets.data.length === 0 && <p className="text-sm text-center py-4" style={{ color: MU }}>Aún no has abierto tickets.</p>}
          <div className="space-y-2">
            {tickets.data.map(t => (
              <div key={t.id} className="rounded-2xl px-4 py-3" style={{ backgroundColor: W, border: `1px solid ${BD}` }}>
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm font-bold" style={{ color: N }}>{t.asunto}</p>
                  <span className="text-[11px] font-bold px-2 py-0.5 rounded-full" style={{ backgroundColor: GL, color: GD }}>{t.estado.replace('_', ' ')}</span>
                </div>
                <p className="text-xs mt-1" style={{ color: MU }}>{nombreCategoria(t.categoria)} · {fechaHora(t.creadoEn)}</p>
                {t.respuesta && <p className="text-sm mt-2 rounded-xl px-3 py-2" style={{ backgroundColor: GL, color: N }}>{t.respuesta}</p>}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

/* ═════════ Historial de pagos, comisiones y reembolsos ═════════ */
const TX_ESTADO: Record<string, { label: string; bg: string; color: string }> = {
  pendiente: { label: 'Pendiente', bg: '#FEF3C7', color: '#92400E' },
  aprobada: { label: 'Aprobada', bg: GL, color: '#065F46' },
  declinada: { label: 'Declinada', bg: '#FEE2E2', color: '#991B1B' },
  error: { label: 'Error', bg: '#FEE2E2', color: '#991B1B' },
  anulada: { label: 'Anulada', bg: '#F3F4F6', color: '#4B5563' },
  reembolsada: { label: 'Reembolsada', bg: '#DBEAFE', color: '#1D4ED8' },
  reembolso_parcial: { label: 'Reembolso parcial', bg: '#DBEAFE', color: '#1D4ED8' },
}

function TxBadge({ estado }: { estado: string }) {
  const c = TX_ESTADO[estado] ?? TX_ESTADO.pendiente
  return <span className="text-[11px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap" style={{ backgroundColor: c.bg, color: c.color }}>{c.label}</span>
}

function DetalleTx({ id }: { id: number }) {
  const eventos = useData(() => getEventosTransaccion(id), [id], [] as TransaccionEvento[])
  const reembolsos = useData(() => getReembolsos(id), [id], [] as Reembolso[])
  if (eventos.loading && reembolsos.loading) return <Loading text="Cargando detalle…" />
  return (
    <div className="mt-3 pt-3 space-y-3" style={{ borderTop: `1px dashed ${BD}` }}>
      {eventos.error && <ErrorBox msg={eventos.error} />}
      {reembolsos.error && <ErrorBox msg={reembolsos.error} />}
      <div>
        <p className="text-[11px] font-extrabold uppercase tracking-wider mb-1" style={{ color: MU }}>Eventos</p>
        {eventos.data.length === 0 ? <p className="text-xs" style={{ color: MU }}>Sin eventos.</p> : (
          <ol className="space-y-1.5">
            {eventos.data.map(e => (
              <li key={e.id} className="text-xs" style={{ color: N }}>
                <strong>{e.tipo.replace(/_/g, ' ')}</strong> · {fechaHora(e.creadoEn)}
              </li>
            ))}
          </ol>
        )}
      </div>
      <div>
        <p className="text-[11px] font-extrabold uppercase tracking-wider mb-1" style={{ color: MU }}>Reembolsos</p>
        {reembolsos.data.length === 0 ? <p className="text-xs" style={{ color: MU }}>Sin reembolsos.</p> : (
          <ul className="space-y-1.5">
            {reembolsos.data.map(r => (
              <li key={r.id} className="text-xs" style={{ color: N }}>
                {cop(r.montoCentavos)} · {r.estado} · {r.motivo}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

export function TransactionsScreen({ perfil, go }: { perfil: Perfil; go: (s: 'profile') => void }) {
  const [version, setVersion] = useState(0)
  const [abierta, setAbierta] = useState<number | null>(null)
  const [refundTx, setRefundTx] = useState<number | null>(null)
  const [monto, setMonto] = useState('')
  const [motivo, setMotivo] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [ok, setOk] = useState('')
  const tecnicoId = useData(() => perfil.rol === 'tecnico' ? getMiTecnicoId(perfil.id) : Promise.resolve(null), [perfil.id, perfil.rol], null as number | null)
  const txs = useData(getMisTransacciones, [perfil.id, version], [] as Transaccion[])

  const visibles = useMemo(() => txs.data.filter(t => perfil.rol === 'tecnico'
    ? (tecnicoId.data == null || t.tecnicoId === tecnicoId.data)
    : t.clienteId === perfil.id), [txs.data, perfil, tecnicoId.data])

  // `ganancias.ts` usa `creadoEn`; las filas de Supabase traen `creadaEn`.
  const paraResumen = useMemo<TransaccionResumen[]>(() => visibles.map(t => ({
    estado: t.estado,
    montoCentavos: t.montoCentavos,
    comisionCentavos: t.comisionCentavos,
    netoCentavos: t.netoCentavos,
    reembolsadoCentavos: t.reembolsadoCentavos,
    creadoEn: t.creadaEn,
  })), [visibles])

  const resumenTecnico = useMemo(() => resumenGanancias(paraResumen), [paraResumen])
  const resumenCliente = useMemo(() => resumenGastos(paraResumen), [paraResumen])

  const abrirReembolso = (t: Transaccion) => {
    setRefundTx(t.id); setMsg(''); setOk('')
    const restante = Math.max(0, t.montoCentavos - t.reembolsadoCentavos)
    setMonto(String(Math.round(restante / 100)))
    setMotivo('')
  }

  const enviarReembolso = async (t: Transaccion) => {
    setMsg(''); setOk('')
    const restante = Math.max(0, t.montoCentavos - t.reembolsadoCentavos)
    const centavos = Math.round(Number(monto.replace(/[^\d]/g, '')) * 100)
    if (!Number.isFinite(centavos) || centavos <= 0) return setMsg('Escribe un monto válido.')
    if (centavos > restante) return setMsg(`El máximo reembolsable es ${cop(restante)}.`)
    if (motivo.trim().length < 10) return setMsg('Explica el motivo con al menos 10 caracteres.')
    setBusy(true)
    try {
      const r = await solicitarReembolso(t.id, centavos, motivo.trim())
      if (r.estado === 'error' || r.estado === 'fallido') setMsg(r.mensaje)
      else { setOk(r.mensaje); setRefundTx(null); setVersion(v => v + 1) }
    } catch (e) { console.error(e); setMsg(errMsg(e)) }
    finally { setBusy(false) }
  }

  return (
    <div className="flex flex-col h-full" style={{ backgroundColor: BG }}>
      <DarkHeader onBack={() => go('profile')} backLabel="← Perfil">
        <h2 className="text-xl font-extrabold text-white">{perfil.rol === 'tecnico' ? 'Ganancias y pagos' : 'Pagos y reembolsos'}</h2>
        <p className="text-xs mt-1" style={{ color: 'rgba(255,255,255,0.65)' }}>Cada cobro, comisión y reembolso queda registrado.</p>
      </DarkHeader>
      <div className="flex-1 overflow-y-auto px-4 pt-4 pb-safe space-y-4" style={{ scrollbarWidth: 'none' }}>
        <div className="grid grid-cols-2 gap-2.5">
          {perfil.rol === 'tecnico' ? (
            <>
              <Metric label="Bruto" value={cop(resumenTecnico.brutoCentavos)} />
              <Metric label="Neto" value={cop(resumenTecnico.netoCentavos)} highlight />
              <Metric label="Comisión Resolve" value={cop(resumenTecnico.comisionCentavos)} />
              <Metric label="Servicios" value={String(resumenTecnico.servicios)} />
            </>
          ) : (
            <>
              <Metric label="Pagado" value={cop(resumenCliente.totalCentavos)} highlight />
              <Metric label="Servicios" value={String(resumenCliente.servicios)} />
              <Metric label="Reembolsado" value={cop(resumenCliente.reembolsosCentavos)} />
              <Metric label="Transacciones" value={String(visibles.length)} />
            </>
          )}
        </div>

        <ErrorBox msg={msg} />
        {ok && <ErrorBox ok msg={ok} />}
        {txs.loading && visibles.length === 0 && <Loading text="Cargando transacciones…" />}
        {txs.error && <ErrorBox msg={txs.error} />}
        {!txs.loading && !txs.error && visibles.length === 0 && (
          <p className="text-sm text-center py-8" style={{ color: MU }}>Aún no hay transacciones registradas. Aparecerán cuando se confirme un pago.</p>
        )}

        <div className="space-y-2.5">
          {visibles.map(t => {
            const restante = Math.max(0, t.montoCentavos - t.reembolsadoCentavos)
            const puedeReembolsar = perfil.rol === 'cliente' && (t.estado === 'aprobada' || t.estado === 'reembolso_parcial') && restante > 0
            return (
              <Card key={t.id} className="p-4">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-extrabold" style={{ color: N }}>Solicitud #{t.solicitudId}</p>
                    <p className="text-xs mt-0.5" style={{ color: MU }}>{t.proveedor} · {t.referencia} · {fechaHora(t.creadaEn)}</p>
                  </div>
                  <TxBadge estado={t.estado} />
                </div>
                <div className="grid grid-cols-3 gap-2 mt-3 text-center">
                  <div><p className="text-[11px]" style={{ color: MU }}>Monto</p><p className="text-sm font-extrabold" style={{ color: N }}>{cop(t.montoCentavos)}</p></div>
                  <div><p className="text-[11px]" style={{ color: MU }}>Comisión</p><p className="text-sm font-extrabold" style={{ color: N }}>{cop(t.comisionCentavos)}</p></div>
                  <div><p className="text-[11px]" style={{ color: MU }}>Neto</p><p className="text-sm font-extrabold" style={{ color: GD }}>{cop(t.netoCentavos)}</p></div>
                </div>
                {(t.reembolsadoCentavos > 0 || t.comisionReversadaCentavos > 0) && (
                  <p className="text-xs mt-2 rounded-xl px-3 py-2" style={{ backgroundColor: '#EFF6FF', color: '#1D4ED8' }}>
                    Reembolsado: {cop(t.reembolsadoCentavos)} · comisión reversada: {cop(t.comisionReversadaCentavos)}
                  </p>
                )}
                <div className="flex gap-2 mt-3">
                  <button onClick={() => setAbierta(abierta === t.id ? null : t.id)} className="flex-1 min-h-[40px] rounded-xl text-xs font-bold border" style={{ borderColor: BD, color: N }}>
                    {abierta === t.id ? 'Ocultar detalle' : 'Ver detalle'}
                  </button>
                  {puedeReembolsar && (
                    <button onClick={() => abrirReembolso(t)} className="flex-1 min-h-[40px] rounded-xl text-xs font-extrabold" style={{ backgroundColor: GL, color: GD, border: `1px solid ${G}70` }}>
                      Solicitar reembolso
                    </button>
                  )}
                </div>
                {abierta === t.id && <DetalleTx id={t.id} />}
                {refundTx === t.id && (
                  <div className="mt-3 rounded-2xl p-3 space-y-2" style={{ backgroundColor: '#F7FAF7', border: `1px solid ${BD}` }}>
                    <p className="text-xs font-extrabold" style={{ color: N }}>Máximo reembolsable: {cop(restante)}</p>
                    <Field label="Monto en COP">
                      <input value={monto} onChange={e => setMonto(e.target.value.replace(/[^\d]/g, ''))} inputMode="numeric" className={INPUT} style={INPUT_STYLE} />
                    </Field>
                    <Field label="Motivo *">
                      <textarea rows={2} maxLength={500} value={motivo} onChange={e => setMotivo(e.target.value)} className={`${INPUT} resize-none`} style={INPUT_STYLE} />
                    </Field>
                    <div className="flex gap-2">
                      <SecondaryBtn onClick={() => setRefundTx(null)} disabled={busy}>Cancelar</SecondaryBtn>
                      <PrimaryBtn onClick={() => enviarReembolso(t)} disabled={busy}>{busy ? 'Enviando…' : 'Enviar'}</PrimaryBtn>
                    </div>
                  </div>
                )}
              </Card>
            )
          })}
        </div>
      </div>
    </div>
  )
}

function Metric({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="rounded-2xl px-3 py-3" style={{ backgroundColor: highlight ? GL : W, border: `1px solid ${highlight ? G + '70' : BD}` }}>
      <p className="text-[11px] font-bold uppercase tracking-wide" style={{ color: MU }}>{label}</p>
      <p className="text-base font-extrabold mt-0.5" style={{ color: highlight ? GD : N }}>{value}</p>
    </div>
  )
}

/* ═════════ Notificaciones ═════════ */
export function NotificationsScreen({ perfil, go }: { perfil: Perfil; go: (s: 'profile') => void }) {
  const prefs = useData(getPreferencias, [perfil.id], null as PreferenciasNotificacion | null)
  const [p, setP] = useState<PreferenciasNotificacion | null>(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [ok, setOk] = useState('')
  const inbox = useNotificacionesEnVivo(perfil.id)

  useEffect(() => { if (prefs.data) setP(prefs.data) }, [prefs.data])

  const guardar = async (next: PreferenciasNotificacion) => {
    setP(next); setMsg(''); setOk('')
    try { await guardarPreferencias(next); setOk('Preferencias guardadas.') }
    catch (e) { console.error(e); setMsg(errMsg(e)) }
  }

  const activarPush = async () => {
    setBusy(true); setMsg(''); setOk('')
    try {
      const r = await registrarPush()
      if (r.estado === 'registrado') setOk(r.mensaje)
      else setMsg(r.mensaje)
    } catch (e) { console.error(e); setMsg(errMsg(e)) }
    finally { setBusy(false) }
  }

  return (
    <div className="flex flex-col h-full" style={{ backgroundColor: BG }}>
      <DarkHeader onBack={() => go('profile')} backLabel="← Perfil">
        <h2 className="text-xl font-extrabold text-white">Notificaciones</h2>
        <p className="text-xs mt-1" style={{ color: 'rgba(255,255,255,0.65)' }}>Tú decides qué avisos recibes. Los de seguridad siempre llegan.</p>
      </DarkHeader>
      <div className="flex-1 overflow-y-auto px-4 pt-4 pb-safe space-y-4" style={{ scrollbarWidth: 'none' }}>
        <Card className="overflow-hidden">
          {!p && <Loading text="Cargando preferencias…" />}
          {prefs.error && <div className="p-4"><ErrorBox msg={prefs.error} /></div>}
          {p && (
            <>
              <Toggle on={p.push_activo} onChange={v => guardar({ ...p, push_activo: v })} label="Notificaciones push" description="Avisos con la app cerrada (requiere la app móvil)." />
              <Toggle on={p.mensajes} onChange={v => guardar({ ...p, mensajes: v })} label="Mensajes del chat" description="Cuando la otra persona te escribe." />
              <Toggle on={p.estados_servicio} onChange={v => guardar({ ...p, estados_servicio: v })} label="Estado del servicio" description="Aceptado, en camino, llegó, terminado." />
              <Toggle on={p.pagos} onChange={v => guardar({ ...p, pagos: v })} label="Pagos y reembolsos" />
              <Toggle on={p.promociones} onChange={v => guardar({ ...p, promociones: v })} label="Promociones y referidos" description="Ofertas y recompensas." />
            </>
          )}
        </Card>

        <ErrorBox msg={msg} />
        {ok && <ErrorBox ok msg={ok} />}
        <SecondaryBtn onClick={activarPush} disabled={busy}>{busy ? 'Activando…' : 'Activar push en este dispositivo'}</SecondaryBtn>

        <div>
          <SectionTitle right={inbox.noLeidas > 0 ? <button onClick={async () => { await marcarTodasLeidas(); inbox.refrescar() }} className="text-xs font-bold underline" style={{ color: GD }}>Marcar todas leídas</button> : undefined}>
            Bandeja {inbox.noLeidas > 0 && <span className="ml-1 text-[11px] px-2 py-0.5 rounded-full" style={{ backgroundColor: G, color: N }}>{inbox.noLeidas}</span>}
          </SectionTitle>
          {inbox.loading && inbox.data.length === 0 && <Loading />}
          {inbox.error && <ErrorBox msg={inbox.error} />}
          {!inbox.loading && inbox.data.length === 0 && <p className="text-sm text-center py-6" style={{ color: MU }}>No tienes notificaciones todavía.</p>}
          <div className="space-y-2">
            {inbox.data.map(n => (
              <button key={n.id} onClick={async () => { if (!n.leida) { await marcarNotificacionLeida(n.id); inbox.refrescar() } }}
                className="w-full text-left rounded-2xl px-4 py-3" style={{ backgroundColor: n.leida ? W : GL, border: `1px solid ${n.leida ? BD : G + '70'}` }}>
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm font-bold" style={{ color: N }}>{n.titulo}</p>
                  <span className="text-[10px] font-bold uppercase tracking-wide flex-shrink-0" style={{ color: GD }}>{etiquetaTipoNotificacion(n.tipo)}</span>
                </div>
                <p className="text-xs mt-1 leading-relaxed" style={{ color: MU }}>{n.cuerpo}</p>
                <p className="text-[10px] mt-1.5" style={{ color: MU }}>{fechaHora(n.creadaEn)}{n.solicitudId ? ` · Solicitud #${n.solicitudId}` : ''}{n.leida ? ' · Leída' : ''}</p>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

/* ═════════ Referidos y cobertura ═════════ */
export function ReferralsScreen({ perfil, go }: { perfil: Perfil; go: (s: 'profile') => void }) {
  const [version, setVersion] = useState(0)
  const [codigo, setCodigo] = useState('')
  const [aplicar, setAplicar] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [ok, setOk] = useState('')
  const miCodigo = useData(getMiCodigoReferido, [perfil.id, version], '')
  const referidos = useData(() => getMisReferidos(perfil.id), [perfil.id, version], [] as Referido[])
  const cobertura = useData(getCobertura, [perfil.id], [] as Cobertura[])
  const premio = recompensaReferido()

  useEffect(() => { if (miCodigo.data) setCodigo(miCodigo.data) }, [miCodigo.data])

  const copiar = async () => {
    setMsg(''); setOk('')
    try {
      await navigator.clipboard.writeText(enlaceReferido(codigo))
      setOk('Enlace copiado. Compártelo con tus vecinos.')
    } catch { setMsg('No pudimos copiar el enlace. Selecciónalo y cópialo manualmente.') }
  }

  const vincular = async () => {
    setMsg(''); setOk(''); setBusy(true)
    try {
      await vincularReferido(aplicar)
      setOk('Código vinculado. La recompensa se registra cuando completes tu primer pago.')
      setAplicar(''); setVersion(v => v + 1)
    } catch (e) { console.error(e); setMsg(errMsg(e)) }
    finally { setBusy(false) }
  }

  return (
    <div className="flex flex-col h-full" style={{ backgroundColor: BG }}>
      <DarkHeader onBack={() => go('profile')} backLabel="← Perfil">
        <h2 className="text-xl font-extrabold text-white">Invita y gana</h2>
        <p className="text-xs mt-1" style={{ color: 'rgba(255,255,255,0.65)' }}>{premio.descripcion}</p>
      </DarkHeader>
      <div className="flex-1 overflow-y-auto px-4 pt-4 pb-safe space-y-4" style={{ scrollbarWidth: 'none' }}>
        <Card className="p-4">
          <p className="text-xs font-extrabold uppercase tracking-wider mb-1" style={{ color: MU }}>Tu código</p>
          <p className="text-2xl font-extrabold tracking-widest" style={{ color: N }}>{codigo || '…'}</p>
          <p className="text-xs mt-1 break-all" style={{ color: MU }}>{codigo ? enlaceReferido(codigo) : ''}</p>
          <div className="mt-3"><PrimaryBtn onClick={copiar} disabled={!codigo}>Copiar enlace para invitar</PrimaryBtn></div>
        </Card>

        <ErrorBox msg={msg} />
        {ok && <ErrorBox ok msg={ok} />}

        <Card className="p-4 space-y-2">
          <SectionTitle>¿Te invitaron?</SectionTitle>
          <Field label="Código de quien te invitó">
            <input value={aplicar} onChange={e => setAplicar(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 16))}
              placeholder="Ej: RESOLVE1234" className={INPUT} style={INPUT_STYLE} />
          </Field>
          <SecondaryBtn onClick={vincular} disabled={busy || aplicar.length < 5}>{busy ? 'Vinculando…' : 'Vincular código'}</SecondaryBtn>
          <p className="text-xs" style={{ color: MU }}>Solo se puede vincular una vez por cuenta.</p>
        </Card>

        <div>
          <SectionTitle>Mis invitados</SectionTitle>
          {referidos.loading && referidos.data.length === 0 && <Loading />}
          {referidos.error && <ErrorBox msg={referidos.error} />}
          {!referidos.loading && referidos.data.length === 0 && <p className="text-sm text-center py-4" style={{ color: MU }}>Aún no tienes invitados registrados.</p>}
          <div className="space-y-2">
            {referidos.data.map(r => (
              <div key={r.id} className="flex items-center justify-between gap-3 rounded-2xl px-4 py-3" style={{ backgroundColor: W, border: `1px solid ${BD}` }}>
                <div>
                  <p className="text-sm font-bold" style={{ color: N }}>{r.esInvitador ? 'Invitado por ti' : `Código ${r.codigo}`}</p>
                  <p className="text-xs" style={{ color: MU }}>{r.estado} · {fechaHora(r.creadoEn)}</p>
                </div>
                <span className="text-sm font-extrabold" style={{ color: GD }}>{fmt(r.recompensaCop)}</span>
              </div>
            ))}
          </div>
        </div>

        <div>
          <SectionTitle>Cobertura en Pasto</SectionTitle>
          {cobertura.loading && cobertura.data.length === 0 && <Loading />}
          {cobertura.error && <ErrorBox msg={cobertura.error} />}
          {!cobertura.loading && cobertura.data.length === 0 && <p className="text-sm text-center py-4" style={{ color: MU }}>La cobertura por barrio aún no está configurada.</p>}
          <div className="space-y-1.5">
            {cobertura.data.map(c => (
              <div key={c.barrioId} className="flex items-center justify-between gap-3 rounded-xl px-3.5 py-2.5" style={{ backgroundColor: W, border: `1px solid ${BD}` }}>
                <div className="min-w-0">
                  <p className="text-sm font-bold" style={{ color: N }}>{c.barrio}</p>
                  {c.nota && <p className="text-xs" style={{ color: MU }}>{c.nota}</p>}
                </div>
                <div className="text-right flex-shrink-0">
                  <span className="text-[11px] font-bold px-2 py-0.5 rounded-full" style={{ backgroundColor: c.activo ? GL : '#F3F4F6', color: c.activo ? GD : '#4B5563' }}>{c.activo ? 'Con cobertura' : 'Sin cobertura'}</span>
                  {c.recargoCop > 0 && <p className="text-[11px] mt-0.5" style={{ color: MU }}>+{fmt(c.recargoCop)}</p>}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

/* ═════════ Agenda y bloqueos del técnico ═════════ */
export function AgendaScreen({ perfil, go }: { perfil: Perfil; go: (s: 'profile') => void }) {
  const [version, setVersion] = useState(0)
  const [fecha, setFecha] = useState('')
  const [motivo, setMotivo] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [ok, setOk] = useState('')
  const tecnicoId = useData(() => getMiTecnicoId(perfil.id), [perfil.id], null as number | null)
  const disp = useData(
    () => tecnicoId.data == null ? Promise.resolve(null) : getDisponibilidadReal(tecnicoId.data),
    [tecnicoId.data, version],
    null as Awaited<ReturnType<typeof getDisponibilidadReal>> | null,
  )

  const bloquear = async () => {
    setMsg(''); setOk('')
    if (!fecha || fecha < hoy()) return setMsg('Elige una fecha de hoy en adelante.')
    setBusy(true)
    try { await crearBloqueo(fecha, motivo); setOk('Día bloqueado. No recibirás solicitudes esa fecha.'); setFecha(''); setMotivo(''); setVersion(v => v + 1) }
    catch (e) { console.error(e); setMsg(errMsg(e)) }
    finally { setBusy(false) }
  }

  const quitar = async (id: number) => {
    setMsg(''); setOk(''); setBusy(true)
    try { await eliminarBloqueo(id); setOk('Bloqueo eliminado.'); setVersion(v => v + 1) }
    catch (e) { console.error(e); setMsg(errMsg(e)) }
    finally { setBusy(false) }
  }

  return (
    <div className="flex flex-col h-full" style={{ backgroundColor: BG }}>
      <DarkHeader onBack={() => go('profile')} backLabel="← Perfil">
        <h2 className="text-xl font-extrabold text-white">Mi agenda</h2>
        <p className="text-xs mt-1" style={{ color: 'rgba(255,255,255,0.65)' }}>Horario semanal y días bloqueados.</p>
      </DarkHeader>
      <div className="flex-1 overflow-y-auto px-4 pt-4 pb-safe space-y-4" style={{ scrollbarWidth: 'none' }}>
        {disp.loading && !disp.data && <Loading text="Cargando agenda…" />}
        {disp.error && <ErrorBox msg={disp.error} />}
        {disp.data && (
          <Card className="p-4">
            <div className="flex items-center gap-2 mb-2">
              <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: disp.data.disponibleAhora ? G : '#F59E0B' }} />
              <p className="text-sm font-extrabold" style={{ color: N }}>{disp.data.disponibleAhora ? 'Disponible ahora' : 'Fuera de horario o día bloqueado'}</p>
            </div>
            <p className="text-xs leading-relaxed" style={{ color: MU }}>{resumenAgenda(disp.data.franjas) || 'No tienes franjas semanales configuradas.'}</p>
          </Card>
        )}

        <Card className="p-4 space-y-3">
          <SectionTitle>Bloquear un día</SectionTitle>
          <Field label="Fecha">
            <input type="date" min={hoy()} value={fecha} onChange={e => setFecha(e.target.value)} className={INPUT} style={INPUT_STYLE} />
          </Field>
          <Field label="Motivo (opcional)">
            <input value={motivo} maxLength={120} onChange={e => setMotivo(e.target.value)} placeholder="Ej: cita médica" className={INPUT} style={INPUT_STYLE} />
          </Field>
          <ErrorBox msg={msg} />
          {ok && <ErrorBox ok msg={ok} />}
          <PrimaryBtn onClick={bloquear} disabled={busy || !fecha}>{busy ? 'Guardando…' : 'Bloquear día'}</PrimaryBtn>
        </Card>

        <div>
          <SectionTitle>Días bloqueados</SectionTitle>
          {disp.data && disp.data.bloqueos.length === 0 && <p className="text-sm text-center py-4" style={{ color: MU }}>No tienes días bloqueados.</p>}
          <div className="space-y-2">
            {disp.data?.bloqueos.map(b => (
              <div key={b.id} className="flex items-center justify-between gap-3 rounded-2xl px-4 py-3" style={{ backgroundColor: W, border: `1px solid ${BD}` }}>
                <div>
                  <p className="text-sm font-bold" style={{ color: N }}>{new Date(b.fecha + 'T00:00:00').toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long' })}</p>
                  {b.motivo && <p className="text-xs" style={{ color: MU }}>{b.motivo}</p>}
                </div>
                <button onClick={() => quitar(b.id)} disabled={busy} className="min-h-[40px] px-3 rounded-xl text-xs font-bold" style={{ backgroundColor: '#FEF2F2', color: '#B91C1C' }}>Quitar</button>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

/* ═════════ Portafolio y documentos del técnico ═════════ */
export function PortfolioScreen({ perfil, go }: { perfil: Perfil; go: (s: 'profile') => void }) {
  const [tab, setTab] = useState<'portafolio' | 'documentos'>('portafolio')
  const [version, setVersion] = useState(0)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [ok, setOk] = useState('')
  const [pf, setPf] = useState({ titulo: '', descripcion: '', url: '' })
  const [pfFile, setPfFile] = useState<File | null>(null)
  const [doc, setDoc] = useState<{ tipo: DocumentoTecnico['tipo']; nombre: string; url: string }>({ tipo: 'certificado', nombre: '', url: '' })
  const [docFile, setDocFile] = useState<File | null>(null)
  const tecnicoId = useData(() => getMiTecnicoId(perfil.id), [perfil.id], null as number | null)
  const portafolio = useData(() => tecnicoId.data == null ? Promise.resolve([] as PortafolioItem[]) : getPortafolio(tecnicoId.data), [tecnicoId.data, version], [] as PortafolioItem[])
  const docs = useData(() => getMisDocumentos(perfil.id), [perfil.id, version], [] as DocumentoTecnico[])

  const agregarPf = async () => {
    setMsg(''); setOk('')
    if (pf.titulo.trim().length < 3) return setMsg('Escribe un título de al menos 3 caracteres.')
    if (!pfFile && !pf.url.trim()) return setMsg('Sube una foto o pega un enlace.')
    if (!pfFile && pf.url.trim() && !/^https?:\/\//.test(pf.url.trim())) return setMsg('El enlace debe empezar por http:// o https://.')
    if (pfFile && pfFile.size > 5 * 1024 * 1024) return setMsg('La foto no puede superar 5 MB.')
    setBusy(true)
    try {
      const archivoPath = pfFile ? await subirArchivoTecnico(perfil.id, 'portafolio', pfFile) : undefined
      await guardarPortafolio(perfil.id, { ...pf, archivoPath })
      setOk('Trabajo agregado a tu portafolio.')
      setPf({ titulo: '', descripcion: '', url: '' }); setPfFile(null)
      setVersion(v => v + 1)
    } catch (e) { console.error(e); setMsg(errMsg(e)) }
    finally { setBusy(false) }
  }

  const agregarDoc = async () => {
    setMsg(''); setOk('')
    if (doc.nombre.trim().length < 1) return setMsg('Escribe un nombre para el documento.')
    if (!docFile && !doc.url.trim()) return setMsg('Sube un archivo o pega un enlace.')
    if (!docFile && !/^https?:\/\//.test(doc.url.trim())) return setMsg('Pega un enlace válido (http:// o https://).')
    if (docFile && docFile.size > 10 * 1024 * 1024) return setMsg('El archivo no puede superar 10 MB.')
    setBusy(true)
    try {
      const archivoPath = docFile ? await subirArchivoTecnico(perfil.id, 'documento', docFile) : undefined
      await guardarDocumento(perfil.id, { ...doc, archivoPath })
      setOk('Documento registrado. Queda pendiente de revisión.')
      setDoc({ tipo: doc.tipo, nombre: '', url: '' }); setDocFile(null)
      setVersion(v => v + 1)
    } catch (e) { console.error(e); setMsg(errMsg(e)) }
    finally { setBusy(false) }
  }

  const abrirDocumento = async (d: DocumentoTecnico) => {
    setMsg('')
    try {
      const url = d.archivoPath ? await urlFirmadaDocumento(d.archivoPath) : d.url
      if (!url) return setMsg('Este documento no tiene archivo ni enlace.')
      window.open(url, '_blank', 'noopener,noreferrer')
    } catch (e) { console.error(e); setMsg(errMsg(e)) }
  }

  return (
    <div className="flex flex-col h-full" style={{ backgroundColor: BG }}>
      <DarkHeader onBack={() => go('profile')} backLabel="← Perfil">
        <h2 className="text-xl font-extrabold text-white">Portafolio y documentos</h2>
        <p className="text-xs mt-1" style={{ color: 'rgba(255,255,255,0.65)' }}>Muestra tu trabajo y mantén tus documentos al día.</p>
      </DarkHeader>
      <div className="flex-1 overflow-y-auto px-4 pt-4 pb-safe space-y-4" style={{ scrollbarWidth: 'none' }}>
        <div className="flex rounded-2xl p-1" style={{ backgroundColor: W, border: `1px solid ${BD}` }}>
          {(['portafolio', 'documentos'] as const).map(t => (
            <button key={t} onClick={() => setTab(t)} className="flex-1 min-h-[44px] rounded-xl text-sm font-bold capitalize"
              style={{ backgroundColor: tab === t ? N : 'transparent', color: tab === t ? W : MU }}>{t}</button>
          ))}
        </div>

        <ErrorBox msg={msg} />
        {ok && <ErrorBox ok msg={ok} />}

        {tab === 'portafolio' ? (
          <>
            <Card className="p-4 space-y-3">
              <SectionTitle>Agregar trabajo</SectionTitle>
              <Field label="Título *"><input value={pf.titulo} maxLength={100} onChange={e => setPf({ ...pf, titulo: e.target.value })} className={INPUT} style={INPUT_STYLE} /></Field>
              <Field label="Descripción"><textarea rows={2} maxLength={500} value={pf.descripcion} onChange={e => setPf({ ...pf, descripcion: e.target.value })} className={`${INPUT} resize-none`} style={INPUT_STYLE} /></Field>
              <Field label="Foto del trabajo (JPG, PNG o WebP · máx. 5 MB)">
                <input type="file" accept="image/jpeg,image/png,image/webp" onChange={e => setPfFile(e.target.files?.[0] ?? null)} className={INPUT} style={INPUT_STYLE} />
                {pfFile && <p className="text-xs mt-1" style={{ color: MU }}>{pfFile.name}</p>}
              </Field>
              <Field label="…o pega un enlace (opcional)"><input value={pf.url} onChange={e => setPf({ ...pf, url: e.target.value })} placeholder="https://…" className={INPUT} style={INPUT_STYLE} /></Field>
              <PrimaryBtn onClick={agregarPf} disabled={busy}>{busy ? 'Guardando…' : 'Publicar trabajo'}</PrimaryBtn>
            </Card>
            <div>
              <SectionTitle>{portafolio.data.length} trabajos publicados</SectionTitle>
              {portafolio.loading && portafolio.data.length === 0 && <Loading />}
              {portafolio.error && <ErrorBox msg={portafolio.error} />}
              {!portafolio.loading && portafolio.data.length === 0 && <p className="text-sm text-center py-4" style={{ color: MU }}>Aún no has publicado trabajos.</p>}
              <div className="space-y-2">
                {portafolio.data.map(p => (
                  <Card key={p.id} className="p-4">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-sm font-extrabold" style={{ color: N }}>{p.titulo}</p>
                        {p.descripcion && <p className="text-xs mt-1" style={{ color: MU }}>{p.descripcion}</p>}
                        {(p.url || p.archivoPath) && (
                          <a href={p.archivoPath ? urlPublicaPortafolio(p.archivoPath) : (p.url ?? '#')} target="_blank" rel="noopener noreferrer" className="text-xs font-bold underline" style={{ color: GD }}>Ver foto</a>
                        )}
                      </div>
                      <button onClick={async () => { await eliminarPortafolio(p.id); setVersion(v => v + 1) }} className="min-h-[36px] px-2 text-xs font-bold" style={{ color: '#B91C1C' }}>Eliminar</button>
                    </div>
                  </Card>
                ))}
              </div>
            </div>
          </>
        ) : (
          <>
            <Card className="p-4 space-y-3">
              <SectionTitle>Registrar documento</SectionTitle>
              <p className="text-xs" style={{ color: MU }}>Los documentos son privados: solo tú y el equipo de Resolve pueden verlos.</p>
              <Field label="Tipo">
                <select value={doc.tipo} onChange={e => setDoc({ ...doc, tipo: e.target.value as DocumentoTecnico['tipo'] })} className={INPUT} style={INPUT_STYLE}>
                  {TIPOS_DOCUMENTO.map(t => <option key={t.id} value={t.id}>{t.nombre}</option>)}
                </select>
              </Field>
              <Field label="Nombre *"><input value={doc.nombre} maxLength={120} onChange={e => setDoc({ ...doc, nombre: e.target.value })} className={INPUT} style={INPUT_STYLE} /></Field>
              <Field label="Archivo (JPG, PNG, WebP o PDF · máx. 10 MB)">
                <input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" onChange={e => setDocFile(e.target.files?.[0] ?? null)} className={INPUT} style={INPUT_STYLE} />
                {docFile && <p className="text-xs mt-1" style={{ color: MU }}>{docFile.name}</p>}
              </Field>
              <Field label="…o pega un enlace (opcional)"><input value={doc.url} onChange={e => setDoc({ ...doc, url: e.target.value })} placeholder="https://…" className={INPUT} style={INPUT_STYLE} /></Field>
              <PrimaryBtn onClick={agregarDoc} disabled={busy}>{busy ? 'Guardando…' : 'Registrar documento'}</PrimaryBtn>
            </Card>
            <div>
              <SectionTitle>Mis documentos</SectionTitle>
              {docs.loading && docs.data.length === 0 && <Loading />}
              {docs.error && <ErrorBox msg={docs.error} />}
              {!docs.loading && docs.data.length === 0 && <p className="text-sm text-center py-4" style={{ color: MU }}>Aún no has registrado documentos.</p>}
              <div className="space-y-2">
                {docs.data.map(d => (
                  <div key={d.id} className="flex items-center justify-between gap-3 rounded-2xl px-4 py-3" style={{ backgroundColor: W, border: `1px solid ${BD}` }}>
                    <div className="min-w-0">
                      <p className="text-sm font-bold" style={{ color: N }}>{d.nombre}</p>
                      <p className="text-xs" style={{ color: MU }}>{TIPOS_DOCUMENTO.find(t => t.id === d.tipo)?.nombre ?? d.tipo}</p>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      {(d.archivoPath || d.url) && (
                        <button onClick={() => abrirDocumento(d)} className="min-h-[36px] px-2 text-xs font-bold underline" style={{ color: GD }}>Ver</button>
                      )}
                      <span className="text-[11px] font-bold px-2 py-0.5 rounded-full" style={{ backgroundColor: d.estado === 'aprobado' ? GL : d.estado === 'rechazado' ? '#FEE2E2' : '#FEF3C7', color: d.estado === 'aprobado' ? GD : d.estado === 'rechazado' ? '#991B1B' : '#92400E' }}>{d.estado}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

/* ═════════ Ganancias del técnico ═════════ */
export function EarningsScreen({ perfil, go }: { perfil: Perfil; go: (s: 'profile') => void }) {
  const [rango, setRango] = useState<'30' | '90' | 'todo'>('30')
  const tecnicoId = useData(() => getMiTecnicoId(perfil.id), [perfil.id], null as number | null)
  const txs = useData(getMisTransacciones, [perfil.id], [] as Transaccion[])
  const visibles = useMemo(() => txs.data.filter(t => tecnicoId.data == null || t.tecnicoId === tecnicoId.data), [txs.data, tecnicoId.data])
  const paraResumen = useMemo<TransaccionResumen[]>(() => visibles.map(t => ({
    estado: t.estado,
    montoCentavos: t.montoCentavos,
    comisionCentavos: t.comisionCentavos,
    netoCentavos: t.netoCentavos,
    reembolsadoCentavos: t.reembolsadoCentavos,
    creadoEn: t.creadaEn,
  })), [visibles])
  const desde = useMemo(() => {
    if (rango === 'todo') return undefined
    const d = new Date(); d.setDate(d.getDate() - Number(rango)); return d
  }, [rango])
  const r = useMemo(() => resumenGanancias(paraResumen, desde), [paraResumen, desde])

  return (
    <div className="flex flex-col h-full" style={{ backgroundColor: BG }}>
      <DarkHeader onBack={() => go('profile')} backLabel="← Perfil">
        <h2 className="text-xl font-extrabold text-white">Ganancias</h2>
        <p className="text-xs mt-1" style={{ color: 'rgba(255,255,255,0.65)' }}>Solo los pagos aprobados cuentan como ingreso.</p>
      </DarkHeader>
      <div className="flex-1 overflow-y-auto px-4 pt-4 pb-safe space-y-4" style={{ scrollbarWidth: 'none' }}>
        <div className="flex rounded-2xl p-1" style={{ backgroundColor: W, border: `1px solid ${BD}` }}>
          {([['30', '30 días'], ['90', '90 días'], ['todo', 'Todo']] as const).map(([id, label]) => (
            <button key={id} onClick={() => setRango(id)} className="flex-1 min-h-[44px] rounded-xl text-sm font-bold"
              style={{ backgroundColor: rango === id ? N : 'transparent', color: rango === id ? W : MU }}>{label}</button>
          ))}
        </div>

        <Card className="p-4">
          <p className="text-xs font-extrabold uppercase tracking-wider" style={{ color: MU }}>Neto para ti</p>
          <p className="text-3xl font-extrabold mt-1" style={{ color: GD }}>{cop(r.netoCentavos)}</p>
          <div className="grid grid-cols-2 gap-2 mt-3">
            <Metric label="Bruto" value={cop(r.brutoCentavos)} />
            <Metric label="Comisión" value={cop(r.comisionCentavos)} />
            <Metric label="Reembolsos" value={cop(r.reembolsosCentavos)} />
            <Metric label="Ticket promedio" value={cop(r.ticketPromedioCentavos)} />
          </div>
          <p className="text-xs mt-3" style={{ color: MU }}>{r.servicios} servicios en el periodo.</p>
        </Card>

        <div>
          <SectionTitle>Por mes</SectionTitle>
          {r.porMes.length === 0 && <p className="text-sm text-center py-4" style={{ color: MU }}>Sin ingresos en este periodo.</p>}
          <div className="space-y-1.5">
            {r.porMes.map(m => (
              <div key={m.mes} className="flex items-center justify-between gap-3 rounded-xl px-3.5 py-2.5" style={{ backgroundColor: W, border: `1px solid ${BD}` }}>
                <span className="text-sm font-bold capitalize" style={{ color: N }}>{m.mes}</span>
                <span className="text-xs" style={{ color: MU }}>{m.servicios} servicios</span>
                <span className="text-sm font-extrabold" style={{ color: GD }}>{cop(m.netoCentavos)}</span>
              </div>
            ))}
          </div>
        </div>

        <div>
          <SectionTitle>Últimos movimientos</SectionTitle>
          {txs.loading && visibles.length === 0 && <Loading />}
          {txs.error && <ErrorBox msg={txs.error} />}
          {!txs.loading && visibles.length === 0 && <p className="text-sm text-center py-4" style={{ color: MU }}>Aún no tienes movimientos.</p>}
          <div className="space-y-2">
            {visibles.slice(0, 12).map(t => (
              <div key={t.id} className="flex items-center justify-between gap-3 rounded-2xl px-4 py-3" style={{ backgroundColor: W, border: `1px solid ${BD}` }}>
                <div className="min-w-0">
                  <p className="text-sm font-bold" style={{ color: N }}>Solicitud #{t.solicitudId}</p>
                  <p className="text-xs" style={{ color: MU }}>{fechaHora(t.creadaEn)} · {t.proveedor}</p>
                </div>
                <div className="text-right flex-shrink-0">
                  <p className="text-sm font-extrabold" style={{ color: GD }}>{cop(t.netoCentavos)}</p>
                  <TxBadge estado={t.estado} />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

/* ═════════ GPS / ETA en vivo ═════════ */
function useDestinoCliente() {
  const [destino, setDestino] = useState<Punto | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setError('Este dispositivo no permite ubicar tu domicilio para calcular la llegada.')
      return
    }
    navigator.geolocation.getCurrentPosition(
      p => setDestino({ lat: p.coords.latitude, lng: p.coords.longitude }),
      () => setError('Activa la ubicación para ver el tiempo estimado de llegada.'),
      { enableHighAccuracy: true, maximumAge: 60_000, timeout: 15_000 },
    )
  }, [])
  return { destino, error }
}

export function RastreoUbicacion({ pedido, perfil }: { pedido: Pedido; perfil: Perfil }) {
  if (perfil.rol === 'tecnico') return <PublicandoUbicacion pedido={pedido} />
  return <UbicacionCliente pedido={pedido} />
}

function PublicandoUbicacion({ pedido }: { pedido: Pedido }) {
  const { publicando, error } = usePublicarUbicacion(pedido.id, true)
  return (
    <div className="mt-3 rounded-2xl p-3.5" style={{ backgroundColor: GL, border: `1px solid ${G}55` }}>
      <div className="text-xs font-extrabold uppercase tracking-wider mb-1" style={{ color: GD }}>📍 Ubicación compartida</div>
      <p className="text-sm" style={{ color: N }}>
        {publicando ? 'El cliente ve tu recorrido y el tiempo estimado de llegada.' : 'Preparando el envío de tu ubicación…'}
      </p>
      <p className="text-xs mt-1" style={{ color: MU }}>Deja de compartirse al marcar “Llegué” o terminar el servicio.</p>
      {error && <p className="text-xs mt-2 rounded-xl px-3 py-2" style={{ backgroundColor: '#FEF2F2', color: '#B91C1C' }}>{error}</p>}
    </div>
  )
}

function UbicacionCliente({ pedido }: { pedido: Pedido }) {
  const { destino, error: errorDestino } = useDestinoCliente()
  const { ubicacion, eta, senal, conectado, loading, error } = useUbicacionEnVivo(pedido.id, destino)
  const color = senal.estado === 'reciente' ? G : senal.estado === 'debil' ? '#F59E0B' : '#9CA3AF'
  return (
    <div className="mt-3 rounded-2xl p-3.5" style={{ backgroundColor: W, border: `1px solid ${BD}` }}>
      <div className="flex items-center justify-between gap-2">
        <div className="text-xs font-extrabold uppercase tracking-wider" style={{ color: N }}>📍 Seguimiento en vivo</div>
        <span className="inline-flex items-center gap-1.5 text-[11px] font-bold" style={{ color: conectado ? GD : '#92400E' }}>
          <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: conectado ? G : '#F59E0B' }} />
          {conectado ? 'En vivo' : 'Reconectando…'}
        </span>
      </div>
      {loading && !ubicacion && <Loading text="Buscando al técnico…" />}
      {error && <ErrorBox msg={error} />}
      {!loading && !ubicacion && !error && (
        <p className="text-sm mt-2" style={{ color: MU }}>Aún no tenemos la ubicación del técnico. Se mostrará cuando empiece a compartirla.</p>
      )}
      {ubicacion && (
        <>
          <div className="flex items-end gap-2 mt-2">
            <p className="text-2xl font-extrabold" style={{ color: N }}>{eta ? etiquetaEta(eta) : 'ETA no disponible'}</p>
            <span className="w-2.5 h-2.5 rounded-full mb-2" style={{ backgroundColor: color }} />
          </div>
          <p className="text-xs mt-1" style={{ color: MU }}>{senal.mensaje}</p>
          {eta && eta.distanciaKm > 0 && <p className="text-xs mt-0.5" style={{ color: MU }}>Distancia aproximada: {eta.distanciaKm} km</p>}
          {errorDestino && <p className="text-xs mt-1" style={{ color: '#92400E' }}>{errorDestino}</p>}
          <a href={urlUbicacionTecnico({ lat: ubicacion.lat, lng: ubicacion.lng })} target="_blank" rel="noopener noreferrer"
            className="mt-2 inline-flex items-center justify-center min-h-[44px] px-4 rounded-xl text-xs font-extrabold" style={{ backgroundColor: N, color: W }}>
            Ver última ubicación en el mapa
          </a>
          <p className="text-[10px] mt-1.5" style={{ color: MU }}>Actualizada {fechaHora(ubicacion.actualizadoEn)}</p>
        </>
      )}
    </div>
  )
}

/* ═════════ Reportar problema ═════════ */
export function ReportarProblemaBox({ pedido }: { pedido: Pedido }) {
  const [abierto, setAbierto] = useState(false)
  const [version, setVersion] = useState(0)
  const [cat, setCat] = useState<ReporteProblema['categoria']>('no_llego')
  const [desc, setDesc] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [ok, setOk] = useState('')
  const reportes = useData(() => abierto ? getReportesSolicitud(pedido.id) : Promise.resolve([] as ReporteProblema[]), [pedido.id, abierto, version], [] as ReporteProblema[])

  const enviar = async () => {
    setMsg(''); setOk('')
    if (desc.trim().length < 20) return setMsg('Cuéntanos qué pasó con al menos 20 caracteres.')
    setBusy(true)
    try { await reportarProblema(pedido.id, cat, desc.trim()); setOk('Reporte enviado. El equipo de Resolve lo revisará.'); setDesc(''); setVersion(v => v + 1) }
    catch (e) { console.error(e); setMsg(errMsg(e)) }
    finally { setBusy(false) }
  }

  return (
    <div className="mt-3 rounded-2xl p-3.5" style={{ backgroundColor: '#FFF7ED', border: '1px solid #FED7AA' }}>
      <button onClick={() => setAbierto(!abierto)} className="w-full text-left text-xs font-extrabold uppercase tracking-wider" style={{ color: '#9A3412' }}>
        ⚠️ Reportar un problema {abierto ? '▴' : '▾'}
      </button>
      {abierto && (
        <div className="mt-3 space-y-2">
          <select value={cat} onChange={e => setCat(e.target.value as ReporteProblema['categoria'])} className={INPUT} style={INPUT_STYLE}>
            {CATEGORIAS_REPORTE.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
          </select>
          <textarea rows={3} maxLength={2000} value={desc} onChange={e => setDesc(e.target.value)} placeholder="Describe lo que pasó (mínimo 20 caracteres)…"
            className={`${INPUT} resize-none`} style={INPUT_STYLE} />
          <ErrorBox msg={msg} />
          {ok && <ErrorBox ok msg={ok} />}
          <PrimaryBtn onClick={enviar} disabled={busy}>{busy ? 'Enviando…' : 'Enviar reporte'}</PrimaryBtn>
          {reportes.data.length > 0 && (
            <div className="pt-2 space-y-1">
              {reportes.data.map(r => <p key={r.id} className="text-xs" style={{ color: MU }}>#{r.id} · {r.estado} · {fechaHora(r.creadoEn)}</p>)}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/* ═════════ Cupón en el pago ═════════ */
export function CuponBox({ pedido, onApplied }: { pedido: Pedido; onApplied: () => void }) {
  const [codigo, setCodigo] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [ok, setOk] = useState('')
  // Mismo precio base que usa el checkout: final, o la referencia máxima/mínima.
  const base = pedido.precioFinal ?? pedido.precioMax ?? pedido.precioMin
  const totalCentavos = base != null ? Math.round(base * 100) : 0

  if (base == null) {
    return (
      <div className="mt-3 rounded-2xl px-3.5 py-3" style={{ backgroundColor: '#F7FAF7', border: `1px solid ${BD}` }}>
        <p className="text-xs" style={{ color: MU }}>El cupón se puede aplicar cuando el servicio tenga un precio.</p>
      </div>
    )
  }

  if ((pedido.descuentoCentavos ?? 0) > 0) {
    return (
      <div className="mt-3 rounded-2xl px-3.5 py-3" style={{ backgroundColor: GL, border: `1px solid ${G}50` }}>
        <p className="text-xs font-extrabold" style={{ color: '#065F46' }}>
          ✓ Cupón aplicado{pedido.cuponCodigo ? `: ${pedido.cuponCodigo}` : ''}
        </p>
        <p className="text-xs mt-0.5" style={{ color: MU }}>
          Descuento de {cop(pedido.descuentoCentavos)} sobre {cop(totalCentavos)}. Se cobrará {cop(Math.max(0, totalCentavos - pedido.descuentoCentavos))}.
        </p>
      </div>
    )
  }

  const aplicar = async () => {
    setMsg(''); setOk('')
    if (!codigo.trim()) return setMsg('Escribe un código de cupón.')
    setBusy(true)
    try {
      const v = await validarCuponServidor(codigo, totalCentavos)
      if (!v.valido) { setMsg(v.motivo || 'El cupón no es válido.'); return }
      const descuento = await aplicarCuponSolicitud(pedido.id, codigo)
      setOk(`Cupón aplicado: ${cop(descuento)} de descuento.`)
      onApplied()
    } catch (e) { console.error(e); setMsg(errMsg(e)) }
    finally { setBusy(false) }
  }

  return (
    <div className="mt-3 rounded-2xl p-3.5" style={{ backgroundColor: W, border: `1px solid ${BD}` }}>
      <div className="text-xs font-extrabold uppercase tracking-wider mb-2" style={{ color: N }}>🎟️ Cupón de descuento</div>
      <div className="flex gap-2">
        <input value={codigo} onChange={e => setCodigo(e.target.value.toUpperCase().replace(/\s/g, ''))} placeholder="CÓDIGO" className={INPUT} style={INPUT_STYLE} />
        <button onClick={aplicar} disabled={busy} className="min-h-[48px] px-4 rounded-2xl text-xs font-extrabold flex-shrink-0" style={{ backgroundColor: G, color: N, opacity: busy ? 0.6 : 1 }}>
          {busy ? '…' : 'Aplicar'}
        </button>
      </div>
      <ErrorBox msg={msg} />
      {ok && <div className="mt-2"><ErrorBox ok msg={ok} /></div>}
    </div>
  )
}

/* ═════════ Favoritos ═════════ */
export function FavoriteButton({ tecnicoId, onChange }: { tecnicoId: number; onChange?: (v: boolean) => void }) {
  const [fav, setFav] = useState<boolean | null>(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')

  useEffect(() => {
    let alive = true
    getMisFavoritos().then(ids => { if (alive) setFav(ids.includes(tecnicoId)) }).catch(() => { if (alive) setFav(false) })
    return () => { alive = false }
  }, [tecnicoId])

  const alternar = async () => {
    setBusy(true); setMsg('')
    try { const v = await alternarFavorito(tecnicoId); setFav(v); onChange?.(v) }
    catch (e) { console.error(e); setMsg(errMsg(e)) }
    finally { setBusy(false) }
  }

  return (
    <span className="inline-flex flex-col items-end">
      <button onClick={alternar} disabled={busy} aria-pressed={fav === true} aria-label={fav ? 'Quitar de favoritos' : 'Guardar en favoritos'}
        className="min-h-[36px] px-2 text-base leading-none" style={{ color: fav ? '#EAB308' : '#9CA3AF' }}>
        {fav ? '★' : '☆'}
      </button>
      {msg && <span className="text-[10px] text-red-600 max-w-[120px]">{msg}</span>}
    </span>
  )
}

/* ═════════ Recuperación de contraseña ═════════ */
export function ResetPasswordScreen({ onDone }: { onDone: () => void }) {
  const [password, setPassword] = useState('')
  const [confirmacion, setConfirmacion] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [ok, setOk] = useState(false)

  const guardar = async () => {
    setMsg('')
    const err = validarNuevaPassword(password, confirmacion)
    if (err) return setMsg(err)
    setBusy(true)
    try {
      const { error } = await supabase.auth.updateUser({ password })
      if (error) throw error
      setOk(true)
    } catch (e) { console.error(e); setMsg(errMsg(e)) }
    finally { setBusy(false) }
  }

  if (ok) {
    return (
      <div className="flex flex-col h-full px-5 pt-8" style={{ backgroundColor: BG }}>
        <div className="flex-1 flex flex-col items-center justify-center text-center">
          <div className="w-20 h-20 rounded-full flex items-center justify-center mb-4" style={{ backgroundColor: GL }}>
            <span className="text-3xl">✓</span>
          </div>
          <h2 className="text-2xl font-extrabold mb-2" style={{ color: N }}>Contraseña actualizada</h2>
          <p className="text-sm" style={{ color: MU }}>Ya puedes entrar con tu nueva contraseña.</p>
        </div>
        <PrimaryBtn onClick={onDone}>Ir a mi cuenta</PrimaryBtn>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full" style={{ backgroundColor: BG }}>
      <DarkHeader onBack={onDone} backLabel="← Volver">
        <h2 className="text-xl font-extrabold text-white">Nueva contraseña</h2>
        <p className="text-xs mt-1" style={{ color: 'rgba(255,255,255,0.65)' }}>Elige una contraseña segura para tu cuenta.</p>
      </DarkHeader>
      <div className="flex-1 overflow-y-auto px-4 pt-4 pb-safe space-y-3" style={{ scrollbarWidth: 'none' }}>
        <Field label="Nueva contraseña">
          <input type="password" autoComplete="new-password" maxLength={72} value={password} onChange={e => setPassword(e.target.value)} className={INPUT} style={INPUT_STYLE} />
        </Field>
        <Field label="Confirmar contraseña">
          <input type="password" autoComplete="new-password" maxLength={72} value={confirmacion} onChange={e => setConfirmacion(e.target.value)} className={INPUT} style={INPUT_STYLE} />
        </Field>
        <ErrorBox msg={msg} />
        <PrimaryBtn onClick={guardar} disabled={busy}>{busy ? 'Guardando…' : 'Guardar contraseña'}</PrimaryBtn>
      </div>
    </div>
  )
}
