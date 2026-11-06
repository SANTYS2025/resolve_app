import { useState, useMemo, useEffect } from 'react'
import logo from './imports/image.png'

// ─── DATA ────────────────────────────────────────────────────────────────────

const CATEGORIES = [
  { icon: '🔧', name: 'Plomería',      bg: '#E8F4FF', accent: '#1565C0', keywords: ['plomero','plomería','tubería','fontanero'] },
  { icon: '⚡', name: 'Electricidad',  bg: '#FFF8E1', accent: '#F57F17', keywords: ['electricista','eléctrico','industrial','residencial'] },
  { icon: '🪚', name: 'Carpintería',   bg: '#F1F8E9', accent: '#33691E', keywords: ['carpintero','carpintería','madera','muebles'] },
  { icon: '🌿', name: 'Jardinería',    bg: '#E8F5E9', accent: '#2E7D32', keywords: ['jardín','jardinero','paisajismo','plantas'] },
  { icon: '🎨', name: 'Pintura',       bg: '#FCE4EC', accent: '#880E4F', keywords: ['pintor','pintora','pintura','interior','fachada'] },
  { icon: '❄️', name: 'Refrigeración', bg: '#E0F7FA', accent: '#00695C', keywords: ['refrigeración','aire','aires','técnica','frío'] },
  { icon: '🧱', name: 'Albañilería',   bg: '#FBE9E7', accent: '#BF360C', keywords: ['albañil','albañilería','construcción','mampostería','obra'] },
  { icon: '🪟', name: 'Vidriería',     bg: '#EDE7F6', accent: '#4527A0', keywords: ['vidriería','vidriero','vidrio','ventanas','espejos'] },
]

type Worker = {
  id: number; name: string; trade: string; category: string; neighborhood: string
  rating: number; reviews: number; priceMin: number; priceMax: number
  badge: string; years: number; avatar: string; verified: true; jobs: number
  phone: string; bio: string; availability: string
}

const WORKERS: Worker[] = [
  { id:1,  name:'Carlos Muñoz Rueda',  trade:'Plomero Certificado',     category:'Plomería',      neighborhood:'Lorenzo',    rating:4.9, reviews:87, priceMin:35000,  priceMax:80000,  badge:'Top del Mes', years:12, avatar:'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=200&h=200&fit=crop&auto=format', verified:true, jobs:214, phone:'310 555 1234', bio:'Especialista en redes hidráulicas, instalaciones sanitarias y mantenimiento de tuberías.', availability:'Lun–Sáb, 7am–6pm' },
  { id:2,  name:'Lucia Benavides',     trade:'Electricista Industrial',  category:'Electricidad',  neighborhood:'Jongovito',  rating:4.8, reviews:63, priceMin:40000,  priceMax:120000, badge:'Verificada',  years:8,  avatar:'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=200&h=200&fit=crop&auto=format', verified:true, jobs:158, phone:'311 555 5678', bio:'Instalaciones eléctricas residenciales e industriales, tableros de control y certificaciones RETIE.', availability:'Lun–Vie, 8am–5pm' },
  { id:3,  name:'Hernán Solarte',      trade:'Carpintero de Obra',       category:'Carpintería',   neighborhood:'Torobajo',   rating:4.7, reviews:45, priceMin:50000,  priceMax:150000, badge:'Verificado',  years:15, avatar:'https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?w=200&h=200&fit=crop&auto=format', verified:true, jobs:97,  phone:'312 555 9101', bio:'Muebles a medida, closets, cocinas integrales y restauración de piezas en madera.', availability:'Lun–Sáb, 8am–7pm' },
  { id:4,  name:'Paola Córdoba',       trade:'Pintora de Interiores',    category:'Pintura',       neighborhood:'San Ignacio',rating:5.0, reviews:31, priceMin:30000,  priceMax:70000,  badge:'Nuevo ⭐',    years:4,  avatar:'https://images.unsplash.com/photo-1531746020798-e6953c6e8e04?w=200&h=200&fit=crop&auto=format', verified:true, jobs:52,  phone:'313 555 2345', bio:'Pintura de interiores, fachadas y texturas decorativas. Pinturas ecológicas y estuco veneciano.', availability:'Lun–Sáb, 7am–5pm' },
  { id:5,  name:'Rodrigo Pantoja',     trade:'Jardín y Paisajismo',      category:'Jardinería',    neighborhood:'Briceño',    rating:4.6, reviews:29, priceMin:25000,  priceMax:60000,  badge:'Verificado',  years:7,  avatar:'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=200&h=200&fit=crop&auto=format', verified:true, jobs:78,  phone:'314 555 6789', bio:'Diseño y mantenimiento de jardines, podas y control de plagas en exterior.', availability:'Mar–Dom, 7am–4pm' },
  { id:6,  name:'Esperanza Narváez',   trade:'Técnica en Refrigeración', category:'Refrigeración', neighborhood:'París',      rating:4.9, reviews:22, priceMin:45000,  priceMax:100000, badge:'Verificada',  years:6,  avatar:'https://images.unsplash.com/photo-1438761681033-6461ffad8d80?w=200&h=200&fit=crop&auto=format', verified:true, jobs:61,  phone:'315 555 3456', bio:'Mantenimiento, instalación y recarga de aires acondicionados residenciales y comerciales.', availability:'Lun–Sáb, 8am–6pm' },
  { id:7,  name:'Marcos Guerrero',     trade:'Albañil y Constructor',    category:'Albañilería',   neighborhood:'Aranda',     rating:4.7, reviews:54, priceMin:45000,  priceMax:130000, badge:'Verificado',  years:18, avatar:'https://images.unsplash.com/photo-1552058544-f2b08422138a?w=200&h=200&fit=crop&auto=format', verified:true, jobs:132, phone:'316 555 7890', bio:'Levantamiento de muros, pañetes, pisos, enchapes y remodelaciones en general.', availability:'Lun–Sáb, 6am–5pm' },
  { id:8,  name:'Diana Tapia',         trade:'Vidriería y Espejos',      category:'Vidriería',     neighborhood:'Obrero',     rating:4.5, reviews:18, priceMin:35000,  priceMax:90000,  badge:'Verificada',  years:5,  avatar:'https://images.unsplash.com/photo-1580489944761-15a19d654956?w=200&h=200&fit=crop&auto=format', verified:true, jobs:44,  phone:'317 555 1122', bio:'Vidrios templados, espejos decorativos, mamparas de baño y ventanas de aluminio a medida.', availability:'Lun–Vie, 8am–5pm' },
  { id:9,  name:'Julián Ortega',       trade:'Plomero Residencial',      category:'Plomería',      neighborhood:'Madrigal',   rating:4.6, reviews:39, priceMin:30000,  priceMax:70000,  badge:'Verificado',  years:9,  avatar:'https://images.unsplash.com/photo-1492562080023-ab3db95bfbce?w=200&h=200&fit=crop&auto=format', verified:true, jobs:103, phone:'318 555 3344', bio:'Reparación de fugas, sanitarios, grifería y redes de agua fría y caliente.', availability:'Lun–Dom, 7am–8pm' },
  { id:10, name:'Fernando Riascos',    trade:'Electricista Residencial', category:'Electricidad',  neighborhood:'San Felipe', rating:4.8, reviews:47, priceMin:35000,  priceMax:90000,  badge:'Verificado',  years:11, avatar:'https://images.unsplash.com/photo-1463453091185-61582044d556?w=200&h=200&fit=crop&auto=format', verified:true, jobs:175, phone:'319 555 5566', bio:'Tomacorrientes, iluminación LED, circuitos adicionales y revisiones preventivas para hogares.', availability:'Lun–Sáb, 7am–6pm' },
  { id:11, name:'Gloria Melo',         trade:'Jardinera Ornamental',     category:'Jardinería',    neighborhood:'El Tejar',   rating:4.9, reviews:15, priceMin:20000,  priceMax:50000,  badge:'Nuevo ⭐',    years:3,  avatar:'https://images.unsplash.com/photo-1508214751196-bcfd4ca60f91?w=200&h=200&fit=crop&auto=format', verified:true, jobs:28,  phone:'320 555 7788', bio:'Jardines interiores y exteriores, terrazas verdes y huertos urbanos.', availability:'Mar–Dom, 8am–4pm' },
  { id:12, name:'Arnoldo Chaves',      trade:'Pintor de Fachadas',       category:'Pintura',       neighborhood:'Miraflores', rating:4.7, reviews:36, priceMin:40000,  priceMax:110000, badge:'Verificado',  years:14, avatar:'https://images.unsplash.com/photo-1566492031773-4f4e44671857?w=200&h=200&fit=crop&auto=format', verified:true, jobs:89,  phone:'321 555 9900', bio:'Fachadas, impermeabilización de terrazas, graniplast y tratamiento de humedades.', availability:'Lun–Sáb, 6am–6pm' },
]

const TESTIMONIALS = [
  { text:'Carlos llegó en menos de una hora y reparó la tubería sin dejar rastro de suciedad. Precios justos y trabajo impecable. Lo recomiendo con los ojos cerrados.', author:'Marta Elena Rosero', neighborhood:'Lorenzo, Pasto', avatar:'https://images.unsplash.com/photo-1544005313-94ddf0286df2?w=80&h=80&fit=crop&auto=format' },
  { text:'Gracias a la verificación de antecedentes, tuve la tranquilidad de dejar a Lucia trabajar en casa mientras estaba en el trabajo. El sistema de calificaciones no miente.', author:'Javier Morales', neighborhood:'Jongovito, Pasto', avatar:'https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=80&h=80&fit=crop&auto=format' },
  { text:'Los precios estandarizados son lo mejor. Antes me cobraban lo que querían. Ahora sé exactamente cuánto voy a pagar antes de que lleguen a casa.', author:'Ana Lucía Bolaños', neighborhood:'Torobajo, Pasto', avatar:'https://images.unsplash.com/photo-1487412720507-e7ab37603c6f?w=80&h=80&fit=crop&auto=format' },
]

