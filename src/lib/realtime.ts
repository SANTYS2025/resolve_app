import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from './supabase'
import { getMiTecnicoId, getMensajes, useData } from './api'
import type { MensajeSolicitud, Perfil } from './api'

/**
 * Tiempo real de solicitudes (Supabase Realtime → postgres_changes).
 *
 *  · Técnico: escucha las solicitudes asignadas a él (tecnico_id) → ve llegar las nuevas sin recargar.
 *  · Cliente: escucha SUS solicitudes (cliente_id) → se entera al instante cuando el técnico
 *    acepta, rechaza o completa.
 *
 * Seguridad: Realtime aplica las políticas RLS de `solicitudes`; el filtro solo reduce tráfico.
 * Requiere haber corrido supabase/migrations/20261020_solicitud_eventos.sql (publicación + replica identity).
 */

export type Aviso = { id: number; texto: string; solicitudId: number }
/** Último cambio de estado visto por Realtime (sirve para disparar la calificación al cliente). */
export type UltimoCambio = { id: number; estado: string; anterior: string | null; ts: number }

type Fila = { id: number; estado: string; nombre_contacto?: string; diagnostico?: string | null }

// Qué estados le interesan a cada rol. Se omiten los que causó el propio usuario
// (p. ej. el cliente que cancela no necesita un aviso de "cancelada").
const AVISO_CLIENTE: Record<string, string> = {
  aceptada: '✅ El técnico aceptó tu solicitud. Confirma si deseas el servicio',
  en_espera: '⏳ El técnico aceptó tu solicitud, pero está ocupado con otro servicio. Quedó en espera y se activará cuando termine.',
  confirmada_en_espera: '✅ Confirmaste el servicio en espera. Se activará cuando el técnico termine el servicio actual.',
  en_camino: '🛵 El técnico va en camino a tu domicilio',
  llego: '📍 El técnico llegó a tu domicilio',
  rechazada: 'Tu solicitud fue rechazada',
  completada: '🎉 El servicio terminó. Califica al técnico',
}

/** Aviso exacto cuando una solicitud en cola pasa a ser el servicio actual. */
const TEXTO_ACTIVACION = '¡Ahora la solicitud actual eres tú! El técnico ha terminado su servicio anterior y ahora continuará con tu solicitud. Te atenderá lo más pronto posible.'

const POLL_MS = 30_000 // respaldo si el canal se cae; Realtime es la vía principal

