import { useState, useEffect, useRef } from 'react'
import logo from '../imports/image.png'
import { supabase } from '../lib/supabase'
import { agregarFranja, biometria, eliminarFranja, errMsg, getBarrios, getCategorias, getFranjas, getMiTecnico, getMiTecnicoId, normCel, registrarTecnico, setDisponible, subirDocumento, useData } from '../lib/api'
import type { Barrio, Categoria, Franja, MiTecnico, Perfil } from '../lib/api'
import { N, G, GL, BG, MU, BD, W, PRIMARY, INPUT, INPUT_STYLE, DIAS_LARGO, BottomNav, Camera, resizeToJpeg, Field, ErrorBox, PrimaryBtn, DarkHeader, Loading } from '../ui'
import type { NavFn, Draft, FaceCtx } from '../ui'

export function Steps({ n, label }: { n: number; label: string }) {
  return (
    <>
      <div className="flex gap-1.5 mb-1 mt-2">
        {[1, 2, 3].map(s => <div key={s} className="flex-1 h-1.5 rounded-full" style={{ backgroundColor: s <= n ? G : 'rgba(255,255,255,0.18)' }} />)}
      </div>
      <div className="text-[10px]" style={{ color: 'rgba(255,255,255,0.55)' }}>Paso {n} de 3 · {label}</div>
    </>
  )
}

export function V1Screen({ perfil, draft, setDraft, go }: { perfil: Perfil; draft: Draft; setDraft: (d: Draft) => void; go: NavFn }) {
  const [form, setForm] = useState<Draft>({ name: draft.name || perfil.nombre, phone: draft.phone || perfil.telefono || '', cedula: draft.cedula })
  const [message, setMessage] = useState('')
  const siguiente = () => {
    const phone = normCel(form.phone)
    if (form.name.trim().length < 3) return setMessage('Ingresa tu nombre completo.')
    if (!phone) return setMessage('Ingresa un celular colombiano válido (10 dígitos, empieza por 3).')
    if (!/^\d{6,10}$/.test(form.cedula.trim())) return setMessage('La cédula debe tener entre 6 y 10 dígitos.')
    setDraft({ name: form.name.trim(), phone, cedula: form.cedula.trim() })
    go('v2')
  }
  return (
    <div className="flex flex-col h-full" style={{ backgroundColor: BG }}>
      <DarkHeader onBack={() => go('profile')} backLabel="← Salir del registro">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl overflow-hidden"><img src={logo} alt="" className="w-full h-full object-cover" /></div>
          <div className="text-white font-extrabold" style={{ fontFamily: 'Fraunces, serif' }}>Registra tu oficio</div>
        </div>
        <Steps n={1} label="Datos personales" />
      </DarkHeader>
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3" style={{ scrollbarWidth: 'none' }}>
        <Field label="Nombre completo *"><input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} className={INPUT} style={INPUT_STYLE} /></Field>
        <Field label="Celular (WhatsApp) *"><input type="tel" value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} placeholder="310 555 1234" className={INPUT} style={INPUT_STYLE} /></Field>
        <Field label="Número de cédula *"><input inputMode="numeric" value={form.cedula} onChange={e => setForm({ ...form, cedula: e.target.value })} placeholder="Solo números" className={INPUT} style={INPUT_STYLE} /></Field>
        <ErrorBox msg={message} />
        <PrimaryBtn onClick={siguiente}>Siguiente →</PrimaryBtn>
      </div>
    </div>
  )
}

