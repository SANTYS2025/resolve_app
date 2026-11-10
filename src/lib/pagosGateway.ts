/**
 * Abstracción de pasarela de pagos (preparada, sin proveedor conectado).
 *
 * Etapa actual: los pagos reales con Wompi/ePayco están DIFERIDOS hasta que la
 * empresa tenga RUT. Este módulo NO llama a ninguna Edge Function ni usa
 * credenciales; solo describe el estado del cobro automático para que la UI
 * pueda mostrar "próximamente" sin romper el flujo manual.
 *
 * Cuando se habilite el proveedor:
 *  1. Las llaves vivirán en secrets del servidor (nunca aquí).
 *  2. `procesarCobroAutomatico` delegará en la Edge Function del proveedor.
 *  3. El webhook firmado será la única vía que marque un pago como aprobado.
 *
 * El historial, las comisiones y los reembolsos ya funcionan con el proveedor
 * interno (`registrar_pago_interno`), así que habilitar el proveedor real no
 * cambia el modelo de datos.
 */

import type { ProveedorPago } from './pagosCore'

/** Proveedor con el que se registran los pagos hoy. */
export const PROVEEDOR_ACTIVO: ProveedorPago = 'interno'

/** Interruptor de presentación; el guard real vive en el servidor. */
export const PAGOS_REALES_HABILITADOS = false

export type ResultadoCobro =
  | { estado: 'diferido'; mensaje: string }
  | { estado: 'manual'; mensaje: string }
  | { estado: 'error'; mensaje: string }

/** ¿Hay una pasarela real configurada y habilitada? Hoy siempre es `false`. */
export function pasarelaConfigurada(): boolean {
  return PAGOS_REALES_HABILITADOS
}

/** Mensaje único para explicar la etapa actual sin prometer un cobro. */
export const MENSAJE_PAGO_DIFERIDO =
  'El pago con tarjeta, Google Pay o Bre-B estará disponible pronto. Por ahora usa Nequi, Bancolombia, Daviplata o efectivo.'

/**
 * Atajo histórico conservado para no romper importaciones antiguas.
 *
 * No inicia ningún cobro: devuelve el estado diferido. El pago manual se
 * confirma con `registrarPagoInterno` desde la pantalla del técnico.
 */
export async function procesarCobroAutomatico(_solicitudId?: number): Promise<ResultadoCobro> {
  if (!pasarelaConfigurada()) return { estado: 'diferido', mensaje: MENSAJE_PAGO_DIFERIDO }
  return {
    estado: 'error',
    mensaje: 'La pasarela está marcada como habilitada pero aún no tiene adaptador conectado.',
  }
}
