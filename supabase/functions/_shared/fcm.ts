/**
 * Envío push con FCM HTTP v1 (Android/iOS vía Firebase).
 *
 * Aislado para poder probarlo sin red: `enviarFcm` y `obtenerAccessToken`
 * aceptan un `fetchImpl`. La cuenta de servicio se lee de un secret
 * (`FCM_SERVICE_ACCOUNT_JSON`), nunca del cliente.
 */

export type CuentaServicio = {
  project_id: string
  client_email: string
  private_key: string
}

export function leerCuentaServicio(json: string | undefined): CuentaServicio {
  if (!json) throw new Error('Falta FCM_SERVICE_ACCOUNT_JSON.')
  let datos: Record<string, unknown>
  try { datos = JSON.parse(json) } catch { throw new Error('FCM_SERVICE_ACCOUNT_JSON no es un JSON válido.') }
  const project_id = String(datos.project_id ?? '')
  const client_email = String(datos.client_email ?? '')
  const private_key = String(datos.private_key ?? '').replace(/\\n/g, '\n')
  if (!project_id || !client_email || !private_key) {
    throw new Error('La cuenta de servicio de FCM está incompleta.')
  }
  return { project_id, client_email, private_key }
}

function base64Url(bytes: Uint8Array): string {
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function textoABytes(t: string): Uint8Array { return new TextEncoder().encode(t) }

function pemAArrayBuffer(pem: string): ArrayBuffer {
  const limpio = pem.replace(/-----BEGIN [^-]+-----/g, '').replace(/-----END [^-]+-----/g, '').replace(/\s+/g, '')
  const bin = atob(limpio)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes.buffer
}

/** JWT firmado con RS256 para el intercambio OAuth de la cuenta de servicio. */
export async function firmarJwtCuentaServicio(cuenta: CuentaServicio, ahora = Math.floor(Date.now() / 1000)): Promise<string> {
  const header = base64Url(textoABytes(JSON.stringify({ alg: 'RS256', typ: 'JWT' })))
  const claim = base64Url(textoABytes(JSON.stringify({
    iss: cuenta.client_email,
    scope: 'https://www.googleapis.com/auth/firebase.messaging',
    aud: 'https://oauth2.googleapis.com/token',
    iat: ahora,
    exp: ahora + 3600,
  })))
  const clave = await crypto.subtle.importKey(
    'pkcs8',
    pemAArrayBuffer(cuenta.private_key),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const firma = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', clave, textoABytes(`${header}.${claim}`))
  return `${header}.${claim}.${base64Url(new Uint8Array(firma))}`
}

export async function obtenerAccessToken(
  cuenta: CuentaServicio,
  fetchImpl: typeof fetch = fetch,
  ahora = Math.floor(Date.now() / 1000),
): Promise<string> {
  const jwt = await firmarJwtCuentaServicio(cuenta, ahora)
  const res = await fetchImpl('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }).toString(),
  })
  const data = await res.json().catch(() => null) as { access_token?: string; error?: unknown } | null
  if (!res.ok || !data?.access_token) {
    throw new Error(`No se pudo obtener el token de FCM: ${JSON.stringify(data?.error ?? res.status)}`)
  }
  return data.access_token
}

export type MensajePush = {
  titulo: string
  cuerpo: string
  datos?: Record<string, string>
}

export async function enviarFcm(
  tokenDispositivo: string,
  mensaje: MensajePush,
  accessToken: string,
  projectId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ ok: boolean; id?: string; error?: string; noRegistrado?: boolean }> {
  const res = await fetchImpl(`https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      message: {
        token: tokenDispositivo,
        notification: { title: mensaje.titulo, body: mensaje.cuerpo },
        data: mensaje.datos ?? {},
        android: { priority: 'high', notification: { channel_id: 'resolve_avisos' } },
        apns: { payload: { aps: { sound: 'default', badge: 1 } } },
      },
    }),
  })
  const data = await res.json().catch(() => null) as { name?: string; error?: { status?: string; message?: string } } | null
  if (res.ok) return { ok: true, id: data?.name }
  const estado = data?.error?.status ?? ''
  return {
    ok: false,
    error: data?.error?.message ?? `FCM ${res.status}`,
    // Token inválido: el llamador debe desactivarlo.
    noRegistrado: estado === 'NOT_FOUND' || estado === 'UNREGISTERED' || res.status === 404,
  }
}
