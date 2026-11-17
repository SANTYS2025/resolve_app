/**
 * Registro y escuchas de push nativo (Capacitor) — aislado del resto de la app.
 *
 * El plugin `@capacitor/push-notifications` se carga en un chunk aparte y solo
 * se usa en la app nativa; en el build web la app sigue funcionando y solo
 * muestra que el push no está disponible. El token se guarda en Supabase y el
 * envío real lo hace la Edge Function `enviar-push` con FCM.
 *
 * El canal `resolve_avisos` debe coincidir con el `channel_id` que envía
 * `supabase/functions/_shared/fcm.ts`; si no existe, Android 8+ descarta la
 * notificación sin mostrarla.
 */

import { Capacitor } from '@capacitor/core'
import { desactivarDispositivoPush, registrarDispositivoPush } from './notificacionesApi'

export type ResultadoPush = {
  estado: 'registrado' | 'no_soportado' | 'denegado' | 'error'
  mensaje: string
}

/** Aviso que abrió el usuario desde la bandeja del sistema. */
export type AvisoPush = {
  titulo: string
  cuerpo: string
  tipo: string | null
  solicitudId: number | null
  notificacionId: number | null
}

type PluginPush = {
  checkPermissions: () => Promise<{ receive: string }>
  requestPermissions: () => Promise<{ receive: string }>
  register: () => Promise<void>
  createChannel?: (opciones: Record<string, unknown>) => Promise<void>
  addListener: (evento: string, cb: (data: unknown) => void) => Promise<unknown> | unknown
}

const CANAL_ID = 'resolve_avisos'

let plugin: PluginPush | null = null
let cargando: Promise<PluginPush | null> | null = null
let tokenActual: string | null = null
let escuchasActivas = false
let canalCreado = false
let avisoPendiente: AvisoPush | null = null
const oyentesApertura = new Set<(aviso: AvisoPush) => void>()

function cargarPlugin(): Promise<PluginPush | null> {
  if (plugin) return Promise.resolve(plugin)
  cargando ??= import('@capacitor/push-notifications')
    .then(m => {
      const mod = (m ?? {}) as Record<string, unknown>
      const PushNotifications = (mod.PushNotifications ?? (mod.default as Record<string, unknown> | undefined)?.PushNotifications) as PluginPush | undefined
      plugin = PushNotifications ?? null
      return plugin
    })
    .catch(() => null)
  return cargando
}

/** Convierte el `data` de FCM (todo strings) en un aviso tipado. */
function leerAviso(notificacion: unknown): AvisoPush | null {
  if (!notificacion || typeof notificacion !== 'object') return null
  const n = notificacion as { title?: unknown; body?: unknown; data?: unknown }
  const datos = (n.data && typeof n.data === 'object' ? n.data : {}) as Record<string, unknown>
  const numero = (v: unknown): number | null => {
    const nro = Number(v)
    return Number.isFinite(nro) && nro > 0 ? nro : null
  }
  const titulo = String(n.title ?? datos.titulo ?? '').trim()
  const cuerpo = String(n.body ?? datos.cuerpo ?? '').trim()
  if (!titulo && !cuerpo) return null
  return {
    titulo,
    cuerpo,
    tipo: datos.tipo == null ? null : String(datos.tipo),
    solicitudId: numero(datos.solicitud_id),
    notificacionId: numero(datos.notificacion_id),
  }
}

function entregarApertura(aviso: AvisoPush) {
  if (oyentesApertura.size === 0) {
    // La app se abrió desde la notificación y React aún no montó la escucha.
    avisoPendiente = aviso
    return
  }
  for (const oyente of oyentesApertura) {
    try { oyente(aviso) } catch (e) { console.warn('Error al abrir un aviso push:', e) }
  }
}

/**
 * Registra una sola vez los listeners del plugin. Se llama antes de pedir el
 * token, para no perder el evento `registration` si llega muy rápido.
 */
