/**
 * Métodos de pago de Resolve (lógica pura, sin React ni Supabase).
 *
 * Los identificadores coinciden EXACTAMENTE con el CHECK de
 * `solicitudes.metodo_pago` (migración 20261111). El catálogo mantiene los
 * ocho métodos visibles para no romper registros históricos, pero solo cuatro
 * están habilitados: Nequi, Bancolombia, Daviplata y efectivo.
 *
 * El pago lo confirma el técnico cuando recibe el dinero (pago manual interno).
 * Los métodos con tarjeta, Google Pay y Bre-B quedan como "PRONTO" hasta que
 * Resolve habilite pagos reales. Ver docs/INTEGRACION_PAGOS.md.
 *
 * Este módulo es lógica pura: no importa imágenes ni componentes. La capa
 * visual elige el logotipo oficial o el icono genérico en
 * `src/components/MetodoPagoLogo.tsx`.
 */

export const METODOS_PAGO = [
  'tarjeta_credito',
  'tarjeta_debito',
  'google_pay',
  'nequi',
  'bancolombia',
  'daviplata',
  'bre_b',
  'efectivo',
] as const

export type MetodoPago = (typeof METODOS_PAGO)[number]

/** Métodos que el cliente puede elegir hoy. El servidor aplica la misma lista. */
export const METODOS_HABILITADOS = ['nequi', 'bancolombia', 'daviplata', 'efectivo'] as const
export type MetodoPagoHabilitado = (typeof METODOS_HABILITADOS)[number]

/** Estados posibles de `solicitudes.pago_estado`. */
export const ESTADOS_PAGO = ['pendiente', 'pendiente_pasarela', 'pagado', 'efectivo', 'cancelado'] as const
export type PagoEstado = (typeof ESTADOS_PAGO)[number]

export type GrupoPago = 'tarjeta' | 'billetera' | 'transferencia' | 'efectivo'

/** Datos de presentación de un método. Los logotipos viven en `components/MetodoPagoLogo`. */
export type MetodoPagoInfo = {
  id: MetodoPago
  nombre: string
  descripcion: string
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
    grupo: 'tarjeta',
    requierePasarela: true,
    cobroAutomatico: true,
    instruccionCliente: 'El pago con tarjeta estará disponible pronto. Por ahora usa Nequi, Bancolombia, Daviplata o efectivo.',
    instruccionTecnico: 'Pago con tarjeta de crédito (próximamente). El cliente debe usar Nequi, Bancolombia, Daviplata o efectivo.',
  },
  {
    id: 'tarjeta_debito',
    nombre: 'Tarjeta débito',
    descripcion: 'Débito de tu banco',
    grupo: 'tarjeta',
    requierePasarela: true,
    cobroAutomatico: true,
    instruccionCliente: 'El pago con tarjeta estará disponible pronto. Por ahora usa Nequi, Bancolombia, Daviplata o efectivo.',
    instruccionTecnico: 'Pago con tarjeta débito (próximamente). El cliente debe usar Nequi, Bancolombia, Daviplata o efectivo.',
  },
  {
    id: 'google_pay',
    nombre: 'Google Pay',
    descripcion: 'Paga con tu cuenta de Google',
    grupo: 'billetera',
    requierePasarela: true,
    cobroAutomatico: true,
    instruccionCliente: 'Google Pay estará disponible pronto. Por ahora usa Nequi, Bancolombia, Daviplata o efectivo.',
    instruccionTecnico: 'Pago con Google Pay (próximamente). El cliente debe usar Nequi, Bancolombia, Daviplata o efectivo.',
  },
  {
    id: 'nequi',
    nombre: 'Nequi',
    descripcion: 'Transferencia desde tu app Nequi',
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
    grupo: 'transferencia',
    requierePasarela: false,
    cobroAutomatico: false,
    instruccionCliente: 'Pídele al técnico los datos de su cuenta Bancolombia y haz la transferencia. Cuando pagues, avísale por el chat.',
    instruccionTecnico: 'El cliente pagará por Bancolombia. Compártele tus datos por el chat y confirma cuando recibas el dinero.',
  },
  {
    id: 'daviplata',
    nombre: 'Daviplata',
    descripcion: 'Transferencia desde tu app Daviplata',
    grupo: 'transferencia',
    requierePasarela: false,
    cobroAutomatico: false,
    instruccionCliente: 'Pídele al técnico su número de Daviplata y transfiérele directamente desde tu app. Cuando pagues, avísale por el chat.',
    instruccionTecnico: 'El cliente pagará por Daviplata. Compártele tu número por el chat y confirma cuando recibas el dinero.',
  },
  {
    id: 'bre_b',
    nombre: 'Bre-B',
    descripcion: 'Transferencia inmediata',
    grupo: 'transferencia',
    requierePasarela: false,
    cobroAutomatico: false,
    instruccionCliente: 'Bre-B estará disponible pronto. Por ahora usa Nequi, Bancolombia, Daviplata o efectivo.',
    instruccionTecnico: 'Pago por Bre-B (próximamente). El cliente debe usar Nequi, Bancolombia, Daviplata o efectivo.',
  },
  {
    id: 'efectivo',
    nombre: 'Efectivo',
    descripcion: 'Paga en mano al técnico',
    grupo: 'efectivo',
    requierePasarela: false,
    cobroAutomatico: false,
    instruccionCliente: 'Paga en efectivo directamente al técnico cuando termine el servicio. Cuando pagues, avísale por el chat.',
    instruccionTecnico: 'El cliente pagará en efectivo. Confirma cuando recibas el dinero.',
  },
]

const POR_ID = new Map<string, MetodoPagoInfo>(METODOS.map(m => [m.id, m]))

/** Comprueba en tiempo de ejecución que el valor es un método conocido. */
export function esMetodoPago(valor: unknown): valor is MetodoPago {
  return typeof valor === 'string' && (METODOS_PAGO as readonly string[]).includes(valor)
}

/** ¿El método se puede elegir hoy? (Nequi, Bancolombia, Daviplata o efectivo). */
export function metodoHabilitado(metodo: string | null | undefined): boolean {
  return !!metodo && (METODOS_HABILITADOS as readonly string[]).includes(metodo)
}

/** Datos de presentación de un método; `null` si no existe. */
export function metodoPagoInfo(metodo: string | null | undefined): MetodoPagoInfo | null {
  return metodo ? POR_ID.get(metodo) ?? null : null
}

/**
 * Interruptor de presentación. Los pagos reales siguen diferidos hasta que la
 * empresa tenga RUT; el servidor tiene su propio guard
 * (`pagos_config.pagos_reales_habilitados`). Este valor solo controla la UI.
 */
export const PAGOS_REALES_HABILITADOS = false

/**
 * El método está visible pero deshabilitado con la etiqueta PRONTO.
 * Hoy solo Nequi, Bancolombia, Daviplata y efectivo están habilitados.
 */
export function metodoDiferido(metodo: string | null | undefined): boolean {
  return !!metodoPagoInfo(metodo) && !metodoHabilitado(metodo)
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
    return 'Ese método de pago aún no está disponible. Por ahora usa Nequi, Bancolombia, Daviplata o efectivo.'
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
