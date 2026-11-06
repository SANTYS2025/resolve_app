/**
 * Bandeja, preferencias y tokens push (capa Supabase).
 * La decisión de SI enviar vive en el servidor; aquí solo se guarda la elección
 * del usuario y se lee su bandeja.
 */

import { useEffect, useState } from 'react'
import { supabase } from './supabase'
import { useData } from './api'
import { normalizarPreferencias, type PreferenciasNotificacion, type TipoNotificacion } from './notificaciones'

export type Notificacion = {
  id: number
  tipo: TipoNotificacion
  titulo: string
  cuerpo: string
  solicitudId: number | null
  leida: boolean
  creadaEn: string
}

type Fila = {
  id: number; tipo: TipoNotificacion; titulo: string; cuerpo: string
  solicitud_id: number | null; leida: boolean; creada_en: string
}

export async function getPreferencias(): Promise<PreferenciasNotificacion> {
  const { data, error } = await supabase.rpc('mis_preferencias_notificacion')
  if (error) throw error
  const fila = Array.isArray(data) ? data[0] : data
  return normalizarPreferencias(fila as Partial<PreferenciasNotificacion> | null)
}

export async function guardarPreferencias(p: PreferenciasNotificacion): Promise<void> {
  const { error } = await supabase.rpc('guardar_preferencias_notificacion', {
    p_push_activo: p.push_activo,
    p_mensajes: p.mensajes,
    p_estados_servicio: p.estados_servicio,
    p_pagos: p.pagos,
    p_promociones: p.promociones,
  })
  if (error) throw error
}

export async function getNotificaciones(): Promise<Notificacion[]> {
  const { data, error } = await supabase
    .from('notificaciones')
    .select('id,tipo,titulo,cuerpo,solicitud_id,leida,creada_en')
    .order('creada_en', { ascending: false })
    .limit(100)
  if (error) throw error
  return ((data ?? []) as unknown as Fila[]).map(n => ({
    id: n.id, tipo: n.tipo, titulo: n.titulo, cuerpo: n.cuerpo,
    solicitudId: n.solicitud_id, leida: n.leida, creadaEn: n.creada_en,
  }))
}

export async function marcarNotificacionLeida(id: number): Promise<void> {
  const { error } = await supabase.rpc('marcar_notificacion_leida', { p_id: id })
  if (error) throw error
}

export async function marcarTodasLeidas(): Promise<void> {
  const { error } = await supabase.rpc('marcar_todas_leidas')
  if (error) throw error
}

export async function registrarDispositivoPush(token: string, plataforma: 'android' | 'ios' | 'web'): Promise<void> {
  const { error } = await supabase.rpc('registrar_dispositivo_push', {
    p_token: token,
    p_plataforma: plataforma,
  })
  if (error) throw error
}

export async function desactivarDispositivoPush(token: string): Promise<void> {
  const { error } = await supabase.rpc('desactivar_dispositivo_push', { p_token: token })
  if (error) throw error
}

/** Bandeja en vivo: Realtime para el badge y recarga al volver a la app. */
export function useNotificacionesEnVivo(usuarioId: string | null) {
  const [version, setVersion] = useState(0)
  const datos = useData(
    () => (usuarioId ? getNotificaciones() : Promise.resolve([] as Notificacion[])),
    [usuarioId, version],
    [] as Notificacion[],
  )

  useEffect(() => {
    if (!usuarioId) return
    let alive = true
    const canal = supabase
      .channel(`notificaciones-${usuarioId}`)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'notificaciones', filter: `usuario_id=eq.${usuarioId}` },
        () => { if (alive) setVersion(v => v + 1) })
      .subscribe()
    const alVolver = () => { if (!document.hidden && alive) setVersion(v => v + 1) }
    document.addEventListener('visibilitychange', alVolver)
    return () => {
      alive = false
      document.removeEventListener('visibilitychange', alVolver)
      supabase.removeChannel(canal)
    }
  }, [usuarioId])

  const noLeidas = datos.data.filter(n => !n.leida).length
  return { ...datos, noLeidas, refrescar: () => setVersion(v => v + 1) }
}
