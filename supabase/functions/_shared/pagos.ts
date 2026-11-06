/**
 * Lógica pura compartida por las Edge Functions de pago.
 *
 * Es un espejo deliberado de `src/lib/pagosCore.ts` (misma regla de comisión,
 * normalización de estados y firma). Se mantiene aquí porque Supabase despliega
 * solo la carpeta `supabase/functions` y no puede importar archivos de `src/`.
 * Los tests de `tests/edgePagos.test.ts` comprueban que ambas copias coinciden.
 */

export const MONEDA = 'COP'

export type EstadoTransaccion =
  | 'pendiente' | 'aprobada' | 'declinada' | 'error' | 'anulada' | 'reembolsada' | 'reembolso_parcial'

export function normalizarEstadoWompi(estado: string | null | undefined): EstadoTransaccion {
  const s = String(estado ?? '').trim().toUpperCase()
  if (s === 'APPROVED') return 'aprobada'
  if (s === 'DECLINED' || s === 'FAILED') return 'declinada'
  if (s === 'VOIDED') return 'anulada'
  if (s === 'PENDING' || s === 'CREATED') return 'pendiente'
  return 'error'
}

export function calcularComision(
  montoCentavos: number,
  pctBps = 1000,
  minimoCentavos = 0,
): { comisionCentavos: number; netoCentavos: number; pctBps: number } {
  const monto = Math.max(0, Math.round(montoCentavos))
  const bps = Math.max(0, Math.min(10_000, Math.round(pctBps)))
  const cruda = Math.round((monto * bps) / 10_000)
  const comisionCentavos = Math.min(monto, Math.max(cruda, Math.max(0, Math.round(minimoCentavos))))
  return { comisionCentavos, netoCentavos: monto - comisionCentavos, pctBps: bps }
}

/** Referencia determinista; el sufijo `-rN` solo se usa al reintentar un cobro. */
export function construirReferencia(solicitudId: number, intento = 1): string {
  const id = Math.max(0, Math.trunc(solicitudId))
  const n = Math.max(1, Math.trunc(intento))
  return n === 1 ? `resolve-sol-${id}` : `resolve-sol-${id}-r${n}`
}

export function solicitudDesdeReferencia(referencia: string): number | null {
  const m = /^resolve-sol-(\d+)(?:-r\d+)?$/.exec(String(referencia).trim())
  return m ? Number(m[1]) : null
}

export function cadenaFirmaIntegridad(referencia: string, montoCentavos: number, moneda = MONEDA): string {
  return `${referencia}${Math.round(montoCentavos)}${moneda}`
}

export function cadenaFirmaEvento(
  evento: Record<string, unknown>,
  properties: string[],
  timestamp: number | string,
): string {
  const valores = properties.map(p => {
    let actual: unknown = evento
    for (const parte of p.split('.')) {
      if (actual == null || typeof actual !== 'object') return ''
      actual = (actual as Record<string, unknown>)[parte]
    }
    return actual == null ? '' : String(actual)
  })
  return `${valores.join('')}${timestamp}`
}

export async function sha256Hex(texto: string): Promise<string> {
  const bytes = new TextEncoder().encode(texto)
  const hash = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('')
}

export function igualdadSegura(a: string, b: string): boolean {
  const x = String(a).trim().toLowerCase()
  const y = String(b).trim().toLowerCase()
  if (x.length !== y.length) return false
  let diff = 0
  for (let i = 0; i < x.length; i++) diff |= x.charCodeAt(i) ^ y.charCodeAt(i)
  return diff === 0
}

export async function firmarIntegridadCheckout(
  referencia: string,
  montoCentavos: number,
  secretoIntegridad: string,
  moneda = MONEDA,
): Promise<string> {
  return sha256Hex(`${cadenaFirmaIntegridad(referencia, montoCentavos, moneda)}${secretoIntegridad}`)
}

export async function validarFirmaEventoWompi(
  evento: { data?: Record<string, unknown>; signature?: { properties?: string[]; checksum?: string }; timestamp?: number | string },
  secretoEventos: string,
): Promise<boolean> {
  const properties = evento.signature?.properties ?? []
  const checksum = evento.signature?.checksum ?? ''
  if (!secretoEventos || !checksum || properties.length === 0 || evento.timestamp == null) return false
  const cadena = cadenaFirmaEvento(evento.data ?? {}, properties, evento.timestamp)
  const esperado = await sha256Hex(`${cadena}${secretoEventos}`)
  return igualdadSegura(esperado, checksum)
}
