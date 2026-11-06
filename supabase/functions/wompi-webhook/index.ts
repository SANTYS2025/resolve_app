/**
 * Edge Function: wompi-webhook
 *
 * Recibe los eventos de Wompi, VERIFICA LA FIRMA y registra el evento de forma
 * idempotente. Es la única vía que marca un pago como aprobado.
 *
 * Configurar en Wompi la URL:
 *   https://<proyecto>.supabase.co/functions/v1/wompi-webhook
 * y el mismo `WOMPI_SECRETO_EVENTOS` en los secrets de Supabase.
 *
 * Esta función se despliega con `--no-verify-jwt` (Wompi no envía JWT).
 */

import { error, json, mensajeError, preflight } from '../_shared/cors.ts'
import { adminClient } from '../_shared/supabase.ts'
import { validarFirmaEventoWompi } from '../_shared/pagos.ts'
import { consultarTransaccion, leerConfigWompi } from '../_shared/wompi.ts'

type EventoWompi = {
  event?: string
  data?: {
    transaction?: {
      id?: string
      status?: string
      reference?: string
      amount_in_cents?: number
      currency?: string
      payment_method_type?: string
      [k: string]: unknown
    }
  }
  signature?: { properties?: string[]; checksum?: string }
  timestamp?: number
  sent_at?: string
}

Deno.serve(async req => {
  const pre = preflight(req)
  if (pre) return pre
  if (req.method !== 'POST') return error('Método no permitido.', 405)

  try {
    const config = leerConfigWompi()
    if (!config.secretoEventos) {
      console.error('WOMPI_SECRETO_EVENTOS no está configurado: se rechaza el evento.')
      return error('Webhook sin configurar.', 500)
    }

    const evento = await req.json().catch(() => null) as EventoWompi | null
    if (!evento) return error('Cuerpo inválido.', 400)

    const firmaOk = await validarFirmaEventoWompi(
      { data: evento.data as Record<string, unknown> | undefined, signature: evento.signature, timestamp: evento.timestamp },
      config.secretoEventos,
    )
    if (!firmaOk) {
      console.warn('Firma de Wompi inválida; evento descartado.')
      return error('Firma inválida.', 401)
    }

    if (evento.event && evento.event !== 'transaction.updated') {
      return json({ ok: true, ignorado: evento.event })
    }

    const tx = evento.data?.transaction
    if (!tx?.reference || !tx?.id) return error('Evento sin transacción.', 400)

    // Defensa adicional: si hay llave privada, se confirma el estado real.
    let estado = tx.status ?? ''
    let monto = Number(tx.amount_in_cents ?? 0)
    if (config.llavePrivada) {
      try {
        const real = await consultarTransaccion(tx.id, config)
        if (real) {
          estado = real.status ?? estado
          monto = Number(real.amount_in_cents ?? monto)
        }
      } catch (e) {
        // Si la consulta falla, se usa el evento firmado (no se pierde el cobro).
        console.warn('No se pudo verificar la transacción con Wompi:', mensajeError(e))
      }
    }

    const admin = adminClient()
    const { data, error: e } = await admin.rpc('registrar_evento_wompi', {
      p_referencia: tx.reference,
      p_proveedor_id: tx.id,
      p_estado: estado,
      p_monto_centavos: monto,
      p_payload: evento as unknown as Record<string, unknown>,
    })
    if (e) throw e

    return json({ ok: true, transaccion: (data as { id?: number } | null)?.id ?? null })
  } catch (e) {
    console.error(e)
    return error(mensajeError(e), 500)
  }
})
