import test from 'node:test'
import assert from 'node:assert/strict'
import {
  enlaceReferido,
  generarCodigoReferido,
  normalizarCodigoReferido,
  recompensaReferido,
  RECOMPENSA_REFERIDO_COP,
  validarCodigoReferido,
} from '../src/lib/referidos.ts'

test('normaliza y valida códigos de referido', () => {
  assert.equal(normalizarCodigoReferido('  an-123 '), 'AN123')
  assert.equal(validarCodigoReferido('ABC12'), null)
  assert.ok(validarCodigoReferido(''))
  assert.ok(validarCodigoReferido('ABC'))
})

test('genera códigos legibles sin acentos ni símbolos', () => {
  const c = generarCodigoReferido('José Núñez', 'ab-1234')
  assert.match(c, /^[A-Z0-9]+$/)
  assert.ok(c.startsWith('JOSENU'))
  assert.ok(c.endsWith('1234'))
  assert.ok(c.length <= 16)
})

test('la recompensa es informativa y usa la constante', () => {
  const r = recompensaReferido()
  assert.equal(r.referidorCop, RECOMPENSA_REFERIDO_COP)
  assert.equal(r.referidoCop, RECOMPENSA_REFERIDO_COP)
  assert.match(r.descripcion, /primer servicio pagado/)
})

test('el enlace de referido codifica el código', () => {
  assert.equal(enlaceReferido('ana 12'), 'https://resolvepasto.co/?ref=ANA12')
  assert.equal(enlaceReferido('x', 'https://resolve.co/'), 'https://resolve.co/?ref=X')
})
