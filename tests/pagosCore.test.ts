import test from 'node:test'
import assert from 'node:assert/strict'
import {
  METODOS_PAGO_INTERNO, aCentavos, aplicarReembolso, calcularComision, calcularPagoInterno,
  construirReferencia, construirReferenciaInterna, esMetodoPagoInterno,
  estadoSolicitudDesdeTransaccion, firmarIntegridadCheckout, formatoCop, normalizarEstadoWompi,
  puedeReembolsar, sha256Hex, solicitudDesdeReferencia, validarFirmaEventoWompi,
} from '../src/lib/pagosCore.ts'

test('pago exitoso: APPROVED marca la solicitud como pagada', () => {
  assert.equal(normalizarEstadoWompi('APPROVED'), 'aprobada')
  assert.equal(estadoSolicitudDesdeTransaccion('aprobada'), 'pagado')
})

test('pago fallido: DECLINED no marca la solicitud como pagada', () => {
  assert.equal(normalizarEstadoWompi('DECLINED'), 'declinada')
  assert.equal(normalizarEstadoWompi('FAILED'), 'declinada')
  assert.equal(normalizarEstadoWompi('ERROR'), 'error')
  assert.equal(estadoSolicitudDesdeTransaccion('declinada'), 'pendiente_pasarela')
  assert.equal(estadoSolicitudDesdeTransaccion('error'), 'pendiente_pasarela')
})

test('normalización tolera estados desconocidos sin aprobar nada', () => {
  for (const estado of ['', null, undefined, 'CUALQUIERA']) {
    const n = normalizarEstadoWompi(estado)
    assert.notEqual(n, 'aprobada')
    assert.notEqual(estadoSolicitudDesdeTransaccion(n), 'pagado')
  }
})

test('comisión de Resolve: 10 % por defecto, redondeo al centavo', () => {
  // $100.000 COP = 10.000.000 centavos
  const r = calcularComision(10_000_000)
  assert.equal(r.comisionCentavos, 1_000_000)
  assert.equal(r.netoCentavos, 9_000_000)
  assert.equal(r.pctBps, 1000)

  // $33.333 COP = 3.333.300 centavos; 10 % = 333.330
  assert.equal(calcularComision(3_333_300).comisionCentavos, 333_330)

  // Redondeo: 1 centavo al 10 % = 0 (mitad hacia arriba de 0,1)
  assert.equal(calcularComision(1).comisionCentavos, 0)
  assert.equal(calcularComision(5).comisionCentavos, 1) // 0,5 → 1
})

test('comisión configurable, mínima y nunca mayor al monto', () => {
  assert.equal(calcularComision(10_000_000, 800).comisionCentavos, 800_000)
  assert.equal(calcularComision(10_000_000, 0, 500_000).comisionCentavos, 500_000)
  assert.equal(calcularComision(1000, 5000, 2000).comisionCentavos, 1000)
  assert.equal(calcularComision(-50).comisionCentavos, 0)
})

test('reembolso total: estado reembolsada y comisión reversada por completo', () => {
  const t = { montoCentavos: 10_000_000, comisionCentavos: 1_000_000 }
  const r = aplicarReembolso(t, 10_000_000)
  assert.equal(r.estado, 'reembolsada')
  assert.equal(r.reembolsadoCentavos, 10_000_000)
  assert.equal(r.comisionReversadaCentavos, 1_000_000)
  assert.equal(r.comisionNetaCentavos, 0)
})

test('reembolso parcial: comisión reversada en la misma proporción', () => {
  const t = { montoCentavos: 10_000_000, comisionCentavos: 1_000_000, reembolsadoCentavos: 0 }
  const r = aplicarReembolso(t, 4_000_000)
  assert.equal(r.estado, 'reembolso_parcial')
  assert.equal(r.reembolsadoCentavos, 4_000_000)
  assert.equal(r.comisionReversadaCentavos, 400_000)
  assert.equal(r.comisionNetaCentavos, 600_000)

  // Un segundo reembolso completa el total y no reversa dos veces la misma comisión.
  const r2 = aplicarReembolso({ ...t, reembolsadoCentavos: r.reembolsadoCentavos }, 6_000_000)
  assert.equal(r2.estado, 'reembolsada')
  assert.equal(r2.comisionReversadaCentavos, 600_000)
  assert.equal(r2.comisionNetaCentavos, 0)
})

