/**
 * Edge Function: wompi-reembolso
 *
 * Entrada: POST { transaccion_id, monto_centavos, motivo } (JWT del cliente)
 * Salida:  { estado: 'aprobado' | 'pendiente' | 'fallido', mensaje }
 *
 * Crea la solicitud de reembolso (histórico trazable), intenta la anulación en
 * Wompi y aplica el resultado. Si Wompi no está configurado, la solicitud queda
 * `solicitado` para que el equipo la procese: NUNCA se marca como aprobada sin
 * confirmación de la pasarela.
 */

import { error, json, mensajeError, preflight } from '../_shared/cors.ts'
import { adminClient, userClient, usuarioDe } from '../_shared/supabase.ts'
import { leerConfigWompi, reembolsarTransaccion, reembolsosConfigurados } from '../_shared/wompi.ts'

Deno.serve(async req => {
  const pre = preflight(req)
  if (pre) return pre
  if (req.method !== 'POST') return error('Método no permitido.', 405)

  try {
    const usuario = await usuarioDe(req)
    if (!usuario) return error('Debes iniciar sesión.', 401)

    const body = await req.json().catch(() => null) as {
      transaccion_id?: number; monto_centavos?: number; motivo?: string
    } | null
    const txId = Number(body?.transaccion_id)
    const monto = Math.round(Number(body?.monto_centavos ?? 0))
    const motivo = String(body?.motivo ?? '').trim()
    if (!Number.isInteger(txId) || txId <= 0) return error('Falta la transacción.', 400)
    if (!Number.isInteger(monto) || monto <= 0) return error('Indica un monto de reembolso válido.', 400)
    if (motivo.length < 10) return error('Cuéntanos el motivo (mínimo 10 caracteres).', 400)

    const user = userClient(req)
    const { data: reembolsoId, error: eSol } = await user.rpc('solicitar_reembolso', {
      p_transaccion_id: txId,
      p_monto_centavos: monto,
      p_motivo: motivo,
    })
    if (eSol) return error(eSol.message, 409)

    const admin = adminClient()
    const { data: tx, error: eTx } = await admin
      .from('transacciones')
      .select('id,proveedor_transaccion_id,estado,monto_centavos,reembolsado_centavos')
      .eq('id', txId)
      .maybeSingle()
    if (eTx) throw eTx
    if (!tx) return error('La transacción no existe.', 404)
    if (!tx.proveedor_transaccion_id) {
      return json({ estado: 'pendiente', mensaje: 'El reembolso quedó registrado para revisión manual.' })
    }

    const config = leerConfigWompi()
    if (!reembolsosConfigurados(config)) {
      return json({
        estado: 'pendiente',
        mensaje: 'El reembolso quedó registrado. La pasarela aún no está configurada para ejecutarlo automáticamente.',
      })
    }

    try {
      const disponible = Number(tx.monto_centavos) - Number(tx.reembolsado_centavos ?? 0)
      const parcial = monto < disponible
      const respuesta = await reembolsarTransaccion(
        String(tx.proveedor_transaccion_id),
        parcial ? monto : null,
        config,
      )
      const { error: eAplicar } = await admin.rpc('aplicar_reembolso', {
        p_reembolso_id: reembolsoId,
        p_proveedor_id: respuesta.id ?? String(tx.proveedor_transaccion_id),
        p_estado: 'aprobado',
      })
      if (eAplicar) throw eAplicar
      return json({
        estado: 'aprobado',
        mensaje: parcial
          ? 'Reembolso parcial aprobado. La comisión se reversó en la misma proporción.'
          : 'Reembolso total aprobado. La comisión se reversó por completo.',
      })
    } catch (e) {
      console.error('Wompi rechazó el reembolso:', e)
      await admin.rpc('aplicar_reembolso', {
        p_reembolso_id: reembolsoId,
        p_proveedor_id: null,
        p_estado: 'fallido',
      }).catch(() => null)
      return error(`No se pudo ejecutar el reembolso en Wompi: ${mensajeError(e)}`, 502)
    }
  } catch (e) {
    console.error(e)
    return error(mensajeError(e), 500)
  }
})
