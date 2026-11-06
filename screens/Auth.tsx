import { useState } from 'react'
import logo from '../imports/image.png'
import { supabase } from '../lib/supabase'
import { ensurePerfil, errMsg, getTotalTecnicos, useData } from '../lib/api'
import type { Perfil } from '../lib/api'
import { N, G, GL, BG, MU, BD, W, PRIMARY, INPUT, INPUT_STYLE, Field, ErrorBox, PrimaryBtn } from '../ui'
import type { AuthTab, NavFn } from '../ui'

export function SplashScreen({ openAuth }: { openAuth: (t: AuthTab) => void }) {
  const total = useData(getTotalTecnicos, [], 0)
  return (
    <div className="relative flex flex-col items-center justify-center h-full px-6 overflow-hidden"
      style={{ background: `linear-gradient(160deg, ${N} 0%, #0e2840 100%)` }}>
      <div className="absolute w-72 h-72 rounded-full pointer-events-none"
        style={{ background: 'radial-gradient(circle, rgba(16,185,129,0.16), transparent)', top: '-80px', right: '-60px' }} />
      <div className="relative z-10 w-full flex flex-col items-center">
        <div className="w-24 h-24 rounded-3xl overflow-hidden mb-5" style={{ boxShadow: '0 12px 40px rgba(16,185,129,0.3)' }}>
          <img src={logo} alt="Resolve Pasto" className="w-full h-full object-cover" />
        </div>
        <h1 className="text-3xl font-extrabold text-white mb-1 text-center" style={{ fontFamily: 'Fraunces, serif' }}>Resolve Pasto</h1>
        <p className="text-sm text-center mb-2" style={{ color: 'rgba(255,255,255,0.48)' }}>Tu hogar en buenas manos</p>
        <div className="h-5 mb-8 text-xs flex items-center gap-1.5" style={{ color: G }}>
          {!total.loading && !total.error && total.data > 0 && (
            <><span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ backgroundColor: G }} />
              {total.data} {total.data === 1 ? 'técnico activo' : 'técnicos activos'} en Pasto</>
          )}
        </div>
        <div className="w-full space-y-3">
          <button onClick={() => openAuth('register')} className="w-full py-4 rounded-2xl font-extrabold text-sm"
            style={{ background: PRIMARY, color: N, boxShadow: '0 8px 28px rgba(16,185,129,0.4)' }}>Comenzar →</button>
          <button onClick={() => openAuth('login')} className="w-full py-3.5 rounded-2xl font-semibold text-sm border"
            style={{ borderColor: 'rgba(255,255,255,0.14)', color: 'rgba(255,255,255,0.7)' }}>Ya tengo cuenta · Ingresar</button>
        </div>
      </div>
    </div>
  )
}


export function AuthScreen({ initialTab, go, onAuth }: { initialTab: AuthTab; go: NavFn; onAuth: (p: Perfil) => Promise<void> }) {
  const [tab, setTab] = useState<AuthTab>(initialTab)
  const [role, setRole] = useState<'client' | 'worker' | null>(null)
  const [form, setForm] = useState({ name: '', email: '', password: '' })
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')
  const [notice, setNotice] = useState('')

  const handleAuth = async () => {
    setMessage(''); setNotice('')
    const email = form.email.trim().toLowerCase()
    const name = form.name.trim()
    if (!/^\S+@\S+\.\S+$/.test(email)) return setMessage('Ingresa un correo válido.')
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
      <div className="flex-shrink-0 px-5 pt-3 pb-5" style={{ background: `linear-gradient(160deg, ${N} 0%, #0e2840 100%)` }}>
        <button onClick={() => go('splash')} className="text-[10px] mb-3" style={{ color: 'rgba(255,255,255,0.5)' }}>← Volver</button>
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-xl overflow-hidden"><img src={logo} alt="" className="w-full h-full object-cover" /></div>
          <div>
            <div className="font-bold text-white text-sm">Resolve Pasto</div>
            <div className="text-[10px]" style={{ color: 'rgba(255,255,255,0.45)' }}>Tu hogar en buenas manos</div>
          </div>
        </div>
        <div className="flex rounded-2xl p-1" style={{ backgroundColor: 'rgba(255,255,255,0.07)' }}>
          {(['register', 'login'] as AuthTab[]).map(t => (
            <button key={t} onClick={() => { setTab(t); setMessage(''); setNotice('') }}
              className="flex-1 py-2.5 text-xs font-bold rounded-xl transition-all"
              style={{ backgroundColor: tab === t ? W : 'transparent', color: tab === t ? N : 'rgba(255,255,255,0.6)' }}>
              {t === 'login' ? 'Ingresar' : 'Registrarse'}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3" style={{ scrollbarWidth: 'none' }}>
        {tab === 'register' && (
          <Field label="Nombre completo">
            <input type="text" autoComplete="name" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })}
              placeholder="Nombre y apellido" className={INPUT} style={INPUT_STYLE} />
          </Field>
        )}
        <Field label="Correo electrónico">
          <input type="email" autoComplete="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })}
            placeholder="tu@correo.com" className={INPUT} style={INPUT_STYLE} />
        </Field>
        <Field label="Contraseña">
          <input type="password" autoComplete={tab === 'login' ? 'current-password' : 'new-password'} value={form.password}
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
                  <div className="text-xs font-extrabold leading-tight" style={{ color: N }}>{title}</div>
                  <div className="text-[10px] mt-0.5" style={{ color: MU }}>{sub}</div>
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

        <p className="text-center text-xs pt-1" style={{ color: MU }}>
          {tab === 'login' ? '¿No tienes cuenta?' : '¿Ya tienes cuenta?'}{' '}
          <button className="font-bold underline" style={{ color: G }}
            onClick={() => { setTab(tab === 'login' ? 'register' : 'login'); setMessage(''); setNotice('') }}>
            {tab === 'login' ? 'Registrarse' : 'Ingresar'}
          </button>
        </p>
      </div>
    </div>
  )
}

