/**
 * Cupones y descuentos (lógica pura).
 * El servidor vuelve a validar el cupón en la RPC `validar_cupon`; esto solo
 * decide qué mostrar y calcula el descuento antes de cobrar.
 */

export type TipoCupon = 'porcentaje' | 'monto'

export type Cupon = {
  codigo: string
  tipo: TipoCupon
  /** Porcentaje (1–100) o monto en pesos COP según el tipo. */
  valor: number
  montoMinimoCop?: number
  usosMax?: number | null
  usos?: number
  validoDesde?: string | null
  validoHasta?: string | null
  activo?: boolean
}

export type ResultadoCupon = {
  valido: boolean
  motivo: string
  descuentoCentavos: number
  totalCentavos: number
}

/** Normaliza el código: mayúsculas, sin espacios ni guiones de más. */
export function normalizarCodigoCupon(codigo: string): string {
  return String(codigo ?? '').trim().toUpperCase().replace(/\s+/g, '')
}

export function validarCupon(
  cupon: Cupon | null | undefined,
  montoCentavos: number,
  ahora: Date = new Date(),
): ResultadoCupon {
  const total = Math.max(0, Math.round(montoCentavos))
  const no = (motivo: string): ResultadoCupon => ({ valido: false, motivo, descuentoCentavos: 0, totalCentavos: total })
  if (!cupon) return no('Ese cupón no existe.')
  if (cupon.activo === false) return no('Este cupón ya no está activo.')
  const desde = cupon.validoDesde ? new Date(cupon.validoDesde).getTime() : -Infinity
  const hasta = cupon.validoHasta ? new Date(cupon.validoHasta).getTime() : Infinity
  const t = ahora.getTime()
  if (Number.isFinite(desde) && t < desde) return no('Este cupón todavía no está vigente.')
  if (Number.isFinite(hasta) && t > hasta) return no('Este cupón venció.')
  if (cupon.usosMax != null && (cupon.usos ?? 0) >= cupon.usosMax) return no('Este cupón ya alcanzó su límite de usos.')
  if (total <= 0) return no('El servicio no tiene un monto para aplicar el cupón.')
  if (cupon.montoMinimoCop != null && total < cupon.montoMinimoCop * 100) {
    return no(`El cupón aplica desde $${cupon.montoMinimoCop.toLocaleString('es-CO')}.`)
  }
  if (!Number.isFinite(cupon.valor) || cupon.valor <= 0) return no('El cupón no tiene un valor válido.')

  let descuento = cupon.tipo === 'porcentaje'
    ? Math.round(total * Math.min(100, cupon.valor) / 100)
    : Math.round(cupon.valor * 100)

  // Nunca dejar el total en negativo ni regalar más que el valor del servicio.
  descuento = Math.max(0, Math.min(total, descuento))
  if (descuento <= 0) return no('El cupón no genera descuento para este monto.')
  return {
    valido: true,
    motivo: '',
    descuentoCentavos: descuento,
    totalCentavos: total - descuento,
  }
}

/** Código legible para mostrar en la UI. */
export function etiquetaCupon(cupon: Cupon): string {
  return cupon.tipo === 'porcentaje'
    ? `${cupon.valor} % de descuento`
    : `$${cupon.valor.toLocaleString('es-CO')} de descuento`
}
