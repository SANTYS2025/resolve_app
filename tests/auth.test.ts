import test from 'node:test'
import assert from 'node:assert/strict'
import {
  esEnlaceRecuperacion,
  MAX_PASSWORD,
  mensajeErrorRecuperacion,
  validarCorreoRecuperacion,
  validarNuevaPassword,
} from '../src/lib/auth.ts'

test('valida el correo de recuperación', () => {
  assert.equal(validarCorreoRecuperacion('ana@resolve.co'), null)
  assert.ok(validarCorreoRecuperacion(''))
  assert.ok(validarCorreoRecuperacion('ana@resolve'))
  assert.ok(validarCorreoRecuperacion('ana resolve.co'))
})

test('valida la nueva contraseña y su confirmación', () => {
  assert.equal(validarNuevaPassword('segura123', 'segura123'), null)
  assert.ok(validarNuevaPassword('corta', 'corta'))
  assert.ok(validarNuevaPassword('segura123', 'distinta1'))
  assert.ok(validarNuevaPassword(' '.repeat(10), ' '.repeat(10)))
  assert.ok(validarNuevaPassword('a'.repeat(MAX_PASSWORD + 1), 'a'.repeat(MAX_PASSWORD + 1)))
})

test('traduce errores comunes de Supabase Auth', () => {
  assert.match(mensajeErrorRecuperacion({ message: 'Email rate limit exceeded' }), /Demasiados intentos/)
  assert.match(mensajeErrorRecuperacion({ message: 'User not found' }), /No encontramos/)
  assert.match(mensajeErrorRecuperacion({ message: 'Token has expired or is invalid' }), /venció/)
  assert.match(mensajeErrorRecuperacion({ message: 'Failed to fetch' }), /Sin conexión/)
  assert.match(mensajeErrorRecuperacion(new Error('otra cosa')), /otra cosa/)
})

test('detecta el enlace de recuperación en hash o query', () => {
  assert.equal(esEnlaceRecuperacion('#access_token=x&type=recovery', ''), true)
  assert.equal(esEnlaceRecuperacion('', '?type=recovery&code=1'), true)
  assert.equal(esEnlaceRecuperacion('#error_code=otp_expired', ''), true)
  assert.equal(esEnlaceRecuperacion('#access_token=x&type=signup', ''), false)
})
