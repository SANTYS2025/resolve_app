/**
 * Pantallas legales y eliminación de cuenta.
 *
 * Los textos viven en `src/content/legal.ts` y están marcados como BORRADOR:
 * requieren revisión de un abogado antes de publicar en Google Play.
 */

import { useState } from 'react'
import type { ReactNode } from 'react'
import { AVISO_BORRADOR, DOCUMENTOS_LEGALES, documentoLegal } from '../content/legal'
import type { DocumentoLegalId } from '../content/legal'
import { eliminarMiCuenta } from '../lib/cuenta'
import { errMsg } from '../lib/api'
import { IconoMaterial } from '../components/IconoMaterial'

const N = '#000032', G = '#2EDF2D', GD = '#14802A', GL = '#DDFBDD', BG = '#F4F8F4', MU = '#566A5B', BD = '#D3E2D4', W = '#ffffff'

function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-3xl ${className}`} style={{ backgroundColor: W, border: `1px solid ${BD}`, boxShadow: '0 2px 10px rgba(0,0,50,0.05)' }}>{children}</div>
}

function VolverBtn({ onClick }: { onClick: () => void }) {
  return (
    <button onClick={onClick} className="flex items-center gap-1 min-h-[44px] -ml-2 pl-1 pr-3 text-sm font-semibold" style={{ color: 'rgba(255,255,255,0.78)' }}>
      <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true"><path d="M12 4l-6 6 6 6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
      Volver
    </button>
  )
}

export function LegalScreen({ onVolver }: { onVolver: () => void }) {
  const [activo, setActivo] = useState<DocumentoLegalId>('terminos')
  const doc = documentoLegal(activo)

  return (
    <div className="flex flex-col h-full" style={{ backgroundColor: BG }}>
      <header className="flex-shrink-0 px-4 pb-4" style={{ background: `linear-gradient(135deg, ${N}, #0A0A55)`, paddingTop: 'max(12px, env(safe-area-inset-top))' }}>
        <VolverBtn onClick={onVolver} />
        <h2 className="text-xl font-extrabold text-white leading-tight">Términos y privacidad</h2>
        <p className="text-xs mt-1" style={{ color: 'rgba(255,255,255,0.65)' }}>Versión {doc.version} · actualizada el {doc.actualizado}</p>
      </header>

      <div className="flex-1 overflow-y-auto px-4 pt-4 pb-safe space-y-4" style={{ scrollbarWidth: 'none' }}>
        <div className="rounded-2xl px-3.5 py-3 text-xs font-semibold leading-relaxed"
          style={{ backgroundColor: '#FEF3C7', color: '#92400E', border: '1px solid #FDE68A' }}>
          {AVISO_BORRADOR}
        </div>

        <div className="flex rounded-2xl p-1" style={{ backgroundColor: W, border: `1px solid ${BD}` }} role="tablist" aria-label="Documentos legales">
          {DOCUMENTOS_LEGALES.map(d => (
            <button key={d.id} role="tab" aria-selected={activo === d.id} onClick={() => setActivo(d.id)}
              className="flex-1 min-h-[44px] px-2 text-[12px] font-extrabold rounded-xl leading-tight"
              style={{ backgroundColor: activo === d.id ? N : 'transparent', color: activo === d.id ? W : MU }}>
              {d.id === 'terminos' ? 'Términos' : d.id === 'privacidad' ? 'Privacidad' : 'Mis datos'}
            </button>
          ))}
        </div>

        <Card className="p-4">
          <h3 className="text-lg font-extrabold leading-snug" style={{ color: N }}>{doc.titulo}</h3>
          <p className="text-sm mt-1 leading-relaxed" style={{ color: MU }}>{doc.resumen}</p>
          <div className="mt-4 space-y-4">
            {doc.secciones.map(s => (
              <section key={s.titulo}>
                <h4 className="text-sm font-extrabold" style={{ color: GD }}>{s.titulo}</h4>
                <div className="mt-1 space-y-2">
                  {s.parrafos.map((p, i) => (
                    <p key={`${s.titulo}-${i}`} className="text-sm leading-relaxed" style={{ color: N }}>{p}</p>
                  ))}
                </div>
              </section>
            ))}
          </div>
        </Card>

        <p className="text-xs text-center leading-relaxed pb-2" style={{ color: MU }}>
          Dudas sobre estos documentos: <strong style={{ color: N }}>privacidad@resolvepasto.com</strong>
        </p>
      </div>
    </div>
  )
}

/**
 * Zona peligrosa del perfil: elimina la cuenta tras una confirmación escrita.
 * El servidor bloquea la operación si hay un servicio activo.
 */