async function configurarEscuchas(P: PluginPush): Promise<void> {
  if (!canalCreado && P.createChannel) {
    canalCreado = true
    try {
      await P.createChannel({
        id: CANAL_ID,
        name: 'Avisos de Resolve',
        description: 'Mensajes, estados del servicio y pagos.',
        importance: 5, // IMPORTANCE_HIGH
        visibility: 1, // VISIBILITY_PUBLIC
        vibration: true,
        lights: true,
        lightColor: '#2EDF2D',
      })
    } catch (e) {
      // En Android < 8 o en web el canal no aplica; no es un error fatal.
      console.info('Canal de notificaciones no disponible:', e)
    }
  }

  if (escuchasActivas) return
  escuchasActivas = true

  await P.addListener('registration', data => {
    const token = String((data as { value?: string })?.value ?? '')
    if (!token) return
    tokenActual = token
    registrarDispositivoPush(token, Capacitor.getPlatform() === 'ios' ? 'ios' : 'android')
      .catch(e => console.warn('No se pudo guardar el token push:', e))
  })
  await P.addListener('registrationError', e => {
    console.warn('Error al registrar push:', e)
  })
  await P.addListener('pushNotificationReceived', data => {
    // La bandeja en vivo ya muestra el aviso dentro de la app. Este listener
    // existe para dejar rastro y para futuras extensiones (sonido, contador).
    console.info('Push recibido en primer plano:', leerAviso(data))
  })
  await P.addListener('pushNotificationActionPerformed', data => {
    const aviso = leerAviso((data as { notification?: unknown })?.notification)
    if (aviso) entregarApertura(aviso)
  })
}

/** Pide permiso y registra el dispositivo. Es seguro llamarlo en cada login. */
export async function registrarPush(): Promise<ResultadoPush> {
  if (!Capacitor.isNativePlatform()) {
    return {
      estado: 'no_soportado',
      mensaje: 'Las notificaciones push con la app cerrada están disponibles en la app móvil.',
    }
  }

  const P = await cargarPlugin()
  if (!P) {
    return { estado: 'no_soportado', mensaje: 'Falta instalar el plugin de notificaciones en la app móvil.' }
  }

  try {
    let permiso = await P.checkPermissions()
    if (permiso.receive === 'prompt' || permiso.receive === 'prompt-with-rationale') {
      permiso = await P.requestPermissions()
    }
    if (permiso.receive !== 'granted') {
      return { estado: 'denegado', mensaje: 'Activa las notificaciones desde los ajustes del teléfono para recibir avisos.' }
    }

    await configurarEscuchas(P)
    await P.register()
    return { estado: 'registrado', mensaje: 'Notificaciones activadas.' }
  } catch (e) {
    console.warn('Push no disponible:', e)
    return { estado: 'error', mensaje: 'No se pudieron activar las notificaciones en este dispositivo.' }
  }
}

/**
 * Escucha cuando el usuario toca una notificación del sistema.
 * Devuelve una función para dejar de escuchar.
 */
export async function escucharAperturaPush(oyente: (aviso: AvisoPush) => void): Promise<() => void> {
  if (!Capacitor.isNativePlatform()) return () => {}
  const P = await cargarPlugin()
  if (!P) return () => {}

  try { await configurarEscuchas(P) } catch (e) { console.warn('No se pudieron activar las escuchas push:', e) }
  oyentesApertura.add(oyente)

  // Si la app se abrió desde una notificación antes de montar React, se
  // entrega ahora y se limpia para no repetirla en la siguiente suscripción.
  if (avisoPendiente) {
    const aviso = avisoPendiente
    avisoPendiente = null
    try { oyente(aviso) } catch (e) { console.warn('Error al abrir el aviso pendiente:', e) }
  }

  return () => { oyentesApertura.delete(oyente) }
}

/** Solo se usa si el usuario cierra sesión en el mismo teléfono. */
export async function olvidarPush(): Promise<void> {
  if (!tokenActual) return
  try {
    await desactivarDispositivoPush(tokenActual)
  } catch (e) {
    console.warn('No se pudo desactivar el token push:', e)
  }
  tokenActual = null
}