export function useSolicitudesEnVivo(perfil: Perfil | null) {
  /** Sube cada vez que algo cambió → las pantallas lo usan como dependencia para recargar. */
  const [version, setVersion] = useState(0)
  const [aviso, setAviso] = useState<Aviso | null>(null)
  const [ultimoCambio, setUltimoCambio] = useState<UltimoCambio | null>(null)
  const [pendientes, setPendientes] = useState(0) // cambios no vistos, para el badge del menú
  const [conectado, setConectado] = useState(true)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const yaConecto = useRef(false)
  // Último estado conocido por solicitud: evita depender de payload.old cuando
  // REPLICA IDENTITY no está en FULL.
  const estadosVistos = useRef<Map<number, string>>(new Map())

  const refrescar = useCallback(() => setVersion(v => v + 1), [])
  const limpiarPendientes = useCallback(() => setPendientes(0), [])
  const cerrarAviso = useCallback(() => setAviso(null), [])

  const notificar = useCallback((texto: string, solicitudId: number) => {
    setAviso({ id: Date.now(), texto, solicitudId })
    setPendientes(n => n + 1)
    navigator.vibrate?.(120) // Android; iOS Safari lo ignora
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setAviso(null), 6000)
  }, [])

  const uid = perfil?.id
  const rol = perfil?.rol

  // Al cambiar de sesión no debe quedar un aviso viejo pendiente de navegar.
  useEffect(() => { setUltimoCambio(null); estadosVistos.current.clear() }, [uid, rol])

  useEffect(() => {
    if (!uid || (rol !== 'cliente' && rol !== 'tecnico')) return
    let alive = true
    let canal: ReturnType<typeof supabase.channel> | null = null
    yaConecto.current = false

    ;(async () => {
      // El técnico filtra por su id de técnico (no por el id de usuario)
      let filtro: string
      if (rol === 'tecnico') {
        const tid = await getMiTecnicoId(uid).catch(() => null)
        if (!tid || !alive) return
        filtro = `tecnico_id=eq.${tid}`
      } else {
        filtro = `cliente_id=eq.${uid}`
      }

      canal = supabase
        .channel(`solicitudes-${rol}-${uid}`)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'solicitudes', filter: filtro }, payload => {
          if (!alive) return
          const nueva = payload.new as Fila
          const previa = payload.old as Partial<Fila>
          refrescar()

          if (payload.eventType !== 'DELETE') {
            const anterior = previa.estado ?? estadosVistos.current.get(nueva.id) ?? null
            estadosVistos.current.set(nueva.id, nueva.estado)
            if (payload.eventType === 'UPDATE' && anterior !== nueva.estado) {
              setUltimoCambio({ id: nueva.id, estado: nueva.estado, anterior: anterior ?? null, ts: Date.now() })
            }

            if (rol === 'tecnico') {
              if (payload.eventType === 'INSERT') {
                notificar(`🔔 Nueva solicitud de ${nueva.nombre_contacto ?? 'un cliente'}`, nueva.id)
              } else if (payload.eventType === 'UPDATE' && nueva.estado === 'cancelada' && anterior !== 'cancelada') {
                notificar('El cliente canceló una solicitud', nueva.id)
              } else if (payload.eventType === 'UPDATE' && nueva.estado === 'confirmada' && anterior !== 'confirmada') {
                notificar('✅ El cliente confirmó el servicio. Ya puedes ir al domicilio', nueva.id)
              } else if (payload.eventType === 'UPDATE' && nueva.estado === 'confirmada_en_espera' && anterior !== 'confirmada_en_espera') {
                notificar('✅ El cliente confirmó el servicio en espera. Se activará cuando termines el actual', nueva.id)
              }
            } else if (payload.eventType === 'UPDATE' && anterior !== nueva.estado) {
              const seActivo = (nueva.estado === 'aceptada' || nueva.estado === 'confirmada')
                && (anterior === 'en_espera' || anterior === 'confirmada_en_espera')
              const texto = seActivo ? TEXTO_ACTIVACION : AVISO_CLIENTE[nueva.estado]
              if (texto) notificar(texto, nueva.id)
            }
          }

          if (rol !== 'tecnico' && payload.eventType === 'UPDATE' && nueva.diagnostico && previa.diagnostico !== nueva.diagnostico) {
            notificar('🩺 El técnico registró el diagnóstico de tu solicitud', nueva.id)
          }
        })
        .subscribe(status => {
          if (!alive) return
          const ok = status === 'SUBSCRIBED'
          setConectado(ok)
          // Al RE-conectar pudimos perder eventos: recargamos una vez para ponernos al día.
          if (ok && yaConecto.current) refrescar()
          if (ok) yaConecto.current = true
        })
    })()

    // Al volver a la app (cambio de pestaña / desbloquear el teléfono) se pone al día
    const alVolver = () => { if (!document.hidden) refrescar() }
    document.addEventListener('visibilitychange', alVolver)
    window.addEventListener('online', refrescar)

    return () => {
      alive = false
      clearTimeout(timer.current)
      document.removeEventListener('visibilitychange', alVolver)
      window.removeEventListener('online', refrescar)
      if (canal) supabase.removeChannel(canal)
    }
  }, [uid, rol, notificar, refrescar])

  // Respaldo: solo mientras el canal NO está conectado y la app está visible
  useEffect(() => {
    if (conectado || !uid) return
    const t = setInterval(() => { if (!document.hidden) refrescar() }, POLL_MS)
    return () => clearInterval(t)
  }, [conectado, uid, refrescar])

  return { version, aviso, ultimoCambio, pendientes, conectado, cerrarAviso, limpiarPendientes }
}

/**
 * Mensajes del chat de UNA solicitud, en vivo.
 *
 * RLS de `solicitud_mensajes` limita los mensajes a los dos participantes; el
 * filtro del canal solo evita tráfico de otras solicitudes. Requiere haber
 * corrido supabase/migrations/20261101_chat_pagos_cuenta_bancaria.sql.
 */
export function useMensajesEnVivo(solicitudId: number) {
  const [version, setVersion] = useState(0)
  const [conectado, setConectado] = useState(true)
  const datos = useData(
    () => getMensajes(solicitudId),
    [solicitudId, version],
    [] as MensajeSolicitud[],
  )

  useEffect(() => {
    let alive = true
    const canal = supabase
      .channel(`mensajes-solicitud-${solicitudId}`)
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'solicitud_mensajes', filter: `solicitud_id=eq.${solicitudId}` },
        () => { if (alive) setVersion(v => v + 1) })
      .subscribe(status => { if (alive) setConectado(status === 'SUBSCRIBED') })

    return () => {
      alive = false
      supabase.removeChannel(canal)
    }
  }, [solicitudId])

  return { ...datos, version, conectado, refrescar: () => setVersion(v => v + 1) }
}
