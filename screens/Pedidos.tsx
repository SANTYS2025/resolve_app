import { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { cambiarEstado, errMsg, fmt, getMiVerificacion, getPedidos, rostroVigente, useData } from '../lib/api'
import type { Pedido, Perfil, Verif } from '../lib/api'
import { N, G, GL, BG, MU, BD, W, INPUT_STYLE, ESTADO, todayLocal, BottomNav, ErrorBox, DarkHeader, Loading } from '../ui'
import type { NavFn, FaceCtx } from '../ui'

/* ═════════ Pedidos (cliente y técnico) ═════════ */
export function OrdersScreen({ perfil, go, onRate, onFace }: {
  perfil: Perfil; go: NavFn; onRate: (p: Pedido) => void; onFace: (c: FaceCtx) => void
}) {
  const esTec = perfil.rol === 'tecnico'
  const pedidos = useData(() => getPedidos(perfil), [perfil.id, perfil.rol], [] as Pedido[])
  const ver = useData(() => (esTec ? getMiVerificacion(perfil.id) : Promise.resolve(null)), [perfil.id, esTec], null as Verif | null)
  const rostro = useData(() => (esTec ? rostroVigente() : Promise.resolve(true)), [perfil.id, esTec], true)
  const [busy, setBusy] = useState<number | null>(null)
  const [message, setMessage] = useState('')
  const [aviso, setAviso] = useState('')
  const [completando, setCompletando] = useState<number | null>(null)
  const [precio, setPrecio] = useState('')
  const pendPrev = useRef(-1)

  // Cliente: tiempo real (Supabase Realtime). Técnico: consulta cada 20 s.
  useEffect(() => {
    if (esTec) {
      const t = setInterval(() => { if (!document.hidden) pedidos.refresh() }, 20000)
      return () => clearInterval(t)
    }
    const ch = supabase.channel(`sol-${perfil.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'solicitudes', filter: `cliente_id=eq.${perfil.id}` },
        () => { setAviso('🔔 Tu solicitud se actualizó.'); pedidos.refresh() })
      .subscribe()
    return () => { supabase.removeChannel(ch) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [perfil.id, esTec])

  useEffect(() => {
    if (!esTec || pedidos.loading) return
    const n = pedidos.data.filter(p => p.estado === 'pendiente').length
    if (pendPrev.current >= 0 && n > pendPrev.current) setAviso('📥 Tienes una nueva solicitud.')
    pendPrev.current = n
  }, [pedidos.data, pedidos.loading, esTec])

  const cambiar = async (id: number, estado: string, precioFinal?: number) => {
    setMessage(''); setBusy(id)
    try {
      await cambiarEstado(id, estado, precioFinal)
      setCompletando(null); setPrecio('')
      pedidos.refresh()
    } catch (e) { console.error(e); setMessage(errMsg(e)) }
    finally { setBusy(null) }
  }

  const Btn = ({ id, estado, label, primary }: { id: number; estado: string; label: string; primary?: boolean }) => (
    <button disabled={busy === id} onClick={() => cambiar(id, estado)} className="text-[10px] font-extrabold px-3 py-1.5 rounded-xl border"
      style={primary ? { backgroundColor: G, color: N, borderColor: G } : { borderColor: BD, color: N, backgroundColor: BG }}>{label}</button>
  )

  const v = ver.data
  const bannerTec = !esTec ? null
    : ver.loading ? null
    : !v ? <>Aún no completas tu registro de técnico. <button className="underline font-bold" onClick={() => go('v1')}>Completar registro</button></>
    : !v.verificado && (v.estado === null || v.estado === 'pendiente' || v.estado === 'rechazada')
      ? <>{v.estado === 'rechazada' ? `Tu verificación fue rechazada: ${v.observaciones ?? 'revisa tus documentos'}. ` : 'Debes subir tus documentos para activar tu cuenta. '}
          <button className="underline font-bold" onClick={() => go('v3')}>Subir documentos</button></>
    : !v.verificado && v.estado === 'en_revision' ? 'Tu verificación está en revisión. Recibirás solicitudes cuando la aprobemos.'
    : !v.verificado ? 'Tu cuenta está suspendida. Contacta a soporte.'
    : !rostro.data
      ? <>Verifica tu identidad para recibir y gestionar trabajos. <button className="underline font-bold" onClick={() => onFace({ modo: 'login' })}>Verificar ahora</button></>
      : null

  return (
    <div className="flex flex-col h-full" style={{ backgroundColor: BG }}>
      <DarkHeader>
        <h2 className="text-lg font-extrabold text-white" style={{ fontFamily: 'Fraunces, serif' }}>{esTec ? 'Solicitudes recibidas' : 'Mis pedidos'}</h2>
      </DarkHeader>
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3" style={{ scrollbarWidth: 'none' }}>
        {aviso && (
          <button onClick={() => setAviso('')} className="w-full text-left px-3.5 py-3 rounded-2xl text-xs font-bold"
            style={{ backgroundColor: GL, color: '#065F46', border: `1px solid ${G}60` }}>{aviso} <span className="opacity-60">(toca para cerrar)</span></button>
        )}
        {bannerTec && <div className="px-3.5 py-3 rounded-2xl text-xs font-semibold" style={{ backgroundColor: '#FEF3C7', color: '#92400E', border: '1px solid #FDE68A' }}>{bannerTec}</div>}
        <ErrorBox msg={message} />
        {pedidos.loading && <Loading />}
        {pedidos.error && <ErrorBox msg={pedidos.error} />}
        {!pedidos.loading && !pedidos.error && pedidos.data.length === 0 && (
          <p className="text-xs text-center py-8" style={{ color: MU }}>{esTec ? 'Aún no has recibido solicitudes.' : 'Todavía no has solicitado ningún servicio.'}</p>
        )}
        {pedidos.data.map(p => {
          const st = ESTADO[p.estado] ?? { label: p.estado, bg: '#F3F4F6', color: '#4B5563' }
          const contactoVisible = esTec && p.estado !== 'pendiente'
          const maps = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${p.direccion}, ${p.barrio}, Pasto, Nariño`)}`
          return (
            <div key={p.id} className="rounded-3xl p-3.5" style={{ backgroundColor: W, border: `1px solid ${BD}` }}>
              <div className="flex items-start justify-between gap-2 mb-1.5">
                <div className="text-sm font-extrabold" style={{ color: N }}>{esTec ? (p.nombreContacto ?? 'Cliente nuevo') : p.tecnicoNombre}</div>
                <span className="text-[9px] font-bold px-2 py-0.5 rounded-full flex-shrink-0" style={{ backgroundColor: st.bg, color: st.color }}>{st.label}</span>
              </div>
              <div className="text-[10px] mb-1.5 space-y-0.5" style={{ color: MU }}>
                <div>📅 {new Date(p.fecha + 'T00:00:00').toLocaleDateString('es-CO', { day: 'numeric', month: 'long' })}{p.hora && ` · ${p.hora}`}</div>
                {p.barrio && <div>📍 {p.barrio}{(!esTec || contactoVisible) && p.direccion && ` · ${p.direccion}`}</div>}
                {esTec && !contactoVisible && <div>🔒 La dirección y el celular se muestran al aceptar.</div>}
              </div>
              <p className="text-xs leading-relaxed whitespace-pre-line" style={{ color: N }}>{p.cuerpo}</p>
              {p.precioFinal != null
                ? <div className="text-xs font-bold mt-1.5" style={{ color: G }}>Precio final: {fmt(p.precioFinal)}</div>
                : p.precioMin != null && p.precioMax != null && <div className="text-[10px] mt-1.5" style={{ color: MU }}>Referencia: {fmt(p.precioMin)} – {fmt(p.precioMax)}</div>}
              {!esTec && p.intentos > 0 && <div className="text-[10px] mt-1" style={{ color: MU }}>↻ Reasignada {p.intentos} {p.intentos === 1 ? 'vez' : 'veces'} hasta encontrar técnico.</div>}
              {!esTec && p.estado === 'pendiente' && <div className="text-[10px] mt-1" style={{ color: MU }}>Esperando respuesta (máx. 10 min antes de pasar al siguiente técnico).</div>}

              {contactoVisible && (
                <div className="flex gap-3 mt-2 text-[11px] font-bold" style={{ color: G }}>
                  {p.telefonoContacto && <a href={`https://wa.me/57${p.telefonoContacto}`} target="_blank" rel="noreferrer">💬 WhatsApp</a>}
                  {p.telefonoContacto && <a href={`tel:+57${p.telefonoContacto}`}>📞 Llamar</a>}
                  {p.direccion && <a href={maps} target="_blank" rel="noreferrer">🗺️ Cómo llegar</a>}
                </div>
              )}

              <div className="flex gap-2 mt-3 flex-wrap items-center">
                {esTec && p.estado === 'pendiente' && <><Btn id={p.id} estado="aceptada" label="Aceptar" primary /><Btn id={p.id} estado="rechazada" label="Rechazar" /></>}
                {esTec && p.estado === 'aceptada' && (p.fecha === todayLocal()
                  ? <button onClick={() => onFace({ modo: 'trabajo', solicitudId: p.id })} className="text-[10px] font-extrabold px-3 py-1.5 rounded-xl" style={{ backgroundColor: G, color: N }}>Iniciar servicio (verificar rostro)</button>
                  : <span className="text-[10px]" style={{ color: MU }}>Podrás iniciarlo el día del servicio.</span>)}
                {esTec && p.estado === 'en_curso' && (completando === p.id
                  ? <div className="flex gap-2 w-full">
                      <input type="number" min={0} step={1000} value={precio} onChange={e => setPrecio(e.target.value)} placeholder="Precio final COP"
                        className="flex-1 px-3 py-2 text-xs rounded-xl border outline-none" style={INPUT_STYLE} />
                      <button disabled={busy === p.id || !precio} onClick={() => cambiar(p.id, 'completada', Number(precio))}
                        className="text-[10px] font-extrabold px-3 py-1.5 rounded-xl" style={{ backgroundColor: G, color: N }}>Confirmar</button>
                    </div>
                  : <button onClick={() => { setCompletando(p.id); setPrecio('') }} className="text-[10px] font-extrabold px-3 py-1.5 rounded-xl" style={{ backgroundColor: G, color: N }}>Completar trabajo</button>)}
                {!esTec && (p.estado === 'pendiente' || p.estado === 'aceptada') && <Btn id={p.id} estado="cancelada" label="Cancelar" />}
                {!esTec && p.estado === 'completada' && !p.calificada && (
                  <button onClick={() => { onRate(p); go('rate') }} className="text-[10px] font-extrabold px-3 py-1.5 rounded-xl" style={{ backgroundColor: G, color: N }}>Calificar ★</button>
                )}
                {!esTec && p.calificada && <span className="text-[10px] font-semibold" style={{ color: MU }}>✓ Ya calificaste</span>}
              </div>
            </div>
          )
        })}
      </div>
      <BottomNav active="orders" go={go} rol={perfil.rol} />
    </div>
  )
}
