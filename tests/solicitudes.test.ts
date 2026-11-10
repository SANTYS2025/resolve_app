import test from 'node:test'
import assert from 'node:assert/strict'
import {
  ESTADOS_ACTIVOS_TECNICO, accionDelTecnico, clientePuedeCancelar, confirmadaEnEspera,
  disponibilidadTecnico, enHistorial, esEnEspera, esFinalizada, esperaConfirmacionCliente,
  estaVigente, filtrarSolicitudes, llegadaRegistrada, ordenarEnEspera,
  puedeAceptarSolicitud, puedeFinalizarSolicitud, progresoCliente,
} from '../src/lib/solicitudes.ts'

/** Solicitud mínima para probar las listas, la disponibilidad y la cola. */
type P = { id: number; estado: string; enEsperaDesde?: string | null }
const p = (id: number, estado: string, enEsperaDesde: string | null = null): P => ({ id, estado, enEsperaDesde })

test('vigente vs finalizada: son excluyentes (incluye la cola)', () => {
  for (const estado of ['pendiente', 'aceptada', 'confirmada', 'en_camino', 'en_proceso', 'llego', 'en_espera', 'confirmada_en_espera']) {
    assert.equal(estaVigente(estado), true, estado)
    assert.equal(esFinalizada(estado), false, estado)
    assert.equal(enHistorial(estado), false, estado)
  }
  for (const estado of ['completada', 'cancelada', 'rechazada', 'expirada']) {
    assert.equal(estaVigente(estado), false, estado)
    assert.equal(esFinalizada(estado), true, estado)
    assert.equal(enHistorial(estado), true, estado)
  }
})

test('una solicitud terminada sale de vigentes y aparece solo en el historial', () => {
  const pedidos = [p(1, 'pendiente'), p(2, 'aceptada'), p(3, 'completada'), p(4, 'cancelada'), p(5, 'en_espera')]

  const vigentes = filtrarSolicitudes(pedidos, 'vigentes')
  assert.deepEqual(vigentes.map(x => x.id), [1, 2, 5])
  assert.equal(vigentes.some(x => x.estado === 'completada'), false)

  const historial = filtrarSolicitudes(pedidos, 'historial')
  assert.deepEqual(historial.map(x => x.id), [3, 4])
})

test('flujo completo: aceptar → confirmar → en camino → llegó → terminada', () => {
  const estados = ['pendiente', 'aceptada', 'confirmada', 'en_camino', 'llego', 'completada'] as const

  assert.equal(accionDelTecnico('pendiente'), null)
  assert.equal(accionDelTecnico('aceptada'), null)
  assert.equal(esperaConfirmacionCliente('aceptada'), true)
  assert.equal(esperaConfirmacionCliente('confirmada'), false)
  assert.equal(accionDelTecnico('confirmada'), 'navegar')
  assert.equal(accionDelTecnico('en_camino'), 'llegar')
  assert.equal(accionDelTecnico('llego'), 'completar')
  // Compatibilidad con solicitudes viejas en proceso.
  assert.equal(accionDelTecnico('en_proceso'), 'completar')
  assert.equal(accionDelTecnico('completada'), null)

  const antes = [p(9, 'llego')]
  assert.equal(filtrarSolicitudes(antes, 'vigentes').length, 1)
  assert.equal(filtrarSolicitudes(antes, 'historial').length, 0)
  const despues = [p(9, 'completada')]
  assert.equal(filtrarSolicitudes(despues, 'vigentes').length, 0)
  assert.deepEqual(filtrarSolicitudes(despues, 'historial').map(x => x.id), [9])

  assert.deepEqual(estados.map(accionDelTecnico), [null, null, 'navegar', 'llegar', 'completar', null])
})

test('cola: en_espera no es servicio actual y espera el turno', () => {
  assert.equal(esEnEspera('en_espera'), true)
  assert.equal(esEnEspera('confirmada_en_espera'), true)
  assert.equal(esEnEspera('aceptada'), false)
  assert.equal(confirmadaEnEspera('confirmada_en_espera'), true)
  assert.equal(confirmadaEnEspera('en_espera'), false)

  // Sigue en la lista de vigentes, pero NO cuenta como servicio activo.
  assert.equal(estaVigente('en_espera'), true)
  assert.equal((ESTADOS_ACTIVOS_TECNICO as readonly string[]).includes('en_espera'), false)

  // El cliente confirma incluso estando en espera.
  assert.equal(esperaConfirmacionCliente('en_espera'), true)
  assert.equal(esperaConfirmacionCliente('confirmada_en_espera'), false)

  // Mientras espera, no hay acciones de seguimiento ni desplazamiento.
  assert.equal(accionDelTecnico('en_espera'), null)
  assert.equal(accionDelTecnico('confirmada_en_espera'), null)

  const prog = progresoCliente('en_espera')
  assert.equal(prog.aceptado, true)
  assert.equal(prog.enEspera, true)
  assert.equal(prog.enCamino, false)
  assert.equal(prog.llego, false)
})

