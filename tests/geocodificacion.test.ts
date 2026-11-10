import test from 'node:test'
import assert from 'node:assert/strict'
import {
  componerDireccion, mensajeGeolocalizacion, mensajeUbicacion,
} from '../src/lib/geocodificacion.ts'

test('compone una dirección en español con vía, barrio y ciudad', () => {
  const d = componerDireccion({
    road: 'Calle 10', house_number: '5-20', neighbourhood: 'Centro',
    city: 'Pasto', state: 'Nariño',
  })
  assert.ok(d)
  assert.equal(d.direccion, 'Calle 10 # 5-20, Centro, Pasto, Nariño')
  assert.equal(d.barrio, 'Centro')
  assert.equal(d.ciudad, 'Pasto')
})

test('usa la vía peatonal o residencial cuando no hay road', () => {
  assert.equal(componerDireccion({ pedestrian: 'Carrera 4', city: 'Pasto' })?.direccion, 'Carrera 4, Pasto')
  assert.equal(componerDireccion({ residential: 'Av. Los Estudiantes', city: 'Pasto' })?.direccion, 'Av. Los Estudiantes, Pasto')
})

test('sin vía usa el barrio; nunca inventa una dirección vacía', () => {
  const d = componerDireccion({ neighbourhood: 'La Aurora', city: 'Pasto', state: 'Nariño' })
  assert.ok(d)
  assert.equal(d.direccion, 'La Aurora, Pasto, Nariño')
  assert.equal(componerDireccion({ neighbourhood: 'La Aurora', city: 'Pasto', state: 'Nariño' })?.barrio, 'La Aurora')

  assert.equal(componerDireccion({}), null)
  assert.equal(componerDireccion(null), null)
  assert.equal(componerDireccion(undefined), null)
  assert.equal(componerDireccion({ city: 'Pasto', state: 'Nariño' }), null)
})

test('no repite partes idénticas de la dirección', () => {
  const d = componerDireccion({ road: 'Pasto', city: 'Pasto', state: 'Nariño' })
  assert.ok(d)
  assert.equal(d.direccion, 'Pasto, Nariño')
})

test('traduce los errores de geolocalización a mensajes accionables', () => {
  assert.match(mensajeGeolocalizacion({ code: 1 }), /Necesitamos tu autorización para acceder a tu ubicación/i)
  assert.match(mensajeGeolocalizacion({ code: 2 }), /No pudimos obtener tu ubicación\. Inténtalo nuevamente/i)
  assert.match(mensajeGeolocalizacion({ code: 3 }), /No pudimos obtener tu ubicación a tiempo\. Inténtalo nuevamente/i)
  assert.match(mensajeGeolocalizacion({ code: 99 }), /No pudimos obtener tu ubicación\. Inténtalo nuevamente/i)
  assert.match(mensajeGeolocalizacion(null), /ingresa tu dirección manualmente/i)
})

test('mensajeUbicacion conserva el mensaje del error y siempre sugiere alternativa', () => {
  assert.equal(mensajeUbicacion(new Error('No pudimos consultar la dirección.')), 'No pudimos consultar la dirección.')
  assert.equal(mensajeUbicacion('Fallo de red'), 'Fallo de red')
  assert.match(mensajeUbicacion(null), /dirección manualmente/i)
  assert.match(mensajeUbicacion(new Error('')), /dirección manualmente/i)})