const NEIGHBORHOODS = ['Todos los barrios','Lorenzo','Jongovito','Torobajo','San Ignacio','Briceño','París','Aranda','Obrero','Madrigal','San Felipe','El Tejar','Miraflores']
const SORT_OPTIONS  = [
  { value:'rating',     label:'Mejor calificado' },
  { value:'jobs',       label:'Más trabajos' },
  { value:'price_asc',  label:'Precio: menor a mayor' },
  { value:'price_desc', label:'Precio: mayor a menor' },
  { value:'years',      label:'Más experiencia' },
]

// ─── HELPERS ─────────────────────────────────────────────────────────────────

const fmt = (n: number) => '$' + n.toLocaleString('es-CO')

function Stars({ rating, size=12 }: { rating:number; size?:number }) {
  return (
    <span className="flex items-center gap-0.5">
      {[1,2,3,4,5].map(s => (
        <svg key={s} width={size} height={size} viewBox="0 0 12 12">
          <path d="M6 1l1.2 3.6H11L8.1 6.9l1 3.6L6 8.4l-3.1 2.1 1-3.6L1 4.6h3.8L6 1z"
            fill={s <= Math.round(rating) ? '#1AC938' : '#C8E6CB'} />
        </svg>
      ))}
    </span>
  )
}

function CheckBadge({ size=14 }: { size?:number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16">
      <circle cx="8" cy="8" r="7" fill="#1AC938"/>
      <path d="M5 8l2.5 2.5 3.5-3.5" stroke="#0A1628" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  )
}

// ─── MODAL WRAPPER ───────────────────────────────────────────────────────────

function Modal({ onClose, children }: { onClose:()=>void; children:React.ReactNode }) {
  useEffect(() => {
    const h = (e:KeyboardEvent) => e.key==='Escape' && onClose()
    window.addEventListener('keydown', h)
    document.body.style.overflow = 'hidden'
    return () => { window.removeEventListener('keydown', h); document.body.style.overflow = '' }
  }, [onClose])
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backgroundColor:'rgba(10,22,40,0.75)', backdropFilter:'blur(6px)' }}
      onClick={e => e.target===e.currentTarget && onClose()}>
      {children}
    </div>
  )
}

// ─── CONTACT MODAL ───────────────────────────────────────────────────────────

function ContactModal({ worker, onClose }: { worker:Worker; onClose:()=>void }) {
  const [step, setStep] = useState<'form'|'success'>('form')
  const [form, setForm] = useState({ name:'', phone:'', desc:'', date:'', time:'' })
  const [errors, setErrors] = useState<Record<string,string>>({})

  function validate() {
    const e: Record<string,string> = {}
    if (!form.name.trim()) e.name = 'Tu nombre es requerido'
    if (!form.phone.trim() || form.phone.replace(/\D/g,'').length<10) e.phone = 'Número válido requerido'
    if (!form.desc.trim()) e.desc = 'Describe el trabajo'
    if (!form.date) e.date = 'Selecciona una fecha'
    return e
  }

  function submit(ev:React.FormEvent) {
    ev.preventDefault()
    const e = validate()
    if (Object.keys(e).length) { setErrors(e); return }
    setStep('success')
  }

  return (
    <Modal onClose={onClose}>
      <div className="w-full max-w-md rounded-3xl overflow-hidden shadow-2xl" style={{ backgroundColor:'var(--card)' }}>
        <div className="relative px-6 pt-6 pb-5" style={{ background:'linear-gradient(135deg, #0A1628 0%, #0D1F3C 100%)' }}>
          <button onClick={onClose} className="absolute top-4 right-4 w-7 h-7 rounded-full flex items-center justify-center" style={{ backgroundColor:'rgba(255,255,255,0.12)' }}>
            <svg width="12" height="12" viewBox="0 0 12 12"><path d="M2 2l8 8M10 2L2 10" stroke="white" strokeWidth="1.5" strokeLinecap="round"/></svg>
          </button>
          <div className="flex items-center gap-3 mb-4">
            <div className="w-12 h-12 rounded-2xl overflow-hidden" style={{ border:'2px solid rgba(26,201,56,0.4)' }}>
              <img src={worker.avatar} alt={worker.name} className="w-full h-full object-cover"/>
            </div>
            <div>
              <div className="font-semibold text-white text-sm flex items-center gap-1.5">
                {worker.name} <CheckBadge size={13}/>
              </div>
              <div className="text-xs" style={{ color:'rgba(255,255,255,0.5)' }}>{worker.trade}</div>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <div>
              <div className="font-bold text-white text-sm">{worker.rating}</div>
              <Stars rating={worker.rating} size={9}/>
            </div>
            <div className="w-px h-8" style={{ backgroundColor:'rgba(255,255,255,0.15)' }}/>
            <div>
              <div className="font-bold text-white text-sm">{worker.jobs}</div>
              <div className="text-[10px]" style={{ color:'rgba(255,255,255,0.4)', fontFamily:'DM Mono, monospace' }}>trabajos</div>
            </div>
            <div className="w-px h-8" style={{ backgroundColor:'rgba(255,255,255,0.15)' }}/>
            <div className="flex-1 text-right">
              <div className="font-bold text-sm" style={{ color:'#1AC938' }}>{fmt(worker.priceMin)}–{fmt(worker.priceMax)}</div>
              <div className="text-[10px]" style={{ color:'rgba(255,255,255,0.4)', fontFamily:'DM Mono, monospace' }}>tarifa estimada</div>
            </div>
          </div>
        </div>
        {step==='success' ? (
          <div className="px-6 py-10 text-center">
            <div className="w-16 h-16 rounded-full mx-auto mb-4 flex items-center justify-center text-2xl" style={{ background:'linear-gradient(135deg, #22DC44, #1AC938)' }}>✅</div>
            <h3 className="text-xl font-bold mb-2" style={{ fontFamily:'Fraunces, serif' }}>¡Solicitud enviada!</h3>
            <p className="text-sm mb-3" style={{ color:'var(--muted-foreground)' }}>
              <strong>{worker.name}</strong> te contactará al <strong>{form.phone}</strong> en menos de 30 min.
            </p>
            <p className="text-xs mt-2 mb-6 px-4 py-2 rounded-xl" style={{ color:'var(--muted-foreground)', backgroundColor:'var(--secondary)', fontFamily:'DM Mono, monospace' }}>
              🔒 Tu pago queda en custodia hasta confirmar el trabajo.
            </p>
            <button onClick={onClose} className="btn-primary px-8 py-3 rounded-xl font-bold text-sm">Listo</button>
          </div>
        ) : (
          <form onSubmit={submit} className="px-6 py-5 space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <label className="text-xs font-semibold mb-1.5 block" style={{ fontFamily:'DM Mono, monospace', color:'var(--muted-foreground)' }}>Nombre completo *</label>
                <input type="text" value={form.name} onChange={e=>setForm({...form,name:e.target.value})} placeholder="Ana Lucía Bolaños"
                  className="w-full px-4 py-2.5 text-sm rounded-xl border outline-none"
                  style={{ borderColor:errors.name?'#1AC938':'var(--border)', backgroundColor:'var(--background)' }}/>
                {errors.name && <p className="text-xs mt-1" style={{ color:'#1AC938' }}>{errors.name}</p>}
              </div>
              <div>
                <label className="text-xs font-semibold mb-1.5 block" style={{ fontFamily:'DM Mono, monospace', color:'var(--muted-foreground)' }}>Celular *</label>
                <input type="tel" value={form.phone} onChange={e=>setForm({...form,phone:e.target.value})} placeholder="311 555 7890"
                  className="w-full px-4 py-2.5 text-sm rounded-xl border outline-none"
                  style={{ borderColor:errors.phone?'#1AC938':'var(--border)', backgroundColor:'var(--background)' }}/>
                {errors.phone && <p className="text-xs mt-1" style={{ color:'#1AC938' }}>{errors.phone}</p>}
              </div>
              <div>
                <label className="text-xs font-semibold mb-1.5 block" style={{ fontFamily:'DM Mono, monospace', color:'var(--muted-foreground)' }}>Fecha *</label>
                <input type="date" value={form.date} onChange={e=>setForm({...form,date:e.target.value})} min={new Date().toISOString().split('T')[0]}
                  className="w-full px-4 py-2.5 text-sm rounded-xl border outline-none"
                  style={{ borderColor:errors.date?'#1AC938':'var(--border)', backgroundColor:'var(--background)' }}/>
                {errors.date && <p className="text-xs mt-1" style={{ color:'#1AC938' }}>{errors.date}</p>}
              </div>
              <div className="col-span-2">
                <label className="text-xs font-semibold mb-1.5 block" style={{ fontFamily:'DM Mono, monospace', color:'var(--muted-foreground)' }}>Describe el trabajo *</label>
                <textarea rows={3} value={form.desc} onChange={e=>setForm({...form,desc:e.target.value})} placeholder="Tengo una fuga en el baño principal, lleva 2 días goteando…"
                  className="w-full px-4 py-2.5 text-sm rounded-xl border outline-none resize-none"
                  style={{ borderColor:errors.desc?'#1AC938':'var(--border)', backgroundColor:'var(--background)' }}/>
                {errors.desc && <p className="text-xs mt-1" style={{ color:'#1AC938' }}>{errors.desc}</p>}
              </div>
            </div>
            <button type="submit" className="btn-primary w-full py-3 rounded-xl font-bold text-sm">Enviar solicitud →</button>
          </form>
        )}
      </div>
    </Modal>
  )
}

