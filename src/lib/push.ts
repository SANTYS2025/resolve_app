/**
 * Registro de push nativo (Capacitor) — aislado del resto de la app.
 *
 * El plugin `@capacitor/push-notifications` es opcional: si no está instalado
 * (por ejemplo en el build web de Figma Make) la app sigue funcionando y solo
 * muestra que el push no está disponible. El token se guarda en Supabase y el
 * envío real lo hace la Edge Function `enviar-push` con FCM.
 */

import { Capacitor } from '@capacitor/core'
import { registrarDispositivoPush } from './notificacionesApi'

export type ResultadoPush = {
  estado: 'registrado' | 'no_soportado' | 'denegado' | 'error'
  mensaje: string
}

const MODULO_PUSH = '@capacitor/push-notifications'
let tokenActual: string | null = null
let escuchasActivas = false

function cargarPlugin(): Promise<Record<string, unknown> | null> {
  return import(/* @vite-ignore */ MODULO_PUSH)
    .then(m => (m as Record<string, unknown>) ?? null)
    .catch(() => null)
}

/** Pide permiso y registra el dispositivo. Es seguro llamarlo en cada login. */
export async function registrarPush(): Promise<ResultadoPush> {
  if (!Capacitor.isNativePlatform()) {
    return {
      estado: 'no_soportado',
      mensaje: 'Las notificaciones push con la app cerrada están disponibles en la app móvil.',
    }
  }

  const mod = await cargarPlugin()
  const PushNotifications = (mod?.PushNotifications ?? (mod?.default as Record<string, unknown> | undefined)?.PushNotifications) as {
    checkPermissions: () => Promise<{ receive: string }>
    requestPermissions: () => Promise<{ receive: string }>
    register: () => Promise<void>
    addListener: (evento: string, cb: (data: unknown) => void) => Promise<unknown> | unknown
  } | undefined

  if (!PushNotifications) {
    return { estado: 'no_soportado', mensaje: 'Falta instalar el plugin de notificaciones en la app móvil.' }
  }

  try {
    let permiso = await PushNotifications.checkPermissions()
    if (permiso.receive === 'prompt' || permiso.receive === 'prompt-with-rationale') {
      permiso = await PushNotifications.requestPermissions()
    }
    if (permiso.receive !== 'granted') {
      return { estado: 'denegado', mensaje: 'Activa las notificaciones desde los ajustes del teléfono para recibir avisos.' }
    }

    if (!escuchasActivas) {
      escuchasActivas = true
      PushNotifications.addListener('registration', data => {
        const token = String((data as { value?: string })?.value ?? '')
        if (!token) return
        tokenActual = token
        registrarDispositivoPush(token, Capacitor.getPlatform() === 'ios' ? 'ios' : 'android')
          .catch(e => console.warn('No se pudo guardar el token push:', e))
      })
      PushNotifications.addListener('registrationError', e => {
        console.warn('Error al registrar push:', e)
      })
    }

    await PushNotifications.register()
    return { estado: 'registrado', mensaje: 'Notificaciones activadas.' }
  } catch (e) {
    console.warn('Push no disponible:', e)
    return { estado: 'error', mensaje: 'No se pudieron activar las notificaciones en este dispositivo.' }
  }
}

/** Solo se usa si el usuario cierra sesión en el mismo teléfono. */
export async function olvidarPush(): Promise<void> {
  if (!tokenActual) return
  try {
    const { desactivarDispositivoPush } = await import('./notificacionesApi')
    await desactivarDispositivoPush(tokenActual)
  } catch (e) {
    console.warn('No se pudo desactivar el token push:', e)
  }
  tokenActual = null
}
