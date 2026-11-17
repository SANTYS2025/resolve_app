/**
 * Reporte de errores de Edge Functions a Sentry (opcional).
 *
 * Sin el secret `SENTRY_DSN` todas las funciones son no-ops: el error igual se
 * registra en los logs de Supabase. Con DSN se envía un evento mínimo por el
 * endpoint de envelopes de Sentry, sin depender de SDKs que engordan el bundle
 * de Deno.
 *
 * Nunca se envían secretos ni datos personales: solo el mensaje, el stack, la
 * función y etiquetas técnicas que elijamos.
 */

type Contexto = Record<string, string | number | boolean | null | undefined>

type Dsn = { host: string; projectId: string; publicKey: string }

function leerDsn(valor: string | undefined): Dsn | null {
  if (!valor) return null
  try {
    const url = new URL(valor)
    const publicKey = decodeURIComponent(url.username)
    const projectId = url.pathname.replace(/^\/+/, '')
    if (!url.hostname || !publicKey || !projectId) return null
    return { host: url.hostname, projectId, publicKey }
  } catch {
    return null
  }
}

function idEvento(): string {
  return crypto.randomUUID().replace(/-/g, '')
}

function limpiar(texto: string): string {
  return texto
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '[correo]')
    .replace(/\b\+?\d[\d\s().-]{7,}\b/g, '[teléfono]')
}

function mensajeDe(error: unknown): string {
  if (error && typeof error === 'object' && 'message' in error) {
    return String((error as { message: unknown }).message)
  }
  return String(error ?? 'Error inesperado')
}

function pilaDe(error: unknown): string | null {
  if (error && typeof error === 'object' && 'stack' in error) {
    const pila = (error as { stack?: unknown }).stack
    return typeof pila === 'string' ? pila.slice(0, 4000) : null
  }
  return null
}

/**
 * Envía un error a Sentry si `SENTRY_DSN` está configurado.
 * Siempre registra en consola y nunca lanza.
 */
export async function reportarError(
  error: unknown,
  contexto: Contexto = {},
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const mensaje = mensajeDe(error)
  console.error('[resolve][error]', contexto, mensaje)

  const dsn = leerDsn(Deno.env.get('SENTRY_DSN'))
  if (!dsn) return

  const tags: Record<string, string> = {}
  for (const [clave, valor] of Object.entries(contexto)) {
    if (valor != null) tags[clave] = String(valor)
  }

  const evento = {
    event_id: idEvento(),
    timestamp: new Date().toISOString(),
    platform: 'javascript',
    level: 'error',
    logger: 'resolve-edge',
    environment: Deno.env.get('SENTRY_ENVIRONMENT') ?? 'production',
    server_name: 'supabase-edge',
    tags,
    exception: {
      values: [{
        type: error instanceof Error ? error.name : 'Error',
        value: limpiar(mensaje),
      }],
    },
    extra: pilaDe(error) ? { stack: limpiar(pilaDe(error) ?? '') } : undefined,
  }

  const sobre = [
    JSON.stringify({ event_id: evento.event_id, dsn: `https://${dsn.publicKey}@${dsn.host}/${dsn.projectId}` }),
    JSON.stringify({ type: 'event', length: JSON.stringify(evento).length }),
    JSON.stringify(evento),
  ].join('\n')

  try {
    await fetchImpl(`https://${dsn.host}/api/${dsn.projectId}/envelope/`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-sentry-envelope',
        'X-Sentry-Auth': `Sentry sentry_version=7, sentry_key=${dsn.publicKey}, sentry_client=resolve-edge/1.0`,
      },
      body: sobre,
    })
  } catch (e) {
    console.warn('No se pudo enviar el error a Sentry:', mensajeDe(e))
  }
}