// ─── PROFILE MODAL ───────────────────────────────────────────────────────────

function ProfileModal({ worker, onClose, onContact }: { worker:Worker; onClose:()=>void; onContact:()=>void }) {
  const cat = CATEGORIES.find(c=>c.name===worker.category)
  return (
    <Modal onClose={onClose}>
      <div className="w-full max-w-lg rounded-3xl overflow-hidden shadow-2xl" style={{ backgroundColor:'var(--card)', maxHeight:'90vh', overflowY:'auto' }}>
        <div className="relative h-40 overflow-hidden"
          style={{ background: cat ? `linear-gradient(135deg, ${cat.accent}DD, ${cat.accent}88)` : '#0A1628' }}>
          <img src={worker.avatar} alt="" className="absolute inset-0 w-full h-full object-cover mix-blend-overlay opacity-40"/>
          <button onClick={onClose} className="absolute top-4 right-4 w-8 h-8 rounded-full flex items-center justify-center" style={{ backgroundColor:'rgba(0,0,0,0.3)' }}>
            <svg width="14" height="14" viewBox="0 0 14 14"><path d="M3 3l8 8M11 3L3 11" stroke="white" strokeWidth="1.5" strokeLinecap="round"/></svg>
          </button>
          <div className="absolute bottom-4 left-5 flex items-end gap-3">
            <div className="w-16 h-16 rounded-2xl overflow-hidden" style={{ boxShadow:'0 0 0 3px rgba(255,255,255,0.3)' }}>
              <img src={worker.avatar} alt={worker.name} className="w-full h-full object-cover"/>
            </div>
            <div>
              <div className="font-bold text-white text-lg flex items-center gap-2" style={{ fontFamily:'Fraunces, serif' }}>
                {worker.name} <CheckBadge size={15}/>
              </div>
              <div className="text-sm" style={{ color:'rgba(255,255,255,0.75)' }}>{worker.trade}</div>
            </div>
          </div>
        </div>
        <div className="px-6 py-5">
          <div className="grid grid-cols-4 gap-2 mb-5">
            {[
              { v:worker.rating.toFixed(1), s:`${worker.reviews} reseñas` },
              { v:worker.jobs, s:'trabajos' },
              { v:`${worker.years}`, s:'años exp.' },
              { v:'✓', s:'verificado' },
            ].map((s,i) => (
              <div key={i} className="rounded-2xl p-3 text-center" style={{ backgroundColor:'var(--secondary)' }}>
                <div className="font-bold text-sm">{s.v}</div>
                <div className="text-[10px] mt-0.5" style={{ color:'var(--muted-foreground)', fontFamily:'DM Mono, monospace' }}>{s.s}</div>
              </div>
            ))}
          </div>
          <div className="mb-4">
            <h3 className="text-xs font-semibold mb-1.5 uppercase tracking-widest" style={{ color:'var(--muted-foreground)', fontFamily:'DM Mono, monospace' }}>Sobre el técnico</h3>
            <p className="text-sm leading-relaxed">{worker.bio}</p>
          </div>
          <div className="mb-5">
            {[
              ['📅','Disponibilidad', worker.availability],
              ['💰','Tarifa estimada', `${fmt(worker.priceMin)} – ${fmt(worker.priceMax)}`],
              ['📍','Barrio', `${worker.neighborhood}, Pasto`],
              ['🔒','Estado', 'Verificado · Antecedentes aprobados'],
            ].map(([icon,label,val]) => (
              <div key={label as string} className="flex items-center justify-between text-sm py-2.5 border-b" style={{ borderColor:'var(--border)' }}>
                <span style={{ color:'var(--muted-foreground)' }}>{icon} {label}</span>
                <span className="font-medium text-right">{val}</span>
              </div>
            ))}
          </div>
          <div className="flex gap-3">
            <button onClick={onContact} className="btn-primary flex-1 py-3 rounded-2xl font-bold text-sm">Solicitar servicio</button>
            <a href={`tel:${worker.phone}`} className="flex items-center justify-center gap-2 px-4 py-3 rounded-2xl border font-semibold text-sm"
              style={{ borderColor:'var(--border)', color:'var(--foreground)' }}>
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path d="M3 3a1 1 0 011-1h1.5a1 1 0 011 .8l.5 2.5a1 1 0 01-.3 1L6 7a8 8 0 003.5 3.5l.7-1.2a1 1 0 011-.3l2.5.5a1 1 0 01.8 1V13a1 1 0 01-1 1C6.3 14 2 9.7 2 4a1 1 0 011-1z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"/>
              </svg>
              Llamar
            </a>
          </div>
        </div>
      </div>
    </Modal>
  )
}

// ─── AUTH MODAL ──────────────────────────────────────────────────────────────

function AuthModal({ mode, onClose }: { mode:'login'|'register'; onClose:()=>void }) {
  const [tab, setTab]   = useState<'login'|'register'>(mode)
  const [form, setForm] = useState({ name:'', email:'', password:'' })
  const [sent, setSent] = useState(false)
  return (
    <Modal onClose={onClose}>
      <div className="w-full max-w-sm rounded-3xl overflow-hidden shadow-2xl" style={{ backgroundColor:'var(--card)' }}>
        <div className="px-6 pt-6 pb-5 flex items-center gap-3" style={{ background:'linear-gradient(135deg, #0A1628, #0D1F3C)' }}>
          <img src={logo} alt="Resolve Pasto" className="h-10 rounded-xl"/>
          <div className="text-xs" style={{ color:'rgba(255,255,255,0.45)', fontFamily:'DM Mono, monospace' }}>Tu hogar en buenas manos</div>
        </div>
        <div className="flex border-b" style={{ borderColor:'var(--border)' }}>
          {(['login','register'] as const).map(t => (
            <button key={t} onClick={()=>{ setTab(t); setSent(false) }}
              className="flex-1 py-3.5 text-sm font-semibold transition-colors"
              style={{ color:tab===t?'var(--primary)':'var(--muted-foreground)', borderBottom:tab===t?'2px solid var(--primary)':'2px solid transparent' }}>
              {t==='login' ? 'Ingresar' : 'Registrarse'}
            </button>
          ))}
        </div>
        <div className="px-6 py-5">
          {sent ? (
            <div className="text-center py-4">
              <div className="text-4xl mb-3">🎉</div>
              <h3 className="font-bold text-lg mb-1" style={{ fontFamily:'Fraunces, serif' }}>
                {tab==='login' ? '¡Bienvenido!' : '¡Cuenta creada!'}
              </h3>
              <p className="text-sm mb-5" style={{ color:'var(--muted-foreground)' }}>
                {tab==='register' ? 'Revisa tu correo para confirmar.' : 'Has ingresado correctamente.'}
              </p>
              <button onClick={onClose} className="btn-primary px-6 py-2.5 rounded-xl font-semibold text-sm">Continuar</button>
            </div>
          ) : (
            <form onSubmit={e=>{ e.preventDefault(); setSent(true) }} className="space-y-3">
              {tab==='register' && (
                <div>
                  <label className="text-xs font-semibold mb-1 block" style={{ fontFamily:'DM Mono, monospace', color:'var(--muted-foreground)' }}>Nombre completo</label>
                  <input type="text" required placeholder="Tu nombre" value={form.name} onChange={e=>setForm({...form,name:e.target.value})}
                    className="w-full px-4 py-2.5 text-sm rounded-xl border outline-none" style={{ borderColor:'var(--border)', backgroundColor:'var(--background)' }}/>
                </div>
              )}
              <div>
                <label className="text-xs font-semibold mb-1 block" style={{ fontFamily:'DM Mono, monospace', color:'var(--muted-foreground)' }}>Correo electrónico</label>
                <input type="email" required placeholder="tu@correo.com" value={form.email} onChange={e=>setForm({...form,email:e.target.value})}
                  className="w-full px-4 py-2.5 text-sm rounded-xl border outline-none" style={{ borderColor:'var(--border)', backgroundColor:'var(--background)' }}/>
              </div>
              <div>
                <label className="text-xs font-semibold mb-1 block" style={{ fontFamily:'DM Mono, monospace', color:'var(--muted-foreground)' }}>Contraseña</label>
                <input type="password" required placeholder="••••••••" value={form.password} onChange={e=>setForm({...form,password:e.target.value})}
                  className="w-full px-4 py-2.5 text-sm rounded-xl border outline-none" style={{ borderColor:'var(--border)', backgroundColor:'var(--background)' }}/>
              </div>
              <button type="submit" className="btn-primary w-full py-3 rounded-xl font-bold text-sm mt-2">
                {tab==='login' ? 'Ingresar →' : 'Crear cuenta →'}
              </button>
            </form>
          )}
        </div>
      </div>
    </Modal>
  )
}

// ─── TECH REGISTER MODAL ─────────────────────────────────────────────────────

