import test from 'node:test'
import assert from 'node:assert/strict'
import {
  METODOS, METODOS_PAGO, PAGOS_REALES_HABILITADOS, esMetodoPago, estadoPagoInicial,
  etiquetaEstadoPago, metodoDiferido, metodoPagoInfo, puedeElegirMetodoPago,
  resumenPagoTecnico, validarSeleccionMetodo,
} from '../src/lib/pagos.ts'

test('los 7 métodos del pedido están registrados', () => {
  assert.deepEqual([...METODOS_PAGO], [
    'tarjeta_credito', 'tarjeta_debito', 'google_pay',
    'nequi', 'bancolombia', 'bre_b', 'efectivo',
  ])
  for (const id of METODOS_PAGO) {
    assert.equal(esMetodoPago(id), true, id)
    assert.ok(metodoPagoInfo(id), `sin datos de presentación para ${id}`)
  }
  assert.equal(METODOS.length, METODOS_PAGO.length)
})

test('esMetodoPago rechaza valores desconocidos', () => {
  assert.equal(esMetodoPago('bitcoin'), false)
  assert.equal(esMetodoPago(''), false)
  assert.equal(esMetodoPago(null), false)
  assert.equal(esMetodoPago(123), false)
})

test('pagos reales diferidos: tarjeta/Google Pay no quedan en pasarela', () => {
  assert.equal(PAGOS_REALES_HABILITADOS, false)
  assert.equal(estadoPagoInicial('efectivo'), 'efectivo')
  assert.equal(estadoPagoInicial('tarjeta_credito'), 'pendiente')
  assert.equal(estadoPagoInicial('tarjeta_debito'), 'pendiente')
  assert.equal(estadoPagoInicial('google_pay'), 'pendiente')
  assert.equal(estadoPagoInicial('nequi'), 'pendiente')
  assert.equal(estadoPagoInicial('bancolombia'), 'pendiente')
  assert.equal(estadoPagoInicial('bre_b'), 'pendiente')
  for (const id of ['tarjeta_credito', 'tarjeta_debito', 'google_pay'] as const) {
    assert.equal(metodoDiferido(id), true, id)
  }
  for (const id of ['efectivo', 'nequi', 'bancolombia', 'bre_b'] as const) {
    assert.equal(metodoDiferido(id), false, id)
  }
})

test('solo se elige método con la solicitud completada y sin pagar', () => {
  assert.equal(puedeElegirMetodoPago('completada', 'pendiente'), true)
  assert.equal(puedeElegirMetodoPago('completada', null), true)
  assert.equal(puedeElegirMetodoPago('completada', 'pagado'), false)
  assert.equal(puedeElegirMetodoPago('completada', 'cancelado'), false)
  assert.equal(puedeElegirMetodoPago('aceptada', 'pendiente'), false)
  assert.equal(puedeElegirMetodoPago('pendiente', 'pendiente'), false)
})

test('validarSeleccionMetodo devuelve errores claros', () => {
  assert.equal(validarSeleccionMetodo('bitcoin', 'completada'), 'Selecciona un método de pago válido.')
  assert.match(validarSeleccionMetodo('efectivo', 'aceptada') ?? '', /completado/i)
  assert.equal(validarSeleccionMetodo('nequi', 'completada', 'pagado'), 'Este servicio ya está pagado.')
  assert.equal(validarSeleccionMetodo('nequi', 'completada', 'cancelado'), 'El pago de este servicio fue cancelado.')
  assert.equal(validarSeleccionMetodo('nequi', 'completada', 'pendiente'), null)
  assert.equal(validarSeleccionMetodo('efectivo', 'completada'), null)
  assert.match(validarSeleccionMetodo('tarjeta_credito', 'completada', 'pendiente') ?? '', /pagos reales/i)
  assert.match(validarSeleccionMetodo('google_pay', 'completada', 'pendiente') ?? '', /pagos reales/i)
})

test('Nequi / Bancolombia / Bre-B le piden los datos al técnico, no inventan una cuenta', () => {
  for (const id of ['nequi', 'bancolombia', 'bre_b'] as const) {
    const info = metodoPagoInfo(id)
    assert.ok(info)
    assert.match(info.instruccionCliente, /técnico/i)
    assert.equal(info.cobroAutomatico, false)
  }
  assert.match(metodoPagoInfo('efectivo')?.instruccionCliente ?? '', /efectivo/i)
})

test('etiquetas de estado y resumen para el técnico', () => {
  assert.equal(etiquetaEstadoPago('pendiente_pasarela'), 'Pago en línea pendiente')
  assert.equal(etiquetaEstadoPago('pagado'), 'Pagado')
  assert.equal(etiquetaEstadoPago('desconocido'), 'Pendiente de pago')
  assert.equal(resumenPagoTecnico(null, null), 'El cliente aún no ha elegido método de pago.')
  assert.equal(resumenPagoTecnico('efectivo', 'efectivo'), 'Efectivo · Pago en efectivo')
})
