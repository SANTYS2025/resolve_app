/**
 * Reglas de estado de una solicitud (lógica pura, sin React ni Supabase).
 *
 * El servidor sigue siendo la autoridad final (RPC + RLS). Estas funciones solo
 * deciden qué listas y botones mostrar, de modo que una solicitud terminada
 * NUNCA pueda aparecer como vigente en la vista del técnico.
 *
 * Estados del flujo nuevo:
 *   pendiente → aceptada (el técnico aceptó) → confirmada (el cliente confirmó)
 *   → en_camino (abrió Google Maps) → llego (llegó al domicilio)
 *   → completada (servicio terminado / "Terminada")
 *
 * Se conservan estados históricos (`en_proceso`, `rechazada`, `cancelada`,
 * `expirada`) para que las solicitudes viejas sigan leyéndose sin romper nada.
 */

export const ESTADOS_VIGENTES = [
  'pendiente', 'aceptada', 'confirmada', 'en_camino', 'en_proceso', 'llego',
] as const

/** Solicitudes que mantienen al técnico "Ocupado" (ya las aceptó). */
export const ESTADOS_ACTIVOS_TECNICO = [
  'aceptada', 'confirmada', 'en_camino', 'en_proceso', 'llego',
] as const

/** Solicitudes cerradas: van al historial y nunca a la lista de vigentes. */
export const ESTADOS_FINALIZADOS = [
  'completada', 'cancelada', 'rechazada', 'expirada',
] as const

const VIGENTES = new Set<string>(ESTADOS_VIGENTES)
const ACTIVOS_TECNICO = new Set<string>(ESTADOS_ACTIVOS_TECNICO)
const FINALIZADOS = new Set<string>(ESTADOS_FINALIZADOS)

/** La solicitud sigue en curso (no está cerrada). */
export function estaVigente(estado: string): boolean {
  return VIGENTES.has(estado)
}

/** La solicitud ya terminó (completada o cerrada por rechazo/cancelación/expiración). */
export function esFinalizada(estado: string): boolean {
  return FINALIZADOS.has(estado)
}

/** Alias explícito para la lista de "Historial de solicitudes finalizadas". */
export function enHistorial(estado: string): boolean {
  return esFinalizada(estado)
}

/**
 * Filtra para las dos listas del técnico.
 * Las dos son excluyentes: una solicitud finalizada jamás se devuelve como vigente,
 * y una vigente jamás se devuelve en el historial.
 */
export function filtrarSolicitudes<T extends { estado: string }>(
  pedidos: T[],
  modo: 'vigentes' | 'historial',
): T[] {
  return pedidos.filter(p => (modo === 'historial' ? enHistorial(p.estado) : estaVigente(p.estado)))
}

export type DisponibilidadTecnico<T> =
  | { estado: 'disponible'; solicitud: null }
  | { estado: 'ocupado'; solicitud: T }

/**
 * Disponibilidad derivada de la base de datos, sin una columna extra que pueda
 * quedar desactualizada: si no hay ninguna solicitud aceptada/en curso, el
 * técnico está Disponible; si hay una, está Ocupado en ESA solicitud.
 */
export function disponibilidadTecnico<T extends { estado: string }>(pedidos: T[]): DisponibilidadTecnico<T> {
  const solicitud = pedidos.find(p => ACTIVOS_TECNICO.has(p.estado)) ?? null
  return solicitud
    ? { estado: 'ocupado', solicitud }
    : { estado: 'disponible', solicitud: null }
}

/**
 * ¿Puede el técnico aceptar esta solicitud nueva?
 * Mientras esté ocupado con otra, la solicitud entrante se conserva en la base
 * de datos (no se rechaza ni se borra), pero no se deja aceptar para que no
 * interfiera con el trabajo actual.
 */
export function puedeAceptarSolicitud<T extends { id: number; estado: string }>(
  pedidos: T[],
  solicitudId: number,
): { puede: boolean; motivo: string } {
  const disp = disponibilidadTecnico(pedidos)
  if (disp.estado === 'ocupado' && disp.solicitud.id !== solicitudId) {
    return {
      puede: false,
      motivo: `Estás ocupado con la solicitud #${disp.solicitud.id}. Esta nueva queda registrada y podrás aceptarla cuando termines.`,
    }
  }
  return { puede: true, motivo: '' }
}

/** Qué acción le corresponde al técnico en cada estado (null = esperar al cliente). */
export function accionDelTecnico(estado: string): 'navegar' | 'llegar' | 'completar' | null {
  if (estado === 'confirmada') return 'navegar'
  if (estado === 'en_camino') return 'llegar'
  if (estado === 'llego') return 'completar'
  // Compatibilidad: solicitudes viejas que quedaron "en proceso" se pueden cerrar.
  if (estado === 'en_proceso') return 'completar'
  return null
}

/**
 * El técnico ya registró su llegada a la dirección.
 *
 * `llego` es el estado que escribe `marcar_llegada`; `completada` también lo
 * implica porque el flujo pasa por la llegada antes de cerrar.
 */
export function llegadaRegistrada(estado: string): boolean {
  return estado === 'llego' || estado === 'completada'
}

/**
 * Solo se puede cerrar ("Finalizar solicitud") después de registrar la llegada
 * y de que el técnico confirmó que recibió el pago.
 *
 * `pagoConfirmado` es el estado de la UI (respuesta "Sí" al diálogo), no un
 * campo de la base: el pago se registra justo antes de cerrar la solicitud.
 */
export function puedeFinalizarSolicitud(estado: string, pagoConfirmado: boolean): boolean {
  return pagoConfirmado && (estado === 'llego' || estado === 'en_proceso')
}

export type ProgresoCliente = {
  aceptado: boolean
  enCamino: boolean
  llego: boolean
}

/**
 * Progreso que ve el cliente después de confirmar al técnico:
 *   "Técnico aceptó tu solicitud" → "Técnico dirigiéndose a su domicilio" → "Técnico llegó".
 */
export function progresoCliente(estado: string): ProgresoCliente {
  return {
    aceptado: ['aceptada', 'confirmada', 'en_camino', 'en_proceso', 'llego', 'completada'].includes(estado),
    enCamino: ['en_camino', 'llego', 'completada'].includes(estado),
    llego: ['llego', 'completada'].includes(estado),
  }
}

/** El cliente debe confirmar al técnico antes de que la solicitud avance. */
export function esperaConfirmacionCliente(estado: string): boolean {
  return estado === 'aceptada'
}

/** Solicitudes en las que el cliente todavía puede cancelar sin técnico en camino. */
export function clientePuedeCancelar(estado: string): boolean {
  return estado === 'pendiente' || estado === 'aceptada'
}