function TechModal({ onClose }: { onClose:()=>void }) {
  const [step, setStep] = useState(1)
  const [form, setForm] = useState({ name:'', phone:'', cedula:'', trade:'', neighborhood:'', years:'', bio:'' })
  const [errors, setErrors] = useState<Record<string,string>>({})

  function validateStep() {
    const e: Record<string,string> = {}
    if (step===1) {
      if (!form.name.trim()) e.name='Requerido'
      if (!form.phone.trim()) e.phone='Requerido'
      if (!form.cedula.trim()||form.cedula.replace(/\D/g,'').length<8) e.cedula='Cédula inválida'
    }
    if (step===2) {
      if (!form.trade) e.trade='Selecciona un oficio'
      if (!form.neighborhood) e.neighborhood='Selecciona un barrio'
      if (!form.years) e.years='Requerido'
    }
    return e
  }

  function next(e:React.FormEvent) {
    e.preventDefault()
    const errs = validateStep()
    if (Object.keys(errs).length) { setErrors(errs); return }
    setErrors({})
    setStep(s=>s+1)
  }

  return (
    <Modal onClose={onClose}>
      <div className="w-full max-w-md rounded-3xl overflow-hidden shadow-2xl" style={{ backgroundColor:'var(--card)', maxHeight:'90vh', overflowY:'auto' }}>
        <div className="px-6 pt-6 pb-5 relative" style={{ background:'linear-gradient(135deg, #0A1628 0%, #0D1F3C 100%)' }}>
          <button onClick={onClose} className="absolute top-4 right-4 w-7 h-7 rounded-full flex items-center justify-center" style={{ backgroundColor:'rgba(255,255,255,0.1)' }}>
            <svg width="12" height="12" viewBox="0 0 12 12"><path d="M2 2l8 8M10 2L2 10" stroke="white" strokeWidth="1.5" strokeLinecap="round"/></svg>
          </button>
          <img src={logo} alt="Resolve Pasto" className="h-9 rounded-xl mb-3"/>
          <div className="text-white font-bold text-lg" style={{ fontFamily:'Fraunces, serif' }}>Registra tu oficio</div>
          <p className="text-xs mb-4" style={{ color:'rgba(255,255,255,0.5)' }}>Gratis · Sin intermediarios · Verificación en 24h</p>
          <div className="flex gap-1.5">
            {[1,2,3].map(s=>(
              <div key={s} className="flex-1 h-1.5 rounded-full transition-all"
                style={{ backgroundColor: s<=step ? '#1AC938' : 'rgba(255,255,255,0.2)' }}/>
            ))}
          </div>
          <div className="text-xs mt-1.5" style={{ color:'rgba(255,255,255,0.4)', fontFamily:'DM Mono, monospace' }}>Paso {Math.min(step,3)} de 3</div>
        </div>
        <div className="px-6 py-5">
          {step===4 ? (
            <div className="text-center py-6">
              <div className="w-16 h-16 rounded-full mx-auto mb-4 flex items-center justify-center text-2xl" style={{ background:'linear-gradient(135deg, #22DC44, #1AC938)' }}>🎉</div>
              <h3 className="font-bold text-xl mb-2" style={{ fontFamily:'Fraunces, serif' }}>¡Solicitud enviada!</h3>
              <p className="text-sm mb-4" style={{ color:'var(--muted-foreground)' }}>
                Revisaremos tu cédula en las próximas <strong>24 horas</strong>. Te avisamos por WhatsApp al <strong>{form.phone}</strong>.
              </p>
              <div className="px-4 py-3 rounded-2xl text-xs mb-6" style={{ backgroundColor:'var(--secondary)', color:'var(--muted-foreground)', fontFamily:'DM Mono, monospace' }}>
                Registro gratuito · Comisión solo cuando trabajas
              </div>
              <button onClick={onClose} className="btn-primary px-8 py-3 rounded-xl font-bold text-sm">Entendido</button>
            </div>
          ) : step===1 ? (
            <form onSubmit={next} className="space-y-4">
              <h3 className="font-semibold">Datos personales</h3>
              {[
                { key:'name', label:'Nombre completo', type:'text', ph:'Carlos Muñoz Rueda' },
                { key:'phone', label:'Celular (WhatsApp)', type:'tel', ph:'310 555 1234' },
                { key:'cedula', label:'Número de cédula', type:'text', ph:'12345678' },
              ].map(f=>(
                <div key={f.key}>
                  <label className="text-xs font-semibold mb-1 block" style={{ fontFamily:'DM Mono, monospace', color:'var(--muted-foreground)' }}>{f.label} *</label>
                  <input type={f.type} value={(form as any)[f.key]} onChange={e=>setForm({...form,[f.key]:e.target.value})} placeholder={f.ph}
                    className="w-full px-4 py-2.5 text-sm rounded-xl border outline-none"
                    style={{ borderColor:errors[f.key]?'#1AC938':'var(--border)', backgroundColor:'var(--background)' }}/>
                  {errors[f.key] && <p className="text-xs mt-1" style={{ color:'var(--primary)' }}>{errors[f.key]}</p>}
                </div>
              ))}
              <button type="submit" className="btn-primary w-full py-3 rounded-xl font-bold text-sm">Siguiente →</button>
            </form>
          ) : step===2 ? (
            <form onSubmit={next} className="space-y-4">
              <h3 className="font-semibold">Tu oficio</h3>
              <div>
                <label className="text-xs font-semibold mb-1 block" style={{ fontFamily:'DM Mono, monospace', color:'var(--muted-foreground)' }}>Categoría *</label>
                <select value={form.trade} onChange={e=>setForm({...form,trade:e.target.value})}
                  className="w-full px-4 py-2.5 text-sm rounded-xl border outline-none"
                  style={{ borderColor:errors.trade?'#1AC938':'var(--border)', backgroundColor:'var(--background)' }}>
                  <option value="">Selecciona una categoría</option>
                  {CATEGORIES.map(c=><option key={c.name} value={c.name}>{c.icon} {c.name}</option>)}
                </select>
                {errors.trade && <p className="text-xs mt-1" style={{ color:'var(--primary)' }}>{errors.trade}</p>}
              </div>
              <div>
                <label className="text-xs font-semibold mb-1 block" style={{ fontFamily:'DM Mono, monospace', color:'var(--muted-foreground)' }}>Barrio principal *</label>
                <select value={form.neighborhood} onChange={e=>setForm({...form,neighborhood:e.target.value})}
                  className="w-full px-4 py-2.5 text-sm rounded-xl border outline-none"
                  style={{ borderColor:'var(--border)', backgroundColor:'var(--background)' }}>
                  <option value="">Selecciona tu barrio</option>
                  {NEIGHBORHOODS.slice(1).map(n=><option key={n} value={n}>{n}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs font-semibold mb-1 block" style={{ fontFamily:'DM Mono, monospace', color:'var(--muted-foreground)' }}>Años de experiencia *</label>
                <input type="number" min="1" max="60" value={form.years} onChange={e=>setForm({...form,years:e.target.value})} placeholder="Ej: 8"
                  className="w-full px-4 py-2.5 text-sm rounded-xl border outline-none"
                  style={{ borderColor:errors.years?'#1AC938':'var(--border)', backgroundColor:'var(--background)' }}/>
              </div>
              <div className="flex gap-3">
                <button type="button" onClick={()=>setStep(1)} className="flex-1 py-3 rounded-xl font-semibold text-sm border" style={{ borderColor:'var(--border)' }}>← Atrás</button>
                <button type="submit" className="btn-primary flex-1 py-3 rounded-xl font-bold text-sm">Siguiente →</button>
              </div>
            </form>
          ) : (
            <form onSubmit={e=>{e.preventDefault();setStep(4)}} className="space-y-4">
              <h3 className="font-semibold">Un poco más sobre ti</h3>
              <textarea rows={3} value={form.bio} onChange={e=>setForm({...form,bio:e.target.value})} placeholder="Cuéntales a los clientes qué haces y qué te diferencia…"
                className="w-full px-4 py-2.5 text-sm rounded-xl border outline-none resize-none"
                style={{ borderColor:'var(--border)', backgroundColor:'var(--background)' }}/>
              <div className="flex items-start gap-2 px-3 py-3 rounded-xl text-xs" style={{ backgroundColor:'var(--secondary)', color:'var(--muted-foreground)' }}>
                <span>📋</span>
                <span>Al enviar autorizas la consulta de antecedentes en la Policía Nacional y validación de cédula. Sin costo. 24 horas.</span>
              </div>
              <div className="flex gap-3">
                <button type="button" onClick={()=>setStep(2)} className="flex-1 py-3 rounded-xl font-semibold text-sm border" style={{ borderColor:'var(--border)' }}>← Atrás</button>
                <button type="submit" className="btn-primary flex-1 py-3 rounded-xl font-bold text-sm">Enviar →</button>
              </div>
            </form>
          )}
        </div>
      </div>
    </Modal>
  )
}

// ─── WORKER CARD ─────────────────────────────────────────────────────────────

function WorkerCard({ worker, onContact, onView }: { worker:Worker; onContact:()=>void; onView:()=>void }) {
  const cat = CATEGORIES.find(c=>c.name===worker.category)
  const badgeStyle = worker.badge==='Top del Mes'
    ? { bg:'#DCFCE7', color:'#166534' }
    : worker.badge.includes('⭐')
    ? { bg:'#FEF9C3', color:'#854D0E' }
    : { bg:'var(--secondary)', color:'var(--muted-foreground)' }

  return (
    <div className="worker-card rounded-3xl overflow-hidden border" style={{ borderColor:'var(--border)', backgroundColor:'var(--card)' }}>
      <div className="relative h-24 overflow-hidden"
        style={{ background: cat ? `linear-gradient(135deg, ${cat.accent}CC, ${cat.accent}66)` : '#0A1628' }}>
        <div className="absolute inset-0 opacity-20">
          <img src={worker.avatar} alt="" className="w-full h-full object-cover"/>
        </div>
        <div className="absolute top-3 left-3 flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold"
          style={{ backgroundColor:'rgba(255,255,255,0.9)', color: cat?.accent ?? 'var(--foreground)' }}>
          {cat?.icon} {worker.category}
        </div>
        <span className="absolute top-3 right-3 text-[10px] px-2.5 py-0.5 rounded-full font-semibold"
          style={{ backgroundColor: badgeStyle.bg, color: badgeStyle.color, fontFamily:'DM Mono, monospace' }}>
          {worker.badge}
        </span>
        <div className="absolute -bottom-6 left-4 w-14 h-14 rounded-2xl overflow-hidden" style={{ boxShadow:'0 0 0 3px white' }}>
          <img src={worker.avatar} alt={worker.name} className="w-full h-full object-cover"/>
        </div>
      </div>
      <div className="px-4 pt-8 pb-4">
        <div className="flex items-start justify-between mb-1">
          <div>
            <button onClick={onView} className="font-bold text-sm leading-tight hover:underline text-left flex items-center gap-1.5">
              {worker.name} <CheckBadge size={13}/>
            </button>
            <div className="text-xs mt-0.5" style={{ color:'var(--muted-foreground)' }}>{worker.trade}</div>
            <div className="flex items-center gap-1 mt-1">
              <Stars rating={worker.rating} size={10}/>
              <span className="text-xs font-semibold">{worker.rating}</span>
              <span className="text-xs" style={{ color:'var(--muted-foreground)' }}>({worker.reviews})</span>
            </div>
          </div>
          <div className="text-right">
            <div className="text-xs" style={{ color:'var(--muted-foreground)', fontFamily:'DM Mono, monospace' }}>desde</div>
            <div className="font-bold text-sm" style={{ color:'var(--primary)' }}>{fmt(worker.priceMin)}</div>
          </div>
        </div>
        <div className="flex flex-wrap gap-1.5 my-3">
          {[`📍 ${worker.neighborhood}`, `${worker.jobs} trabajos`, `${worker.years} años exp.`].map(chip=>(
            <span key={chip} className="text-[10px] px-2 py-0.5 rounded-full" style={{ backgroundColor:'var(--secondary)', color:'var(--muted-foreground)', fontFamily:'DM Mono, monospace' }}>
              {chip}
            </span>
          ))}
        </div>
        <div className="flex gap-2 pt-2 border-t" style={{ borderColor:'var(--border)' }}>
          <button onClick={onView} className="flex-1 py-2 text-xs font-semibold rounded-xl border transition-colors hover:border-primary"
            style={{ borderColor:'var(--border)', color:'var(--foreground)' }}>
            Ver perfil
          </button>
          <button onClick={onContact} className="btn-primary flex-1 py-2 text-xs font-bold rounded-xl">
            Contactar
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── APP ─────────────────────────────────────────────────────────────────────

export default function App() {
  const [search, setSearch]                 = useState('')
  const [activeCategory, setActiveCategory] = useState<string|null>(null)
  const [neighborhood, setNeighborhood]     = useState('Todos los barrios')
  const [sortBy, setSortBy]                 = useState('rating')
  const [filterOpen, setFilterOpen]         = useState(false)
  const [priceRange, setPriceRange]         = useState<[number,number]>([0,150000])
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)

  const [contactWorker, setContactWorker] = useState<Worker|null>(null)
  const [profileWorker, setProfileWorker] = useState<Worker|null>(null)
  const [authModal, setAuthModal]         = useState<'login'|'register'|null>(null)
  const [techOpen, setTechOpen]           = useState(false)

  const filtered = useMemo(() => {
    let list = [...WORKERS]
    if (activeCategory) {
      const cat = CATEGORIES.find(c=>c.name===activeCategory)
      if (cat) list = list.filter(w=>cat.keywords.some(k=>w.trade.toLowerCase().includes(k))||w.category===activeCategory)
    }
    if (neighborhood!=='Todos los barrios') list = list.filter(w=>w.neighborhood===neighborhood)
    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter(w=>w.name.toLowerCase().includes(q)||w.trade.toLowerCase().includes(q)||w.neighborhood.toLowerCase().includes(q)||w.category.toLowerCase().includes(q))
    }
    list = list.filter(w=>w.priceMin<=priceRange[1]&&w.priceMax>=priceRange[0])
    list.sort((a,b)=>{
      if (sortBy==='rating')     return b.rating-a.rating
      if (sortBy==='jobs')       return b.jobs-a.jobs
      if (sortBy==='price_asc')  return a.priceMin-b.priceMin
      if (sortBy==='price_desc') return b.priceMax-a.priceMax
      if (sortBy==='years')      return b.years-a.years
      return 0
    })
    return list
  }, [search, activeCategory, neighborhood, sortBy, priceRange])

  const hasFilters = !!(activeCategory||neighborhood!=='Todos los barrios'||search||priceRange[1]<150000)

  function clearFilters() {
    setSearch(''); setActiveCategory(null); setNeighborhood('Todos los barrios')
    setSortBy('rating'); setPriceRange([0,150000])
  }

  return (
    <div className="min-h-screen" style={{ backgroundColor:'var(--background)', color:'var(--foreground)' }}>

      {/* ══ NAV ══════════════════════════════════════════════════════════════ */}
      <header className="sticky top-0 z-40 border-b backdrop-blur-md"
        style={{ backgroundColor:'rgba(244,250,245,0.93)', borderColor:'var(--border)' }}>
        <div className="max-w-6xl mx-auto px-5 flex items-center justify-between h-14">
          <button onClick={()=>{ clearFilters(); window.scrollTo({top:0,behavior:'smooth'}) }}>
            <img src={logo} alt="Resolve Pasto" className="h-9 rounded-xl"/>
          </button>
          <nav className="hidden md:flex items-center gap-6 text-sm font-medium" style={{ color:'var(--muted-foreground)' }}>
            <a href="#categorias" className="hover:text-foreground transition-colors">Servicios</a>
            <a href="#como-funciona" className="hover:text-foreground transition-colors">Cómo Funciona</a>
            <a href="#tecnicos" className="hover:text-foreground transition-colors">Técnicos</a>
            <button onClick={()=>setTechOpen(true)} className="hover:text-foreground transition-colors">Para Técnicos</button>
          </nav>
          <div className="hidden md:flex items-center gap-2">
            <button onClick={()=>setAuthModal('login')} className="text-sm font-semibold px-4 py-2 rounded-xl transition-colors hover:bg-secondary" style={{ color:'var(--foreground)' }}>
              Ingresar
            </button>
            <button onClick={()=>setAuthModal('register')} className="btn-primary text-sm font-bold px-4 py-2 rounded-xl">
              Registrarse
            </button>
          </div>
          <button className="md:hidden p-2" onClick={()=>setMobileMenuOpen(!mobileMenuOpen)}>
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
              {mobileMenuOpen
                ? <path d="M4 4l12 12M16 4L4 16" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                : <path d="M3 5h14M3 10h14M3 15h14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
              }
            </svg>
          </button>
        </div>
        {mobileMenuOpen && (
          <div className="md:hidden border-t px-5 py-4 flex flex-col gap-3 text-sm" style={{ borderColor:'var(--border)', backgroundColor:'var(--background)' }}>
            <a href="#categorias" onClick={()=>setMobileMenuOpen(false)}>Servicios</a>
            <a href="#como-funciona" onClick={()=>setMobileMenuOpen(false)}>Cómo Funciona</a>
            <a href="#tecnicos" onClick={()=>setMobileMenuOpen(false)}>Técnicos</a>
            <button className="text-left" onClick={()=>{ setTechOpen(true); setMobileMenuOpen(false) }}>Para Técnicos</button>
            <div className="flex gap-2 pt-2 border-t" style={{ borderColor:'var(--border)' }}>
              <button className="flex-1 py-2 rounded-xl text-sm font-semibold border" style={{ borderColor:'var(--border)' }} onClick={()=>{ setAuthModal('login'); setMobileMenuOpen(false) }}>Ingresar</button>
              <button className="btn-primary flex-1 py-2 rounded-xl text-sm font-bold" onClick={()=>{ setAuthModal('register'); setMobileMenuOpen(false) }}>Registrarse</button>
            </div>
          </div>
        )}
      </header>

      {/* ══ HERO ═════════════════════════════════════════════════════════════ */}
      <section className="hero-gradient relative overflow-hidden">
        <div className="absolute top-0 right-0 w-96 h-96 rounded-full pointer-events-none"
          style={{ background:'radial-gradient(circle, rgba(26,201,56,0.12), transparent 70%)', transform:'translate(20%,-20%)' }}/>
        <div className="absolute bottom-0 left-0 w-72 h-72 rounded-full pointer-events-none"
          style={{ background:'radial-gradient(circle, rgba(26,201,56,0.07), transparent 70%)', transform:'translate(-20%,20%)' }}/>

        <div className="max-w-6xl mx-auto px-5 pt-14 pb-12 grid md:grid-cols-2 gap-10 items-center relative z-10">
          <div>
            <img src={logo} alt="Resolve Pasto" className="h-16 rounded-2xl mb-6"/>
            <div className="inline-flex items-center gap-2 text-xs font-semibold px-3 py-1.5 rounded-full mb-5"
              style={{ backgroundColor:'rgba(26,201,56,0.15)', color:'#1AC938', border:'1px solid rgba(26,201,56,0.3)', fontFamily:'DM Mono, monospace' }}>
              <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse"/>
              412 técnicos activos ahora mismo
            </div>
            <h1 className="text-5xl md:text-6xl leading-[1.05] font-extrabold mb-5 text-white" style={{ fontFamily:'Fraunces, serif' }}>
              Tu hogar en<br/>
              <em className="not-italic" style={{ color:'#1AC938' }}>buenas manos.</em>
            </h1>
            <p className="text-base leading-relaxed mb-8 max-w-md" style={{ color:'rgba(255,255,255,0.55)' }}>
              Plomeros, electricistas, carpinteros y más en Pasto. Identidad verificada, antecedentes revisados, precios honestos.
            </p>
            <div className="flex items-center rounded-2xl overflow-hidden mb-5 shadow-xl" style={{ backgroundColor:'white' }}>
              <svg className="ml-4 flex-shrink-0" width="16" height="16" viewBox="0 0 16 16" fill="none">
                <circle cx="7" cy="7" r="5" stroke="#4A6E52" strokeWidth="1.4"/>
                <path d="M11 11l3 3" stroke="#4A6E52" strokeWidth="1.4" strokeLinecap="round"/>
              </svg>
              <input type="text" placeholder="Busca: plomero, pintura, jardín…"
                value={search} onChange={e=>setSearch(e.target.value)}
                className="flex-1 px-3 py-3.5 text-sm outline-none" style={{ color:'var(--foreground)' }}/>
              {search && <button onClick={()=>setSearch('')} className="px-3 text-sm" style={{ color:'#4A6E52' }}>✕</button>}
              <a href="#tecnicos" className="btn-primary px-5 py-3.5 text-sm font-bold whitespace-nowrap m-1 rounded-xl">Buscar</a>
            </div>
            <div className="flex flex-wrap gap-2">
              {CATEGORIES.slice(0,5).map(c=>(
                <a href="#tecnicos" key={c.name} onClick={()=>setActiveCategory(c.name)}
                  className="text-xs px-3 py-1.5 rounded-full font-medium transition-all hover:scale-105"
                  style={{ backgroundColor:'rgba(26,201,56,0.12)', color:'rgba(255,255,255,0.75)', border:'1px solid rgba(26,201,56,0.25)' }}>
                  {c.icon} {c.name}
                </a>
              ))}
            </div>
          </div>

          <div className="relative hidden md:block h-[440px]">
            <div className="absolute top-0 right-0 w-52 h-64 rounded-3xl overflow-hidden" style={{ boxShadow:'0 25px 50px rgba(0,0,0,0.5)' }}>
              <img src="https://images.unsplash.com/photo-1621905251189-08b45d6a269e?w=400&h=500&fit=crop&auto=format" alt="Plomero" className="w-full h-full object-cover"/>
            </div>
            <div className="absolute bottom-0 left-0 w-48 h-56 rounded-3xl overflow-hidden" style={{ boxShadow:'0 25px 50px rgba(0,0,0,0.5)' }}>
              <img src="https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=400&h=450&fit=crop&auto=format" alt="Electricista" className="w-full h-full object-cover"/>
            </div>
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-44 h-52 rounded-3xl overflow-hidden z-10" style={{ boxShadow:'0 30px 60px rgba(0,0,0,0.6)' }}>
              <img src="https://images.unsplash.com/photo-1416879595882-3373a0480b5b?w=400&h=500&fit=crop&auto=format" alt="Jardinero" className="w-full h-full object-cover"/>
            </div>
            <div className="float-card absolute bottom-10 right-0 z-20 rounded-2xl px-4 py-3" style={{ backgroundColor:'white', boxShadow:'0 20px 40px rgba(10,22,40,0.25)' }}>
              <div className="text-xs font-medium mb-0.5" style={{ color:'#4A6E52', fontFamily:'DM Mono, monospace' }}>Completados hoy</div>
              <div className="text-3xl font-extrabold" style={{ fontFamily:'Fraunces, serif', color:'#0A1628' }}>34</div>
              <div className="flex items-center gap-1 text-xs font-semibold" style={{ color:'#1AC938' }}>
                <svg width="10" height="10" viewBox="0 0 10 10"><path d="M2 7l3-3 3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
                +12% esta semana
              </div>
            </div>
            <div className="float-card absolute top-8 left-2 z-20 rounded-2xl px-3 py-2.5" style={{ backgroundColor:'white', boxShadow:'0 16px 32px rgba(10,22,40,0.2)', animationDelay:'2s' }}>
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-full overflow-hidden">
                  <img src="https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=32&h=32&fit=crop&auto=format" alt=""/>
                </div>
                <div>
                  <div className="text-xs font-semibold">Carlos M.</div>
                  <Stars rating={5} size={9}/>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="border-t" style={{ borderColor:'rgba(26,201,56,0.15)' }}>
          <div className="max-w-6xl mx-auto px-5 py-4 grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              { n:'412',    label:'Técnicos activos',      icon:'👷' },
              { n:'2.300+', label:'Calificaciones',        icon:'⭐' },
              { n:'18',     label:'Barrios cubiertos',     icon:'📍' },
              { n:'4.8/5',  label:'Calificación promedio', icon:'🏆' },
            ].map(s=>(
              <div key={s.label} className="flex items-center gap-3">
                <span className="text-xl">{s.icon}</span>
                <div>
                  <div className="font-extrabold text-white text-lg leading-none" style={{ fontFamily:'Fraunces, serif' }}>{s.n}</div>
                  <div className="text-xs" style={{ color:'rgba(255,255,255,0.4)', fontFamily:'DM Mono, monospace' }}>{s.label}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ══ CATEGORIES ═══════════════════════════════════════════════════════ */}
      <section id="categorias" className="py-16 max-w-6xl mx-auto px-5">
        <div className="flex items-end justify-between mb-8">
          <div>
            <div className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1 rounded-full mb-3"
              style={{ backgroundColor:'var(--secondary)', color:'var(--primary)', fontFamily:'DM Mono, monospace' }}>
              ✦ SERVICIOS DISPONIBLES
            </div>
            <h2 className="text-4xl font-extrabold" style={{ fontFamily:'Fraunces, serif' }}>
              ¿Qué necesitas<br/>
              <em className="not-italic" style={{ color:'var(--primary)' }}>resolver hoy?</em>
            </h2>
          </div>
          <a href="#tecnicos" className="hidden md:block text-sm font-semibold underline underline-offset-2 transition-opacity hover:opacity-70" style={{ color:'var(--primary)' }}>
            Ver todos →
          </a>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {CATEGORIES.map(cat=>{
            const count    = WORKERS.filter(w=>w.category===cat.name).length
            const isActive = activeCategory===cat.name
            return (
              <a href="#tecnicos" key={cat.name} onClick={()=>setActiveCategory(isActive?null:cat.name)}
                className="cat-hover text-left rounded-2xl p-4 border block cursor-pointer"
                style={{
                  borderColor: isActive ? cat.accent : 'var(--border)',
                  backgroundColor: isActive ? cat.bg : 'var(--card)',
                  boxShadow: isActive ? `0 0 0 1px ${cat.accent}30, 0 8px 24px ${cat.accent}15` : undefined,
                }}>
                <div className="w-10 h-10 rounded-xl flex items-center justify-center text-xl mb-3" style={{ backgroundColor: cat.bg }}>
                  {cat.icon}
                </div>
                <div className="font-bold text-sm leading-tight">{cat.name}</div>
                <div className="text-xs mt-1 font-medium" style={{ color: isActive ? cat.accent : 'var(--muted-foreground)', fontFamily:'DM Mono, monospace' }}>
                  {count} técnico{count!==1?'s':''}
                </div>
              </a>
            )
          })}
        </div>
      </section>

      {/* ══ HOW IT WORKS ═════════════════════════════════════════════════════ */}
      <section id="como-funciona" className="py-20 relative overflow-hidden"
        style={{ background:'linear-gradient(135deg, #0A1628 0%, #0D1F3C 100%)' }}>
        <div className="absolute inset-0 opacity-5 pointer-events-none"
          style={{ backgroundImage:'radial-gradient(circle, #1AC938 1px, transparent 1px)', backgroundSize:'24px 24px' }}/>
        <div className="max-w-6xl mx-auto px-5 relative z-10">
          <div className="mb-12 text-center">
            <div className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1 rounded-full mb-3"
              style={{ backgroundColor:'rgba(26,201,56,0.15)', color:'#1AC938', fontFamily:'DM Mono, monospace', border:'1px solid rgba(26,201,56,0.25)' }}>
              ✦ PROCESO SIMPLE
            </div>
            <h2 className="text-4xl font-extrabold text-white" style={{ fontFamily:'Fraunces, serif' }}>Cómo funciona</h2>
            <p className="text-sm mt-2" style={{ color:'rgba(255,255,255,0.4)' }}>Simple, seguro, sin sorpresas.</p>
          </div>
          <div className="grid sm:grid-cols-2 md:grid-cols-4 gap-5">
            {[
              { num:'01', icon:'🔍', title:'Busca el oficio',   desc:'Filtra por categoría, barrio o precio. Tarifas reales antes de contactar.' },
              { num:'02', icon:'🪪', title:'Perfil verificado', desc:'Cédula confirmada, antecedentes revisados, referencias de vecinos reales.' },
              { num:'03', icon:'🔒', title:'Agenda seguro',     desc:'El pago queda en custodia hasta que confirmes que el trabajo quedó bien.' },
              { num:'04', icon:'⭐', title:'Califica y ayuda',  desc:'Tu reseña construye la reputación del barrio. Las falsas están bloqueadas.' },
            ].map(step=>(
              <div key={step.num} className="rounded-3xl p-5"
                style={{ backgroundColor:'rgba(255,255,255,0.04)', border:'1px solid rgba(26,201,56,0.12)' }}>
                <div className="text-4xl mb-4">{step.icon}</div>
                <div className="text-xs font-bold mb-2" style={{ color:'#1AC938', fontFamily:'DM Mono, monospace' }}>{step.num}</div>
                <h3 className="font-bold text-white mb-2">{step.title}</h3>
                <p className="text-sm leading-relaxed" style={{ color:'rgba(255,255,255,0.45)' }}>{step.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ══ WORKERS ══════════════════════════════════════════════════════════ */}
      <section id="tecnicos" className="py-16 max-w-6xl mx-auto px-5">
        <div className="flex items-end justify-between mb-6">
          <div>
            <div className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1 rounded-full mb-3"
              style={{ backgroundColor:'var(--secondary)', color:'var(--primary)', fontFamily:'DM Mono, monospace' }}>
              ✦ DIRECTORIO VERIFICADO
            </div>
            <h2 className="text-4xl font-extrabold" style={{ fontFamily:'Fraunces, serif' }}>
              Técnicos<em className="not-italic" style={{ color:'var(--primary)' }}> en tu barrio</em>
            </h2>
            <p className="text-sm mt-1" style={{ color:'var(--muted-foreground)' }}>
              <strong>{filtered.length}</strong> técnico{filtered.length!==1?'s':''} encontrado{filtered.length!==1?'s':''}
              {activeCategory ? ` en ${activeCategory}` : ''}
            </p>
          </div>
          <button onClick={()=>setFilterOpen(!filterOpen)}
            className="flex items-center gap-2 text-sm font-semibold px-4 py-2.5 rounded-xl border transition-all"
            style={{
              borderColor: hasFilters?'var(--primary)':'var(--border)',
              backgroundColor: hasFilters?'var(--secondary)':'transparent',
              color: hasFilters?'var(--primary)':'var(--foreground)',
            }}>
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M1 3h12M3 7h8M5 11h4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
            </svg>
            Filtros {hasFilters && <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ backgroundColor:'var(--primary)' }}/>}
          </button>
        </div>

        {filterOpen && (
          <div className="rounded-3xl border p-6 mb-6" style={{ borderColor:'var(--border)', backgroundColor:'var(--card)' }}>
            <div className="grid sm:grid-cols-3 gap-5 mb-5">
              <div>
                <label className="text-xs font-bold mb-2 block uppercase tracking-widest" style={{ fontFamily:'DM Mono, monospace', color:'var(--muted-foreground)' }}>Barrio</label>
                <select value={neighborhood} onChange={e=>setNeighborhood(e.target.value)}
                  className="w-full px-4 py-2.5 text-sm rounded-xl border outline-none"
                  style={{ borderColor:'var(--border)', backgroundColor:'var(--background)' }}>
                  {NEIGHBORHOODS.map(n=><option key={n} value={n}>{n}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs font-bold mb-2 block uppercase tracking-widest" style={{ fontFamily:'DM Mono, monospace', color:'var(--muted-foreground)' }}>Ordenar por</label>
                <select value={sortBy} onChange={e=>setSortBy(e.target.value)}
                  className="w-full px-4 py-2.5 text-sm rounded-xl border outline-none"
                  style={{ borderColor:'var(--border)', backgroundColor:'var(--background)' }}>
                  {SORT_OPTIONS.map(o=><option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs font-bold mb-2 block uppercase tracking-widest" style={{ fontFamily:'DM Mono, monospace', color:'var(--muted-foreground)' }}>
                  Tarifa máx: {fmt(priceRange[1])}
                </label>
                <input type="range" min={10000} max={150000} step={5000} value={priceRange[1]}
                  onChange={e=>setPriceRange([priceRange[0],Number(e.target.value)])}
                  className="w-full" style={{ accentColor:'var(--primary)' }}/>
                <div className="flex justify-between text-xs mt-1" style={{ color:'var(--muted-foreground)', fontFamily:'DM Mono, monospace' }}>
                  <span>$10k</span><span>$150k</span>
                </div>
              </div>
            </div>
            <div className="flex flex-wrap gap-2 pt-4 border-t" style={{ borderColor:'var(--border)' }}>
              {CATEGORIES.map(cat=>{
                const isActive = activeCategory===cat.name
                return (
                  <button key={cat.name} onClick={()=>setActiveCategory(isActive?null:cat.name)}
                    className="text-xs px-3 py-1.5 rounded-full border transition-all font-medium"
                    style={{ borderColor: isActive?cat.accent:'var(--border)', backgroundColor: isActive?cat.bg:'transparent', color: isActive?cat.accent:'var(--muted-foreground)' }}>
                    {cat.icon} {cat.name}
                  </button>
                )
              })}
            </div>
            {hasFilters && (
              <button onClick={clearFilters} className="mt-3 text-xs underline underline-offset-2" style={{ color:'var(--primary)' }}>
                Limpiar todos los filtros
              </button>
            )}
          </div>
        )}

        {hasFilters && !filterOpen && (
          <div className="flex flex-wrap gap-2 mb-5">
            {activeCategory && (
              <span className="flex items-center gap-1 text-xs px-3 py-1.5 rounded-full font-semibold border"
                style={{ borderColor:'var(--primary)', color:'var(--primary)', backgroundColor:'var(--secondary)' }}>
                {CATEGORIES.find(c=>c.name===activeCategory)?.icon} {activeCategory}
                <button onClick={()=>setActiveCategory(null)} className="ml-1">✕</button>
              </span>
            )}
            {neighborhood!=='Todos los barrios' && (
              <span className="flex items-center gap-1 text-xs px-3 py-1.5 rounded-full border" style={{ borderColor:'var(--border)', color:'var(--muted-foreground)' }}>
                📍 {neighborhood}
                <button onClick={()=>setNeighborhood('Todos los barrios')} className="ml-1">✕</button>
              </span>
            )}
            {search && (
              <span className="flex items-center gap-1 text-xs px-3 py-1.5 rounded-full border" style={{ borderColor:'var(--border)', color:'var(--muted-foreground)' }}>
                🔍 "{search}"
                <button onClick={()=>setSearch('')} className="ml-1">✕</button>
              </span>
            )}
            <button onClick={clearFilters} className="text-xs px-3 py-1.5 underline underline-offset-2" style={{ color:'var(--primary)' }}>Limpiar todo</button>
          </div>
        )}

        {filtered.length===0 ? (
          <div className="text-center py-24 rounded-3xl border" style={{ borderColor:'var(--border)' }}>
            <div className="text-6xl mb-4">🔍</div>
            <p className="font-extrabold text-xl mb-2" style={{ fontFamily:'Fraunces, serif' }}>Sin resultados</p>
            <p className="text-sm mb-6" style={{ color:'var(--muted-foreground)' }}>Ningún técnico coincide con esos filtros.</p>
            <button onClick={clearFilters} className="btn-primary px-6 py-3 rounded-xl font-bold text-sm">Limpiar filtros</button>
          </div>
        ) : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {filtered.map(w=>(
              <WorkerCard key={w.id} worker={w} onContact={()=>setContactWorker(w)} onView={()=>setProfileWorker(w)}/>
            ))}
          </div>
        )}
      </section>

      {/* ══ VERIFICATION ═════════════════════════════════════════════════════ */}
      <section className="py-20" style={{ backgroundColor:'var(--secondary)' }}>
        <div className="max-w-6xl mx-auto px-5 grid md:grid-cols-2 gap-14 items-center">
          <div>
            <div className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1 rounded-full mb-4"
              style={{ backgroundColor:'var(--muted)', color:'var(--muted-foreground)', fontFamily:'DM Mono, monospace' }}>
              ✦ SISTEMA DE CONFIANZA
            </div>
            <h2 className="text-4xl font-extrabold mb-4 leading-tight" style={{ fontFamily:'Fraunces, serif' }}>
              La verificación que<br/>
              <em className="not-italic" style={{ color:'var(--primary)' }}>el barrio merece</em>
            </h2>
            <p className="text-sm leading-relaxed mb-5" style={{ color:'var(--muted-foreground)' }}>
              Cada técnico pasa por validación de cédula, revisión de antecedentes en la Policía Nacional y referencias laborales antes de aparecer en el directorio.
            </p>
            <div className="space-y-1">
              {[
                ['🪪','Cédula de Ciudadanía confirmada'],
                ['📋','Antecedentes judiciales sin registro'],
                ['🤳','Foto y selfie validadas por IA'],
                ['👥','Mínimo 3 referencias verificadas'],
                ['⭐','Calificaciones no pueden ser anónimas'],
              ].map(([icon,label])=>(
                <div key={label as string} className="flex items-center gap-3 text-sm py-2.5 rounded-xl px-3 transition-colors hover:bg-muted">
                  <span className="text-xl">{icon}</span>
                  <span className="font-medium">{label}</span>
                  <div className="ml-auto w-5 h-5 rounded-full flex items-center justify-center" style={{ backgroundColor:'rgba(26,201,56,0.15)' }}>
                    <svg width="10" height="10" viewBox="0 0 10 10">
                      <path d="M2 5l2.5 2.5 4-4" stroke="#1AC938" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  </div>
                </div>
              ))}
            </div>
            <button onClick={()=>setTechOpen(true)} className="btn-primary mt-8 px-6 py-3 rounded-xl font-bold text-sm">
              Quiero verificar mi oficio →
            </button>
          </div>
          <div className="relative">
            <div className="rounded-3xl overflow-hidden shadow-2xl" style={{ aspectRatio:'4/3', backgroundColor:'var(--muted)' }}>
              <img src="https://images.unsplash.com/photo-1530099486328-e021101a494a?w=700&h=525&fit=crop&auto=format" alt="Técnico verificado" className="w-full h-full object-cover"/>
              <div className="absolute inset-0 rounded-3xl" style={{ background:'linear-gradient(to top, rgba(10,22,40,0.4), transparent)' }}/>
            </div>
            <div className="absolute -bottom-5 -left-5 rounded-2xl px-4 py-3 shadow-xl"
              style={{ backgroundColor:'var(--card)', border:'1px solid var(--border)' }}>
              <div className="flex items-center gap-2">
                <div className="w-9 h-9 rounded-full flex items-center justify-center text-white text-sm font-bold" style={{ background:'linear-gradient(135deg, #22DC44, #1AC938)' }}>✓</div>
                <div>
                  <div className="text-xs font-bold">Perfil 100% verificado</div>
                  <div className="text-[10px]" style={{ color:'var(--muted-foreground)', fontFamily:'DM Mono, monospace' }}>Revisado hace 2 días</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ══ TESTIMONIALS ═════════════════════════════════════════════════════ */}
      <section className="py-16 max-w-6xl mx-auto px-5">
        <div className="text-center mb-10">
          <div className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1 rounded-full mb-3"
            style={{ backgroundColor:'var(--secondary)', color:'var(--primary)', fontFamily:'DM Mono, monospace' }}>
            ✦ OPINIONES REALES
          </div>
          <h2 className="text-4xl font-extrabold" style={{ fontFamily:'Fraunces, serif' }}>
            Lo que dicen los<em className="not-italic" style={{ color:'var(--primary)' }}> vecinos</em>
          </h2>
        </div>
        <div className="grid sm:grid-cols-3 gap-5">
          {TESTIMONIALS.map((t,i)=>(
            <div key={t.author} className="rounded-3xl p-6 relative overflow-hidden"
              style={{ backgroundColor: i===1 ? '#0A1628' : 'var(--card)', border: i===1 ? 'none' : '1px solid var(--border)' }}>
              {i===1 && (
                <div className="absolute top-0 right-0 w-32 h-32 rounded-full pointer-events-none"
                  style={{ background:'radial-gradient(circle, rgba(26,201,56,0.15), transparent)', transform:'translate(20%,-20%)' }}/>
              )}
              <div className="flex gap-0.5 mb-4">
                {[1,2,3,4,5].map(s=>(
                  <svg key={s} width="14" height="14" viewBox="0 0 14 14" fill="#1AC938">
                    <path d="M7 1l1.4 4.2H13L9.5 7.9l1.4 4.2L7 9.5l-3.9 2.6 1.4-4.2L1 5.2h4.6L7 1z"/>
                  </svg>
                ))}
              </div>
              <p className="text-sm leading-relaxed mb-5" style={{ color: i===1?'rgba(255,255,255,0.75)':'var(--foreground)' }}>"{t.text}"</p>
              <div className="flex items-center gap-3 pt-4 border-t" style={{ borderColor: i===1?'rgba(255,255,255,0.08)':'var(--border)' }}>
                <div className="w-10 h-10 rounded-full overflow-hidden" style={{ backgroundColor:'var(--muted)' }}>
                  <img src={t.avatar} alt={t.author} className="w-full h-full object-cover"/>
                </div>
                <div>
                  <div className="text-xs font-bold" style={{ color: i===1?'white':'var(--foreground)' }}>{t.author}</div>
                  <div className="text-[10px]" style={{ color: i===1?'rgba(255,255,255,0.35)':'var(--muted-foreground)', fontFamily:'DM Mono, monospace' }}>{t.neighborhood}</div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ══ CTA ══════════════════════════════════════════════════════════════ */}
      <section className="py-5 px-5">
        <div className="max-w-6xl mx-auto rounded-3xl py-16 px-8 text-center relative overflow-hidden"
          style={{ background:'linear-gradient(135deg, #0A1628 0%, #0D1F3C 60%, #0F2644 100%)' }}>
          <div className="absolute top-0 right-0 w-72 h-72 rounded-full pointer-events-none"
            style={{ background:'radial-gradient(circle, rgba(26,201,56,0.15), transparent 70%)', transform:'translate(20%,-30%)' }}/>
          <div className="absolute bottom-0 left-0 w-48 h-48 rounded-full pointer-events-none"
            style={{ background:'radial-gradient(circle, rgba(26,201,56,0.08), transparent 70%)', transform:'translate(-20%,30%)' }}/>
          <div className="relative z-10">
            <img src={logo} alt="Resolve Pasto" className="h-12 rounded-2xl mx-auto mb-6"/>
            <div className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1 rounded-full mb-5"
              style={{ backgroundColor:'rgba(26,201,56,0.15)', color:'#1AC938', fontFamily:'DM Mono, monospace', border:'1px solid rgba(26,201,56,0.25)' }}>
              ✦ PARA TÉCNICOS
            </div>
            <h2 className="text-4xl md:text-5xl font-extrabold text-white mb-4" style={{ fontFamily:'Fraunces, serif' }}>
              ¿Eres técnico<br/>en Pasto?
            </h2>
            <p className="text-base max-w-md mx-auto mb-8 leading-relaxed" style={{ color:'rgba(255,255,255,0.55)' }}>
              Crea tu perfil verificado y llega a cientos de clientes en tu barrio. Sin intermediarios. Tú fijas tus precios.
            </p>
            <div className="flex flex-col sm:flex-row gap-3 justify-center">
              <button onClick={()=>setTechOpen(true)} className="btn-primary px-8 py-3.5 rounded-2xl font-bold text-sm">
                Registrar mi oficio gratis
              </button>
              <a href="#como-funciona" className="px-8 py-3.5 rounded-2xl font-bold text-sm border transition-all hover:border-green-400"
                style={{ borderColor:'rgba(26,201,56,0.3)', color:'white' }}>
                Ver cómo funciona →
              </a>
            </div>
            <p className="text-xs mt-5" style={{ color:'rgba(255,255,255,0.3)', fontFamily:'DM Mono, monospace' }}>
              Sin costo de registro · Verificación gratuita · Comisión solo cuando trabajas
            </p>
          </div>
        </div>
      </section>

      {/* ══ FOOTER ═══════════════════════════════════════════════════════════ */}
      <footer className="border-t py-12 mt-5" style={{ borderColor:'var(--border)' }}>
        <div className="max-w-6xl mx-auto px-5 grid sm:grid-cols-4 gap-8">
          <div className="sm:col-span-2">
            <img src={logo} alt="Resolve Pasto" className="h-10 rounded-xl mb-3"/>
            <p className="text-xs leading-relaxed max-w-xs mb-4" style={{ color:'var(--muted-foreground)' }}>
              Red de empleo técnico y servicios del hogar verificados en San Juan de Pasto, Nariño. Tu hogar en buenas manos.
            </p>
            <div className="flex gap-2">
              {['📘','📸','🐦'].map((icon,idx)=>(
                <div key={idx} className="w-8 h-8 rounded-lg flex items-center justify-center text-sm cursor-pointer hover:bg-secondary transition-colors" style={{ backgroundColor:'var(--muted)' }}>{icon}</div>
              ))}
            </div>
          </div>
          <div>
            <div className="text-xs font-bold mb-3 uppercase tracking-widest" style={{ color:'var(--muted-foreground)', fontFamily:'DM Mono, monospace' }}>Plataforma</div>
            <ul className="space-y-2 text-sm">
              {[
                { label:'Cómo funciona', href:'#como-funciona', action:undefined },
                { label:'Para técnicos', href:undefined, action:()=>setTechOpen(true) },
                { label:'Verificación',  href:'#',              action:undefined },
                { label:'Tarifas justas',href:'#',              action:undefined },
              ].map(l=>(
                <li key={l.label}>
                  {l.action
                    ? <button onClick={l.action} className="transition-colors hover:text-primary text-left" style={{ color:'var(--muted-foreground)' }}>{l.label}</button>
                    : <a href={l.href} className="transition-colors hover:text-primary" style={{ color:'var(--muted-foreground)' }}>{l.label}</a>
                  }
                </li>
              ))}
            </ul>
          </div>
          <div>
            <div className="text-xs font-bold mb-3 uppercase tracking-widest" style={{ color:'var(--muted-foreground)', fontFamily:'DM Mono, monospace' }}>Legal</div>
            <ul className="space-y-2 text-sm">
              {['Términos de uso','Privacidad','Política de datos','Contacto'].map(l=>(
                <li key={l}><a href="#" className="transition-colors hover:text-primary" style={{ color:'var(--muted-foreground)' }}>{l}</a></li>
              ))}
            </ul>
          </div>
        </div>
        <div className="max-w-6xl mx-auto px-5 mt-8 pt-6 border-t flex flex-col sm:flex-row items-center justify-between gap-2" style={{ borderColor:'var(--border)' }}>
          <p className="text-xs" style={{ color:'var(--muted-foreground)', fontFamily:'DM Mono, monospace' }}>
            © 2026 Resolve Pasto · Tu hogar en buenas manos 🌋
          </p>
          <p className="text-xs" style={{ color:'var(--muted-foreground)', fontFamily:'DM Mono, monospace' }}>
            412 técnicos verificados · 18 barrios cubiertos
          </p>
        </div>
      </footer>

      {/* ══ MODALS ═══════════════════════════════════════════════════════════ */}
      {contactWorker && <ContactModal worker={contactWorker} onClose={()=>setContactWorker(null)}/>}
      {profileWorker && <ProfileModal worker={profileWorker} onClose={()=>setProfileWorker(null)} onContact={()=>{ setContactWorker(profileWorker); setProfileWorker(null) }}/>}
      {authModal     && <AuthModal mode={authModal} onClose={()=>setAuthModal(null)}/>}
      {techOpen      && <TechModal onClose={()=>setTechOpen(false)}/>}
    </div>
  )
}
