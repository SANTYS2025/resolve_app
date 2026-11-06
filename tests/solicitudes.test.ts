import test from 'node:test'
import assert from 'node:assert/strict'
import {
  accionDelTecnico, clientePuedeCancelar, disponibilidadTecnico, enHistorial, esFinalizada,
  esperaConfirmacionCliente, estaVigente, filtrarSolicitudes, llegadaRegistrada,
  puedeAceptarSolicitud, puedeFinalizarSolicitud, progresoCliente,
} from '../src/lib/solicitudes.ts'

/** Solicitud mínima para probar las listas y la disponibilidad. */
type P = { id: number; estado: string }
const p = (id: number, estado: string): P => ({ id, estado })

test('vigente vs finalizada: son excluyentes', () => {
  for (const estado of ['pendiente', 'aceptada', 'confirmada', 'en_camino', 'en_proceso', 'llego']) {
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
  const pedidos = [p(1, 'pendiente'), p(2, 'aceptada'), p(3, 'completada'), p(4, 'cancelada')]

  const vigentes = filtrarSolicitudes(pedidos, 'vigentes')
  assert.deepEqual(vigentes.map(x => x.id), [1, 2])
  assert.equal(vigentes.some(x => x.estado === 'completada'), false)

  const historial = filtrarSolicitudes(pedidos, 'historial')
  assert.deepEqual(historial.map(x => x.id), [3, 4])
})

test('flujo completo: aceptar → confirmar → en camino → llegó → terminada', () => {
  const estados = ['pendiente', 'aceptada', 'confirmada', 'en_camino', 'llego', 'completada'] as const

  // Antes de aceptar, el técnico no tiene acción de seguimiento.
  assert.equal(accionDelTecnico('pendiente'), null)
  // Aceptada: espera al cliente; todavía no puede salir.
  assert.equal(accionDelTecnico('aceptada'), null)
  assert.equal(esperaConfirmacionCliente('aceptada'), true)

  // Ya confirmada: el link de Google Maps (navegar) es la acción.
  assert.equal(esperaConfirmacionCliente('confirmada'), false)
  assert.equal(accionDelTecnico('confirmada'), 'navegar')
  // Al abrir Maps queda en_camino → marcar llegada.
  assert.equal(accionDelTecnico('en_camino'), 'llegar')
  // Llegó → terminar.
  assert.equal(accionDelTecnico('llego'), 'completar')
  // Compatibilidad con solicitudes viejas en proceso.
  assert.equal(accionDelTecnico('en_proceso'), 'completar')
  // Terminada: ya no hay acciones.
  assert.equal(accionDelTecnico('completada'), null)

  // La lista del técnico la mueve de vigentes a historial en el último paso.
  const antes = [p(9, 'llego')]
  assert.equal(filtrarSolicitudes(antes, 'vigentes').length, 1)
  assert.equal(filtrarSolicitudes(antes, 'historial').length, 0)
  const despues = [p(9, 'completada')]
  assert.equal(filtrarSolicitudes(despues, 'vigentes').length, 0)
  assert.deepEqual(filtrarSolicitudes(despues, 'historial').map(x => x.id), [9])

  assert.deepEqual(estados.map(accionDelTecnico), [null, null, 'navegar', 'llegar', 'completar', null])
})

test('la llegada se registra una sola vez y queda confirmada en la interfaz', () => {
  assert.equal(llegadaRegistrada('en_camino'), false)
  assert.equal(llegadaRegistrada('llego'), true)
  assert.equal(llegadaRegistrada('completada'), true)

  // Después de llegar, la acción del técnico ya no es "llegar" sino cerrar.
  assert.equal(accionDelTecnico('llego'), 'completar')
})

test('finalizar exige haber llegado y confirmado el pago', () => {
  // Sin respuesta al diálogo, el botón no se habilita.
  assert.equal(puedeFinalizarSolicitud('llego', false), false)
  assert.equal(puedeFinalizarSolicitud('en_proceso', false), false)
  // Con "Sí" al pago, sí se puede cerrar.
  assert.equal(puedeFinalizarSolicitud('llego', true), true)
  assert.equal(puedeFinalizarSolicitud('en_proceso', true), true)
  // Estados anteriores o cerrados nunca habilitan el cierre.
  for (const estado of ['pendiente', 'aceptada', 'confirmada', 'en_camino', 'completada', 'cancelada']) {
    assert.equal(puedeFinalizarSolicitud(estado, true), false, estado)
  }
})

test('el cliente ve la secuencia exacta de tres pasos', () => {
  const aceptada = progresoCliente('aceptada')
  assert.deepEqual(aceptada, { aceptado: true, enCamino: false, llego: false })

  const enCamino = progresoCliente('en_camino')
  assert.deepEqual(enCamino, { aceptado: true, enCamino: true, llego: false })

  const llego = progresoCliente('llego')
  assert.deepEqual(llego, { aceptado: true, enCamino: true, llego: true })

  // Antes de aceptar no se muestra el seguimiento.
  assert.deepEqual(progresoCliente('pendiente'), { aceptado: false, enCamino: false, llego: false })
})

test('disponibilidad: sin solicitudes activas el técnico está Disponible', () => {
  assert.equal(disponibilidadTecnico([]).estado, 'disponible')
  // Pendientes y cerradas no lo ocupan.
  assert.equal(disponibilidadTecnico([p(1, 'pendiente'), p(2, 'completada'), p(3, 'rechazada')]).estado, 'disponible')
  // Al terminar el servicio vuelve a estar disponible.
  assert.equal(disponibilidadTecnico([p(1, 'completada'), p(2, 'cancelada')]).estado, 'disponible')

  const ocupado = disponibilidadTecnico([p(1, 'pendiente'), p(2, 'en_camino')])
  assert.equal(ocupado.estado, 'ocupado')
  assert.equal(ocupado.estado === 'ocupado' && ocupado.solicitud.id, 2)
})

test('solicitud nueva mientras está ocupado: se conserva, pero no se puede aceptar', () => {
  const pedidos = [p(1, 'aceptada'), p(2, 'pendiente')]

  const nueva = puedeAceptarSolicitud(pedidos, 2)
  assert.equal(nueva.puede, false)
  assert.match(nueva.motivo, /ocupado con la solicitud #1/i)

  // La que ya está atendiendo no se bloquea a sí misma.
  assert.equal(puedeAceptarSolicitud(pedidos, 1).puede, true)

  // Sin servicio activo puede aceptar cualquiera.
  assert.equal(puedeAceptarSolicitud([p(3, 'pendiente')], 3).puede, true)
})

test('el cliente puede cancelar solo antes de que el técnico salga', () => {
  assert.equal(clientePuedeCancelar('pendiente'), true)
  assert.equal(clientePuedeCancelar('aceptada'), true)
  for (const estado of ['confirmada', 'en_camino', 'llego', 'completada', 'cancelada']) {
    assert.equal(clientePuedeCancelar(estado), false, estado)
  }
})