export function EliminarCuentaBox({ onDeleted }: { onDeleted: () => void }) {
  const [abierto, setAbierto] = useState(false)
  const [texto, setTexto] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const confirmar = async () => {
    if (texto.trim().toUpperCase() !== 'ELIMINAR') return
    setError('')
    setBusy(true)
    try {
      await eliminarMiCuenta()
      onDeleted()
    } catch (e) {
      console.error(e)
      setError(errMsg(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card className="p-4">
      <div className="flex items-start gap-3">
        <span className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0" style={{ backgroundColor: '#FEF2F2', color: '#B91C1C' }}>
          <IconoMaterial name="warning" size={19} />
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-extrabold" style={{ color: N }}>Eliminar mi cuenta</p>
          <p className="text-xs mt-1 leading-relaxed" style={{ color: MU }}>
            Borra tus datos personales, tus archivos y tu acceso. Los registros de servicios y pagos se conservan anonimizados por obligación legal. No se puede deshacer.
          </p>
        </div>
      </div>

      {!abierto ? (
        <button onClick={() => { setAbierto(true); setError('') }} disabled={busy}
          className="mt-3 w-full min-h-[44px] rounded-2xl text-sm font-bold border"
          style={{ borderColor: '#FECACA', color: '#B91C1C', backgroundColor: W }}>
          Quiero eliminar mi cuenta
        </button>
      ) : (
        <div className="mt-3 space-y-2.5">
          <div className="rounded-xl px-3 py-2.5 text-xs leading-relaxed font-semibold" style={{ backgroundColor: '#FEF2F2', color: '#991B1B' }}>
            Si tienes un servicio pendiente, acéptalo, termínalo o cancélalo antes de eliminar la cuenta.
          </div>
          <label className="block">
            <span className="text-[11px] font-bold uppercase tracking-wide" style={{ color: MU }}>
              Escribe ELIMINAR para confirmar
            </span>
            <input value={texto} onChange={e => setTexto(e.target.value)} autoCapitalize="characters" maxLength={10}
              placeholder="ELIMINAR" className="mt-1 w-full px-4 min-h-[48px] py-3 text-base rounded-2xl border outline-none focus:ring-2 focus:ring-[#F87171]"
              style={{ borderColor: '#FECACA', backgroundColor: W, color: N }} />
          </label>
          {error && <p role="alert" className="text-xs font-semibold" style={{ color: '#B91C1C' }}>{error}</p>}
          <div className="flex gap-2">
            <button onClick={() => { setAbierto(false); setTexto(''); setError('') }} disabled={busy}
              className="flex-1 min-h-[48px] rounded-2xl text-sm font-extrabold border" style={{ borderColor: BD, color: N, backgroundColor: W }}>
              Cancelar
            </button>
            <button onClick={confirmar} disabled={busy || texto.trim().toUpperCase() !== 'ELIMINAR'}
              className="flex-1 min-h-[48px] rounded-2xl text-sm font-extrabold"
              style={{ backgroundColor: '#DC2626', color: W, opacity: busy || texto.trim().toUpperCase() !== 'ELIMINAR' ? 0.5 : 1 }}>
              {busy ? 'Eliminando…' : 'Eliminar'}
            </button>
          </div>
        </div>
      )}
    </Card>
  )
}

/** Checkbox obligatorio del registro. Se exporta para mantener el copy en un solo lugar. */
export function AceptoLegal({ acepto, onCambio, onAbrirLegal }: {
  acepto: boolean
  onCambio: (v: boolean) => void
  onAbrirLegal: () => void
}) {
  return (
    <div className="flex items-start gap-3 rounded-2xl px-3.5 py-3" style={{ backgroundColor: GL, border: `1px solid ${G}55` }}>
      <input id="acepto-legal" type="checkbox" checked={acepto} onChange={e => onCambio(e.target.checked)}
        className="mt-0.5 w-5 h-5 flex-shrink-0 accent-[#2EDF2D]" />
      <label htmlFor="acepto-legal" className="text-xs leading-relaxed" style={{ color: N }}>
        Acepto los{' '}
        <button type="button" onClick={onAbrirLegal} className="font-extrabold underline" style={{ color: GD }}>
          términos y condiciones
        </button>{' '}
        y la{' '}
        <button type="button" onClick={onAbrirLegal} className="font-extrabold underline" style={{ color: GD }}>
          política de privacidad
        </button>
        , y autorizo el tratamiento de mis datos personales conforme a la Ley 1581 de 2012.
      </label>
    </div>
  )
}
