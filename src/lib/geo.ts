/**
 * GPS, distancia y tiempo estimado de llegada (ETA) — lógica pura.
 *
 * Decisión de producto para la pérdida de señal:
 *  · Si la última posición tiene menos de 90 s, la ETA es "confiable".
 *  · Entre 90 s y 5 min, se muestra la última ETA conocida como "aproximada"
 *    y se avisa que la señal está débil.
 *  · A partir de 5 min se oculta la ETA numérica: se muestra la última
 *    ubicación conocida y "Sin señal". NUNCA se inventa una ETA con datos viejos.
 */

export type Punto = { lat: number; lng: number }

export const RADIO_TIERRA_KM = 6371
export const VELOCIDAD_URBANA_KMH = 22
export const FACTOR_RUTA = 1.35
export const BUFFER_MINUTOS = 3
export const SENAL_RECIENTE_MS = 90_000
export const SENAL_DEBIL_MS = 5 * 60_000

export function puntoValido(p: Partial<Punto> | null | undefined): p is Punto {
  return !!p && Number.isFinite(p.lat) && Number.isFinite(p.lng)
    && Math.abs(p.lat!) <= 90 && Math.abs(p.lng!) <= 180
}

function aRadianes(g: number) { return (g * Math.PI) / 180 }

/** Distancia en línea recta (Haversine) en kilómetros. */
export function distanciaKm(a: Punto, b: Punto): number {
  if (!puntoValido(a) || !puntoValido(b)) return 0
  const dLat = aRadianes(b.lat - a.lat)
  const dLng = aRadianes(b.lng - a.lng)
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(aRadianes(a.lat)) * Math.cos(aRadianes(b.lat)) * Math.sin(dLng / 2) ** 2
  return 2 * RADIO_TIERRA_KM * Math.asin(Math.min(1, Math.sqrt(h)))
}

export type Eta = {
  minutos: number | null
  distanciaKm: number
  /** `true` si se usó una posición reciente; `false` si la ETA es aproximada o nula. */
  confiable: boolean
  motivo: string
}

/**
 * Calcula la ETA con la última posición del técnico.
 * `factorRuta` convierte distancia en línea recta a recorrido urbano aproximado.
 */
export function calcularEta(
  origen: Punto,
  destino: Punto,
  opciones: { velocidadKmh?: number; factorRuta?: number; bufferMin?: number } = {},
): Eta {
  if (!puntoValido(origen) || !puntoValido(destino)) {
    return { minutos: null, distanciaKm: 0, confiable: false, motivo: 'Ubicación no disponible.' }
  }
  const velocidad = Math.max(5, opciones.velocidadKmh ?? VELOCIDAD_URBANA_KMH)
  const factor = Math.max(1, opciones.factorRuta ?? FACTOR_RUTA)
  const buffer = Math.max(0, opciones.bufferMin ?? BUFFER_MINUTOS)
  const recta = distanciaKm(origen, destino)
  const recorrido = recta * factor
  const minutos = Math.max(1, Math.ceil((recorrido / velocidad) * 60 + buffer))
  return {
    minutos,
    distanciaKm: Math.round(recorrido * 10) / 10,
    confiable: true,
    motivo: '',
  }
}

export type EstadoSenal = 'sin_datos' | 'reciente' | 'debil' | 'sin_senal'

export type Senal = {
  estado: EstadoSenal
  minutosSinSenal: number
  /** `true` solo cuando la posición permite confiar en la ETA. */
  confiable: boolean
  mensaje: string
}

/** Evalúa la frescura de la última posición reportada por el técnico. */
export function evaluarSenal(
  actualizadoEn: string | number | Date | null | undefined,
  ahora: number = Date.now(),
): Senal {
  if (actualizadoEn == null) {
    return { estado: 'sin_datos', minutosSinSenal: 0, confiable: false, mensaje: 'Aún no tenemos la ubicación del técnico.' }
  }
  const t = actualizadoEn instanceof Date ? actualizadoEn.getTime() : new Date(actualizadoEn).getTime()
  if (!Number.isFinite(t)) {
    return { estado: 'sin_datos', minutosSinSenal: 0, confiable: false, mensaje: 'Aún no tenemos la ubicación del técnico.' }
  }
  const ms = Math.max(0, ahora - t)
  const minutos = Math.floor(ms / 60_000)
  if (ms <= SENAL_RECIENTE_MS) {
    return { estado: 'reciente', minutosSinSenal: 0, confiable: true, mensaje: 'Ubicación en vivo.' }
  }
  if (ms <= SENAL_DEBIL_MS) {
    return {
      estado: 'debil', minutosSinSenal: minutos, confiable: false,
      mensaje: `Señal débil. Última ubicación hace ${minutos || 1} min; la llegada es aproximada.`,
    }
  }
  return {
    estado: 'sin_senal', minutosSinSenal: minutos, confiable: false,
    mensaje: `Sin señal del técnico desde hace ${minutos} min. Te mostramos su última ubicación conocida.`,
  }
}

/**
 * ETA que se muestra al cliente. Si la señal está perdida, devuelve `minutos: null`
 * y conserva la distancia de la última posición para dar contexto.
 */
export function etaParaCliente(
  origen: Punto | null,
  destino: Punto | null,
  actualizadoEn: string | number | Date | null | undefined,
  ahora: number = Date.now(),
): Eta & { senal: Senal } {
  const senal = evaluarSenal(actualizadoEn, ahora)
  if (!puntoValido(origen) || !puntoValido(destino)) {
    return { minutos: null, distanciaKm: 0, confiable: false, motivo: 'Ubicación no disponible.', senal }
  }
  if (senal.estado === 'sin_senal') {
    return {
      minutos: null,
      distanciaKm: Math.round(distanciaKm(origen, destino) * FACTOR_RUTA * 10) / 10,
      confiable: false,
      motivo: senal.mensaje,
      senal,
    }
  }
  const eta = calcularEta(origen, destino)
  return {
    ...eta,
    confiable: eta.confiable && senal.confiable,
    motivo: senal.estado === 'debil' ? senal.mensaje : '',
    senal,
  }
}

/** Texto corto para la tarjeta de seguimiento. */
export function etiquetaEta(eta: Eta): string {
  if (eta.minutos == null) return 'ETA no disponible'
  return eta.minutos <= 1 ? 'Llega en menos de 1 min' : `Llega en ~${eta.minutos} min`
}

/** Enlace a Google Maps con la posición del técnico (para abrir la app nativa). */
export function urlUbicacionTecnico(p: Punto): string {
  return `https://www.google.com/maps/search/?api=1&query=${p.lat},${p.lng}`
}
