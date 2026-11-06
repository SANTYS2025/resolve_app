import test from 'node:test'
import assert from 'node:assert/strict'
import { motivoRecomendacion, puntuarTecnico, recomendarTecnicos, type CandidatoTecnico } from '../src/lib/recomendacion.ts'

const base: CandidatoTecnico = { id: 1, rating: 4.5, reviews: 10, jobs: 20, priceMin: 50_000 }

test('un técnico mejor calificado y con más reseñas puntúa más', () => {
  const bueno = puntuarTecnico({ ...base, rating: 5, reviews: 30 })
  const regular = puntuarTecnico({ ...base, rating: 3, reviews: 1 })
  assert.ok(bueno.total > regular.total)
  assert.ok(bueno.desglose.calidad > regular.desglose.calidad)
})

test('la cercanía suma y el radio reduce el puntaje', () => {
  const cerca = puntuarTecnico({ ...base, distanciaKm: 1 }, { radioKm: 10 })
  const lejos = puntuarTecnico({ ...base, distanciaKm: 9 }, { radioKm: 10 })
  assert.ok(cerca.desglose.cercania > lejos.desglose.cercania)
  assert.equal(puntuarTecnico({ ...base, disponible: false }).desglose.disponibilidad, 0)
  assert.equal(puntuarTecnico({ ...base, favorito: true }).desglose.favorito, 5)
})

test('recomendar filtra por categoría, disponibilidad y radio', () => {
  const lista: CandidatoTecnico[] = [
    { ...base, id: 1, categoryId: 2, disponible: true, distanciaKm: 3 },
    { ...base, id: 2, categoryId: 2, disponible: false, distanciaKm: 3 },
    { ...base, id: 3, categoryId: 2, disponible: true, distanciaKm: 40 },
    { ...base, id: 4, categoryId: 9, disponible: true, distanciaKm: 2 },
  ]
  const r = recomendarTecnicos(lista, { categoriaId: 2, soloDisponibles: true, radioKm: 10 })
  assert.deepEqual(r.map(t => t.id), [1])
})

test('el orden prioriza favoritos y disponibilidad ante empate de calidad', () => {
  const lista: CandidatoTecnico[] = [
    { ...base, id: 1, disponible: false },
    { ...base, id: 2, disponible: true },
    { ...base, id: 3, favorito: true, disponible: true },
  ]
  const r = recomendarTecnicos(lista)
  assert.equal(r[0].id, 3)
  assert.equal(r[r.length - 1].id, 1)
})

test('motivo de recomendación es claro y no expone datos sensibles', () => {
  assert.equal(motivoRecomendacion({ ...base, favorito: true }), 'Está en tus favoritos')
  assert.equal(motivoRecomendacion({ ...base, disponible: true }), 'Disponible ahora')
  assert.equal(motivoRecomendacion({ ...base, jobs: 5, verified: true }), 'Técnico verificado')
})
