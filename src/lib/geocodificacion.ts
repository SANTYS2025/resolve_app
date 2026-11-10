/**
 * Ubicación del domicilio para el formulario de solicitud.
 *
 *  · `obtenerUbicacionActual` pide permiso SOLO cuando el usuario toca el botón
 *    "Usar mi ubicación actual" (nunca al abrir la pantalla).
 *  · `geocodificarInversa` convierte esas coordenadas en una dirección legible
 *    con Nominatim (OpenStreetMap). Si el proveedor falla o no hay dirección,
 *    se devuelve un error: la app NUNCA inventa una dirección.
 *  · La dirección resultante queda en un campo editable; el cliente puede
 *    corregirla antes de enviar la solicitud.
 */

export type Coordenadas = { latitud: number; longitud: number; precision?: number | null }

export type DireccionGeocodificada = {
  direccion: string
  barrio: string | null
  ciudad: string | null
}

type NominatimAddress = {
  road?: string
  pedestrian?: string
  residential?: string
  footway?: string
  path?: string
  house_number?: string
  neighbourhood?: string
  suburb?: string
  quarter?: string
  city_district?: string
  city?: string
  town?: string
  village?: string
  municipality?: string
  state?: string
}

type NominatimResponse = {
  display_name?: string
  address?: NominatimAddress
}

const SIN_UBICACION = 'No pudimos obtener tu ubicación. Inténtalo nuevamente o ingresa tu dirección manualmente.'

/** Traduce el error del navegador a un mensaje accionable en español. */
export function mensajeGeolocalizacion(error: { code?: number; message?: string } | null | undefined): string {
  switch (error?.code) {
    case 1:
      return 'Necesitamos tu autorización para acceder a tu ubicación. Actívala en los ajustes del teléfono o ingresa tu dirección manualmente.'
    case 2:
      return 'No pudimos obtener tu ubicación. Inténtalo nuevamente o ingresa tu dirección manualmente.'
    case 3:
      return 'No pudimos obtener tu ubicación a tiempo. Inténtalo nuevamente o ingresa tu dirección manualmente.'
    default:
      return SIN_UBICACION
  }
}

/** Mensaje legible para cualquier fallo del flujo de ubicación. */
export function mensajeUbicacion(error: unknown): string {
  if (error && typeof error === 'object' && 'message' in error) {
    const m = String((error as { message: unknown }).message || '')
    if (m) return m
  }
  if (typeof error === 'string' && error) return error
  return 'No se pudo usar tu ubicación. Escribe la dirección manualmente.'
}

/** Pide la ubicación al sistema. Debe llamarse únicamente desde un toque del usuario. */
export function obtenerUbicacionActual(): Promise<Coordenadas> {
  return new Promise((resolve, reject) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      reject(new Error(SIN_UBICACION))
      return
    }
    navigator.geolocation.getCurrentPosition(
      pos => {
        const latitud = pos.coords.latitude
        const longitud = pos.coords.longitude
        if (!Number.isFinite(latitud) || !Number.isFinite(longitud) || latitud < -90 || latitud > 90 || longitud < -180 || longitud > 180) {
          reject(new Error(SIN_UBICACION))
          return
        }
        const precision = Number.isFinite(pos.coords.accuracy) ? pos.coords.accuracy : null
        resolve({ latitud, longitud, precision })
      },
      err => reject(new Error(mensajeGeolocalizacion(err))),
      { enableHighAccuracy: true, timeout: 20_000, maximumAge: 60_000 },
    )
  })
}

/**
 * Compone una dirección en español a partir de los campos de Nominatim.
 * Devuelve `null` cuando no hay calle ni barrio: mejor pedir la dirección a mano
 * que mostrar un texto genérico que parezca una dirección real.
 */
export function componerDireccion(address: NominatimAddress | null | undefined): DireccionGeocodificada | null {
  if (!address) return null

  const via = address.road || address.pedestrian || address.residential || address.footway || address.path || ''
  const numero = (address.house_number || '').trim()
  const calle = via ? `${via}${numero ? ` # ${numero}` : ''}` : ''
  const barrio = address.neighbourhood || address.suburb || address.quarter || address.city_district || ''
  const ciudad = address.city || address.town || address.village || address.municipality || ''
  const depto = address.state || ''

  const partes = [calle, barrio, ciudad, depto]
    .map(p => p.trim())
    .filter(Boolean)
    .filter((p, i, arr) => arr.findIndex(x => x.toLowerCase() === p.toLowerCase()) === i)

  // Sin vía ni barrio no hay una dirección útil para que llegue el técnico.
  if (!calle && !barrio) return null

  return {
    direccion: partes.join(', '),
    barrio: barrio || null,
    ciudad: ciudad || null,
  }
}

/**
 * Convierte coordenadas en dirección (Nominatim / OpenStreetMap).
 * Lanza un error con mensaje para el usuario si no hay resultado útil.
 */
export async function geocodificarInversa(c: Coordenadas): Promise<DireccionGeocodificada> {
  if (!Number.isFinite(c.latitud) || !Number.isFinite(c.longitud)) {
    throw new Error('Las coordenadas no son válidas. Escribe la dirección manualmente.')
  }

  const url = new URL('https://nominatim.openstreetmap.org/reverse')
  url.searchParams.set('format', 'jsonv2')
  url.searchParams.set('lat', String(c.latitud))
  url.searchParams.set('lon', String(c.longitud))
  url.searchParams.set('zoom', '18')
  url.searchParams.set('addressdetails', '1')
  url.searchParams.set('accept-language', 'es')

  const control = new AbortController()
  const timeout = setTimeout(() => control.abort(), 12_000)
  let json: NominatimResponse
  try {
    const res = await fetch(url.toString(), {
      headers: { Accept: 'application/json' },
      signal: control.signal,
    })
    if (!res.ok) throw new Error('El servicio de direcciones no respondió. Escribe la dirección manualmente.')
    json = await res.json() as NominatimResponse
  } catch (e) {
    if (e instanceof Error && e.name === 'AbortError') {
      throw new Error('El servicio de direcciones tardó demasiado. Escribe la dirección manualmente.')
    }
    if (e instanceof Error && /Failed to fetch|NetworkError|Load failed/i.test(e.message)) {
      throw new Error('No pudimos consultar la dirección. Revisa tu internet o escríbela manualmente.')
    }
    throw e instanceof Error ? e : new Error('No pudimos consultar la dirección. Escríbela manualmente.')
  } finally {
    clearTimeout(timeout)
  }

  const compuesta = componerDireccion(json.address)
  if (!compuesta) {
    throw new Error('Obtuvimos tus coordenadas, pero no pudimos convertirlas en una dirección. Escríbela manualmente.')
  }
  return compuesta
}
