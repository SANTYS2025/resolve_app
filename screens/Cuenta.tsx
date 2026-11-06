import { useState, useEffect } from 'react'
import { adminListar, adminRevisar, errMsg, getMiTecnico, getMiVerificacion, subirFoto, urlFirmada, useData } from '../lib/api'
import type { AdminVerif, MiTecnico, Perfil, Verif } from '../lib/api'
import { N, G, GL, BG, MU, BD, W, INPUT, INPUT_STYLE, BottomNav, resizeToJpeg, Avatar, ErrorBox, PrimaryBtn, DarkHeader, Loading } from '../ui'
import type { NavFn } from '../ui'

/* ═════════ Perfil / sesión ═════════ */
const VER_TXT: Record<string, string> = {
  pendiente: 'Documentos pendientes', en_revision: 'En revisión', aprobada: 'Verificado ✓',
  rechazada: 'Rechazada', suspendida: 'Suspendida',
}

export function ProfileScreen({ perfil, go, onLogout }: { perfil: Perfil; go: NavFn; onLogout: () => Promise<void> }) {
  const esTec = perfil.rol === 'tecnico'
  const tec = useData(() => (esTec ? getMiTecnico(perfil.id) : Promise.resolve(null)), [perfil.id, esTec], null as MiTecnico | null)
  const ver = useData(() => (esTec ? getMiVerificacion(perfil.id) : Promise.resolve(null)), [perfil.id, esTec], null as Verif | null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')

  const v = ver.data
  const rows: [string, string][] = [
    ['Nombre', perfil.nombre], ['Correo', perfil.email],
    ['Tipo de cuenta', perfil.rol === 'tecnico' ? 'Técnico' : perfil.rol === 'admin' ? 'Administrador' : 'Cliente'],
  ]
  if (perfil.telefono) rows.push(['Celular', perfil.telefono])
  if (esTec && v) rows.push(['Verificación', v.verificado ? VER_TXT.aprobada : VER_TXT[v.estado ?? 'pendiente'] ?? v.estado ?? ''])

  const subirFotoPerfil = async (e: { target: HTMLInputElement }) => {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f) return
    setMessage(''); setBusy(true)
    try { await subirFoto(perfil.id, await resizeToJpeg(f, 600)); tec.reload() }
    catch (err) { console.error(err); setMessage(errMsg(err)) }
    finally { setBusy(false) }
  }

  return (
    <div className="flex flex-col h-full" style={{ backgroundColor: BG }}>
      <DarkHeader><h2 className="text-lg font-extrabold text-white" style={{ fontFamily: 'Fraunces, serif' }}>Mi perfil</h2></DarkHeader>
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4" style={{ scrollbarWidth: 'none' }}>
        {esTec && tec.data && (
          <div className="flex items-center gap-3 rounded-2xl p-3" style={{ backgroundColor: W, border: `1px solid ${BD}` }}>
            <div className="w-16 h-16 rounded-2xl overflow-hidden flex-shrink-0"><Avatar w={{ name: tec.data.nombre, avatar: tec.data.fotoUrl }} /></div>
            <label className="text-xs font-bold px-3 py-2 rounded-xl border cursor-pointer" style={{ borderColor: BD, color: N, backgroundColor: BG }}>
              {busy ? 'Subiendo…' : 'Cambiar foto de perfil'}
              <input type="file" accept="image/*" className="hidden" disabled={busy} onChange={subirFotoPerfil} />
            </label>
          </div>
        )}
        <div className="rounded-2xl overflow-hidden" style={{ backgroundColor: W, border: `1px solid ${BD}` }}>
          {rows.map(([l, val], i) => (
            <div key={l} className="flex items-center justify-between gap-3 px-4 py-2.5" style={{ borderBottom: i < rows.length - 1 ? `1px solid ${BD}` : undefined }}>
              <span className="text-xs" style={{ color: MU }}>{l}</span>
              <span className="text-xs font-bold text-right break-all" style={{ color: N }}>{val}</span>
            </div>
          ))}
        </div>
        {esTec && !ver.loading && !v && <PrimaryBtn onClick={() => go('v1')}>Completar registro de técnico</PrimaryBtn>}
        {esTec && v && !v.verificado && (v.estado === null || v.estado === 'pendiente' || v.estado === 'rechazada') && (
          <>
            {v.estado === 'rechazada' && v.observaciones && <ErrorBox msg={`Motivo del rechazo: ${v.observaciones}`} />}
            <PrimaryBtn onClick={() => go('v3')}>{v.estado === 'rechazada' ? 'Reenviar documentos' : 'Subir documentos'}</PrimaryBtn>
          </>
        )}
        <ErrorBox msg={message} />
        <button disabled={busy} onClick={async () => { setBusy(true); await onLogout() }}
          className="w-full py-3.5 rounded-2xl font-bold text-sm border" style={{ borderColor: '#FECACA', color: '#B91C1C', backgroundColor: W }}>
          Cerrar sesión
        </button>
      </div>
      <BottomNav active="profile" go={go} rol={perfil.rol} />
    </div>
  )
}

