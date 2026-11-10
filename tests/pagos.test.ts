import test from 'node:test'
import assert from 'node:assert/strict'
import {
  METODOS, METODOS_HABILITADOS, METODOS_PAGO, PAGOS_REALES_HABILITADOS, esMetodoPago,
  estadoPagoInicial, etiquetaEstadoPago, metodoDiferido, metodoHabilitado, metodoPagoInfo,
  puedeElegirMetodoPago, resumenPagoTecnico, validarSeleccionMetodo,
} from '../src/lib/pagos.ts'

test('los 8 métodos están visibles, con Daviplata agregado', () => {
  assert.deepEqual([...METODOS_PAGO], [
    'tarjeta_credito', 'tarjeta_debito', 'google_pay',
    'nequi', 'bancolombia', 'daviplata', 'bre_b', 'efectivo',
  ])
  for (const id of METODOS_PAGO) {
    assert.equal(esMetodoPago(id), true, id)
    assert.ok(metodoPagoInfo(id), `sin datos de presentación para ${id}`)
  }
  assert.equal(METODOS.length, METODOS_PAGO.length)
})

test('solo Nequi, Bancolombia, Daviplata y efectivo están habilitados', () => {
  assert.deepEqual([...METODOS_HABILITADOS], ['nequi', 'bancolombia', 'daviplata', 'efectivo'])
  for (const id of METODOS_HABILITADOS) {
    assert.equal(metodoHabilitado(id), true, id)
    assert.equal(metodoDiferido(id), false, id)
  }
  for (const id of ['tarjeta_credito', 'tarjeta_debito', 'google_pay', 'bre_b'] as const) {
    assert.equal(metodoHabilitado(id), false, id)
    assert.equal(metodoDiferido(id), true, id)
  }
  // Valores nulos/desconocidos no se consideran habilitados.
  assert.equal(metodoHabilitado(null), false)
  assert.equal(metodoHabilitado('bitcoin'), false)
  assert.equal(metodoDiferido(null), false)
  assert.equal(metodoDiferido('bitcoin'), false)
})

test('esMetodoPago rechaza valores desconocidos', () => {
  assert.equal(esMetodoPago('bitcoin'), false)
  assert.equal(esMetodoPago(''), false)
  assert.equal(esMetodoPago(null), false)
  assert.equal(esMetodoPago(123), false)
})

test('pagos reales diferidos: no se crean cobros automáticos', () => {
  assert.equal(PAGOS_REALES_HABILITADOS, false)
  assert.equal(estadoPagoInicial('efectivo'), 'efectivo')
  for (const id of ['tarjeta_credito', 'tarjeta_debito', 'google_pay', 'nequi', 'bancolombia', 'daviplata', 'bre_b'] as const) {
    assert.equal(estadoPagoInicial(id), 'pendiente', id)
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

test('validarSeleccionMetodo devuelve errores claros y bloquea PRONTO', () => {
  assert.equal(validarSeleccionMetodo('bitcoin', 'completada'), 'Selecciona un método de pago válido.')
  assert.match(validarSeleccionMetodo('nequi', 'aceptada') ?? '', /completado/i)
  assert.equal(validarSeleccionMetodo('nequi', 'completada', 'pagado'), 'Este servicio ya está pagado.')
  assert.equal(validarSeleccionMetodo('nequi', 'completada', 'cancelado'), 'El pago de este servicio fue cancelado.')
  assert.equal(validarSeleccionMetodo('nequi', 'completada', 'pendiente'), null)
  assert.equal(validarSeleccionMetodo('bancolombia', 'completada'), null)
  assert.equal(validarSeleccionMetodo('daviplata', 'completada'), null)
  assert.equal(validarSeleccionMetodo('efectivo', 'completada'), null)
  for (const id of ['tarjeta_credito', 'tarjeta_debito', 'google_pay', 'bre_b'] as const) {
    const err = validarSeleccionMetodo(id, 'completada', 'pendiente') ?? ''
    assert.match(err, /no está disponible/i, id)
    assert.match(err, /Nequi, Bancolombia, Daviplata o efectivo/i, id)
  }
})

test('Nequi / Bancolombia / Daviplata / efectivo piden los datos al técnico, no inventan una cuenta', () => {
  for (const id of METODOS_HABILITADOS) {
    const info = metodoPagoInfo(id)
    assert.ok(info)
    assert.match(info.instruccionCliente, /técnico/i)
    assert.equal(info.cobroAutomatico, false)
    assert.equal(info.requierePasarela, false)
  }
})

test('los métodos PRONTO explican que deben usar Nequi, Bancolombia, Daviplata o efectivo', () => {
  for (const id of ['tarjeta_credito', 'tarjeta_debito', 'google_pay', 'bre_b'] as const) {
    const info = metodoPagoInfo(id)
    assert.ok(info)
    assert.match(info.instruccionCliente, /Nequi, Bancolombia, Daviplata o efectivo/i, id)
    assert.match(info.instruccionTecnico, /Nequi, Bancolombia, Daviplata o efectivo/i, id)
  }
})

test('etiquetas de estado y resumen para el técnico', () => {
  assert.equal(etiquetaEstadoPago('pendiente_pasarela'), 'Pago en línea pendiente')
  assert.equal(etiquetaEstadoPago('pagado'), 'Pagado')
  assert.equal(etiquetaEstadoPago('desconocido'), 'Pendiente de pago')
  assert.equal(resumenPagoTecnico(null, null), 'El cliente aún no ha elegido método de pago.')
  assert.equal(resumenPagoTecnico('daviplata', 'pendiente'), 'Daviplata · Pendiente de pago')
  assert.equal(resumenPagoTecnico('efectivo', 'efectivo'), 'Efectivo · Pago en efectivo')
})
