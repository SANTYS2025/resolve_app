/**
 * Núcleo de pagos de Resolve Pasto (lógica pura, sin React ni Supabase).
 *
 * Todo el dinero se maneja en CENTAVOS para evitar errores de coma flotante.
 * En esta etapa los pagos reales están diferidos: el registro es interno y el
 * técnico confirma efectivo/transferencia. Las firmas de Wompi se conservan
 * como adaptador futuro y se pueden probar sin red ni credenciales.
 *
 * Decisiones documentadas:
 *  · Comisión por defecto: 10 % (1000 puntos básicos), configurable en la tabla
 *    `comisiones_config`. Se redondea al centavo más cercano (mitad hacia arriba).
 *  · La comisión se calcula sobre el monto bruto aprobado, antes de la comisión
 *    de la pasarela. La comisión de Wompi es un costo aparte y no se descuenta
 *    del neto del técnico en este cálculo.
 *  · Una transacción aprobada es la única que marca la solicitud como pagada.
 *  · Reembolso total → estado `reembolsada`; parcial → `reembolso_parcial`.
 *    La comisión se reversa en la misma proporción del reembolso.
 */

export const MONEDA = 'COP' as const

export const ESTADOS_TRANSACCION = [
  'pendiente',
  'aprobada',
  'declinada',
  'error',
  'anulada',
  'reembolsada',
  'reembolso_parcial',
] as const

export type EstadoTransaccion = (typeof ESTADOS_TRANSACCION)[number]

export const PROVEEDORES_PAGO = ['interno', 'wompi', 'epayco', 'efectivo', 'transferencia'] as const
export type ProveedorPago = (typeof PROVEEDORES_PAGO)[number]

/** Métodos habilitados que se confirman sin proveedor real (pago manual). */
export const METODOS_PAGO_INTERNO = ['nequi', 'bancolombia', 'daviplata', 'efectivo'] as const
export type MetodoPagoInterno = (typeof METODOS_PAGO_INTERNO)[number]

export function esMetodoPagoInterno(metodo: string | null | undefined): metodo is MetodoPagoInterno {
  return (METODOS_PAGO_INTERNO as readonly string[]).includes(String(metodo ?? ''))
}

/** Estados que ya no admiten un nuevo cobro. */
export const ESTADOS_TRANSACCION_FINALES: EstadoTransaccion[] = [
  'aprobada', 'declinada', 'error', 'anulada', 'reembolsada', 'reembolso_parcial',
]

/** Estados de Wompi que nos interesan. Se normalizan a un vocabulario propio. */
export function normalizarEstadoWompi(estado: string | null | undefined): EstadoTransaccion {
  const s = String(estado ?? '').trim().toUpperCase()
  if (s === 'APPROVED') return 'aprobada'
  if (s === 'DECLINED' || s === 'FAILED') return 'declinada'
  if (s === 'VOIDED') return 'anulada'
  if (s === 'ERROR') return 'error'
  if (s === 'PENDING' || s === 'CREATED') return 'pendiente'
  return 'error'
}

/** Estado de `solicitudes.pago_estado` que corresponde a una transacción. */
export function estadoSolicitudDesdeTransaccion(estado: EstadoTransaccion): 'pagado' | 'pendiente_pasarela' | 'cancelado' {
  if (estado === 'aprobada') return 'pagado'
  if (estado === 'declinada' || estado === 'error' || estado === 'anulada') return 'pendiente_pasarela'
  if (estado === 'reembolsada' || estado === 'reembolso_parcial') return 'pagado'
  return 'pendiente_pasarela'
}

/** Convierte pesos COP a centavos. Acepta enteros y decimales con punto o coma,
 *  incluidos formatos con separador de miles ("100.000,50" o "100,000.50"). */
export function aCentavos(montoCop: number | string): number {
  let n: number
  if (typeof montoCop === 'number') {
    n = montoCop
  } else {
    let s = String(montoCop).replace(/\s/g, '')
    const tienePunto = s.includes('.')
    const tieneComa = s.includes(',')
    if (tienePunto && tieneComa) {
      s = s.lastIndexOf(',') > s.lastIndexOf('.')
        ? s.replace(/\./g, '').replace(',', '.')
        : s.replace(/,/g, '')
    } else if (tieneComa) {
      s = /,\d{1,2}$/.test(s) ? s.replace(',', '.') : s.replace(/,/g, '')
    } else if (tienePunto) {
      const partes = s.split('.')
      if (partes.length > 2) s = partes.join('')
    }
    n = Number(s)
  }
  if (!Number.isFinite(n) || n < 0) return 0
  return Math.round(n * 100)
}

