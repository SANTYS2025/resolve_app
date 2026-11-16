/**
 * Presencia del técnico: latido mientras la app está abierta.
 *
 * El servidor decide la disponibilidad (migración 20261113). Este hook solo
 * avisa que la persona sigue conectada y permite el interruptor manual de
 * "Recibir solicitudes". Si la app se cierra sin avisar, el último latido deja
 * de renovarse y la vista marca al técnico como desconectado como máximo en
 * 4 minutos (ventana definida en SQL).
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  alternarRecibirSolicitudes, getMiEstadoTecnico, marcarDesconexionTecnico, marcarPresenciaTecnico,
} from './api'
import type { MiEstadoTecnico, Perfil } from './api'

/** Un latido por minuto: suficiente para una ventana de 4 minutos sin saturar Realtime. */
const LATIDO_MS = 60_000

const ERROR_CAMBIO = 'No pudimos cambiar tu disponibilidad. Revisa tu conexión e intenta de nuevo.'

export function usePresenciaTecnico(perfil: Perfil | null) {
  const [estado, setEstado] = useState<MiEstadoTecnico | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [cambiando, setCambiando] = useState(false)
  const vivo = useRef(true)
  const esTecnico = perfil?.rol === 'tecnico'
  const usuarioId = perfil?.id

  const refrescar = useCallback(async () => {
    if (!esTecnico) return
    try {
      const actual = await getMiEstadoTecnico()
      if (vivo.current && actual) setEstado(actual)
    } catch {
      // Sin red: se conserva el último estado conocido y el latido reintenta.
    }
  }, [esTecnico])

  useEffect(() => {
    vivo.current = true
    if (!esTecnico) {
      setEstado(null)
      return
    }

    const latir = async () => {
      try {
        await marcarPresenciaTecnico()
        const actual = await getMiEstadoTecnico()
        if (vivo.current && actual) setEstado(actual)
      } catch {
        // El siguiente latido o el evento `online` vuelve a intentarlo.
      }
    }

    void latir()
    const intervalo = window.setInterval(() => {
      if (!document.hidden) void latir()
    }, LATIDO_MS)

    const alVolver = () => { if (!document.hidden) void latir() }
    document.addEventListener('visibilitychange', alVolver)
    window.addEventListener('online', alVolver)

    return () => {
      vivo.current = false
      window.clearInterval(intervalo)
      document.removeEventListener('visibilitychange', alVolver)
      window.removeEventListener('online', alVolver)
      // Salir de la pantalla / cerrar sesión deja de estar disponible al instante.
      void marcarDesconexionTecnico().catch(() => {})
    }
  }, [esTecnico, usuarioId])

  const alternar = useCallback(async (nuevo: boolean): Promise<boolean> => {
    setCambiando(true)
    setError(null)
    try {
      const aplicado = await alternarRecibirSolicitudes(nuevo)
      // Se relee del servidor: no se adivina el estado con datos locales.
      const actual = await getMiEstadoTecnico()
      if (vivo.current) {
        if (actual) setEstado(actual)
        else setEstado(prev => prev ? { ...prev, recibiendoSolicitudes: aplicado } : prev)
      }
      return aplicado
    } catch (e) {
      if (vivo.current) setError(ERROR_CAMBIO)
      throw e
    } finally {
      if (vivo.current) setCambiando(false)
    }
  }, [])

  /** Desconexión explícita antes de cerrar sesión (aún hay token válido). */
  const desconectar = useCallback(async () => {
    if (!esTecnico) return
    await marcarDesconexionTecnico().catch(() => {})
  }, [esTecnico])

  return { estado, error, cambiando, alternar, refrescar, desconectar }
}

/** Tipo del estado que consume la pantalla de perfil. */
export type PresenciaTecnico = ReturnType<typeof usePresenciaTecnico>
