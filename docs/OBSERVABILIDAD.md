# Observabilidad (Sentry)

## 1. Qué se monitorea

| Capa | Archivo | Qué reporta |
|---|---|---|
| App React | `src/lib/observabilidad.ts` | Errores no capturados, rechazos de promesas y el `ErrorBoundary`. |
| Arranque | `src/main.tsx` | `iniciarObservabilidad()` corre antes de montar React. |
| Edge Functions | `supabase/functions/_shared/observabilidad.ts` | Errores de `enviar-push`, `wompi-webhook`, `wompi-checkout` y `wompi-reembolso`. |

Sin DSN **todo queda en no-ops**: la app y las funciones siguen funcionando y
solo registran en consola / logs de Supabase.

## 2. Activar en la app

1. Crea un proyecto en Sentry y copia el DSN.
2. Añade al `.env` (local) o a las variables de entorno del build:

```dotenv
VITE_SENTRY_DSN=https://<clave>@o<org>.ingest.sentry.io/<proyecto>
VITE_APP_VERSION=1.0.0
```

3. Vuelve a compilar. El DSN es público por diseño; no es un secreto, pero
   tampoco conviene hardcodearlo en el código.

### Privacidad

- `dataCollection` desactiva cookies, cabeceras, cuerpos HTTP, query params y
  variables locales de los stack frames.
- `beforeSend` reemplaza correos y teléfonos por `[correo]` / `[teléfono]`.
- El usuario se identifica con `Sentry.setUser({ id })` — solo el uuid interno —
  y una etiqueta `rol`. Nunca nombre ni correo.
- Se descartan errores de ruido (red, `AbortError`, `ResizeObserver`).

## 3. Activar en Edge Functions

```bash
npx supabase secrets set SENTRY_DSN=https://... SENTRY_ENVIRONMENT=production
```

`reportarError(error, contexto)` envía un evento mínimo al endpoint de
envelopes de Sentry y **siempre** escribe en `console.error`, que Supabase
conserva en los logs de la función.

Si prefieres no usar Sentry en el servidor, no configures el secret: los logs de
Supabase siguen siendo la fuente de verdad.

## 4. Qué NO se envía

- Tokens, contraseñas, llaves de Wompi o de FCM.
- Correos, teléfonos, direcciones ni contenido de mensajes.
- Cuerpos de peticiones o respuestas HTTP.

## 5. Probar

```bash
# App: provoca un error desde la consola del navegador
throw new Error('prueba de Sentry')

# Edge Function: invoca enviar-push sin secretos y revisa los logs
curl -X POST "https://<proyecto>.supabase.co/functions/v1/enviar-push"
```

El evento debe aparecer en Sentry en segundos. Si no aparece, revisa el DSN y
que el proyecto no tenga filtros de *inbound* que descarten el entorno.
