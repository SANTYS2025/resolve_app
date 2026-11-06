import test from 'node:test'
import assert from 'node:assert/strict'
import { etiquetaCupon, normalizarCodigoCupon, validarCupon } from '../src/lib/cupones.ts'

const ahora = new Date('2026-11-15T12:00:00Z')

test('cupón porcentual descuenta sobre el total', () => {
  const r = validarCupon({ codigo: 'PROMO10', tipo: 'porcentaje', valor: 10 }, 100_000, ahora)
  assert.equal(r.valido, true)
  assert.equal(r.descuentoCentavos, 10_000)
  assert.equal(r.totalCentavos, 90_000)
})

test('cupón de monto fijo no deja el total negativo', () => {
  const r = validarCupon({ codigo: 'GRANDE', tipo: 'monto', valor: 50_000 }, 20_000, ahora)
  assert.equal(r.valido, true)
  assert.equal(r.descuentoCentavos, 20_000)
  assert.equal(r.totalCentavos, 0)
})

test('rechaza cupón vencido, inactivo o agotado', () => {
  assert.equal(validarCupon({ codigo: 'X', tipo: 'porcentaje', valor: 10, validoHasta: '2026-11-01' }, 100_000, ahora).valido, false)
  assert.equal(validarCupon({ codigo: 'X', tipo: 'porcentaje', valor: 10, activo: false }, 100_000, ahora).valido, false)
  assert.equal(validarCupon({ codigo: 'X', tipo: 'porcentaje', valor: 10, usosMax: 3, usos: 3 }, 100_000, ahora).valido, false)
  assert.equal(validarCupon(null, 100_000, ahora).valido, false)
})

test('rechaza cupón por debajo del monto mínimo', () => {
  const r = validarCupon({ codigo: 'X', tipo: 'porcentaje', valor: 10, montoMinimoCop: 50_000 }, 30_000, ahora)
  assert.equal(r.valido, false)
  assert.match(r.motivo, /desde/)
})

test('normaliza y etiqueta códigos', () => {
  assert.equal(normalizarCodigoCupon('  promo 10 '), 'PROMO10')
  assert.equal(etiquetaCupon({ codigo: 'A', tipo: 'porcentaje', valor: 15 }), '15 % de descuento')
  assert.match(etiquetaCupon({ codigo: 'B', tipo: 'monto', valor: 20_000 }), /20\.000/)
})