/** Formatea centavos como pesos colombianos sin decimales. */
export function formatoCop(centavos: number): string {
  const pesos = Math.round(centavos / 100)
  return '$' + pesos.toLocaleString('es-CO')
}

/**
 * Calcula la comisión de Resolve y el neto del técnico.
 * `pctBps` está en puntos básicos: 1000 = 10 %.
 */
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

/** Comisión expresada como porcentaje legible (10 %, 8,5 %…). */
export function porcentajeLegible(pctBps: number): string {
  const pct = pctBps / 100
  return `${Number.isInteger(pct) ? pct : pct.toFixed(2).replace(/0+$/, '').replace(/\.$/, '')} %`
}

export type Reembolsable = {
  estado: EstadoTransaccion
  montoCentavos: number
  reembolsadoCentavos?: number
  comisionCentavos?: number
}

/** Valida si se puede reembolsar un monto y cuánto queda disponible. */
export function puedeReembolsar(t: Reembolsable, montoSolicitadoCentavos: number): {
  puede: boolean
  motivo: string
  disponibleCentavos: number
} {
  const disponible = Math.max(0, Math.round(t.montoCentavos) - Math.round(t.reembolsadoCentavos ?? 0))
  if (t.estado !== 'aprobada' && t.estado !== 'reembolso_parcial') {
    return { puede: false, motivo: 'Solo se puede reembolsar una transacción aprobada.', disponibleCentavos: disponible }
  }
  if (!Number.isFinite(montoSolicitadoCentavos) || montoSolicitadoCentavos <= 0) {
    return { puede: false, motivo: 'Indica un monto de reembolso mayor a cero.', disponibleCentavos: disponible }
  }
  if (montoSolicitadoCentavos > disponible) {
    return { puede: false, motivo: 'El monto supera el saldo disponible de la transacción.', disponibleCentavos: disponible }
  }
  return { puede: true, motivo: '', disponibleCentavos: disponible }
}

/**
 * Calcula cómo queda una transacción después de un reembolso.
 * La comisión se reversa proporcionalmente para que el historial sea trazable.
 */
export function aplicarReembolso(
  t: { montoCentavos: number; comisionCentavos: number; reembolsadoCentavos?: number },
  montoReembolsoCentavos: number,
): {
  estado: EstadoTransaccion
  reembolsadoCentavos: number
  comisionReversadaCentavos: number
  comisionNetaCentavos: number
} {
  const monto = Math.max(0, Math.round(t.montoCentavos))
  const ya = Math.max(0, Math.round(t.reembolsadoCentavos ?? 0))
  const reembolso = Math.max(0, Math.min(Math.round(montoReembolsoCentavos), monto - ya))
  const totalReembolsado = ya + reembolso
  const comisionTotal = Math.max(0, Math.round(t.comisionCentavos))
  // Comisión que corresponde al acumulado reembolsado (redondeo una sola vez).
  const comisionAcumulada = monto === 0 ? 0 : Math.round((comisionTotal * totalReembolsado) / monto)
  const comisionYaReversada = monto === 0 ? 0 : Math.round((comisionTotal * ya) / monto)
  return {
    estado: totalReembolsado >= monto ? 'reembolsada' : 'reembolso_parcial',
    reembolsadoCentavos: totalReembolsado,
    comisionReversadaCentavos: comisionAcumulada - comisionYaReversada,
    comisionNetaCentavos: comisionTotal - comisionAcumulada,
  }
}

/** Referencia determinista por solicitud: evita cobros duplicados al reintentar. */
export function construirReferencia(solicitudId: number, intento = 1): string {
  const id = Math.max(0, Math.trunc(solicitudId))
  const n = Math.max(1, Math.trunc(intento))
  return n === 1 ? `resolve-sol-${id}` : `resolve-sol-${id}-r${n}`
}

