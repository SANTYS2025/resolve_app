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

export type Aviso = { id: number; texto: string; solicitudId: number; requiereAccion?: boolean }
/** Último cambio de estado visto por Realtime (sirve para disparar la calificación al cliente). */
export type UltimoCambio = { id: number; estado: string; anterior: string | null; ts: number }

type Fila = { id: number; estado: string; nombre_contacto?: string; diagnostico?: string | null }

// Qué estados le interesan a cada rol. Se omiten los que causó el propio usuario
// (p. ej. el cliente que cancela no necesita un aviso de "cancelada").
const AVISO_CLIENTE: Record<string, string> = {
  aceptada: 'El técnico aceptó tu solicitud. Confirma si deseas el servicio.',
  en_espera: 'El técnico aceptó tu solicitud, pero está ocupado con otro servicio. Quedó en espera y se activará cuando termine.',
  confirmada_en_espera: 'Confirmaste el servicio en espera. Empezará cuando el técnico termine el servicio actual.',
  en_camino: 'El técnico va en camino a tu domicilio.',
  llego: 'El técnico llegó a tu domicilio.',
  rechazada: 'Tu solicitud fue rechazada.',
  completada: 'El servicio terminó. Califica al técnico.',
}

/** Aviso exacto cuando una solicitud en cola pasa a ser el servicio actual. */
const TEXTO_ACTIVACION = 'Tu solicitud se activó: el técnico terminó el servicio anterior y ahora te atenderá.'

const POLL_MS = 30_000 // respaldo si el canal se cae; Realtime es la vía principal

/** Fila mínima de `tecnico_estado` para detectar cambios reales de disponibilidad. */
type EstadoFila = { tecnico_id: number; actualizado_en: string }

export function useSolicitudesEnVivo(perfil: Perfil | null) {
  /** Sube cada vez que algo cambió → las pantallas lo usan como dependencia para recargar. */
  const [version, setVersion] = useState(0)
  const [aviso, setAviso] = useState<Aviso | null>(null)
  const [ultimoCambio, setUltimoCambio] = useState<UltimoCambio | null>(null)
  const [pendientes, setPendientes] = useState(0) // cambios no vistos, para el badge del menú
  const [conectado, setConectado] = useState(true)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const timerEstado = useRef<ReturnType<typeof setTimeout>>(undefined)
  const yaConecto = useRef(false)
  // Último estado conocido por solicitud: evita depender de payload.old cuando
  // REPLICA IDENTITY no está en FULL.
  const estadosVistos = useRef<Map<number, string>>(new Map())
  // Última marca de `actualizado_en` por técnico: el latido normal no cambia esa
  // columna, así que no provoca recargas innecesarias en los clientes.
  const estadosTecnicos = useRef<Map<number, string>>(new Map())

  const refrescar = useCallback(() => setVersion(v => v + 1), [])
  const limpiarPendientes = useCallback(() => setPendientes(0), [])
  const cerrarAviso = useCallback(() => setAviso(null), [])
  /** Agrupa varios avisos de disponibilidad seguidos en una sola recarga. */
  const refrescarPronto = useCallback(() => {
    if (timerEstado.current) return
    timerEstado.current = setTimeout(() => {
      timerEstado.current = undefined
      refrescar()
    }, 800)
  }, [refrescar])

  const notificar = useCallback((texto: string, solicitudId: number, requiereAccion = false) => {
    setAviso({ id: Date.now(), texto, solicitudId, requiereAccion })
    setPendientes(n => n + 1)
    navigator.vibrate?.(120) // Android; iOS Safari lo ignora
    clearTimeout(timer.current)
    if (!requiereAccion) {
      // Autocierre de 3.5 segundos para avisos puramente informativos
      timer.current = setTimeout(() => setAviso(null), 3500)
    }
  }, [])

  const uid = perfil?.id
  const rol = perfil?.rol

  // Al cambiar de sesión no debe quedar un aviso viejo pendiente de navegar.
  useEffect(() => {
    setUltimoCambio(null)
    estadosVistos.current.clear()
    estadosTecnicos.current.clear()
  }, [uid, rol])

  useEffect(() => {
    if (!uid || (rol !== 'cliente' && rol !== 'tecnico')) return
    let alive = true
    let canal: ReturnType<typeof supabase.channel> | null = null
    yaConecto.current = false

    /*
     * Disponibilidad de TODOS los técnicos.
     *
     * `tecnico_estado` tiene lectura pública y está en la publicación de
     * Realtime, así que cualquier cliente recibe el cambio aunque las RLS le
     * oculten las solicitudes de otros. Solo se recarga cuando cambia
     * `actualizado_en` (conexión, desconexión, interruptor o servicio).
     */
    const canalEstado = supabase
      .channel(`tecnico-estado-${uid}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tecnico_estado' }, payload => {
        if (!alive) return
        if (payload.eventType === 'DELETE') { refrescarPronto(); return }
        const fila = payload.new as EstadoFila
        const tecnicoId = Number(fila?.tecnico_id)
        if (!Number.isFinite(tecnicoId) || !fila?.actualizado_en) return
        if (estadosTecnicos.current.get(tecnicoId) === fila.actualizado_en) return
        estadosTecnicos.current.set(tecnicoId, fila.actualizado_en)
        refrescarPronto()
      })
      .subscribe()

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
                notificar(`Nueva solicitud de ${nueva.nombre_contacto ?? 'un cliente'}.`, nueva.id, true)
              } else if (payload.eventType === 'UPDATE' && nueva.estado === 'cancelada' && anterior !== 'cancelada') {
                notificar('El cliente canceló una solicitud.', nueva.id, false)
              } else if (payload.eventType === 'UPDATE' && nueva.estado === 'confirmada' && anterior !== 'confirmada') {
                notificar('El cliente confirmó el servicio. Ya puedes ir al domicilio.', nueva.id, false)
              } else if (payload.eventType === 'UPDATE' && nueva.estado === 'confirmada_en_espera' && anterior !== 'confirmada_en_espera') {
                notificar('El cliente confirmó el servicio en espera. Empezará cuando termines el actual.', nueva.id, false)
              }
            } else if (payload.eventType === 'UPDATE' && anterior !== nueva.estado) {
              const seActivo = (nueva.estado === 'aceptada' || nueva.estado === 'confirmada')
                && (anterior === 'en_espera' || anterior === 'confirmada_en_espera')
              const texto = seActivo ? TEXTO_ACTIVACION : AVISO_CLIENTE[nueva.estado]
              // Solo las que requieren decisión inmediata quedan fijas (aceptada, en_espera, completada)
              const accionInmediata = !seActivo && ['aceptada', 'en_espera', 'completada'].includes(nueva.estado)
              if (texto) notificar(texto, nueva.id, accionInmediata)
            }
          }

          if (rol !== 'tecnico' && payload.eventType === 'UPDATE' && nueva.diagnostico && previa.diagnostico !== nueva.diagnostico) {
            notificar('El técnico registró el diagnóstico de tu solicitud.', nueva.id, false)
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
      clearTimeout(timerEstado.current)
      timerEstado.current = undefined
      document.removeEventListener('visibilitychange', alVolver)
      window.removeEventListener('online', refrescar)
      supabase.removeChannel(canalEstado)
      if (canal) supabase.removeChannel(canal)
    }
  }, [uid, rol, notificar, refrescar, refrescarPronto])

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
