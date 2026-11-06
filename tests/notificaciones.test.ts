import test from 'node:test'
import assert from 'node:assert/strict'
import {
  contenidoEstado,
  contenidoMensaje,
  debeNotificar,
  etiquetaTipoNotificacion,
  normalizarPreferencias,
  PREFERENCIAS_DEFECTO,
  validarTokenPush,
} from '../src/lib/notificaciones.ts'

test('las preferencias por defecto permiten mensajes y bloquean promociones', () => {
  assert.equal(debeNotificar(null, 'mensaje'), true)
  assert.equal(debeNotificar(undefined, 'promocion'), false)
  assert.equal(debeNotificar(PREFERENCIAS_DEFECTO, 'pago'), true)
})

test('desactivar mensajes no afecta alertas del sistema', () => {
  const prefs = normalizarPreferencias({ mensajes: false })
  assert.equal(debeNotificar(prefs, 'mensaje'), false)
  assert.equal(debeNotificar(prefs, 'sistema'), true)
})

test('push desactivado bloquea todos los tipos', () => {
  const prefs = { push_activo: false }
  assert.equal(debeNotificar(prefs, 'mensaje'), false)
  assert.equal(debeNotificar(prefs, 'estado_servicio'), false)
  assert.equal(debeNotificar(prefs, 'sistema'), false)
})

test('el token push se valida por longitud', () => {
  assert.ok(validarTokenPush('corto'))
  assert.equal(validarTokenPush('a'.repeat(64)), null)
  assert.ok(validarTokenPush('a'.repeat(5000)))
})

test('el contenido del mensaje no expone todo el texto', () => {
  const c = contenidoMensaje('Ana', 'x'.repeat(200), 42)
  assert.match(c.titulo, /Ana/)
  assert.ok(c.cuerpo.length < 120)
  assert.match(c.cuerpo, /#42/)
  assert.equal(c.tipo, 'mensaje')
})

test('el contenido de estado es legible y tiene respaldo', () => {
  assert.match(contenidoEstado('en_camino', 7).cuerpo, /en camino/i)
  assert.match(contenidoEstado('estado_raro', 7).cuerpo, /estado_raro/)
  assert.equal(etiquetaTipoNotificacion('pago'), 'Pago')
  assert.equal(etiquetaTipoNotificacion('desconocido'), 'Aviso')
})
