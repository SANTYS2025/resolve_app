/**
 * Geolocalización multiplataforma.
 *
 *  · Web: `navigator.geolocation` SOLO en contextos seguros (HTTPS o
 *    localhost). En un origen inseguro el navegador lanza el error técnico
 *    "Only secure origins are allowed"; aquí se intercepta y se convierte en
 *    un mensaje accionable en español, sin mostrarlo en la interfaz.
 *  · App nativa (Capacitor): plugin oficial `@capacitor/geolocation`, que pide
 *    los permisos del sistema (ACCESS_FINE_LOCATION / ACCESS_COARSE_LOCATION)
 *    y funciona sin depender del origen web.
 *
 * Regla de oro: la ubicación se pide solo por una acción del usuario o al
 * iniciar el seguimiento de un servicio; nunca al abrir una pantalla.
 */

import { Capacitor } from '@capacitor/core'
import { Geolocation } from '@capacitor/geolocation'

export type Coordenadas = { latitud: number; longitud: number; precision?: number | null }

/** Posición normalizada que entregan tanto el navegador como Capacitor. */
export type Posicion = {
  coords: { latitude: number; longitude: number; accuracy: number | null }
}

export type ObservadorUbicacion = (pos: Posicion) => void

const SIN_UBICACION = 'No pudimos obtener tu ubicación. Inténtalo nuevamente o ingresa tu dirección manualmente.'
const SIN_PERMISO = 'Necesitamos tu autorización para acceder a tu ubicación. Actívala en los ajustes del teléfono o ingresa tu dirección manualmente.'
const SIN_CONTEXTO = 'La ubicación automática solo funciona en la app o en una conexión segura (HTTPS). Escribe tu dirección manualmente.'
const SERVICIO_APAGADO = 'Activa la ubicación del teléfono e inténtalo de nuevo. También puedes escribir tu dirección manualmente.'

/** ¿Estamos dentro del APK (Capacitor) o en un navegador? */
export function esNativo(): boolean {
  try { return Capacitor.isNativePlatform() } catch { return false }
}

export function hayGeolocalizacionWeb(): boolean {
  return typeof navigator !== 'undefined' && !!navigator.geolocation
}

/** HTTPS, localhost o app nativa. Evita el error "Only secure origins". */
export function contextoSeguro(): boolean {
  if (esNativo()) return true
  if (typeof window === 'undefined') return false
  if (window.isSecureContext) return true
  const host = window.location?.hostname ?? ''
  return host === 'localhost' || host === '127.0.0.1' || host === '::1'
}

/** La app puede intentar ubicar al usuario sin lanzar errores técnicos. */
export function ubicacionDisponible(): boolean {
  return esNativo() || (hayGeolocalizacionWeb() && contextoSeguro())
}

/** Traduce el error del navegador a un mensaje accionable en español. */
export function mensajeGeolocalizacion(error: { code?: number; message?: string } | null | undefined): string {
  switch (error?.code) {
    case 1:
      return SIN_PERMISO
    case 2:
      return SIN_UBICACION
    case 3:
      return 'No pudimos obtener tu ubicación a tiempo. Inténtalo nuevamente o ingresa tu dirección manualmente.'
    default: {
      const m = String(error?.message ?? '')
      if (/only secure origins|secure origins/i.test(m)) return SIN_CONTEXTO
      return SIN_UBICACION
    }
  }
}

/**
 * Mensaje legible para cualquier fallo del flujo de ubicación.
 * Nunca devuelve el texto técnico del navegador/plugin.
 */
export function mensajeUbicacion(error: unknown): string {
  const m = typeof error === 'object' && error !== null && 'message' in error
    ? String((error as { message: unknown }).message || '')
    : (typeof error === 'string' ? error : '')

  if (!m) return 'No pudimos usar tu ubicación. Escribe la dirección manualmente.'
  if (/only secure origins|secure origins/i.test(m)) return SIN_CONTEXTO
  if (/denied|denegad|permission|permiso/i.test(m)) return SIN_PERMISO
  if (/location services|servicios de ubicaci|not enabled|unavailable|no disponible/i.test(m)) return SERVICIO_APAGADO
  return m
}

function aCoordenadas(lat: number, lng: number, accuracy: number | null): Coordenadas {
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    throw new Error(SIN_UBICACION)
  }
  return { latitud: lat, longitud: lng, precision: Number.isFinite(accuracy) ? accuracy : null }
}

async function asegurarPermisoNativo(): Promise<void> {
  const estado = await Geolocation.checkPermissions()
  if (estado.location === 'granted') return
  const pedido = await Geolocation.requestPermissions()
  if (pedido.location !== 'granted') throw new Error(SIN_PERMISO)
}

/** Pide la ubicación al sistema. Debe llamarse únicamente desde un toque del usuario. */
export async function obtenerUbicacionActual(): Promise<Coordenadas> {
  if (esNativo()) {
    try {
      await asegurarPermisoNativo()
      const pos = await Geolocation.getCurrentPosition({
        enableHighAccuracy: true,
        timeout: 20_000,
        maximumAge: 60_000,
      })
      return aCoordenadas(pos.coords.latitude, pos.coords.longitude, pos.coords.accuracy ?? null)
    } catch (e) {
      throw new Error(mensajeUbicacion(e))
    }
  }

  if (!hayGeolocalizacionWeb() || !contextoSeguro()) {
    throw new Error(SIN_CONTEXTO)
  }

  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(
      pos => {
        try {
          resolve(aCoordenadas(
            pos.coords.latitude,
            pos.coords.longitude,
            Number.isFinite(pos.coords.accuracy) ? pos.coords.accuracy : null,
          ))
        } catch (e) {
          reject(e)
        }
      },
      err => reject(new Error(mensajeGeolocalizacion(err))),
      { enableHighAccuracy: true, timeout: 20_000, maximumAge: 60_000 },
    )
  })
}

/**
 * Observa la ubicación mientras el servicio está activo.
 * Devuelve la función para dejar de observar; no lanza: informa por `onError`.
 */
export function observarUbicacion(onPosicion: ObservadorUbicacion, onError: (mensaje: string) => void): () => void {
  if (esNativo()) {
    let cancelado = false
    let watchId: string | null = null

    void (async () => {
      try {
        await asegurarPermisoNativo()
        if (cancelado) return
        watchId = await Geolocation.watchPosition(
          { enableHighAccuracy: true, maximumAge: 5_000, timeout: 20_000 },
          (pos, err) => {
            if (cancelado) return
            if (err) { onError(mensajeUbicacion(err)); return }
            if (!pos) return
            onPosicion({
              coords: {
                latitude: pos.coords.latitude,
                longitude: pos.coords.longitude,
                accuracy: pos.coords.accuracy ?? null,
              },
            })
          },
        )
      } catch (e) {
        if (!cancelado) onError(mensajeUbicacion(e))
      }
    })()

    return () => {
      cancelado = true
      if (watchId) void Geolocation.clearWatch({ id: watchId })
    }
  }

  if (!hayGeolocalizacionWeb() || !contextoSeguro()) {
    onError(SIN_CONTEXTO)
    return () => {}
  }

  const id = navigator.geolocation.watchPosition(
    pos => onPosicion({
      coords: {
        latitude: pos.coords.latitude,
        longitude: pos.coords.longitude,
        accuracy: Number.isFinite(pos.coords.accuracy) ? pos.coords.accuracy : null,
      },
    }),
    err => onError(mensajeGeolocalizacion(err)),
    { enableHighAccuracy: true, maximumAge: 5_000, timeout: 20_000 },
  )

  return () => navigator.geolocation.clearWatch(id)
}
