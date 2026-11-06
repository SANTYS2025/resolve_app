import test from 'node:test'
import assert from 'node:assert/strict'
import {
  estaDisponibleAhora, normalizarHora, resumenAgenda, validarAgenda, validarFranja,
} from '../src/lib/disponibilidad.ts'

const franja = (dia: number, ini: string, fin: string) => ({ dia_semana: dia, hora_inicio: ini, hora_fin: fin })

test('normaliza horas y rechaza valores inválidos', () => {
  assert.equal(normalizarHora('7:5'), '07:05')
  assert.equal(normalizarHora('08:30:00'), '08:30')
  assert.equal(normalizarHora('24:00'), null)
  assert.equal(normalizarHora('12:60'), null)
  assert.equal(normalizarHora('abc'), null)
})

test('valida una franja: fin posterior e inicio y duración mínima', () => {
  assert.equal(validarFranja(franja(1, '08:00', '12:00')), null)
  assert.match(validarFranja(franja(1, '12:00', '08:00')) ?? '', /posterior/i)
  assert.match(validarFranja(franja(1, '08:00', '08:15')) ?? '', /30 minutos/i)
  assert.match(validarFranja(franja(9, '08:00', '12:00')) ?? '', /día/i)
})

test('la agenda no permite franjas solapadas el mismo día', () => {
  assert.equal(validarAgenda([franja(1, '08:00', '12:00'), franja(1, '12:00', '18:00')]), null)
  assert.match(validarAgenda([franja(1, '08:00', '12:00'), franja(1, '11:00', '14:00')]) ?? '', /solapan/i)
  assert.match(validarAgenda([]) ?? '', /al menos una/i)
  // El mismo horario en días distintos sí es válido.
  assert.equal(validarAgenda([franja(1, '08:00', '12:00'), franja(2, '08:00', '12:00')]), null)
})

test('disponibilidad ahora respeta día, hora y bloqueos', () => {
  const lunes10 = new Date('2026-10-26T10:00:00') // lunes
  assert.equal(lunes10.getDay(), 1)
  const agenda = [franja(1, '08:00', '12:00')]
  assert.equal(estaDisponibleAhora(agenda, lunes10), true)
  assert.equal(estaDisponibleAhora(agenda, new Date('2026-10-26T13:00:00')), false)
  assert.equal(estaDisponibleAhora(agenda, new Date('2026-10-27T10:00:00')), false)
  assert.equal(estaDisponibleAhora(agenda, lunes10, [{ fecha: '2026-10-26' }]), false)
})

test('resumen legible de la agenda', () => {
  const txt = resumenAgenda([franja(2, '14:00', '18:00'), franja(1, '08:00', '12:00')])
  assert.equal(txt, 'Lun 08:00–12:00 · Mar 14:00–18:00')
})
