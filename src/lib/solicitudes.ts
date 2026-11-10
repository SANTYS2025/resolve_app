/**
 * Reglas de estado de una solicitud (lógica pura, sin React ni Supabase).
 *
 * El servidor sigue siendo la autoridad final (RPC + RLS). Estas funciones solo
 * deciden qué listas y botones mostrar, de modo que una solicitud terminada
 * NUNCA pueda aparecer como vigente en la vista del técnico.
 *
 * Flujo normal:
 *   pendiente → aceptada (el técnico aceptó) → confirmada (el cliente confirmó)
 *   → en_camino (abrió Google Maps) → llego (llegó al domicilio)
 *   → completada (servicio terminado / "Terminada")
 *
 * Cola de espera:
 *   Si el técnico está ocupado y acepta otra solicitud, esta pasa a
 *   `en_espera`; cuando el cliente la confirma queda `confirmada_en_espera`.
 *   Al terminar el servicio actual, el servidor la activa en orden de
 *   aceptación (`en_espera` → `aceptada`, `confirmada_en_espera` → `confirmada`).
 *
 * Se conservan estados históricos (`en_proceso`, `rechazada`, `cancelada`,
 * `expirada`) para que las solicitudes viejas sigan leyéndose sin romper nada.
 */

export const ESTADOS_VIGENTES = [
  'pendiente', 'aceptada', 'confirmada', 'en_camino', 'en_proceso', 'llego',
  'en_espera', 'confirmada_en_espera',
] as const

/** Solicitudes que mantienen al técnico "Ocupado" (son su servicio actual). */
export const ESTADOS_ACTIVOS_TECNICO = [
  'aceptada', 'confirmada', 'en_camino', 'en_proceso', 'llego',
] as const

/** Aceptadas cuando el técnico ya tenía un servicio activo. Esperan su turno. */
export const ESTADOS_EN_ESPERA = ['en_espera', 'confirmada_en_espera'] as const

/** Solicitudes cerradas: van al historial y nunca a la lista de vigentes. */
export const ESTADOS_FINALIZADOS = [
  'completada', 'cancelada', 'rechazada', 'expirada',
] as const

const VIGENTES = new Set<string>(ESTADOS_VIGENTES)
const ACTIVOS_TECNICO = new Set<string>(ESTADOS_ACTIVOS_TECNICO)
const EN_ESPERA = new Set<string>(ESTADOS_EN_ESPERA)
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

/** La solicitud está aceptada pero esperando que el técnico termine otro servicio. */
export function esEnEspera(estado: string): boolean {
  return EN_ESPERA.has(estado)
}

/** El cliente ya confirmó, pero la solicitud todavía espera su turno. */
export function confirmadaEnEspera(estado: string): boolean {
  return estado === 'confirmada_en_espera'
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

/**
 * Ordena la cola por momento de aceptación (`en_espera_desde`), que es el orden
 * real de llegada a la cola. Las solicitudes antiguas sin fecha usan su id.
 */
export function ordenarEnEspera<T extends { id: number; enEsperaDesde?: string | null }>(pedidos: T[]): T[] {
  return [...pedidos].sort((a, b) => {
    const fa = a.enEsperaDesde ?? null
    const fb = b.enEsperaDesde ?? null
    if (fa && fb && fa !== fb) return fa < fb ? -1 : 1
    if (fa && !fb) return -1
    if (!fa && fb) return 1
    return a.id - b.id
  })
}

export type DisponibilidadTecnico<T> =
  | { estado: 'disponible'; solicitud: null }
  | { estado: 'ocupado'; solicitud: T }

/**
 * Disponibilidad derivada de la base de datos, sin una columna extra que pueda
 * quedar desactualizada: si no hay ninguna solicitud aceptada/en curso, el
 * técnico está Disponible; si hay una, está Ocupado en ESA solicitud.
 *
 * Las solicitudes `en_espera` NO lo ocupan: son justamente las que esperan a que
 * termine el servicio actual.
 */
export function disponibilidadTecnico<T extends { estado: string }>(pedidos: T[]): DisponibilidadTecnico<T> {
  const solicitud = pedidos.find(p => ACTIVOS_TECNICO.has(p.estado)) ?? null
  return solicitud
    ? { estado: 'ocupado', solicitud }
    : { estado: 'disponible', solicitud: null }
}

/**
 * ¿Puede el técnico aceptar esta solicitud?
 *
 * Siempre puede: si ya tiene un servicio activo, la solicitud no se pierde ni se
 * rechaza, queda en espera y se activa cuando termine. `enEspera` le permite a
 * la interfaz explicar qué pasará antes de aceptar.
 */
export function puedeAceptarSolicitud<T extends { id: number; estado: string }>(
  pedidos: T[],
  solicitudId: number,
): { puede: boolean; enEspera: boolean; motivo: string } {
  const otras = pedidos.filter(p => p.id !== solicitudId)
  const disp = disponibilidadTecnico(otras)
  if (disp.estado === 'ocupado') {
    return {
      puede: true,
      enEspera: true,
      motivo: `Estás ocupado con la solicitud #${disp.solicitud.id}. Si aceptas, esta quedará en espera y se activará automáticamente cuando termines.`,
    }
  }
  return { puede: true, enEspera: false, motivo: '' }
}

/** Qué acción le corresponde al técnico en cada estado (null = esperar al cliente o su turno). */
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
  enEspera: boolean
  enCamino: boolean
  llego: boolean
}

/**
 * Progreso que ve el cliente después de confirmar al técnico:
 *   "Técnico aceptó tu solicitud" → "Técnico dirigiéndose a su domicilio" → "Técnico llegó".
 * Si está en cola, `enEspera` indica que todavía no saldrá al domicilio.
 */
export function progresoCliente(estado: string): ProgresoCliente {
  const aceptado = [
    'aceptada', 'confirmada', 'en_camino', 'en_proceso', 'llego', 'completada',
    'en_espera', 'confirmada_en_espera',
  ].includes(estado)
  return {
    aceptado,
    enEspera: EN_ESPERA.has(estado),
    enCamino: ['en_camino', 'llego', 'completada'].includes(estado),
    llego: ['llego', 'completada'].includes(estado),
  }
}

/**
 * El cliente debe confirmar al técnico antes de que la solicitud avance.
 * También aplica a la cola: al confirmar queda `confirmada_en_espera`.
 */
export function esperaConfirmacionCliente(estado: string): boolean {
  return estado === 'aceptada' || estado === 'en_espera'
}

/** Solicitudes en las que el cliente todavía puede cancelar (incluso en espera). */
export function clientePuedeCancelar(estado: string): boolean {
  return ['pendiente', 'aceptada', 'en_espera', 'confirmada_en_espera'].includes(estado)
}
