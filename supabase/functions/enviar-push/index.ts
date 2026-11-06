/**
 * Edge Function: enviar-push
 *
 * Despacha las notificaciones pendientes de `public.notificaciones` a FCM.
 * Se invoca desde un cron de Supabase (o un Database Webhook) con el header
 * `x-push-secreto: <PUSH_SECRETO>`.
 *
 * Secrets necesarios:
 *   · FCM_SERVICE_ACCOUNT_JSON  (JSON completo de la cuenta de servicio)
 *   · PUSH_SECRETO              (cadena larga aleatoria)
 *   · SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (los pone Supabase)
 *
 * Si FCM no está configurado responde 503 y NO marca nada como enviado: los
 * avisos quedan en la bandeja y se enviarán cuando se configure.
 */

import { error, json, mensajeError, preflight } from '../_shared/cors.ts'
import { adminClient } from '../_shared/supabase.ts'
import { enviarFcm, leerCuentaServicio, obtenerAccessToken } from '../_shared/fcm.ts'

type Notificacion = {
  id: number
  usuario_id: string
  tipo: string
  titulo: string
  cuerpo: string
  solicitud_id: number | null
  push_intentos: number
}

Deno.serve(async req => {
  const pre = preflight(req)
  if (pre) return pre
  if (req.method !== 'POST') return error('Método no permitido.', 405)

  try {
    const secreto = Deno.env.get('PUSH_SECRETO') ?? ''
    const recibido = req.headers.get('x-push-secreto') ?? ''
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    const bearer = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
    const autorizado = Boolean(secreto && recibido === secreto) || Boolean(serviceKey && bearer === serviceKey)
    if (!autorizado) return error('No autorizado.', 401)

    const cuentaJson = Deno.env.get('FCM_SERVICE_ACCOUNT_JSON')
    if (!cuentaJson) {
      return json({ estado: 'no_configurado', mensaje: 'Falta FCM_SERVICE_ACCOUNT_JSON.' }, 503)
    }
    const cuenta = leerCuentaServicio(cuentaJson)
    const accessToken = await obtenerAccessToken(cuenta)

    const admin = adminClient()
    const { data, error: e } = await admin
      .from('notificaciones')
      .select('id,usuario_id,tipo,titulo,cuerpo,solicitud_id,push_intentos')
      .eq('push_enviado', false)
      .lt('push_intentos', 3)
      .order('creada_en', { ascending: true })
      .limit(50)
    if (e) throw e

    const pendientes = (data ?? []) as Notificacion[]
    if (pendientes.length === 0) return json({ enviados: 0, pendientes: 0 })

    let enviados = 0
    let sinToken = 0
    let fallidos = 0

    for (const n of pendientes) {
      const { data: dispositivos, error: eDisp } = await admin
        .from('dispositivos_push')
        .select('token')
        .eq('usuario_id', n.usuario_id)
        .eq('activo', true)
      if (eDisp) { fallidos++; continue }
      const tokens = (dispositivos ?? []).map(d => String(d.token))
      if (tokens.length === 0) {
        // Sin dispositivo: se marca enviado para no reintentar eternamente.
        await admin.from('notificaciones').update({ push_enviado: true }).eq('id', n.id)
        sinToken++
        continue
      }

      let alguno = false
      for (const token of tokens) {
        const r = await enviarFcm(token, {
          titulo: n.titulo,
          cuerpo: n.cuerpo,
          datos: {
            tipo: n.tipo,
            solicitud_id: n.solicitud_id == null ? '' : String(n.solicitud_id),
            notificacion_id: String(n.id),
          },
        }, accessToken, cuenta.project_id)

        if (r.ok) { alguno = true; continue }
        if (r.noRegistrado) {
          await admin.from('dispositivos_push').update({ activo: false }).eq('token', token)
        }
      }

      if (alguno) {
        await admin.from('notificaciones').update({ push_enviado: true }).eq('id', n.id)
        enviados++
      } else {
        await admin.from('notificaciones').update({ push_intentos: n.push_intentos + 1 }).eq('id', n.id)
        fallidos++
      }
    }

    return json({ enviados, sinToken, fallidos, pendientes: pendientes.length })
  } catch (e) {
    console.error(e)
    return error(mensajeError(e), 500)
  }
})
