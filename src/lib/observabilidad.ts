/**
 * Observabilidad de la app (Sentry).
 *
 * Es opcional: sin `VITE_SENTRY_DSN` todo queda en no-ops y la app funciona
 * igual. La inicialización se hace una sola vez al arrancar (`main.tsx`), antes
 * de montar React, para capturar también errores tempranos.
 *
 * Privacidad: no se envían cookies, cabeceras, cuerpos HTTP ni variables
 * locales; se descartan correos y teléfonos del mensaje/contexto, y el usuario
 * se identifica solo por su id interno (nunca nombre ni correo). El DSN es
 * público por diseño; el token de escritura viaja dentro de él.
 */

import * as Sentry from '@sentry/react'

const DSN = String(import.meta.env.VITE_SENTRY_DSN ?? '').trim()
const ENTORNO = String(import.meta.env.MODE ?? 'production')
const VERSION = String(import.meta.env.VITE_APP_VERSION ?? '').trim() || undefined

let iniciado = false
let capturarHabilitado = false

/** Errores que no aportan nada y solo gastan cuota. */
const RUIDO = [
  /ResizeObserver loop/i,
  /Non-Error promise rejection/i,
  /AbortError/i,
  /The operation was aborted/i,
  /Failed to fetch/i,
  /NetworkError/i,
  /Load failed/i,
  /cancelled/i,
]

function esRuido(mensaje: string): boolean {
  return RUIDO.some(re => re.test(mensaje))
}

/** Quita correos y teléfonos largos de los textos antes de enviarlos. */
function limpiarTexto(texto: string): string {
  return texto
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '[correo]')
    .replace(/\b\+?\d[\d\s().-]{7,}\b/g, '[teléfono]')
}

/** Inicializa Sentry si hay DSN. Es seguro llamarlo varias veces. */
export function iniciarObservabilidad(): void {
  if (iniciado) return
  iniciado = true
  if (!DSN) return

  try {
    Sentry.init({
      dsn: DSN,
      environment: ENTORNO,
      release: VERSION,
      // Privacidad: solo se envía el error y sus etiquetas. Nada de cookies,
      // cabeceras, cuerpos HTTP, query params ni variables locales.
      dataCollection: {
        userInfo: false,
        cookies: false,
        httpHeaders: false,
        httpBodies: [],
        urlQueryParams: false,
        stackFrameVariables: false,
        graphQL: { document: false, variables: false },
      },
      // Sin trazas de rendimiento: primero estabilidad y cuota predecible.
      tracesSampleRate: 0,
      ignoreErrors: [
        'ResizeObserver loop limit exceeded',
        'Non-Error promise rejection captured',
        'AbortError',
      ],
      beforeSend(evento) {
        // El mensaje y el stack pueden contener datos del usuario.
        if (evento.message) evento.message = limpiarTexto(evento.message)
        for (const excepcion of evento.exception?.values ?? []) {
          if (excepcion.value) excepcion.value = limpiarTexto(excepcion.value)
        }
        if (evento.extra) {
          for (const [clave, valor] of Object.entries(evento.extra)) {
            if (typeof valor === 'string') evento.extra[clave] = limpiarTexto(valor)
          }
        }
        return evento
      },
    })
    capturarHabilitado = true
  } catch (e) {
    // Nunca romper la app por el monitoreo.
    console.warn('No se pudo iniciar el monitoreo de errores:', e)
  }
}

/**
 * Reporta un error con contexto. Nunca lanza: si Sentry falla, se registra en
 * consola y la app sigue.
 */
export function capturarError(
  error: unknown,
  contexto: Record<string, string | number | boolean | null | undefined> = {},
): void {
  if (capturarHabilitado) {
    try {
      Sentry.withScope(scope => {
        for (const [clave, valor] of Object.entries(contexto)) {
          if (valor == null) continue
          const texto = String(valor)
          // Las etiquetas deben ser cortas; el resto va como dato extra.
          if (texto.length <= 200) scope.setTag(clave, texto)
          else scope.setExtra(clave, texto)
        }
        Sentry.captureException(error)
      })
    } catch (e) {
      console.warn('No se pudo enviar el error al monitoreo:', e)
    }
  }

  // Siempre queda rastro local (y en los logs de la consola del WebView).
  console.error('[resolve]', contexto, error)
}

/** Asocia los errores al usuario autenticado por su id interno. */
export function identificarUsuario(id: string, rol: string): void {
  if (!capturarHabilitado) return
  try {
    Sentry.setUser({ id })
    Sentry.setTag('rol', rol)
  } catch { /* noop */ }
}

/** Deja de asociar errores al usuario (cierre de sesión o cuenta eliminada). */
export function limpiarUsuario(): void {
  if (!capturarHabilitado) return
  try {
    Sentry.setUser(null)
    Sentry.setTag('rol', '')
  } catch { /* noop */ }
}