export function V2Screen({ draft, go }: { draft: Draft; go: NavFn }) {
  const cats = useData(getCategorias, [], [] as Categoria[])
  const barrios = useData(getBarrios, [], [] as Barrio[])
  const [f, setF] = useState({ categoriaId: '', barrioId: '', years: '', especialidad: '', descripcion: '', precioMin: '', precioMax: '' })
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value })

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
        <div className="text-white font-extrabold" style={{ fontFamily: 'Fraunces, serif' }}>Registra tu oficio</div>
        <Steps n={2} label="Oficio y cobertura" />
      </DarkHeader>
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3" style={{ scrollbarWidth: 'none' }}>
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
        <Field label="Años de experiencia *"><input type="number" min={0} max={60} value={f.years} onChange={set('years')} className={INPUT} style={INPUT_STYLE} /></Field>
        <div className="grid grid-cols-2 gap-2.5">
          <Field label="Tarifa mínima (COP) *"><input type="number" min={0} step={1000} value={f.precioMin} onChange={set('precioMin')} className={INPUT} style={INPUT_STYLE} /></Field>
          <Field label="Tarifa máxima (COP) *"><input type="number" min={0} step={1000} value={f.precioMax} onChange={set('precioMax')} className={INPUT} style={INPUT_STYLE} /></Field>
        </div>
        <Field label="Cuéntanos sobre tu trabajo (opcional)">
          <textarea rows={3} maxLength={500} value={f.descripcion} onChange={set('descripcion')} className={`${INPUT} resize-none`} style={INPUT_STYLE} />
        </Field>
        <ErrorBox msg={message} />
        <PrimaryBtn onClick={guardar} disabled={loading}>{loading ? 'Guardando…' : 'Continuar →'}</PrimaryBtn>
      </div>
    </div>
  )
}


/* ═════════ Documentos de verificación (paso 3) ═════════ */
type SlotKey = 'frente' | 'reverso' | 'selfie'

export function DocsScreen({ perfil, go }: { perfil: Perfil; go: NavFn }) {
  const tec = useData(() => getMiTecnicoId(perfil.id), [perfil.id], null as number | null)
  const [files, setFiles] = useState<Partial<Record<SlotKey, Blob>>>({})
  const [prev, setPrev] = useState<Partial<Record<SlotKey, string>>>({})
  const [cam, setCam] = useState(false)
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')
  const [rechazo, setRechazo] = useState('')

  const put = (k: SlotKey, b: Blob) => {
    setFiles(f => ({ ...f, [k]: b }))
    setPrev(p => { if (p[k]) URL.revokeObjectURL(p[k]!); return { ...p, [k]: URL.createObjectURL(b) } })
  }
  const onFile = async (k: SlotKey, e: { target: HTMLInputElement }) => {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f) return
    try { put(k, await resizeToJpeg(f)) } catch (err) { setMessage(errMsg(err)) }
  }

  const enviar = async () => {
    setMessage(''); setRechazo('')
    if (!tec.data) return setMessage('No encontramos tu registro de técnico.')
    if (!files.frente || !files.reverso || !files.selfie) return setMessage('Sube las tres fotos: frente, reverso y selfie.')
    const items: [string, Blob][] = [['frente', files.frente], ['reverso', files.reverso], ['selfie', files.selfie]]
    setLoading(true)
    try {
      await Promise.all(items.map(([n, b]) => subirDocumento(tec.data!, n, b)))
      const r = await biometria({ modo: 'documentos' })
      if (r.estado === 'rechazada') setRechazo(r.observaciones ?? 'No pudimos validar tus documentos.')
      else go('v4')
    } catch (e) {
      console.error(e); setMessage(errMsg(e))
    } finally {
      setLoading(false)
    }
  }

  const slots: { k: SlotKey; label: string; hint: string }[] = [
    { k: 'frente', label: 'Frente de la cédula', hint: 'Con buena luz, sin reflejos, documento completo.' },
    { k: 'reverso', label: 'Reverso de la cédula', hint: 'Debe verse completo y nítido.' },
  ]

  return (
    <div className="flex flex-col h-full" style={{ backgroundColor: BG }}>
      <DarkHeader onBack={() => go('profile')} backLabel="← Salir">
        <div className="text-white font-extrabold" style={{ fontFamily: 'Fraunces, serif' }}>Verifica tu identidad</div>
        <Steps n={3} label="Documentos y selfie" />
      </DarkHeader>
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3" style={{ scrollbarWidth: 'none' }}>
        {slots.map(s => (
          <div key={s.k} className="rounded-2xl p-3" style={{ backgroundColor: W, border: `1px solid ${BD}` }}>
            <div className="text-xs font-extrabold" style={{ color: N }}>{s.label} *</div>
            <div className="text-[10px] mb-2" style={{ color: MU }}>{s.hint}</div>
            {prev[s.k] && <img src={prev[s.k]} alt={s.label} className="w-full max-h-40 object-contain rounded-xl mb-2" />}
            <label className="block text-center text-xs font-bold py-2.5 rounded-xl border cursor-pointer" style={{ borderColor: BD, color: N, backgroundColor: BG }}>
              {prev[s.k] ? 'Cambiar foto' : '📷 Tomar o elegir foto'}
              <input type="file" accept="image/*" capture="environment" className="hidden" onChange={e => onFile(s.k, e)} />
            </label>
          </div>
        ))}

        <div className="rounded-2xl p-3" style={{ backgroundColor: W, border: `1px solid ${BD}` }}>
          <div className="text-xs font-extrabold" style={{ color: N }}>Selfie *</div>
          <div className="text-[10px] mb-2" style={{ color: MU }}>Mira de frente a la cámara, sin gafas ni gorra. Esta foto será tu referencia para ingresar y empezar trabajos.</div>
          {cam
            ? <Camera onCapture={(_b64, blob) => { put('selfie', blob); setCam(false) }} />
            : <>
                {prev.selfie && <img src={prev.selfie} alt="Selfie" className="w-40 mx-auto rounded-2xl mb-2" />}
                <button onClick={() => setCam(true)} className="w-full text-xs font-bold py-2.5 rounded-xl border" style={{ borderColor: BD, color: N, backgroundColor: BG }}>
                  {prev.selfie ? 'Repetir selfie' : '🤳 Tomar selfie'}
                </button>
              </>}
        </div>

        <div className="px-3.5 py-3 rounded-2xl text-[10px] leading-relaxed" style={{ backgroundColor: GL, color: '#065F46', border: `1px solid ${G}40` }}>
          Al enviar autorizas el tratamiento de tus datos biométricos (rostro) y de tu documento de identidad con el único fin de verificar tu identidad en Resolve Pasto (Ley 1581 de 2012). Las fotos se guardan en un espacio privado.
        </div>
        <ErrorBox msg={rechazo} />
        <ErrorBox msg={message} />
        <PrimaryBtn onClick={enviar} disabled={loading || tec.loading}>{loading ? 'Enviando y validando…' : 'Enviar para verificación →'}</PrimaryBtn>
      </div>
    </div>
  )
}

