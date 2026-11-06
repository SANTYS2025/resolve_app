import test from 'node:test'
import assert from 'node:assert/strict'
import { calcularEta, distanciaKm, etaParaCliente, etiquetaEta, evaluarSenal, puntoValido } from '../src/lib/geo.ts'

// Pasto, Nariño (aprox.)
const CENTRO = { lat: 1.2136, lng: -77.2811 }
const NORTE = { lat: 1.2300, lng: -77.2811 }

test('distancia Haversine es razonable y simétrica', () => {
  const d = distanciaKm(CENTRO, NORTE)
  assert.ok(d > 1.5 && d < 2.5, `distancia inesperada: ${d}`)
  assert.equal(Math.round(distanciaKm(CENTRO, NORTE) * 1000), Math.round(distanciaKm(NORTE, CENTRO) * 1000))
  assert.equal(distanciaKm(CENTRO, CENTRO), 0)
})

test('puntoValido rechaza coordenadas imposibles', () => {
  assert.equal(puntoValido(CENTRO), true)
  assert.equal(puntoValido({ lat: 91, lng: 0 }), false)
  assert.equal(puntoValido({ lat: 0, lng: 181 }), false)
  assert.equal(puntoValido(null), false)
})

test('ETA usa distancia de ruta y un buffer, nunca menos de 1 minuto', () => {
  const eta = calcularEta(CENTRO, NORTE, { velocidadKmh: 20, factorRuta: 1.4, bufferMin: 3 })
  assert.ok(eta.minutos && eta.minutos >= 3)
  assert.ok(eta.distanciaKm > 2)
  assert.equal(eta.confiable, true)
  const mismo = calcularEta(CENTRO, CENTRO)
  assert.equal(mismo.minutos, 3) // solo queda el buffer de 3 min
  assert.equal(mismo.distanciaKm, 0)
})

test('señal reciente, débil y perdida', () => {
  const ahora = Date.now()
  assert.equal(evaluarSenal(ahora - 10_000, ahora).estado, 'reciente')
  assert.equal(evaluarSenal(ahora - 10_000, ahora).confiable, true)

  const debil = evaluarSenal(ahora - 2 * 60_000, ahora)
  assert.equal(debil.estado, 'debil')
  assert.equal(debil.confiable, false)
  assert.match(debil.mensaje, /señal débil/i)

  const perdida = evaluarSenal(ahora - 10 * 60_000, ahora)
  assert.equal(perdida.estado, 'sin_senal')
  assert.match(perdida.mensaje, /sin señal/i)
})

test('si se pierde la señal NO se inventa una ETA', () => {
  const ahora = Date.now()
  const eta = etaParaCliente(CENTRO, NORTE, ahora - 10 * 60_000, ahora)
  assert.equal(eta.minutos, null)
  assert.equal(eta.confiable, false)
  assert.equal(eta.senal.estado, 'sin_senal')
  assert.match(eta.motivo, /sin señal/i)
  assert.equal(etiquetaEta(eta), 'ETA no disponible')
})

test('con señal débil se conserva la ETA pero marcada como aproximada', () => {
  const ahora = Date.now()
  const eta = etaParaCliente(CENTRO, NORTE, ahora - 2 * 60_000, ahora)
  assert.ok(eta.minutos && eta.minutos > 0)
  assert.equal(eta.confiable, false)
  assert.equal(eta.senal.estado, 'debil')
})

test('sin datos de ubicación se informa claramente', () => {
  const eta = etaParaCliente(null, NORTE, null)
  assert.equal(eta.minutos, null)
  assert.equal(eta.senal.estado, 'sin_datos')
})