/* ═════════ Administración de verificaciones ═════════ */
function VerifCard({ v, onDone }: { v: AdminVerif; onDone: () => void }) {
  const [open, setOpen] = useState(false)
  const [urls, setUrls] = useState<string[]>([])
  const [obs, setObs] = useState(v.observaciones ?? '')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const st = VER_TXT[v.estado] ?? v.estado

  useEffect(() => {
    if (!open || urls.length) return
    Promise.all(['frente', 'reverso', 'selfie'].map(n => urlFirmada(`${v.tecnico_id}/${n}.jpg`)))
      .then(setUrls).catch(e => setMsg(errMsg(e)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const revisar = async (estado: 'aprobada' | 'rechazada' | 'suspendida') => {
    setMsg('')
    if (estado !== 'aprobada' && obs.trim().length < 5) return setMsg('Escribe el motivo (mínimo 5 caracteres).')
    setBusy(true)
    try { await adminRevisar(v.id, estado, obs.trim()); onDone() }
    catch (e) { console.error(e); setMsg(errMsg(e)); setBusy(false) }
  }

  return (
    <div className="rounded-3xl p-3.5" style={{ backgroundColor: W, border: `1px solid ${BD}` }}>
      <button onClick={() => setOpen(!open)} className="w-full text-left">
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="text-sm font-extrabold" style={{ color: N }}>{v.nombre_publico}</div>
            <div className="text-[10px]" style={{ color: MU }}>Cédula {v.cedula} · {new Date(v.fecha_solicitud).toLocaleDateString('es-CO')}</div>
          </div>
          <span className="text-[9px] font-bold px-2 py-0.5 rounded-full flex-shrink-0" style={{ backgroundColor: GL, color: '#065F46' }}>{st}</span>
        </div>
      </button>
      {open && (
        <div className="mt-3 space-y-2.5">
          {urls.length === 0 && !msg && <Loading text="Cargando documentos…" />}
          <div className="grid grid-cols-3 gap-2">
            {urls.map((u, i) => (
              <a key={i} href={u} target="_blank" rel="noreferrer"><img src={u} alt={['Frente', 'Reverso', 'Selfie'][i]} className="w-full h-24 object-cover rounded-xl border" style={{ borderColor: BD }} /></a>
            ))}
          </div>
          <textarea rows={2} value={obs} onChange={e => setObs(e.target.value)} placeholder="Observaciones (obligatorias si rechazas o suspendes)"
            className={`${INPUT} resize-none text-xs`} style={INPUT_STYLE} />
          <ErrorBox msg={msg} />
          <div className="flex gap-2 flex-wrap">
            <button disabled={busy} onClick={() => revisar('aprobada')} className="text-[10px] font-extrabold px-3 py-1.5 rounded-xl" style={{ backgroundColor: G, color: N }}>Aprobar</button>
            <button disabled={busy} onClick={() => revisar('rechazada')} className="text-[10px] font-extrabold px-3 py-1.5 rounded-xl border" style={{ borderColor: '#FECACA', color: '#B91C1C' }}>Rechazar</button>
            <button disabled={busy} onClick={() => revisar('suspendida')} className="text-[10px] font-extrabold px-3 py-1.5 rounded-xl border" style={{ borderColor: BD, color: MU }}>Suspender</button>
          </div>
        </div>
      )}
    </div>
  )
}

export function AdminScreen({ perfil, go }: { perfil: Perfil; go: NavFn }) {
  const [filtro, setFiltro] = useState<string | null>('en_revision')
  const lista = useData(() => adminListar(filtro), [filtro], [] as AdminVerif[])
  const filtros: [string | null, string][] = [['en_revision', 'En revisión'], ['pendiente', 'Pendientes'], ['aprobada', 'Aprobadas'], [null, 'Todas']]
  return (
    <div className="flex flex-col h-full" style={{ backgroundColor: BG }}>
      <DarkHeader>
        <h2 className="text-lg font-extrabold text-white mb-2" style={{ fontFamily: 'Fraunces, serif' }}>Verificaciones</h2>
        <div className="flex gap-1.5 overflow-x-auto" style={{ scrollbarWidth: 'none' }}>
          {filtros.map(([k, l]) => (
            <button key={l} onClick={() => setFiltro(k)} className="flex-shrink-0 text-[10px] font-bold px-3 py-1.5 rounded-full"
              style={{ backgroundColor: filtro === k ? G : 'rgba(255,255,255,0.1)', color: filtro === k ? N : 'rgba(255,255,255,0.7)' }}>{l}</button>
          ))}
        </div>
      </DarkHeader>
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3" style={{ scrollbarWidth: 'none' }}>
        {lista.loading && <Loading />}
        {lista.error && <ErrorBox msg={lista.error} />}
        {!lista.loading && !lista.error && lista.data.length === 0 && <p className="text-xs text-center py-8" style={{ color: MU }}>No hay verificaciones en este estado.</p>}
        {lista.data.map(v => <VerifCard key={v.id} v={v} onDone={lista.reload} />)}
      </div>
      <BottomNav active="admin" go={go} rol={perfil.rol} />
    </div>
  )
}