/* ═════════ Verificación enviada (paso final) ═════════ */
export function DoneScreen({ go }: { go: NavFn }) {
  return (
    <div className="flex flex-col h-full px-5 py-4" style={{ backgroundColor: BG }}>
      <div className="flex-1 flex flex-col items-center justify-center text-center">
        <div className="w-28 h-28 rounded-full flex items-center justify-center mb-5" style={{ background: PRIMARY, boxShadow: '0 16px 52px rgba(16,185,129,0.42)' }}>
          <svg width="52" height="52" viewBox="0 0 52 52"><path d="M12 26l11 11 18-19" stroke="white" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </div>
        <h2 className="text-2xl font-extrabold mb-2" style={{ fontFamily: 'Fraunces, serif', color: N }}>¡Documentos recibidos!</h2>
        <p className="text-sm leading-relaxed mb-5" style={{ color: MU }}>
          Revisaremos tu identidad. Cuando la aprobemos, tu perfil se publicará con la insignia <strong style={{ color: G }}>“Verificado”</strong> y podrás recibir solicitudes.
          Mientras tanto, <strong style={{ color: N }}>configura tu agenda</strong>: sin horarios no te asignamos trabajos.
        </p>
        <div className="w-full space-y-2.5">
          <PrimaryBtn onClick={() => go('agenda')}>Configurar mi agenda</PrimaryBtn>
          <button onClick={() => go('orders')} className="w-full py-3 rounded-2xl font-semibold text-xs border" style={{ borderColor: BD, color: MU }}>Ir a mis solicitudes</button>
        </div>
      </div>
    </div>
  )
}

