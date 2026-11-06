/**
 * Métodos de pago de Resolve (lógica pura, sin React ni Supabase).
 *
 * Los identificadores coinciden EXACTAMENTE con el CHECK de
 * `solicitudes.metodo_pago` (migración 20261101).
 *
 * Etapa actual: los pagos reales con tarjeta/Google Pay están DIFERIDOS hasta
 * que Resolve tenga RUT y habilite Wompi/ePayco. Los métodos manuales
 * (efectivo, Nequi, Bancolombia, Bre-B) sí se pueden confirmar; el técnico es
 * quien registra el pago recibido. Ver docs/INTEGRACION_PAGOS.md.
 */

export const METODOS_PAGO = [
  'tarjeta_credito',
  'tarjeta_debito',
  'google_pay',
  'nequi',
  'bancolombia',
  'bre_b',
  'efectivo',
] as const

export type MetodoPago = (typeof METODOS_PAGO)[number]

/** Estados posibles de `solicitudes.pago_estado`. */
export const ESTADOS_PAGO = ['pendiente', 'pendiente_pasarela', 'pagado', 'efectivo', 'cancelado'] as const
export type PagoEstado = (typeof ESTADOS_PAGO)[number]

export type GrupoPago = 'tarjeta' | 'billetera' | 'transferencia' | 'efectivo'

export type MetodoPagoInfo = {
  id: MetodoPago
  nombre: string
  descripcion: string
  icono: string
  grupo: GrupoPago
  /** Necesita una pasarela externa para cobrar. */
  requierePasarela: boolean
  /** Se cobra solo, sin que el cliente tenga que transferir a mano. */
  cobroAutomatico: boolean
  /** Qué se le explica al cliente al elegirlo. */
  instruccionCliente: string
  /** Qué ve el técnico en la solicitud. */
  instruccionTecnico: string
}

export const METODOS: MetodoPagoInfo[] = [
  {
    id: 'tarjeta_credito',
    nombre: 'Tarjeta de crédito',
    descripcion: 'Visa, Mastercard y más',
    icono: '💳',
    grupo: 'tarjeta',
    requierePasarela: true,
    cobroAutomatico: true,
    instruccionCliente: 'El pago con tarjeta estará disponible cuando Resolve active pagos reales. Por ahora usa efectivo, Nequi, Bancolombia o Bre-B.',
    instruccionTecnico: 'Pago con tarjeta de crédito (próximamente). Por ahora el cliente debe usar un método manual.',
  },
  {
    id: 'tarjeta_debito',
    nombre: 'Tarjeta débito',
    descripcion: 'Débito de tu banco',
    icono: '💳',
    grupo: 'tarjeta',
    requierePasarela: true,
    cobroAutomatico: true,
    instruccionCliente: 'El pago con tarjeta estará disponible cuando Resolve active pagos reales. Por ahora usa efectivo, Nequi, Bancolombia o Bre-B.',
    instruccionTecnico: 'Pago con tarjeta débito (próximamente). Por ahora el cliente debe usar un método manual.',
  },
  {
    id: 'google_pay',
    nombre: 'Google Pay',
    descripcion: 'Paga con tu cuenta de Google',
    icono: '🅖',
    grupo: 'billetera',
    requierePasarela: true,
    cobroAutomatico: true,
    instruccionCliente: 'Google Pay estará disponible cuando Resolve active pagos reales. Por ahora usa efectivo, Nequi, Bancolombia o Bre-B.',
    instruccionTecnico: 'Pago con Google Pay (próximamente). Por ahora el cliente debe usar un método manual.',
  },
  {
    id: 'nequi',
    nombre: 'Nequi',
    descripcion: 'Transferencia desde tu app Nequi',
    icono: '📱',
    grupo: 'transferencia',
    requierePasarela: false,
    cobroAutomatico: false,
    instruccionCliente: 'Pídele al técnico su número de Nequi y transfiérele directamente desde tu app. Cuando pagues, avísale por el chat.',
    instruccionTecnico: 'El cliente pagará por Nequi. Compártele tu número por el chat y confirma cuando recibas el dinero.',
  },
  {
    id: 'bancolombia',
    nombre: 'Bancolombia',
    descripcion: 'Transferencia a cuenta Bancolombia',
    icono: '🏦',
    grupo: 'transferencia',
    requierePasarela: false,
    cobroAutomatico: false,
    instruccionCliente: 'Pídele al técnico los datos de su cuenta Bancolombia y haz la transferencia. Cuando pagues, avísale por el chat.',
    instruccionTecnico: 'El cliente pagará por Bancolombia. Compártele tus datos por el chat y confirma cuando recibas el dinero.',
  },
  {
    id: 'bre_b',
    nombre: 'Bre-B',
    descripcion: 'Transferencia inmediata',
    icono: '⚡',
    grupo: 'transferencia',
    requierePasarela: false,
    cobroAutomatico: false,
    instruccionCliente: 'Pídele al técnico su llave Bre-B y transfiere al instante. Cuando pagues, avísale por el chat.',
    instruccionTecnico: 'El cliente pagará por Bre-B. Compártele tu llave por el chat y confirma cuando recibas el dinero.',
  },
  {
    id: 'efectivo',
    nombre: 'Efectivo',
    descripcion: 'Paga en mano al técnico',
    icono: '💵',
    grupo: 'efectivo',
    requierePasarela: false,
    cobroAutomatico: false,
    instruccionCliente: 'Paga en efectivo directamente al técnico cuando termine el servicio.',
    instruccionTecnico: 'El cliente pagará en efectivo al finalizar el servicio.',
  },
]

