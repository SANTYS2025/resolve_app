/**
 * Reglas del chat por solicitud (lógica pura, sin React ni Supabase).
 *
 * El servidor aplica las mismas reglas en la RPC `enviar_mensaje_solicitud` y en
 * las políticas RLS de `solicitud_mensajes`. Estas funciones solo deciden qué
 * mostrar en la interfaz; nunca son la única barrera de seguridad.
 */

/** Largo máximo de un mensaje (igual que el CHECK de la tabla). */
export const MAX_MENSAJE = 1000

export type ChatAccess = {
  /** El usuario participante puede abrir el historial. */
  puedeVer: boolean
  /** Puede enviar mensajes nuevos. */
  puedeEscribir: boolean
  /** Explicación para mostrar cuando no se puede escribir. */
  motivo: string
}

const MOTIVO_COMPLETADA = 'El servicio está completado. El chat quedó en solo lectura como historial.'
const MOTIVO_CANCELADA = 'La solicitud fue cancelada. El chat quedó en solo lectura como historial.'
const MOTIVO_INACTIVA = 'El chat solo está disponible mientras la solicitud está activa.'

/** Estados con chat activo: el técnico ya aceptó y el servicio sigue en curso. */
export const ESTADOS_CHAT_ACTIVO = ['aceptada', 'confirmada', 'en_camino', 'en_proceso', 'llego'] as const

/**
 * Calcula el acceso al chat a partir del estado de la solicitud.
 *
 * · `aceptada/confirmada/en_camino/en_proceso/llego` → leer y escribir.
 * · `completada`          → leer el historial, sin escribir.
 * · `cancelada`           → leer solo si hay mensajes (pudo cancelarse después de aceptar).
 * · `pendiente/rechazada/expirada` sin mensajes → sin acceso.
 *
 * `tieneMensajes` lo aporta la pantalla tras cargar el historial.
 */
export function evaluarAccesoChat(estado: string, tieneMensajes = false): ChatAccess {
  if ((ESTADOS_CHAT_ACTIVO as readonly string[]).includes(estado)) {
    return { puedeVer: true, puedeEscribir: true, motivo: '' }
  }

  const historialVisible =
    estado === 'completada' ||
    (estado === 'cancelada' && tieneMensajes)

  if (!historialVisible) return { puedeVer: false, puedeEscribir: false, motivo: MOTIVO_INACTIVA }

  const motivo = estado === 'completada' ? MOTIVO_COMPLETADA : MOTIVO_CANCELADA
  return { puedeVer: true, puedeEscribir: false, motivo }
}

/** `true` cuando la tarjeta de la solicitud debe mostrar el botón de chat. */
export function mostrarBotonChat(estado: string): boolean {
  return ['completada', 'cancelada', ...ESTADOS_CHAT_ACTIVO].includes(estado)
}

/** Valida el texto antes de llamar a la RPC. Devuelve el error o `null` si es válido. */
export function validarMensaje(texto: string): string | null {
  const t = texto.trim()
  if (!t) return 'Escribe un mensaje.'
  if (t.length > MAX_MENSAJE) return `El mensaje no puede superar ${MAX_MENSAJE} caracteres.`
  return null
}

/** Texto corto para la vista previa de la lista de solicitudes. */
export function resumenMensaje(contenido: string, max = 60): string {
  const t = contenido.trim().replace(/\s+/g, ' ')
  return t.length > max ? `${t.slice(0, max - 1)}…` : t
}