/* ═════════ Agenda y disponibilidad ═════════ */
export function AgendaScreen({ perfil, go }: { perfil: Perfil; go: NavFn }) {
  const tec = useData(() => getMiTecnico(perfil.id), [perfil.id], null as MiTecnico | null)
  const franjas = useData(() => (tec.data ? getFranjas(tec.data.id) : Promise.resolve([] as Franja[])), [tec.data?.id], [] as Franja[])
  const [f, setF] = useState({ dia: '1', ini: '08:00', fin: '17:00' })
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)

  const agregar = async () => {
    setMessage('')
    if (!tec.data) return
    if (f.fin <= f.ini) return setMessage('La hora final debe ser posterior a la inicial.')
    setBusy(true)
    try { await agregarFranja(tec.data.id, Number(f.dia), f.ini, f.fin); franjas.reload() }
    catch (e) { console.error(e); setMessage(errMsg(e)) }
    finally { setBusy(false) }
  }
  const quitar = async (id: number) => {
    setMessage('')
    try { await eliminarFranja(id); franjas.reload() } catch (e) { console.error(e); setMessage(errMsg(e)) }
  }
  const alternar = async () => {
    if (!tec.data) return
    setMessage(''); setBusy(true)
    try { await setDisponible(!tec.data.disponible); tec.reload() }
    catch (e) { console.error(e); setMessage(errMsg(e)) }
    finally { setBusy(false) }
  }

  return (
    <div className="flex flex-col h-full" style={{ backgroundColor: BG }}>
      <DarkHeader><h2 className="text-lg font-extrabold text-white" style={{ fontFamily: 'Fraunces, serif' }}>Mi agenda</h2></DarkHeader>
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3" style={{ scrollbarWidth: 'none' }}>
        {tec.loading && <Loading />}
        {!tec.loading && !tec.data && (
          <div className="text-xs text-center py-6" style={{ color: MU }}>Primero completa tu registro. <button className="underline font-bold" style={{ color: G }} onClick={() => go('v1')}>Registrarme</button></div>
        )}
        {tec.data && (
          <>
            <div className="flex items-center justify-between rounded-2xl px-4 py-3" style={{ backgroundColor: W, border: `1px solid ${BD}` }}>
              <div>
                <div className="text-sm font-extrabold" style={{ color: N }}>{tec.data.disponible ? 'Disponible para trabajos' : 'No disponible'}</div>
                <div className="text-[10px]" style={{ color: MU }}>{tec.data.verificado ? 'Pausa tu cuenta cuando no quieras recibir solicitudes.' : 'Podrás activarlo cuando tu cuenta esté verificada.'}</div>
              </div>
              <button onClick={alternar} disabled={busy || !tec.data.verificado} className="text-[10px] font-extrabold px-3 py-1.5 rounded-xl"
                style={{ backgroundColor: tec.data.disponible ? '#FEE2E2' : G, color: tec.data.disponible ? '#991B1B' : N, opacity: tec.data.verificado ? 1 : 0.4 }}>
                {tec.data.disponible ? 'Pausar' : 'Activar'}
              </button>
            </div>

            <div className="rounded-2xl p-3.5" style={{ backgroundColor: W, border: `1px solid ${BD}` }}>
              <div className="text-xs font-extrabold mb-2" style={{ color: N }}>Agregar horario</div>
              <div className="grid grid-cols-3 gap-2 mb-2.5">
                <select value={f.dia} onChange={e => setF({ ...f, dia: e.target.value })} className="px-2 py-2.5 text-xs rounded-xl border outline-none" style={INPUT_STYLE}>
                  {[1, 2, 3, 4, 5, 6, 7].map(d => <option key={d} value={d}>{DIAS_LARGO[d]}</option>)}
                </select>
                <input type="time" value={f.ini} onChange={e => setF({ ...f, ini: e.target.value })} className="px-2 py-2.5 text-xs rounded-xl border outline-none" style={INPUT_STYLE} />
                <input type="time" value={f.fin} onChange={e => setF({ ...f, fin: e.target.value })} className="px-2 py-2.5 text-xs rounded-xl border outline-none" style={INPUT_STYLE} />
              </div>
              <PrimaryBtn onClick={agregar} disabled={busy}>Agregar</PrimaryBtn>
            </div>
            <ErrorBox msg={message} />

            <div className="rounded-2xl overflow-hidden" style={{ backgroundColor: W, border: `1px solid ${BD}` }}>
              {franjas.loading && <Loading />}
              {!franjas.loading && franjas.data.length === 0 && <p className="text-xs text-center py-5 px-4" style={{ color: MU }}>Aún no tienes horarios. Sin horarios no recibirás solicitudes.</p>}
              {franjas.data.map((x, i, arr) => (
                <div key={x.id} className="flex items-center justify-between px-4 py-2.5" style={{ borderBottom: i < arr.length - 1 ? `1px solid ${BD}` : undefined }}>
                  <span className="text-xs font-bold" style={{ color: N }}>{DIAS_LARGO[x.dia_semana]} · {x.hora_inicio.slice(0, 5)}–{x.hora_fin.slice(0, 5)}</span>
                  <button onClick={() => quitar(x.id)} aria-label="Eliminar horario" className="text-sm">🗑️</button>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
      <BottomNav active="agenda" go={go} rol={perfil.rol} />
    </div>
  )
}

/* ═════════ Verificación facial (ingreso e inicio de trabajo) ═════════ */
export function FaceScreen({ ctx, onDone, onCancel }: { ctx: FaceCtx; onDone: () => void; onCancel: () => void }) {
  const [fase, setFase] = useState<'probando' | 'camara' | 'enviando'>('probando')
  const [message, setMessage] = useState('')
  const [intento, setIntento] = useState(0)
  const started = useRef(false)

  const terminar = async () => {
    if (ctx.modo === 'login') await supabase.auth.refreshSession() // trae la nueva marca face_ok_until
    onDone()
  }

  useEffect(() => {
    if (started.current) return
    started.current = true
    biometria({ modo: ctx.modo, solicitud_id: ctx.solicitudId })
      .then(r => {
        if (r.ok) terminar()
        else if (r.requiere_imagen) setFase('camara')
        else setMessage(r.motivo ?? 'No se pudo iniciar la verificación.')
      })
      .catch(e => setMessage(errMsg(e)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const capturar = async (b64: string) => {
    setFase('enviando'); setMessage('')
    try {
      const r = await biometria({ modo: ctx.modo, solicitud_id: ctx.solicitudId, imagen: b64 })
      if (r.ok) return await terminar()
      setMessage(`${r.motivo ?? 'Tu rostro no coincide.'} Intentos restantes: ${r.intentos_restantes ?? 0}.`)
    } catch (e) {
      console.error(e); setMessage(errMsg(e))
    }
    setIntento(i => i + 1)
    setFase('camara')
  }

  return (
    <div className="flex flex-col h-full" style={{ backgroundColor: BG }}>
      <DarkHeader onBack={onCancel} backLabel="← Cancelar">
        <h2 className="text-lg font-extrabold text-white" style={{ fontFamily: 'Fraunces, serif' }}>Verifica tu identidad</h2>
        <p className="text-xs mt-0.5" style={{ color: 'rgba(255,255,255,0.55)' }}>
          {ctx.modo === 'login' ? 'Confirmamos que eres tú antes de recibir trabajos.' : 'Confirmamos que eres tú antes de iniciar el servicio.'}
        </p>
      </DarkHeader>
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3" style={{ scrollbarWidth: 'none' }}>
        {fase === 'probando' && !message && <Loading text="Preparando verificación…" />}
        {fase === 'enviando' && <Loading text="Comparando tu rostro…" />}
        {fase === 'camara' && (
          <>
            <p className="text-xs text-center" style={{ color: MU }}>Mira de frente a la cámara, con buena luz y sin gafas ni gorra.</p>
            <Camera key={intento} onCapture={b64 => capturar(b64)} />
          </>
        )}
        <ErrorBox msg={message} />
        {message && fase === 'probando' && <PrimaryBtn onClick={onCancel}>Volver</PrimaryBtn>}
      </div>
    </div>
  )
}