const POR_ID = new Map<string, MetodoPagoInfo>(METODOS.map(m => [m.id, m]))

/** Comprueba en tiempo de ejecución que el valor es un método conocido. */
export function esMetodoPago(valor: unknown): valor is MetodoPago {
  return typeof valor === 'string' && (METODOS_PAGO as readonly string[]).includes(valor)
}

/** Datos de presentación de un método; `null` si no existe. */
export function metodoPagoInfo(metodo: string | null | undefined): MetodoPagoInfo | null {
  return metodo ? POR_ID.get(metodo) ?? null : null
}

/**
 * Interruptor de presentación. Los pagos reales están diferidos hasta que la
 * empresa tenga RUT; el servidor tiene su propio guard
 * (`pagos_config.pagos_reales_habilitados`). Este valor solo controla la UI.
 */
export const PAGOS_REALES_HABILITADOS = false

/** El método necesita un proveedor real que todavía no está habilitado. */
export function metodoDiferido(metodo: string | null | undefined): boolean {
  const info = metodoPagoInfo(metodo)
  return !!info?.requierePasarela && !PAGOS_REALES_HABILITADOS
}

/** Estado inicial de `pago_estado` al elegir un método. */
export function estadoPagoInicial(metodo: MetodoPago): PagoEstado {
  if (metodo === 'efectivo') return 'efectivo'
  if (metodo === 'tarjeta_credito' || metodo === 'tarjeta_debito' || metodo === 'google_pay') {
    return PAGOS_REALES_HABILITADOS ? 'pendiente_pasarela' : 'pendiente'
  }
  return 'pendiente'
}

/** El cliente solo puede elegir/cambiar el método cuando el servicio está completado y no pagado. */
export function puedeElegirMetodoPago(estadoSolicitud: string, pagoEstado?: string | null): boolean {
  return estadoSolicitud === 'completada' && pagoEstado !== 'pagado' && pagoEstado !== 'cancelado'
}

/**
 * Valida la selección antes de llamar a la RPC.
 * Devuelve el mensaje de error o `null` si es válida.
 */
export function validarSeleccionMetodo(
  metodo: string,
  estadoSolicitud: string,
  pagoEstado?: string | null,
): string | null {
  if (!esMetodoPago(metodo)) return 'Selecciona un método de pago válido.'
  if (estadoSolicitud !== 'completada') return 'Podrás elegir el método de pago cuando el servicio esté completado.'
  if (pagoEstado === 'pagado') return 'Este servicio ya está pagado.'
  if (pagoEstado === 'cancelado') return 'El pago de este servicio fue cancelado.'
  if (metodoDiferido(metodo)) {
    return 'El pago con tarjeta o Google Pay estará disponible cuando Resolve active pagos reales. Usa efectivo, Nequi, Bancolombia o Bre-B.'
  }
  return null
}

export const ETIQUETA_PAGO_ESTADO: Record<PagoEstado, string> = {
  pendiente: 'Pendiente de pago',
  pendiente_pasarela: 'Pago en línea pendiente',
  pagado: 'Pagado',
  efectivo: 'Pago en efectivo',
  cancelado: 'Pago cancelado',
}

/** Etiqueta legible del estado de pago; tolera valores viejos/desconocidos. */
export function etiquetaEstadoPago(pagoEstado: string | null | undefined): string {
  if (!pagoEstado) return ETIQUETA_PAGO_ESTADO.pendiente
  return ETIQUETA_PAGO_ESTADO[pagoEstado as PagoEstado] ?? ETIQUETA_PAGO_ESTADO.pendiente
}

/**
 * Texto que resume el pago para el técnico. No incluye datos bancarios del
 * cliente: solo el método y su estado.
 */
export function resumenPagoTecnico(metodo: string | null | undefined, pagoEstado: string | null | undefined): string {
  const info = metodoPagoInfo(metodo)
  if (!info) return 'El cliente aún no ha elegido método de pago.'
  return `${info.nombre} · ${etiquetaEstadoPago(pagoEstado)}`
}
