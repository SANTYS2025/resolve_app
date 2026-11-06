/**
 * Programa de referidos (lógica pura).
 * El código se genera en el servidor; aquí se normaliza y valida lo que escribe
 * el usuario y se calcula la recompensa informativa.
 */

export const PREFIJO_REFERIDO = 'RESOLVE'
export const RECOMPENSA_REFERIDO_COP = 10_000

/** Código limpio: mayúsculas, sin espacios ni caracteres raros. */
export function normalizarCodigoReferido(codigo: string): string {
  return String(codigo ?? '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 16)
}

export function validarCodigoReferido(codigo: string): string | null {
  const c = normalizarCodigoReferido(codigo)
  if (!c) return 'Escribe un código de referido.'
  if (c.length < 5) return 'El código debe tener al menos 5 caracteres.'
  if (c.length > 16) return 'El código no puede superar 16 caracteres.'
  if (!/^[A-Z0-9]+$/.test(c)) return 'El código solo puede tener letras y números.'
  return null
}

/**
 * Genera un código legible a partir del nombre y un sufijo estable.
 * El servidor usa esta misma forma; el sufijo evita colisiones.
 */
export function generarCodigoReferido(nombre: string, sufijo: string | number): string {
  const base = String(nombre ?? '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toUpperCase().replace(/[^A-Z]/g, '').slice(0, 6) || 'AMIGO'
  const cola = String(sufijo ?? '').replace(/[^A-Z0-9]/gi, '').toUpperCase().slice(-4) || '0000'
  return `${base}${cola}`.slice(0, 16)
}

export type Recompensa = {
  referidorCop: number
  referidoCop: number
  descripcion: string
}

/** Recompensa informativa. El abono real se registra en `referidos`. */
export function recompensaReferido(): Recompensa {
  return {
    referidorCop: RECOMPENSA_REFERIDO_COP,
    referidoCop: RECOMPENSA_REFERIDO_COP,
    descripcion: `Ganas $${RECOMPENSA_REFERIDO_COP.toLocaleString('es-CO')} cuando tu invitado completa su primer servicio pagado.`,
  }
}

export function enlaceReferido(codigo: string, origen = 'https://resolvepasto.co'): string {
  const c = normalizarCodigoReferido(codigo)
  return `${origen.replace(/\/$/, '')}/?ref=${encodeURIComponent(c)}`
}
