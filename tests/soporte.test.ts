import test from 'node:test'
import assert from 'node:assert/strict'
import { buscarFaq, CATEGORIAS_TICKET, nombreCategoria, validarTicket } from '../src/lib/soporte.ts'

test('la búsqueda de ayuda filtra por texto y categoría', () => {
  assert.ok(buscarFaq('reembolso').length >= 1)
  const pagos = buscarFaq('', 'pago')
  assert.ok(pagos.length >= 2)
  assert.ok(pagos.every(f => f.categoria === 'pago'))
  assert.equal(buscarFaq('zzzz-no-existe').length, 0)
})

test('el formulario de soporte exige categoría, asunto y descripción', () => {
  const valido = {
    categoria: 'pago' as const,
    asunto: 'No se aplicó mi reembolso',
    descripcion: 'Pagué con tarjeta y el reembolso no aparece en mi historial.',
  }
  assert.equal(validarTicket(valido), null)
  assert.ok(validarTicket({ ...valido, categoria: 'otra' as never }))
  assert.ok(validarTicket({ ...valido, asunto: 'Hola' }))
  assert.ok(validarTicket({ ...valido, descripcion: 'Muy corto' }))
  assert.ok(validarTicket({ ...valido, descripcion: 'x'.repeat(2001) }))
})

test('todas las categorías tienen nombre legible', () => {
  for (const c of CATEGORIAS_TICKET) {
    assert.equal(nombreCategoria(c.id), c.nombre)
  }
  assert.equal(nombreCategoria('inexistente'), 'Otro')
})
