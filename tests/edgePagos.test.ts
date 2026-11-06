import test from 'node:test'
import assert from 'node:assert/strict'
import {
  calcularComision,
  construirReferencia,
  normalizarEstadoWompi,
  solicitudDesdeReferencia,
  validarFirmaEventoWompi,
  firmarIntegridadCheckout,
} from '../supabase/functions/_shared/pagos.ts'
import { construirUrlCheckout, reembolsarTransaccion, type WompiConfig } from '../supabase/functions/_shared/wompi.ts'

const config: WompiConfig = {
  entorno: 'sandbox',
  llavePublica: 'pub_test_123',
  llavePrivada: 'prv_test_123',
  secretoIntegridad: 'integrity_secret',
  secretoEventos: 'events_secret',
}

test('la copia de pagos del servidor coincide con la regla del cliente', () => {
  assert.deepEqual(calcularComision(100_000, 1000), { comisionCentavos: 10_000, netoCentavos: 90_000, pctBps: 1000 })
  assert.deepEqual(calcularComision(1_005, 1000), { comisionCentavos: 101, netoCentavos: 904, pctBps: 1000 })
  assert.equal(calcularComision(100, 1000, 500).comisionCentavos, 100)
})

test('normaliza estados y referencias de Wompi', () => {
  assert.equal(normalizarEstadoWompi('APPROVED'), 'aprobada')
  assert.equal(normalizarEstadoWompi('DECLINED'), 'declinada')
  assert.equal(normalizarEstadoWompi('VOIDED'), 'anulada')
  assert.equal(normalizarEstadoWompi('otro'), 'error')
  assert.equal(construirReferencia(12), 'resolve-sol-12')
  assert.equal(construirReferencia(12, 3), 'resolve-sol-12-r3')
  assert.equal(solicitudDesdeReferencia('resolve-sol-12-r3'), 12)
  assert.equal(solicitudDesdeReferencia('otra'), null)
})

test('la URL de checkout incluye firma de integridad y no la llave privada', async () => {
  const url = await construirUrlCheckout({ referencia: 'resolve-sol-5', montoCentavos: 10_000 }, config)
  const u = new URL(url)
  assert.equal(u.origin + u.pathname, 'https://checkout.wompi.co/p/')
  assert.equal(u.searchParams.get('reference'), 'resolve-sol-5')
  assert.equal(u.searchParams.get('amount-in-cents'), '10000')
  assert.equal(u.searchParams.get('public-key'), 'pub_test_123')
  assert.ok(u.searchParams.get('signature:integrity'))
  assert.equal(url.includes('prv_test_123'), false)
  assert.equal(u.searchParams.get('signature:integrity'), await firmarIntegridadCheckout('resolve-sol-5', 10_000, 'integrity_secret'))
})

test('el webhook rechaza firmas alteradas', async () => {
  const evento = {
    data: { transaction: { id: 'tx-1', status: 'APPROVED', amount_in_cents: 10_000 } },
    signature: { properties: ['transaction.id', 'transaction.status', 'transaction.amount_in_cents'], checksum: '' },
    timestamp: 1700000000,
  }
  assert.equal(await validarFirmaEventoWompi(evento, 'events_secret'), false)
  assert.equal(await validarFirmaEventoWompi({ ...evento, timestamp: undefined }, 'events_secret'), false)
})

test('el reembolso usa la llave privada solo en el servidor y acepta fetch inyectado', async () => {
  let capturado: { url: string; init: RequestInit } | null = null
  const fakeFetch = (async (url: string | URL | Request, init?: RequestInit) => {
    capturado = { url: String(url), init: init ?? {} }
    return new Response(JSON.stringify({ data: { id: 'tx-1', status: 'VOIDED', reference: 'resolve-sol-5', amount_in_cents: 10_000, currency: 'COP' } }), { status: 200 })
  }) as typeof fetch

  const r = await reembolsarTransaccion('tx-1', 5_000, config, fakeFetch)
  assert.equal(r.status, 'VOIDED')
  assert.ok(capturado)
  assert.match(capturado!.url, /sandbox\.wompi\.co\/v1\/transactions\/tx-1\/void/)
  assert.equal((capturado!.init.headers as Record<string, string>).Authorization, 'Bearer prv_test_123')
  assert.equal(capturado!.init.body, JSON.stringify({ amount_in_cents: 5_000 }))
})
