/**
 * Preferencias y contenido de notificaciones (lógica pura).
 *
 * Las notificaciones push se envían desde una Edge Function; aquí solo se
 * decide SI el usuario quiere recibir cada tipo. El servidor repite esta
 * validación antes de encolar el envío.
 */

export type TipoNotificacion = 'mensaje' | 'estado_servicio' | 'pago' | 'promocion' | 'sistema'

export type PreferenciasNotificacion = {
  push_activo: boolean
  mensajes: boolean
  estados_servicio: boolean
  pagos: boolean
  promociones: boolean
}

export const PREFERENCIAS_DEFECTO: PreferenciasNotificacion = {
  push_activo: true,
  mensajes: true,
  estados_servicio: true,
  pagos: true,
  promociones: false,
}

export function normalizarPreferencias(p: Partial<PreferenciasNotificacion> | null | undefined): PreferenciasNotificacion {
  return {
    push_activo: p?.push_activo ?? PREFERENCIAS_DEFECTO.push_activo,
    mensajes: p?.mensajes ?? PREFERENCIAS_DEFECTO.mensajes,
    estados_servicio: p?.estados_servicio ?? PREFERENCIAS_DEFECTO.estados_servicio,
    pagos: p?.pagos ?? PREFERENCIAS_DEFECTO.pagos,
    promociones: p?.promociones ?? PREFERENCIAS_DEFECTO.promociones,
  }
}

/**
 * ¿Se debe enviar una push de este tipo?
 * `sistema` (seguridad, cuenta, soporte) siempre pasa; el resto respeta la preferencia.
 */
export function debeNotificar(
  prefs: Partial<PreferenciasNotificacion> | null | undefined,
  tipo: TipoNotificacion,
): boolean {
  const p = normalizarPreferencias(prefs)
  if (!p.push_activo) return false
  switch (tipo) {
    case 'mensaje': return p.mensajes
    case 'estado_servicio': return p.estados_servicio
    case 'pago': return p.pagos
    case 'promocion': return p.promociones
    case 'sistema': return true
  }
}

export function validarTokenPush(token: string | null | undefined): string | null {
  const t = String(token ?? '').trim()
  if (t.length < 20) return 'El token del dispositivo no es válido.'
  if (t.length > 4096) return 'El token del dispositivo es demasiado largo.'
  return null
}

export type ContenidoNotificacion = { titulo: string; cuerpo: string; tipo: TipoNotificacion }

/** Texto de la push de un mensaje nuevo. No incluye el contenido completo por privacidad. */
export function contenidoMensaje(remitente: string, texto: string, solicitudId: number): ContenidoNotificacion {
  const limpio = texto.trim().replace(/\s+/g, ' ')
  const resumen = limpio.length > 80 ? `${limpio.slice(0, 79)}…` : limpio
  return {
    titulo: `Nuevo mensaje de ${remitente || 'Resolve'}`,
    cuerpo: `${resumen || 'Tienes un mensaje nuevo'} · Solicitud #${solicitudId}`,
    tipo: 'mensaje',
  }
}

const ESTADOS: Record<string, string> = {
  aceptada: 'El técnico aceptó tu solicitud.',
  confirmada: 'Confirmaste al técnico. Ya puede ir a tu domicilio.',
  en_camino: 'El técnico va en camino.',
  llego: 'El técnico llegó a tu domicilio.',
  completada: 'El servicio terminó. Ya puedes calificar y pagar.',
  cancelada: 'La solicitud fue cancelada.',
  rechazada: 'La solicitud fue rechazada.',
}

export function contenidoEstado(estado: string, solicitudId: number): ContenidoNotificacion {
  return {
    titulo: `Solicitud #${solicitudId}`,
    cuerpo: ESTADOS[estado] ?? `La solicitud cambió a ${estado}.`,
    tipo: 'estado_servicio',
  }
}

/** Etiqueta de la bandeja de notificaciones. */
export function etiquetaTipoNotificacion(tipo: string): string {
  const map: Record<string, string> = {
    mensaje: 'Mensaje',
    estado_servicio: 'Servicio',
    pago: 'Pago',
    promocion: 'Promoción',
    sistema: 'Sistema',
  }
  return map[tipo] ?? 'Aviso'
}