test('cola: se respeta el orden de aceptación (en_espera_desde y luego id)', () => {
  const cola = [
    p(30, 'en_espera', '2026-11-11T10:05:00Z'),
    p(10, 'en_espera', '2026-11-11T10:01:00Z'),
    p(20, 'confirmada_en_espera', '2026-11-11T10:03:00Z'),
    p(40, 'en_espera', null),
    p(5, 'en_espera', null),
  ]
  assert.deepEqual(ordenarEnEspera(cola).map(x => x.id), [10, 20, 30, 5, 40])
})

test('la llegada se registra una sola vez y queda confirmada en la interfaz', () => {
  assert.equal(llegadaRegistrada('en_camino'), false)
  assert.equal(llegadaRegistrada('llego'), true)
  assert.equal(llegadaRegistrada('completada'), true)
  assert.equal(accionDelTecnico('llego'), 'completar')
})

test('finalizar exige haber llegado y confirmado el pago', () => {
  assert.equal(puedeFinalizarSolicitud('llego', false), false)
  assert.equal(puedeFinalizarSolicitud('en_proceso', false), false)
  assert.equal(puedeFinalizarSolicitud('llego', true), true)
  assert.equal(puedeFinalizarSolicitud('en_proceso', true), true)
  for (const estado of ['pendiente', 'aceptada', 'confirmada', 'en_camino', 'completada', 'cancelada', 'en_espera', 'confirmada_en_espera']) {
    assert.equal(puedeFinalizarSolicitud(estado, true), false, estado)
  }
})

test('el cliente ve la secuencia exacta de tres pasos', () => {
  assert.deepEqual(progresoCliente('aceptada'), { aceptado: true, enEspera: false, enCamino: false, llego: false })
  assert.deepEqual(progresoCliente('en_camino'), { aceptado: true, enEspera: false, enCamino: true, llego: false })
  assert.deepEqual(progresoCliente('llego'), { aceptado: true, enEspera: false, enCamino: true, llego: true })
  assert.deepEqual(progresoCliente('pendiente'), { aceptado: false, enEspera: false, enCamino: false, llego: false })
})

test('disponibilidad: solo un servicio activo ocupa al técnico', () => {
  assert.equal(disponibilidadTecnico([]).estado, 'disponible')
  // Pendientes, en espera y cerradas NO lo ocupan.
  assert.equal(disponibilidadTecnico([
    p(1, 'pendiente'), p(2, 'en_espera'), p(3, 'confirmada_en_espera'),
    p(4, 'completada'), p(5, 'rechazada'), p(6, 'cancelada'), p(7, 'expirada'),
  ]).estado, 'disponible')

  const ocupado = disponibilidadTecnico([p(1, 'pendiente'), p(2, 'en_camino')])
  assert.equal(ocupado.estado, 'ocupado')
  assert.equal(ocupado.estado === 'ocupado' && ocupado.solicitud.id, 2)
})

test('ocupado puede aceptar: la nueva queda en espera, nunca se bloquea', () => {
  const pedidos = [p(1, 'aceptada'), p(2, 'pendiente')]

  const nueva = puedeAceptarSolicitud(pedidos, 2)
  assert.equal(nueva.puede, true)
  assert.equal(nueva.enEspera, true)
  assert.match(nueva.motivo, /ocupado con la solicitud #1/i)
  assert.match(nueva.motivo, /espera/i)

  // La que ya está atendiendo no se bloquea a sí misma.
  const actual = puedeAceptarSolicitud(pedidos, 1)
  assert.equal(actual.puede, true)
  assert.equal(actual.enEspera, false)

  // Sin servicio activo puede aceptar sin cola.
  const libre = puedeAceptarSolicitud([p(3, 'pendiente')], 3)
  assert.equal(libre.puede, true)
  assert.equal(libre.enEspera, false)
})

test('el cliente puede cancelar antes de que el técnico salga, incluso en espera', () => {
  assert.equal(clientePuedeCancelar('pendiente'), true)
  assert.equal(clientePuedeCancelar('aceptada'), true)
  assert.equal(clientePuedeCancelar('en_espera'), true)
  assert.equal(clientePuedeCancelar('confirmada_en_espera'), true)
  for (const estado of ['confirmada', 'en_camino', 'llego', 'completada', 'cancelada']) {
    assert.equal(clientePuedeCancelar(estado), false, estado)
  }
})