/** Referencia determinista para un pago interno (sin proveedor externo). */
export function construirReferenciaInterna(solicitudId: number): string {
  return `resolve-sol-${Math.max(0, Math.trunc(solicitudId))}-interno`
}

/** Extrae el id de solicitud de una referencia de Resolve (o null). */
export function solicitudDesdeReferencia(referencia: string): number | null {
  const m = /^resolve-sol-(\d+)(?:-r\d+|-interno)?$/.exec(referencia.trim())
  return m ? Number(m[1]) : null
}

/**
 * Calcula el monto, la comisión y el neto de un pago interno.
 * Repite exactamente la regla del servidor para poder probarla sin red.
 */
export function calcularPagoInterno(p: {
  precioFinal?: number | null
  precioEstimadoMax?: number | null
  precioEstimadoMin?: number | null
  descuentoCentavos?: number | null
  pctBps?: number
  minimoCentavos?: number
}): { montoCentavos: number; comisionCentavos: number; netoCentavos: number } {
  const base = p.precioFinal ?? p.precioEstimadoMax ?? p.precioEstimadoMin ?? 0
  const bruto = Math.max(0, Math.round(base * 100))
  const descuento = Math.min(bruto, Math.max(0, Math.round(p.descuentoCentavos ?? 0)))
  const montoCentavos = Math.max(0, bruto - descuento)
  const { comisionCentavos, netoCentavos } = calcularComision(
    montoCentavos,
    p.pctBps ?? 1000,
    p.minimoCentavos ?? 0,
  )
  return { montoCentavos, comisionCentavos, netoCentavos }
}

/** Cadena que Wompi firma en el Web Checkout (integridad). */
export function cadenaFirmaIntegridad(referencia: string, montoCentavos: number, moneda = MONEDA): string {
  return `${referencia}${Math.round(montoCentavos)}${moneda}`
}

/**
 * Cadena que Wompi firma en los eventos: los valores de `signature.properties`
 * en el orden indicado + timestamp + secreto de eventos.
 */
export function cadenaFirmaEvento(
  evento: Record<string, unknown>,
  properties: string[],
  timestamp: number | string,
): string {
  const valores = properties.map(p => {
    const partes = p.split('.')
    let actual: unknown = evento
    for (const parte of partes) {
      if (actual == null || typeof actual !== 'object') return ''
      actual = (actual as Record<string, unknown>)[parte]
    }
    return actual == null ? '' : String(actual)
  })
  return `${valores.join('')}${timestamp}`
}

/** SHA-256 en hexadecimal. Usa Web Crypto (disponible en navegador, Node 18+ y Deno). */
export async function sha256Hex(texto: string): Promise<string> {
  const bytes = new TextEncoder().encode(texto)
  const hash = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('')
}

/** Comparación en tiempo constante para firmas hex. */
export function igualdadSegura(a: string, b: string): boolean {
  const x = String(a).trim().toLowerCase()
  const y = String(b).trim().toLowerCase()
  if (x.length !== y.length) return false
  let diff = 0
  for (let i = 0; i < x.length; i++) diff |= x.charCodeAt(i) ^ y.charCodeAt(i)
  return diff === 0
}

/**
 * Verifica la firma de un evento de Wompi.
 * `evento` es el objeto completo `{ event, data, signature, timestamp, sent_at }`.
 */
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

/** Firma de integridad del checkout. El secreto de integridad NUNCA va al cliente. */
export async function firmarIntegridadCheckout(
  referencia: string,
  montoCentavos: number,
  secretoIntegridad: string,
  moneda = MONEDA,
): Promise<string> {
  return sha256Hex(`${cadenaFirmaIntegridad(referencia, montoCentavos, moneda)}${secretoIntegridad}`)
}

/** Etiqueta legible del estado de una transacción. */
export const ETIQUETA_TRANSACCION: Record<EstadoTransaccion, string> = {
  pendiente: 'Pendiente',
  aprobada: 'Aprobada',
  declinada: 'Rechazada',
  error: 'Error',
  anulada: 'Anulada',
  reembolsada: 'Reembolsada',
  reembolso_parcial: 'Reembolso parcial',
}

export function etiquetaTransaccion(estado: string | null | undefined): string {
  return ETIQUETA_TRANSACCION[estado as EstadoTransaccion] ?? 'Pendiente'
}
