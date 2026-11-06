/**
 * Cierre de sesión al cerrar la app (Android/Capacitor).
 *
 * Android no ejecuta JavaScript cuando el usuario desliza la app desde
 * "recientes" o cuando el sistema mata el proceso. Por eso el cierre se hace
 * en los dos únicos puntos fiables:
 *
 *  1. Salida explícita: el botón/gesto atrás en la pantalla raíz cierra la
 *     sesión antes de llamar a `App.exitApp()`.
 *  2. Arranque en frío: `sessionStorage` vive dentro del WebView y se pierde
 *     cuando el proceso muere. Si al abrir la app no existe la marca de este
 *     proceso, sabemos que la app se había cerrado y limpiamos los tokens
 *     antes de restaurar la sesión.
 *
 * Pasar a segundo plano (abrir Google Maps, atender una llamada) NO cierra la
 * sesión: la marca sigue viva mientras el WebView exista.
 *
 * Efecto secundario aceptado: el técnico debe iniciar sesión otra vez cada vez
 * que cierre la app o el sistema la termine.
 */

import { supabase } from './supabase'
import { olvidarPush } from './push'

const CLAVE_PROCESO = 'resolve_proceso_activo'

/**
 * Devuelve `true` si el WebView es nuevo, es decir, si la app se cerró o el
 * sistema la terminó desde la última vez. Debe llamarse una sola vez por
 * proceso; la marca queda puesta para las siguientes llamadas.
 */
export function esArranqueFrio(): boolean {
  try {
    const activo = sessionStorage.getItem(CLAVE_PROCESO) === '1'
    sessionStorage.setItem(CLAVE_PROCESO, '1')
    return !activo
  } catch {
    // Navegador sin sessionStorage: no forzamos cierres inesperados.
    return false
  }
}

/** Se calcula al importar el módulo, antes de montar React. */
export const ARRANQUE_FRIO = esArranqueFrio()

/**
 * Borra del almacenamiento las claves de sesión de Supabase.
 *
 * Es una red de seguridad para cuando `signOut` no puede hablar con el
 * servidor (sin internet): el token no debe quedar guardado en el teléfono.
 */
function limpiarTokensLocales(): void {
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const clave = localStorage.key(i)
      if (clave && /^sb-.*-auth-token/.test(clave)) localStorage.removeItem(clave)
    }
  } catch (e) {
    console.warn('No se pudo limpiar el almacenamiento de sesión:', e)
  }
}

/** Borra los tokens de Supabase y desactiva el push del dispositivo. */
export async function cerrarSesion(): Promise<void> {
  try { await olvidarPush() } catch (e) { console.warn('No se pudo desactivar el push:', e) }
  try {
    const { error } = await supabase.auth.signOut()
    if (error) throw error
  } catch (e) {
    console.warn('Cierre de sesión global falló; se limpia la sesión local:', e)
    try { await supabase.auth.signOut({ scope: 'local' }) } catch (e2) { console.warn('Cierre local falló:', e2) }
  } finally {
    // Siempre: aunque falle la red, los tokens dejan de estar en el dispositivo.
    limpiarTokensLocales()
  }
}

/**
 * Limpieza de arranque compartida.
 *
 * En desarrollo React StrictMode monta el efecto de arranque dos veces. Con una
 * única promesa, las dos ejecuciones esperan el mismo cierre y `getSession()`
 * nunca alcanza a restaurar los tokens que se están borrando.
 */
let cierreDeArranque: Promise<void> | null = null
export function limpiarSesionDeArranque(): Promise<void> {
  cierreDeArranque ??= cerrarSesion()
  return cierreDeArranque
}
