/**
 * Adaptador de Wompi (aislado y testeable).
 *
 * - El Web Checkout se arma como URL firmada; no requiere llamada de red.
 * - Las consultas y reembolsos usan la llave privada SOLO en el servidor.
 * - Todas las funciones aceptan `fetchImpl` para probarlas sin red.
 */

import { firmarIntegridadCheckout, MONEDA } from './pagos.ts'

export type WompiConfig = {
  entorno: 'sandbox' | 'produccion'
  llavePublica: string
  llavePrivada: string
  secretoIntegridad: string
  secretoEventos: string
  urlRetorno?: string
}

export function leerConfigWompi(env: (k: string) => string | undefined = k => Deno.env.get(k)): WompiConfig {
  const entorno = (env('WOMPI_ENTORNO') ?? 'sandbox').toLowerCase() === 'produccion' ? 'produccion' : 'sandbox'
  return {
    entorno,
    llavePublica: env('WOMPI_LLAVE_PUBLICA') ?? '',
    llavePrivada: env('WOMPI_LLAVE_PRIVADA') ?? '',
    secretoIntegridad: env('WOMPI_SECRETO_INTEGRIDAD') ?? '',
    secretoEventos: env('WOMPI_SECRETO_EVENTOS') ?? '',
    urlRetorno: env('WOMPI_URL_RETORNO') || undefined,
  }
}

export function baseApi(entorno: WompiConfig['entorno']): string {
  return entorno === 'produccion' ? 'https://production.wompi.co/v1' : 'https://sandbox.wompi.co/v1'
}

export function checkoutConfigurado(c: WompiConfig): boolean {
  return Boolean(c.llavePublica && c.secretoIntegridad)
}

export function reembolsosConfigurados(c: WompiConfig): boolean {
  return Boolean(c.llavePrivada)
}

export type DatosCheckout = {
  referencia: string
  montoCentavos: number
  moneda?: string
  correoCliente?: string
  urlRetorno?: string
}

/** URL del Web Checkout con la firma de integridad. No expone secretos. */
export async function construirUrlCheckout(d: DatosCheckout, c: WompiConfig): Promise<string> {
  if (!checkoutConfigurado(c)) throw new Error('Wompi no está configurado (falta llave pública o secreto de integridad).')
  const moneda = d.moneda ?? MONEDA
  const firma = await firmarIntegridadCheckout(d.referencia, d.montoCentavos, c.secretoIntegridad, moneda)
  const params = new URLSearchParams({
    'public-key': c.llavePublica,
    currency: moneda,
    'amount-in-cents': String(Math.round(d.montoCentavos)),
    reference: d.referencia,
    'signature:integrity': firma,
  })
  if (d.correoCliente) params.set('customer-data:email', d.correoCliente)
  const retorno = d.urlRetorno ?? c.urlRetorno
  if (retorno) params.set('redirect-url', retorno)
  return `https://checkout.wompi.co/p/?${params.toString()}`
}

export type TransaccionWompi = {
  id: string
  status: string
  reference: string
  amount_in_cents: number
  currency: string
  payment_method_type?: string
  [k: string]: unknown
}

async function pedir<T>(
  url: string,
  init: RequestInit,
  fetchImpl: typeof fetch,
): Promise<T> {
  const res = await fetchImpl(url, init)
  const texto = await res.text()
  let cuerpo: unknown = null
  try { cuerpo = texto ? JSON.parse(texto) : null } catch { cuerpo = texto }
  if (!res.ok) {
    const detalle = cuerpo && typeof cuerpo === 'object' && 'error' in cuerpo
      ? JSON.stringify((cuerpo as { error: unknown }).error)
      : texto.slice(0, 300)
    throw new Error(`Wompi respondió ${res.status}: ${detalle}`)
  }
  return cuerpo as T
}

/** Consulta una transacción por su id de Wompi (verificación adicional del webhook). */
export async function consultarTransaccion(
  id: string,
  c: WompiConfig,
  fetchImpl: typeof fetch = fetch,
): Promise<TransaccionWompi | null> {
  if (!c.llavePrivada) throw new Error('Falta WOMPI_LLAVE_PRIVADA.')
  const data = await pedir<{ data?: TransaccionWompi }>(
    `${baseApi(c.entorno)}/transactions/${encodeURIComponent(id)}`,
    { headers: { Authorization: `Bearer ${c.llavePrivada}` } },
    fetchImpl,
  )
  return data?.data ?? null
}

/**
 * Anula/reembolsa una transacción. Wompi permite el monto en centavos para
 * reembolsos parciales; si la cuenta no lo soporta, la solicitud queda pendiente
 * para revisión manual (nunca se marca como aprobada sin confirmación).
 */
export async function reembolsarTransaccion(
  id: string,
  montoCentavos: number | null,
  c: WompiConfig,
  fetchImpl: typeof fetch = fetch,
): Promise<TransaccionWompi> {
  if (!c.llavePrivada) throw new Error('Falta WOMPI_LLAVE_PRIVADA.')
  const body = montoCentavos == null ? {} : { amount_in_cents: Math.round(montoCentavos) }
  const data = await pedir<{ data?: TransaccionWompi }>(
    `${baseApi(c.entorno)}/transactions/${encodeURIComponent(id)}/void`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${c.llavePrivada}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    },
    fetchImpl,
  )
  if (!data?.data) throw new Error('Wompi no devolvió la transacción reembolsada.')
  return data.data
}
