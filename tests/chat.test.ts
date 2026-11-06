import test from 'node:test'
import assert from 'node:assert/strict'
import { evaluarAccesoChat, mostrarBotonChat, resumenMensaje, validarMensaje } from '../src/lib/chat.ts'

test('aceptada: el participante puede leer y escribir', () => {
  const a = evaluarAccesoChat('aceptada')
  assert.equal(a.puedeVer, true)
  assert.equal(a.puedeEscribir, true)
  assert.equal(a.motivo, '')
})

test('completada: el historial queda visible pero en solo lectura', () => {
  const a = evaluarAccesoChat('completada')
  assert.equal(a.puedeVer, true)
  assert.equal(a.puedeEscribir, false)
  assert.match(a.motivo, /solo lectura/i)
})

test('pendiente: no hay acceso al chat', () => {
  const a = evaluarAccesoChat('pendiente')
  assert.equal(a.puedeVer, false)
  assert.equal(a.puedeEscribir, false)
})

test('cancelada: conserva el historial solo si ya había mensajes', () => {
  const conMensajes = evaluarAccesoChat('cancelada', true)
  assert.equal(conMensajes.puedeVer, true)
  assert.equal(conMensajes.puedeEscribir, false)

  const sinMensajes = evaluarAccesoChat('cancelada', false)
  assert.equal(sinMensajes.puedeVer, false)
  assert.equal(sinMensajes.puedeEscribir, false)
})

test('mostrarBotonChat: solo en estados donde el chat existe o existió', () => {
  for (const estado of ['aceptada', 'confirmada', 'en_camino', 'llego', 'en_proceso', 'completada', 'cancelada']) {
    assert.equal(mostrarBotonChat(estado), true, estado)
  }
  for (const estado of ['pendiente', 'rechazada', 'expirada']) {
    assert.equal(mostrarBotonChat(estado), false, estado)
  }
})

test('los estados activos del flujo nuevo permiten escribir en el chat', () => {
  for (const estado of ['aceptada', 'confirmada', 'en_camino', 'en_proceso', 'llego']) {
    const a = evaluarAccesoChat(estado)
    assert.equal(a.puedeVer, true, estado)
    assert.equal(a.puedeEscribir, true, estado)
  }
})

test('validarMensaje: rechaza vacío y textos demasiado largos', () => {
  assert.equal(validarMensaje('  '), 'Escribe un mensaje.')
  assert.equal(validarMensaje('a'.repeat(1001)), 'El mensaje no puede superar 1000 caracteres.')
  assert.equal(validarMensaje('  Hola, voy en camino  '), null)
})

test('resumenMensaje: recorta y limpia espacios', () => {
  assert.equal(resumenMensaje('  Hola   mundo  '), 'Hola mundo')
  assert.equal(resumenMensaje('a'.repeat(80), 10), 'aaaaaaaaa…')
})
