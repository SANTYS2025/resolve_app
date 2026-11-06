import test from 'node:test'
import assert from 'node:assert/strict'
import { calcularComision } from '../src/lib/pagosCore.ts'
import { resumenGanancias, resumenGastos } from '../src/lib/ganancias.ts'

const tx = (estado: string, monto: number, creadoEn: string, reembolsado = 0) => {
  const c = calcularComision(monto)
  return {
    estado, montoCentavos: monto, comisionCentavos: c.comisionCentavos,
    netoCentavos: c.netoCentavos, reembolsadoCentavos: reembolsado, creadoEn,
  }
}

test('solo las transacciones aprobadas cuentan como ingreso', () => {
  const r = resumenGanancias([
    tx('aprobada', 10_000_000, '2026-10-01T10:00:00Z'),
    tx('declinada', 10_000_000, '2026-10-02T10:00:00Z'),
    tx('pendiente', 10_000_000, '2026-10-03T10:00:00Z'),
  ])
  assert.equal(r.servicios, 1)
  assert.equal(r.brutoCentavos, 10_000_000)
  assert.equal(r.comisionCentavos, 1_000_000)
  assert.equal(r.netoCentavos, 9_000_000)
  assert.equal(r.ticketPromedioCentavos, 10_000_000)
})

test('reembolso total deja el neto en cero', () => {
  const r = resumenGanancias([tx('reembolsada', 10_000_000, '2026-10-01T10:00:00Z', 10_000_000)])
  assert.equal(r.brutoCentavos, 0)
  assert.equal(r.comisionCentavos, 0)
  assert.equal(r.netoCentavos, 0)
  assert.equal(r.reembolsosCentavos, 10_000_000)
})

test('reembolso parcial descuenta bruto, comisión y neto en proporción', () => {
  const r = resumenGanancias([tx('reembolso_parcial', 10_000_000, '2026-10-01T10:00:00Z', 4_000_000)])
  assert.equal(r.brutoCentavos, 6_000_000)
  assert.equal(r.comisionCentavos, 600_000)
  assert.equal(r.netoCentavos, 5_400_000)
})

test('filtra por rango de fechas y agrupa por mes', () => {
  const r = resumenGanancias([
    tx('aprobada', 10_000_000, '2026-09-15T10:00:00Z'),
    tx('aprobada', 20_000_000, '2026-10-01T10:00:00Z'),
    tx('aprobada', 30_000_000, '2026-10-20T10:00:00Z'),
  ])
  assert.equal(r.servicios, 3)
  assert.equal(r.porMes.length, 2)
  assert.equal(r.porMes[1].servicios, 2)
  assert.equal(r.porMes[1].brutoCentavos, 50_000_000)

  const octubre = resumenGanancias(
    [
      tx('aprobada', 20_000_000, '2026-10-01T10:00:00Z'),
      tx('aprobada', 30_000_000, '2026-11-01T10:00:00Z'),
    ],
    '2026-10-01',
    '2026-10-31',
  )
  assert.equal(octubre.servicios, 1)
})

test('gastos del cliente descuentan reembolsos', () => {
  const r = resumenGastos([
    tx('aprobada', 10_000_000, '2026-10-01T10:00:00Z'),
    tx('reembolso_parcial', 10_000_000, '2026-10-02T10:00:00Z', 4_000_000),
    tx('declinada', 10_000_000, '2026-10-03T10:00:00Z'),
  ])
  assert.equal(r.servicios, 2)
  assert.equal(r.totalCentavos, 16_000_000)
  assert.equal(r.reembolsosCentavos, 4_000_000)
})