test('puedeReembolsar valida estado y saldo disponible', () => {
  assert.equal(puedeReembolsar({ estado: 'aprobada', montoCentavos: 1000 }, 500).puede, true)
  assert.equal(puedeReembolsar({ estado: 'pendiente', montoCentavos: 1000 }, 500).puede, false)
  assert.equal(puedeReembolsar({ estado: 'reembolsada', montoCentavos: 1000 }, 500).puede, false)
  const parcial = puedeReembolsar({ estado: 'reembolso_parcial', montoCentavos: 1000, reembolsadoCentavos: 800 }, 300)
  assert.equal(parcial.puede, false)
  assert.equal(parcial.disponibleCentavos, 200)
  assert.equal(puedeReembolsar({ estado: 'aprobada', montoCentavos: 1000 }, 0).puede, false)
})

test('referencia idempotente por solicitud', () => {
  assert.equal(construirReferencia(42), 'resolve-sol-42')
  assert.equal(construirReferencia(42, 1), 'resolve-sol-42')
  assert.equal(construirReferencia(42, 2), 'resolve-sol-42-r2')
  assert.equal(solicitudDesdeReferencia('resolve-sol-42'), 42)
  assert.equal(solicitudDesdeReferencia('resolve-sol-42-r2'), 42)
  assert.equal(solicitudDesdeReferencia('otra-cosa'), null)
})

test('pago interno: referencia determinista e idempotente', () => {
  assert.equal(construirReferenciaInterna(42), 'resolve-sol-42-interno')
  assert.equal(construirReferenciaInterna(42), construirReferenciaInterna(42))
  assert.equal(solicitudDesdeReferencia('resolve-sol-42-interno'), 42)
  assert.equal(solicitudDesdeReferencia('resolve-sol-42-interno-r2'), null)
})

test('pago interno: monto, comisión y neto con la misma regla del servidor', () => {
  const r = calcularPagoInterno({ precioFinal: 100_000 })
  assert.deepEqual(r, { montoCentavos: 10_000_000, comisionCentavos: 1_000_000, netoCentavos: 9_000_000 })

  // Sin precio final se usa el máximo estimado; el cupón se descuenta antes de la comisión.
  const conCupon = calcularPagoInterno({
    precioFinal: null, precioEstimadoMax: 80_000, precioEstimadoMin: 50_000,
    descuentoCentavos: 2_000_000,
  })
  assert.equal(conCupon.montoCentavos, 6_000_000)
  assert.equal(conCupon.comisionCentavos, 600_000)
  assert.equal(conCupon.netoCentavos, 5_400_000)

  // El descuento nunca deja un monto negativo.
  assert.equal(calcularPagoInterno({ precioFinal: 10_000, descuentoCentavos: 9_999_999 }).montoCentavos, 0)
})

test('solo los métodos manuales habilitados se confirman sin proveedor real', () => {
  assert.deepEqual([...METODOS_PAGO_INTERNO], ['nequi', 'bancolombia', 'daviplata', 'efectivo'])
  for (const m of METODOS_PAGO_INTERNO) assert.equal(esMetodoPagoInterno(m), true, m)
  for (const m of ['tarjeta_credito', 'tarjeta_debito', 'google_pay', 'bre_b', '', null]) {
    assert.equal(esMetodoPagoInterno(m), false, String(m))
  }
})

test('firma de integridad del checkout es reproducible', async () => {
  const firma = await firmarIntegridadCheckout('resolve-sol-42', 10_000_000, 'secreto-integridad')
  const esperada = await sha256Hex('resolve-sol-4210000000COPsecreto-integridad')
  assert.equal(firma, esperada)
})

test('webhook: acepta firma válida y rechaza firma alterada', async () => {
  const secreto = 'secreto-eventos'
  const evento = {
    event: 'transaction.updated',
    data: { transaction: { id: 'tx-1', status: 'APPROVED', amount_in_cents: 10_000_000 } },
    signature: { properties: ['transaction.id', 'transaction.status', 'transaction.amount_in_cents'], checksum: '' },
    timestamp: 1_700_000_000,
  }
  const cadena = `tx-1APPROVED10000000${evento.timestamp}${secreto}`
  evento.signature.checksum = await sha256Hex(cadena)
  assert.equal(await validarFirmaEventoWompi(evento, secreto), true)

  const alterado = { ...evento, data: { transaction: { ...evento.data.transaction, status: 'DECLINED' } } }
  assert.equal(await validarFirmaEventoWompi(alterado, secreto), false)
  assert.equal(await validarFirmaEventoWompi(evento, ''), false)
  assert.equal(await validarFirmaEventoWompi({ ...evento, timestamp: undefined }, secreto), false)
})

test('conversión de montos a centavos y formato COP', () => {
  assert.equal(aCentavos(100_000), 10_000_000)
  assert.equal(aCentavos('100.000,50'), 10_000_050)
  assert.equal(aCentavos(-1), 0)
  assert.equal(formatoCop(10_000_000), '$100.000')
})
