/**
 * Recomendación y ordenamiento de técnicos (lógica pura).
 *
 * El puntaje combina lo que el cliente valora y lo que la plataforma necesita:
 * calificación, volumen de reseñas, cercanía, disponibilidad, verificación,
 * trabajos completados y favoritos. No usa datos personales sensibles.
 */

export type CandidatoTecnico = {
  id: number
  rating: number
  reviews: number
  jobs: number
  priceMin: number
  years?: number
  verified?: boolean
  /** Distancia aproximada en km desde el cliente (si se conoce). */
  distanciaKm?: number | null
  /** El barrio del técnico coincide con el del cliente o con la búsqueda. */
  barrioCoincide?: boolean
  /** Está dentro de su horario y sin un servicio activo. */
  disponible?: boolean
  /** El cliente ya lo guardó como favorito. */
  favorito?: boolean
  /** Categoría solicitada; si el técnico no es de esa categoría, baja. */
  categoryId?: number | null
}

export type ContextoRecomendacion = {
  categoriaId?: number | null
  /** Distancia máxima en km para seguir recomendando. */
  radioKm?: number
  soloDisponibles?: boolean
}

export type Puntaje = {
  total: number
  desglose: { calidad: number; cercania: number; disponibilidad: number; confianza: number; precio: number; favorito: number }
}

const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n))

/**
 * Puntaje de 0 a 100. Pesos:
 *  calidad 40 · cercanía 20 · disponibilidad 15 · confianza 15 · precio 5 · favorito 5.
 */
export function puntuarTecnico(t: CandidatoTecnico, ctx: ContextoRecomendacion = {}): Puntaje {
  const rating = clamp(Number.isFinite(t.rating) ? t.rating : 0, 0, 5)
  // Las reseñas dan confianza, pero no infinitamente: 30 reseñas ya es "mucho".
  const volumen = clamp(Math.log10(1 + Math.max(0, t.reviews)) / Math.log10(31), 0, 1)
  const calidad = ((rating / 5) * 0.8 + volumen * 0.2) * 40

  const km = t.distanciaKm
  const cercania = km == null || !Number.isFinite(km)
    ? (t.barrioCoincide ? 20 : 10)
    : clamp(1 - km / Math.max(1, ctx.radioKm ?? 10), 0, 1) * 20

  const disponibilidad = t.disponible === false ? 0 : 15

  const confianza = (t.verified === false ? 0 : 10)
    + clamp(Math.log10(1 + Math.max(0, t.jobs)) / Math.log10(101), 0, 1) * 5

  const precio = t.priceMin <= 0 ? 2.5 : clamp(1 - t.priceMin / 300_000, 0, 1) * 5
  const favorito = t.favorito ? 5 : 0

  return {
    total: Math.round((calidad + cercania + disponibilidad + confianza + precio + favorito) * 10) / 10,
    desglose: {
      calidad: Math.round(calidad * 10) / 10,
      cercania: Math.round(cercania * 10) / 10,
      disponibilidad,
      confianza: Math.round(confianza * 10) / 10,
      precio: Math.round(precio * 10) / 10,
      favorito,
    },
  }
}

/**
 * Filtra y ordena candidatos. `soloDisponibles` y `radioKm` son opcionales:
 * si no hay datos de ubicación, se usan barrio y disponibilidad conocidos.
 */
export function recomendarTecnicos<T extends CandidatoTecnico>(
  candidatos: T[],
  ctx: ContextoRecomendacion = {},
): T[] {
  return candidatos
    .filter(t => {
      if (ctx.categoriaId != null && t.categoryId != null && t.categoryId !== ctx.categoriaId) return false
      if (ctx.soloDisponibles && t.disponible === false) return false
      if (ctx.radioKm != null && t.distanciaKm != null && t.distanciaKm > ctx.radioKm) return false
      return true
    })
    .slice()
    .sort((a, b) => {
      const pa = puntuarTecnico(a, ctx).total
      const pb = puntuarTecnico(b, ctx).total
      if (pb !== pa) return pb - pa
      // Desempate estable: más trabajos, luego mejor rating, luego id.
      if (b.jobs !== a.jobs) return b.jobs - a.jobs
      if (b.rating !== a.rating) return b.rating - a.rating
      return a.id - b.id
    })
}

/** Motivo corto para explicar por qué se recomienda (transparencia para el cliente). */
export function motivoRecomendacion(t: CandidatoTecnico): string {
  if (t.favorito) return 'Está en tus favoritos'
  if (t.disponible && t.distanciaKm != null) return `Disponible a ${t.distanciaKm.toFixed(1)} km`
  if (t.disponible) return 'Disponible ahora'
  if (t.rating >= 4.8 && t.reviews >= 5) return 'Mejor calificado'
  if (t.jobs >= 20) return 'Con amplia experiencia'
  if (t.verified) return 'Técnico verificado'
  return 'Recomendado para ti'
}
