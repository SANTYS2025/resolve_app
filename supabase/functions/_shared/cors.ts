/** CORS y respuestas JSON comunes a todas las Edge Functions. */

export const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-push-secreto',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
}

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json; charset=utf-8' },
  })
}

export function error(mensaje: string, status = 400): Response {
  return json({ error: mensaje }, status)
}

export function preflight(req: Request): Response | null {
  return req.method === 'OPTIONS' ? new Response('ok', { headers: CORS }) : null
}

/** Mensaje legible de un error desconocido, sin filtrar secretos. */
export function mensajeError(e: unknown): string {
  const m = e && typeof e === 'object' && 'message' in e ? String((e as { message: unknown }).message) : String(e ?? '')
  if (/integer out of range|numeric field overflow|out of range|value too (large|long)/i.test(m)) {
    return 'El monto del pago es demasiado alto para procesarlo. Revisa el precio del servicio e inténtalo de nuevo.'
  }
  return m || 'Error inesperado'
}
