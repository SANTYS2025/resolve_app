/**
 * Estadísticas de ganancias del técnico (lógica pura).
 * Trabaja con transacciones ya normalizadas por `transacciones.ts`.
 */

export type TransaccionResumen = {
  estado: string
  montoCentavos: number
  comisionCentavos: number
  netoCentavos: number
  reembolsadoCentavos?: number
  creadoEn: string
}

export type ResumenGanancias = {
  brutoCentavos: number
  comisionCentavos: number
  netoCentavos: number
  reembolsosCentavos: number
  servicios: number
  ticketPromedioCentavos: number
  porMes: { mes: string; brutoCentavos: number; netoCentavos: number; servicios: number }[]
}

const MES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']

/** Solo las transacciones aprobadas (o parcialmente reembolsadas) generan ingresos. */
export function cuentaComoIngreso(t: Pick<TransaccionResumen, 'estado'>): boolean {
  return t.estado === 'aprobada' || t.estado === 'reembolso_parcial' || t.estado === 'reembolsada'
}

/**
 * Resume las ganancias. Un reembolso total deja el neto en 0 (la comisión
 * reversada también se descuenta) para que el historial no muestre dinero
 * que ya se devolvió.
 */
export function resumenGanancias(
  transacciones: TransaccionResumen[],
  desde?: string | Date,
  hasta?: string | Date,
): ResumenGanancias {
  const d = desde ? new Date(desde).getTime() : -Infinity
  const h = hasta ? new Date(hasta).getTime() : Infinity
  const filtradas = transacciones.filter(t => {
    if (!cuentaComoIngreso(t)) return false
    const ts = new Date(t.creadoEn).getTime()
    return Number.isFinite(ts) && ts >= d && ts <= h
  })

  let bruto = 0, comision = 0, neto = 0, reembolsos = 0
  const meses = new Map<string, { brutoCentavos: number; netoCentavos: number; servicios: number }>()

  for (const t of filtradas) {
    const reembolsado = Math.max(0, t.reembolsadoCentavos ?? 0)
    const factor = t.montoCentavos > 0 ? Math.max(0, 1 - reembolsado / t.montoCentavos) : 1
    const brutoNeto = Math.round(t.montoCentavos * factor)
    const comisionNeta = Math.round(t.comisionCentavos * factor)
    const netoTecnico = Math.max(0, brutoNeto - comisionNeta)
    bruto += brutoNeto
    comision += comisionNeta
    neto += netoTecnico
    reembolsos += reembolsado

    const fecha = new Date(t.creadoEn)
    const clave = `${fecha.getFullYear()}-${String(fecha.getMonth() + 1).padStart(2, '0')}`
    const actual = meses.get(clave) ?? { brutoCentavos: 0, netoCentavos: 0, servicios: 0 }
    actual.brutoCentavos += brutoNeto
    actual.netoCentavos += netoTecnico
    actual.servicios += 1
    meses.set(clave, actual)
  }

  const porMes = [...meses.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([clave, v]) => {
      const [anio, mes] = clave.split('-').map(Number)
      return { mes: `${MES[mes - 1]} ${anio}`, ...v }
    })

  return {
    brutoCentavos: bruto,
    comisionCentavos: comision,
    netoCentavos: neto,
    reembolsosCentavos: reembolsos,
    servicios: filtradas.length,
    ticketPromedioCentavos: filtradas.length ? Math.round(bruto / filtradas.length) : 0,
    porMes,
  }
}

/** Gastos del cliente: lo que efectivamente pagó, descontando reembolsos. */
export function resumenGastos(transacciones: TransaccionResumen[]): {
  totalCentavos: number
  servicios: number
  reembolsosCentavos: number
} {
  let total = 0, reembolsos = 0, servicios = 0
  for (const t of transacciones) {
    if (t.estado !== 'aprobada' && t.estado !== 'reembolso_parcial' && t.estado !== 'reembolsada') continue
    servicios += 1
    reembolsos += Math.max(0, t.reembolsadoCentavos ?? 0)
    total += Math.max(0, t.montoCentavos - Math.max(0, t.reembolsadoCentavos ?? 0))
  }
  return { totalCentavos: total, servicios, reembolsosCentavos: reembolsos }
}
