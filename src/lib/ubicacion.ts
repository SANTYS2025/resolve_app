/**
 * GPS y ETA en vivo.
 *
 * - `publicarUbicacion` valida en el servidor que sea el técnico asignado y que
 *   el servicio esté en curso.
 * - `useUbicacionEnVivo` usa UN canal Realtime filtrado por solicitud (no un
 *   canal por técnico ni polling agresivo).
 * - La señal se reevalúa localmente cada 15 s para que la ETA deje de mostrarse
 *   aunque no lleguen más eventos (ver `geo.ts`).
 */

import { useEffect, useRef, useState } from 'react'
import { supabase } from './supabase'
import { errMsg, useData } from './api'
import { etaParaCliente, evaluarSenal, type Eta, type Punto, type Senal } from './geo'

export type Ubicacion = {
  tecnicoId: number
  solicitudId: number | null
  lat: number
  lng: number
  precisionM: number | null
  compartiendo: boolean
  actualizadoEn: string
}

type Fila = {
  tecnico_id: number; solicitud_id: number | null; lat: number; lng: number
  precision_m: number | null; compartiendo: boolean; actualizado_en: string
}

function mapUbicacion(f: Fila): Ubicacion {
  return {
    tecnicoId: f.tecnico_id,
    solicitudId: f.solicitud_id,
    lat: Number(f.lat),
    lng: Number(f.lng),
    precisionM: f.precision_m == null ? null : Number(f.precision_m),
    compartiendo: f.compartiendo,
    actualizadoEn: f.actualizado_en,
  }
}

export async function getUbicacionSolicitud(solicitudId: number): Promise<Ubicacion | null> {
  const { data, error } = await supabase
    .from('ubicaciones_tecnicos')
    .select('tecnico_id,solicitud_id,lat,lng,precision_m,compartiendo,actualizado_en')
    .eq('solicitud_id', solicitudId)
    .eq('compartiendo', true)
    .order('actualizado_en', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw error
  return data ? mapUbicacion(data as unknown as Fila) : null
}

export async function publicarUbicacion(
  solicitudId: number,
  punto: Punto,
  precisionM: number | null = null,
): Promise<void> {
  const { error } = await supabase.rpc('publicar_ubicacion', {
    p_solicitud_id: solicitudId,
    p_lat: punto.lat,
    p_lng: punto.lng,
    p_precision_m: precisionM,
  })
  if (error) throw error
}

export async function detenerUbicacion(solicitudId?: number): Promise<void> {
  const { error } = await supabase.rpc('detener_ubicacion', { p_solicitud_id: solicitudId ?? null })
  if (error) throw error
}

/** Suscripción Realtime a la última posición de una solicitud + ETA con señal. */
export function useUbicacionEnVivo(solicitudId: number | null, destino: Punto | null) {
  const [version, setVersion] = useState(0)
  const [conectado, setConectado] = useState(true)
  const [tick, setTick] = useState(0)

  const datos = useData(
    () => (solicitudId ? getUbicacionSolicitud(solicitudId) : Promise.resolve(null)),
    [solicitudId, version],
    null as Ubicacion | null,
  )

  useEffect(() => {
    if (!solicitudId) return
    let alive = true
    const canal = supabase
      .channel(`ubicacion-solicitud-${solicitudId}`)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'ubicaciones_tecnicos', filter: `solicitud_id=eq.${solicitudId}` },
        () => { if (alive) setVersion(v => v + 1) })
      .subscribe(status => { if (alive) setConectado(status === 'SUBSCRIBED') })
    return () => {
      alive = false
      supabase.removeChannel(canal)
    }
  }, [solicitudId])

  // Reevalúa la frescura de la señal aunque no lleguen eventos.
  useEffect(() => {
    const t = setInterval(() => setTick(v => v + 1), 15_000)
    return () => clearInterval(t)
  }, [])

  const u = datos.data
  const origen: Punto | null = u ? { lat: u.lat, lng: u.lng } : null
  const senal: Senal = evaluarSenal(u?.actualizadoEn ?? null)
  const eta: Eta & { senal: Senal } | null = origen && destino
    ? etaParaCliente(origen, destino, u?.actualizadoEn ?? null)
    : null

  // `tick` participa para que React vuelva a renderizar al reevaluar la señal.
  void tick

  return {
    ubicacion: u,
    origen,
    eta,
    senal,
    conectado,
    loading: datos.loading,
    error: datos.error,
    refrescar: datos.reload,
  }
}

/**
 * Publica la ubicación del técnico mientras `activo` sea true.
 * Se limita a un envío cada 10 s y a movimientos de más de 10 m para no gastar
 * batería ni llenar el canal.
 */
export function usePublicarUbicacion(solicitudId: number | null, activo: boolean) {
  const [publicando, setPublicando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const ultimo = useRef<{ ts: number; lat: number; lng: number } | null>(null)

  useEffect(() => {
    if (!solicitudId || !activo) return
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setError('Este dispositivo no permite compartir la ubicación.')
      return
    }
    let alive = true
    setPublicando(true)
    setError(null)

    const id = navigator.geolocation.watchPosition(
      pos => {
        if (!alive) return
        const ahora = Date.now()
        const p = { lat: pos.coords.latitude, lng: pos.coords.longitude }
        const prev = ultimo.current
        const movido = prev ? Math.abs(prev.lat - p.lat) + Math.abs(prev.lng - p.lng) > 0.0001 : true
        if (prev && (!movido || ahora - prev.ts < 10_000)) return
        ultimo.current = { ts: ahora, ...p }
        publicarUbicacion(solicitudId, p, pos.coords.accuracy ?? null).catch(e => {
          if (alive) setError(errMsg(e))
        })
      },
      e => { if (alive) setError(e.message || 'No se pudo obtener tu ubicación.') },
      { enableHighAccuracy: true, maximumAge: 5_000, timeout: 20_000 },
    )

    return () => {
      alive = false
      navigator.geolocation.clearWatch(id)
      setPublicando(false)
      detenerUbicacion(solicitudId).catch(() => null)
    }
  }, [solicitudId, activo])

  return { publicando, error }
}
