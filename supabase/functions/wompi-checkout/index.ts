/**
 * Edge Function: wompi-checkout
 *
 * Entrada:  POST { solicitud_id: number }  (JWT del cliente)
 * Salida:   { estado: 'iniciado', url, referencia, monto_centavos }
 *
 * No cobra: crea el intento idempotente y devuelve la URL firmada del Web
 * Checkout. El cobro se confirma SOLO por el webhook.
 */

import { error, json, mensajeError, preflight } from '../_shared/cors.ts'
import { adminClient, userClient, usuarioDe } from '../_shared/supabase.ts'
import { construirReferencia } from '../_shared/pagos.ts'
import { checkoutConfigurado, construirUrlCheckout, leerConfigWompi } from '../_shared/wompi.ts'

type Solicitud = {
  id: number
  cliente_id: string
  estado: string
  precio_final: number | null
  precio_estimado_max: number | null
  precio_estimado_min: number | null
  descuento_centavos: number | null
  pago_estado: string
  metodo_pago: string | null
}

Deno.serve(async req => {
  const pre = preflight(req)
  if (pre) return pre
  if (req.method !== 'POST') return error('Método no permitido.', 405)

  try {
    const usuario = await usuarioDe(req)
    if (!usuario) return error('Debes iniciar sesión.', 401)

    const body = await req.json().catch(() => null) as { solicitud_id?: number } | null
    const solicitudId = Number(body?.solicitud_id)
    if (!Number.isInteger(solicitudId) || solicitudId <= 0) return error('Falta la solicitud.', 400)

    const admin = adminClient()
    const { data, error: e } = await admin
      .from('solicitudes')
      .select('id,cliente_id,estado,precio_final,precio_estimado_max,precio_estimado_min,descuento_centavos,pago_estado,metodo_pago')
      .eq('id', solicitudId)
      .maybeSingle()
    if (e) throw e
    const sol = data as Solicitud | null
    if (!sol) return error('La solicitud no existe.', 404)
    if (sol.cliente_id !== usuario.id) return error('Solo el cliente puede pagar esta solicitud.', 403)
    if (sol.estado !== 'completada') return error('Solo se paga un servicio completado.', 409)
    if (sol.pago_estado === 'pagado') return error('Esta solicitud ya está pagada.', 409)

    // Precio acordado; si el técnico aún no lo registró, se usa la referencia
    // que ya mostraba la app (máximo y luego mínimo). Queda congelado en la
    // transacción y es el mismo monto que ve el cliente en PagoBox.
    const base = sol.precio_final ?? sol.precio_estimado_max ?? sol.precio_estimado_min ?? 0
    const bruto = Math.max(0, Math.round(Number(base) * 100))
    const descuento = Math.max(0, Math.round(Number(sol.descuento_centavos ?? 0)))
    const monto = bruto - descuento
    if (monto <= 0) return error('El monto a cobrar no es válido.', 409)

    // Reintento determinista: solo cambia la referencia si un intento anterior falló.
    const { count } = await admin
      .from('transacciones')
      .select('id', { count: 'exact', head: true })
      .eq('solicitud_id', solicitudId)
      .in('estado', ['declinada', 'error', 'anulada'])
    const referencia = construirReferencia(solicitudId, (count ?? 0) + 1)

    const config = leerConfigWompi()
    if (!checkoutConfigurado(config)) {
      return json({
        estado: 'no_configurado',
        mensaje: 'La pasarela aún no está configurada. Tu método quedó guardado.',
      }, 503)
    }

    // RPC con el JWT del usuario: valida propiedad y crea la fila pendiente.
    const user = userClient(req)
    const { error: ePrep } = await user.rpc('preparar_transaccion', {
      p_solicitud_id: solicitudId,
      p_referencia: referencia,
      p_monto_centavos: monto,
      p_metodo: sol.metodo_pago ?? 'tarjeta_credito',
    })
    if (ePrep) return error(ePrep.message, 409)

    const url = await construirUrlCheckout({
      referencia,
      montoCentavos: monto,
      correoCliente: usuario.email ?? undefined,
    }, config)

    return json({ estado: 'iniciado', url, referencia, monto_centavos: monto })
  } catch (e) {
    console.error(e)
    return error(mensajeError(e), 500)
  }
})
