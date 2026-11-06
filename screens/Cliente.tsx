import { useState, useMemo } from 'react'
import { calificar, errMsg, fmt, getBarrios, getCategorias, getDisponibilidades, getTecnicos, normCel, solicitarServicio, useData } from '../lib/api'
import type { Barrio, Categoria, Disponibilidad, Pedido, Perfil, WorkerType } from '../lib/api'
import { N, G, GL, BG, MU, BD, W, PRIMARY, INPUT, INPUT_STYLE, CAT_STYLE, DEFAULT_CAT, DIAS, todayLocal, BottomNav, Stars, VBadge, Avatar, Field, ErrorBox, PrimaryBtn, DarkHeader, Loading } from '../ui'
import type { NavFn } from '../ui'

export function HomeScreen({ perfil, go, setWorker }: { perfil: Perfil; go: NavFn; setWorker: (w: WorkerType | null) => void }) {
  const tecnicos = useData(getTecnicos, [], [] as WorkerType[])
  const cats = useData(getCategorias, [], [] as Categoria[])
  const [filter, setFilter] = useState<number | null>(null)
  const [q, setQ] = useState('')
  const puedeSolicitar = perfil.rol === 'cliente'

  const visible = useMemo(() => {
    const s = q.trim().toLowerCase()
    return tecnicos.data.filter(w =>
      (filter === null || w.categoryId === filter) &&
      (!s || [w.name, w.trade, w.category, w.neighborhood].some(x => x.toLowerCase().includes(s))))
  }, [tecnicos.data, filter, q])

  return (
    <div className="flex flex-col h-full" style={{ backgroundColor: BG }}>
      <div className="flex-shrink-0 px-4 pt-3 pb-4" style={{ backgroundColor: W }}>
        <h2 className="text-xl font-extrabold mb-0.5" style={{ fontFamily: 'Fraunces, serif', color: N }}>
          Hola 👋 {perfil.nombre.split(' ')[0]}
        </h2>
        <p className="text-xs mb-3" style={{ color: MU }}>¿Qué necesitas resolver hoy?</p>
        <div className="flex items-center gap-2.5 px-3.5 py-2.5 rounded-2xl border" style={{ backgroundColor: BG, borderColor: BD }}>
          <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
            <circle cx="7" cy="7" r="5" stroke={MU} strokeWidth="1.4" /><path d="M11 11l3 3" stroke={MU} strokeWidth="1.4" strokeLinecap="round" />
          </svg>
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Buscar plomero, electricista, barrio…"
            aria-label="Buscar técnicos" className="flex-1 text-xs bg-transparent outline-none" />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto" style={{ scrollbarWidth: 'none' }}>
        {puedeSolicitar && (
          <div className="px-4 pt-3">
            <button onClick={() => { setWorker(null); go('request') }} className="w-full py-3 rounded-2xl font-extrabold text-xs"
              style={{ background: PRIMARY, color: N, boxShadow: '0 4px 14px rgba(16,185,129,0.3)' }}>
              ⚡ Pedir un técnico (asignación automática)
            </button>
          </div>
        )}
        {cats.data.length > 0 && (
          <div className="px-4 pt-3">
            <h3 className="text-[10px] font-extrabold mb-2.5 uppercase tracking-wider" style={{ color: N }}>Servicios</h3>
            <div className="grid grid-cols-4 gap-2 mb-4">
              {cats.data.map(c => {
                const st = CAT_STYLE[c.nombre] ?? DEFAULT_CAT, on = filter === c.id
                return (
                  <button key={c.id} onClick={() => setFilter(on ? null : c.id)} className="rounded-2xl py-2.5 text-center transition-all"
                    style={{ backgroundColor: on ? st.bg : W, border: `1.5px solid ${on ? st.color + '50' : BD}` }}>
                    <div className="text-xl leading-none mb-0.5">{c.icono || '🔧'}</div>
                    <div className="text-[8px] font-bold leading-tight" style={{ color: on ? st.color : MU }}>{c.nombre}</div>
                  </button>
                )
              })}
            </div>
          </div>
        )}

        <div className="px-4 pb-3">
          <div className="flex items-center justify-between mb-2.5">
            <h3 className="text-[10px] font-extrabold uppercase tracking-wider" style={{ color: N }}>Técnicos cerca de ti</h3>
            {!tecnicos.loading && <span className="text-[10px] font-semibold" style={{ color: G }}>{visible.length} disponibles</span>}
          </div>
          {tecnicos.loading && <Loading text="Cargando técnicos…" />}
          {tecnicos.error && (
            <div className="space-y-2"><ErrorBox msg={tecnicos.error} />
              <button onClick={tecnicos.reload} className="text-xs font-bold underline" style={{ color: G }}>Reintentar</button></div>
          )}
          {!tecnicos.loading && !tecnicos.error && visible.length === 0 && (
            <p className="text-xs text-center py-6" style={{ color: MU }}>
              {tecnicos.data.length === 0 ? 'Aún no hay técnicos registrados.' : 'No hay técnicos que coincidan con tu búsqueda.'}
            </p>
          )}
          <div className="space-y-3">
            {visible.map(w => (
              <div key={w.id} className="rounded-3xl p-3.5" style={{ backgroundColor: W, boxShadow: '0 2px 12px rgba(11,28,45,0.07)', border: `1px solid ${BD}` }}>
                <div className="flex items-start gap-3">
                  <div className="w-14 h-14 rounded-2xl overflow-hidden flex-shrink-0"><Avatar w={w} /></div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-1">
                      <div>
                        <div className="font-extrabold text-sm leading-tight" style={{ color: N }}>{w.name}</div>
                        <div className="text-[10px] mt-0.5" style={{ color: MU }}>{w.trade}</div>
                      </div>
                      {w.verified && <VBadge />}
                    </div>
                    <div className="flex items-center gap-1.5 mt-1.5">
                      {w.reviews > 0
                        ? <><Stars r={w.rating} size={10} /><span className="text-xs font-bold" style={{ color: N }}>{w.rating.toFixed(1)}</span>
                            <span className="text-[10px]" style={{ color: MU }}>({w.reviews})</span></>
                        : <span className="text-[10px]" style={{ color: MU }}>Sin reseñas aún</span>}
                    </div>
                    <div className="flex flex-wrap gap-x-2 mt-1 text-[10px]" style={{ color: MU }}>
                      {w.neighborhood && <span>📍 {w.neighborhood}</span>}
                      <span>· {w.jobs} trabajos</span><span>· {w.years} años</span>
                    </div>
                  </div>
                </div>
                <div className="flex items-center justify-between mt-3 pt-3 border-t" style={{ borderColor: BD }}>
                  <div>
                    <div className="text-[9px]" style={{ color: MU }}>desde</div>
                    <div className="text-sm font-extrabold" style={{ color: G }}>{fmt(w.priceMin)}</div>
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => { setWorker(w); go('worker') }} className="text-[10px] font-bold px-3 py-1.5 rounded-xl border"
                      style={{ borderColor: BD, color: N, backgroundColor: BG }}>Ver perfil</button>
                    {puedeSolicitar && (
                      <button onClick={() => { setWorker(w); go('request') }} className="text-[10px] font-extrabold px-3 py-1.5 rounded-xl"
                        style={{ backgroundColor: G, color: N }}>Contactar</button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
      <BottomNav active="home" go={go} rol={perfil.rol} />
    </div>
  )
}


export function WorkerScreen({ worker: w, perfil, go }: { worker: WorkerType; perfil: Perfil; go: NavFn }) {
  const disp = useData(() => getDisponibilidades(w.id), [w.id], [] as Disponibilidad[])
  const horario = disp.data.map(d => `${DIAS[d.dia_semana % 7]} ${d.hora_inicio.slice(0, 5)}–${d.hora_fin.slice(0, 5)}`).join(' · ')
  const rows: [string, string, string][] = [
    ['💰', 'Tarifa', `${fmt(w.priceMin)} – ${fmt(w.priceMax)} COP`],
    ['📍', 'Barrio', w.neighborhood ? `${w.neighborhood}, Pasto` : 'No especificado'],
    ['📅', 'Horario', disp.loading ? 'Cargando…' : horario || 'A convenir'],
    ['🔒', 'Verificación', w.verified ? 'Identidad verificada' : 'En proceso de verificación'],
  ]
  return (
    <div className="flex flex-col h-full overflow-y-auto" style={{ backgroundColor: BG, scrollbarWidth: 'none' }}>
      <div className="relative h-36 flex-shrink-0" style={{ background: `linear-gradient(135deg, ${N} 0%, #1a3a5c 100%)` }}>
        <button onClick={() => go('home')} aria-label="Volver" className="absolute top-3 left-3 w-8 h-8 rounded-full flex items-center justify-center"
          style={{ backgroundColor: 'rgba(255,255,255,0.14)' }}>
          <svg width="14" height="14" viewBox="0 0 14 14"><path d="M9 3L4 7l5 4" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </button>
        <div className="absolute left-4 -bottom-8 w-16 h-16 rounded-2xl overflow-hidden" style={{ boxShadow: `0 0 0 3px ${W}` }}><Avatar w={w} /></div>
      </div>
      <div className="px-4 pt-10 pb-4 flex-1">
        <div className="flex items-start justify-between mb-1">
          <div>
            <h2 className="text-lg font-extrabold leading-tight" style={{ fontFamily: 'Fraunces, serif', color: N }}>{w.name}</h2>
            <p className="text-xs" style={{ color: MU }}>{w.trade}{w.neighborhood && ` · 📍 ${w.neighborhood}`}</p>
          </div>
          {w.verified && <VBadge />}
        </div>
        <div className="flex items-center gap-2 mb-4 h-5">
          {w.reviews > 0
            ? <><Stars r={w.rating} size={12} /><span className="text-sm font-extrabold" style={{ color: N }}>{w.rating.toFixed(1)}</span>
                <span className="text-xs" style={{ color: MU }}>({w.reviews} reseñas)</span></>
            : <span className="text-xs" style={{ color: MU }}>Sin reseñas aún</span>}
        </div>
        {w.description && <p className="text-xs leading-relaxed mb-4" style={{ color: N }}>{w.description}</p>}
        <div className="grid grid-cols-3 gap-2 mb-4">
          {[[w.reviews > 0 ? w.rating.toFixed(1) : '—', 'Rating'], [String(w.jobs), 'Trabajos'], [String(w.years), 'Años']].map(([v, l]) => (
            <div key={l} className="rounded-2xl p-2.5 text-center" style={{ backgroundColor: W, border: `1px solid ${BD}` }}>
              <div className="font-extrabold text-sm" style={{ color: N }}>{v}</div>
              <div className="text-[9px] mt-0.5" style={{ color: MU }}>{l}</div>
            </div>
          ))}
        </div>
        <div className="rounded-2xl overflow-hidden mb-4" style={{ backgroundColor: W, border: `1px solid ${BD}` }}>
          {rows.map(([icon, label, val], i) => (
            <div key={label} className="flex items-center justify-between gap-3 px-4 py-2.5" style={{ borderBottom: i < rows.length - 1 ? `1px solid ${BD}` : undefined }}>
              <span className="text-xs flex-shrink-0" style={{ color: MU }}>{icon} {label}</span>
              <span className="text-xs font-bold text-right" style={{ color: N }}>{val}</span>
            </div>
          ))}
        </div>
        {perfil.rol === 'cliente' && <PrimaryBtn onClick={() => go('request')}>Solicitar servicio</PrimaryBtn>}
      </div>
    </div>
  )
}


/* ═════════ Solicitud ═════════ */
export function RequestScreen({ worker: w, perfil, go, onAssigned }: {
  worker: WorkerType | null; perfil: Perfil; go: NavFn; onAssigned: (a: { nombre: string; auto: boolean }) => void
}) {
  const cats = useData(getCategorias, [], [] as Categoria[])
  const barrios = useData(getBarrios, [], [] as Barrio[])
  const [form, setForm] = useState({
    name: perfil.nombre, phone: perfil.telefono ?? '', categoriaId: '', barrioId: '',
    date: '', hora: '', direccion: '', desc: '',
  })
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm({ ...form, [k]: e.target.value })

  const enviar = async () => {
    setMessage('')
    const phone = normCel(form.phone)
    if (form.name.trim().length < 3) return setMessage('Ingresa tu nombre completo.')
    if (!phone) return setMessage('Ingresa un celular colombiano válido (10 dígitos, empieza por 3).')
    if (!w && !form.categoriaId) return setMessage('Elige qué tipo de técnico necesitas.')
    if (!form.barrioId) return setMessage('Elige tu barrio.')
    if (form.direccion.trim().length < 5) return setMessage('Ingresa la dirección donde se hará el trabajo.')
    if (!form.date || form.date < todayLocal()) return setMessage('Elige una fecha de hoy en adelante.')
    if (form.desc.trim().length < 10) return setMessage('Describe el trabajo con al menos 10 caracteres.')

    setLoading(true)
    try {
      const r = await solicitarServicio({
        categoriaId: w ? (w.categoryId ?? 0) : Number(form.categoriaId), barrioId: Number(form.barrioId),
        fecha: form.date, nombre: form.name.trim(), telefono: phone, direccion: form.direccion.trim(),
        hora: form.hora, descripcion: form.desc.trim(), tecnicoId: w?.id ?? null,
      })
      onAssigned({ nombre: r.tecnicoNombre, auto: !w })
      go('confirm')
    } catch (e) {
      console.error(e); setMessage(errMsg(e))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex flex-col h-full" style={{ backgroundColor: BG }}>
      <DarkHeader onBack={() => go(w ? 'worker' : 'home')} backLabel={w ? '← Volver al perfil' : '← Volver'}>
        {w ? (
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-2xl overflow-hidden flex-shrink-0" style={{ border: `2px solid ${G}50` }}><Avatar w={w} /></div>
            <div className="flex-1">
              <div className="font-extrabold text-white text-sm">{w.name}</div>
              <div className="text-[10px]" style={{ color: 'rgba(255,255,255,0.55)' }}>{w.trade}</div>
              <div className="text-xs font-bold mt-0.5" style={{ color: G }}>{fmt(w.priceMin)} – {fmt(w.priceMax)} COP</div>
            </div>
          </div>
        ) : (
          <>
            <h2 className="text-lg font-extrabold text-white" style={{ fontFamily: 'Fraunces, serif' }}>Pedir un técnico</h2>
            <p className="text-xs mt-0.5" style={{ color: 'rgba(255,255,255,0.55)' }}>Te asignamos el mejor técnico verificado disponible.</p>
          </>
        )}
      </DarkHeader>
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3" style={{ scrollbarWidth: 'none' }}>
        {!w && (
          <Field label="¿Qué necesitas? *">
            <select value={form.categoriaId} onChange={set('categoriaId')} className={INPUT} style={INPUT_STYLE}>
              <option value="">Seleccionar…</option>{cats.data.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
            </select>
          </Field>
        )}
        <Field label="Tu barrio *">
          <select value={form.barrioId} onChange={set('barrioId')} className={INPUT} style={INPUT_STYLE}>
            <option value="">Seleccionar…</option>{barrios.data.map(b => <option key={b.id} value={b.id}>{b.nombre}</option>)}
          </select>
        </Field>
        <Field label="Dirección del servicio *">
          <input value={form.direccion} maxLength={120} autoComplete="street-address" onChange={set('direccion')}
            placeholder="Ej: Cra 5 #10-20, apto 301" className={INPUT} style={INPUT_STYLE} />
        </Field>
        <div className="grid grid-cols-2 gap-2.5">
          <Field label="Fecha *"><input type="date" value={form.date} min={todayLocal()} onChange={set('date')} className={INPUT} style={INPUT_STYLE} /></Field>
          <Field label="Hora (opcional)"><input type="time" value={form.hora} onChange={set('hora')} className={INPUT} style={INPUT_STYLE} /></Field>
        </div>
        <Field label="Describe el trabajo o problema *">
          <textarea rows={4} maxLength={1000} value={form.desc} onChange={set('desc')}
            placeholder="Ej: Tengo una fuga en el baño del segundo piso, lleva 2 días…" className={`${INPUT} resize-none`} style={INPUT_STYLE} />
        </Field>
        <Field label="Nombre de contacto *"><input value={form.name} autoComplete="name" onChange={set('name')} className={INPUT} style={INPUT_STYLE} /></Field>
        <Field label="Celular de contacto *">
          <input type="tel" autoComplete="tel" value={form.phone} onChange={set('phone')} placeholder="311 555 7890" className={INPUT} style={INPUT_STYLE} />
        </Field>
        <div className="px-3.5 py-3 rounded-2xl text-xs" style={{ backgroundColor: GL, border: `1px solid ${G}40`, color: '#065F46' }}>
          🔒 Tu dirección y celular solo se muestran al técnico cuando acepta tu solicitud. El precio final lo acuerdas con él.
        </div>
        <ErrorBox msg={message} />
        <PrimaryBtn onClick={enviar} disabled={loading}>{loading ? 'Buscando técnico…' : w ? 'Enviar solicitud →' : 'Buscar técnico →'}</PrimaryBtn>
      </div>
    </div>
  )
}

export function ConfirmScreen({ asignado, go }: { asignado: { nombre: string; auto: boolean }; go: NavFn }) {
  return (
    <div className="flex flex-col h-full px-5 py-6 overflow-y-auto" style={{ backgroundColor: BG, scrollbarWidth: 'none' }}>
      <div className="flex flex-col items-center text-center mb-6 mt-4">
        <div className="w-24 h-24 rounded-full flex items-center justify-center mb-4" style={{ background: PRIMARY, boxShadow: '0 14px 44px rgba(16,185,129,0.38)' }}>
          <svg width="42" height="42" viewBox="0 0 42 42"><path d="M10 21l9 9 14-14" stroke="white" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </div>
        <h2 className="text-2xl font-extrabold mb-2" style={{ fontFamily: 'Fraunces, serif', color: N }}>¡Solicitud enviada!</h2>
        <p className="text-sm leading-relaxed" style={{ color: MU }}>
          {asignado.auto ? 'Asignamos tu solicitud a ' : 'Enviamos tu solicitud a '}
          <strong style={{ color: N }}>{asignado.nombre}</strong>.
          {asignado.auto
            ? ' Si no responde en 10 minutos, la pasamos automáticamente al siguiente técnico disponible.'
            : ' Si no responde en 10 minutos, la solicitud vencerá y podrás pedir otra.'}
        </p>
      </div>
      <div className="space-y-2.5">
        <PrimaryBtn onClick={() => go('orders')}>Seguir mi pedido</PrimaryBtn>
        <button onClick={() => go('home')} className="w-full py-3 rounded-2xl font-semibold text-xs border" style={{ borderColor: BD, color: MU }}>Volver al inicio</button>
      </div>
    </div>
  )
}

export function RateScreen({ pedido, perfil, go }: { pedido: Pedido; perfil: Perfil; go: NavFn }) {
  const [stars, setStars] = useState(0)
  const [hover, setHover] = useState(0)
  const [comment, setComment] = useState('')
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')
  const [done, setDone] = useState(false)
  const labels = ['', 'Muy malo', 'Regular', 'Bueno', 'Muy bueno', '¡Excelente!']

  const enviar = async () => {
    if (stars === 0) return
    setLoading(true); setMessage('')
    try {
      await calificar({ solicitudId: pedido.id, clienteId: perfil.id, tecnicoId: pedido.tecnicoId, puntuacion: stars, comentario: comment })
      setDone(true)
    } catch (e) {
      console.error(e); setMessage(errMsg(e))
    } finally {
      setLoading(false)
    }
  }

  if (done) return (
    <div className="flex flex-col items-center justify-center h-full px-6 text-center" style={{ backgroundColor: BG }}>
      <div className="text-6xl mb-4">🎉</div>
      <h3 className="text-2xl font-extrabold mb-2" style={{ fontFamily: 'Fraunces, serif', color: N }}>¡Gracias!</h3>
      <p className="text-sm mb-6" style={{ color: MU }}>Tu reseña ayuda a otros vecinos de Pasto a tomar mejores decisiones.</p>
      <PrimaryBtn onClick={() => go('orders')}>Volver a mis pedidos</PrimaryBtn>
    </div>
  )

  return (
    <div className="flex flex-col h-full" style={{ backgroundColor: BG }}>
      <DarkHeader onBack={() => go('orders')}>
        <h2 className="text-lg font-extrabold text-white" style={{ fontFamily: 'Fraunces, serif' }}>¿Cómo estuvo el servicio?</h2>
        <p className="text-xs mt-0.5" style={{ color: 'rgba(255,255,255,0.55)' }}>Califica a {pedido.tecnicoNombre}</p>
      </DarkHeader>
      <div className="flex-1 overflow-y-auto px-4 py-6" style={{ scrollbarWidth: 'none' }}>
        <div className="flex justify-center gap-2.5 mb-2">
          {[1, 2, 3, 4, 5].map(s => (
            <button key={s} aria-label={`${s} estrellas`} onMouseEnter={() => setHover(s)} onMouseLeave={() => setHover(0)} onClick={() => setStars(s)}
              className="transition-transform" style={{ transform: (hover || stars) >= s ? 'scale(1.2)' : 'scale(1)' }}>
              <svg width="38" height="38" viewBox="0 0 40 40">
                <path d="M20 3l4 12H37L27 22.5l4.5 12.5L20 27l-11.5 8L13 22.5 3 15h13L20 3z" fill={(hover || stars) >= s ? G : BD} />
              </svg>
            </button>
          ))}
        </div>
        <p className="text-center text-sm font-bold mb-5" style={{ color: stars > 0 ? G : MU }}>{labels[hover || stars] || 'Toca para calificar'}</p>
        <div className="mb-4">
          <Field label="Comentario para los vecinos (opcional)">
            <textarea rows={4} maxLength={500} value={comment} onChange={e => setComment(e.target.value)}
              placeholder="Ej: Llegó puntual y dejó todo limpio…" className={`${INPUT} resize-none`} style={INPUT_STYLE} />
          </Field>
        </div>
        <div className="space-y-3">
          <ErrorBox msg={message} />
          <PrimaryBtn onClick={enviar} disabled={stars === 0 || loading}>{loading ? 'Enviando…' : 'Enviar calificación'}</PrimaryBtn>
        </div>
      </div>
    </div>
  )
}

