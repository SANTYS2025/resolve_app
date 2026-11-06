# Notificaciones y push (app cerrada)

## 1. Cómo funciona

```
evento en la base (mensaje, estado, pago, referido)
        │
        ▼
public.encolar_notificacion(...)   ← respeta las preferencias
        │
        ▼
public.notificaciones (bandeja + cola de push)
        │
        ▼
Edge Function enviar-push  ──►  FCM HTTP v1  ──►  Android / iOS
```

- La **bandeja** (`public.notificaciones`) se lee desde la app y se actualiza
  por Realtime.
- El **push con la app cerrada** lo entrega FCM. La app solo registra el token
  del dispositivo; nunca envía push directamente.
- Si FCM no está configurado, `enviar-push` responde `503` y **no marca nada
  como enviado**: los avisos quedan en la bandeja para más tarde.

## 2. Tablas y RPC

| Objeto | Para qué |
|---|---|
| `notificaciones_preferencias` | Interruptores por usuario. |
| `mis_preferencias_notificacion()` | Devuelve/crea las preferencias. |
| `guardar_preferencias_notificacion(...)` | Guarda los 5 interruptores. |
| `dispositivos_push` | Tokens FCM (uno por dispositivo). |
| `registrar_dispositivo_push(token, plataforma)` | Alta/reapertura del token. |
| `desactivar_dispositivo_push(token)` | Baja al cerrar sesión. |
| `notificaciones` | Bandeja + cola (`push_enviado`, `push_intentos`). |
| `marcar_notificacion_leida(id)` | Marca una como leída. |
| `marcar_todas_leidas()` | Marca todas. |

Preferencias por defecto:

```json
{
  "push_activo": true,
  "mensajes": true,
  "estados_servicio": true,
  "pagos": true,
  "promociones": false
}
```

`promociones` viene apagado a propósito. La recompensa de referidos se envía
como tipo `pago` (es un crédito, no publicidad).

`encolar_notificacion` es `security definer` y **no** está concedida a
`authenticated`: solo la llaman triggers y funciones del servidor.

## 3. Qué eventos generan aviso

| Evento | Tipo | Destino |
|---|---|---|
| Mensaje nuevo en el chat | `mensaje` | La contraparte (nunca el autor) |
| Cambio de estado del servicio | `estado_servicio` | Cliente o técnico, según quién actúe |
| Pago aprobado / rechazado / reembolsado | `pago` | Cliente y/o técnico |
| Recompensa de referido | `pago` | Referidor |
| Respuesta de soporte | `sistema` | Autor del ticket |

La push de un mensaje lleva un resumen de máximo 120 caracteres; el texto
completo se lee en el chat.

## 4. Registro del dispositivo (Capacitor)

El adaptador está aislado en `src/lib/push.ts`:

- En web devuelve `no_soportado` y la app sigue funcionando.
- En Android/iOS pide permiso, llama a `register()` y guarda el token con
  `registrar_dispositivo_push`.
- Al cerrar sesión, `olvidarPush()` desactiva el token de ese teléfono.

### Instalar el plugin nativo

```bash
npm install @capacitor/push-notifications
npx cap sync android
```

Android:

1. Crear el proyecto en Firebase.
2. Descargar `google-services.json` y copiarlo a `android/app/`.
3. Añadir el plugin de Google Services en Gradle (lo hace Capacitor al
   sincronizar si el archivo existe).
4. En Firebase → Cloud Messaging, usar la **cuenta de servicio** para el
   servidor (no la clave de Android).

iOS:

1. Configurar APNs en Firebase.
2. Subir la clave APNs (.p8) en Firebase.
3. Habilitar `Push Notifications` y `Background Modes → Remote notifications`
   en Xcode.

> Sin `google-services.json` / APNs el código compila, pero el registro nativo
> no obtiene token. Es una integración opcional y configurable.

## 5. Secrets de `enviar-push`

```env
FCM_SERVICE_ACCOUNT_JSON={"type":"service_account", ...}
PUSH_SECRETO=<cadena larga aleatoria>
```

`SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY` los inyecta Supabase.

Despliegue:

```bash
npx supabase functions deploy enviar-push
npx supabase secrets set PUSH_SECRETO=... FCM_SERVICE_ACCOUNT_JSON=...
```

La función acepta:

- `x-push-secreto: <PUSH_SECRETO>`, o
- `Authorization: Bearer <service_role_key>`.

Cualquier otra petición recibe `401`.

## 6. Programar el envío

`enviar-push` procesa hasta 50 avisos pendientes por llamada. Se puede
disparar con:

### Opción A: cron de Supabase (pg_cron + pg_net)

```sql
select cron.schedule(
  'enviar-push-cada-minuto',
  '* * * * *',
  $$
  select net.http_post(
    url := 'https://<proyecto>.supabase.co/functions/v1/enviar-push',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-push-secreto', '<PUSH_SECRETO>'),
    body := '{}'::jsonb
  );
  $$
);
```

### Opción B: Database Webhook

Crear un webhook sobre `insert` en `public.notificaciones` que apunte a
`enviar-push` con el header `x-push-secreto`.

### Opción C: manual / desde el panel

```bash
curl -X POST "https://<proyecto>.supabase.co/functions/v1/enviar-push" \
  -H "x-push-secreto: $PUSH_SECRETO"
```

## 7. Reintentos y tokens inválidos

- Cada aviso tiene `push_intentos`; se reintenta hasta 3 veces.
- Si FCM responde `UNREGISTERED` / `NOT_FOUND`, el token se marca
  `activo = false` para no volver a usarlo.
- Si el usuario no tiene dispositivos, el aviso se marca `push_enviado = true`
  para no reintentar para siempre; sigue visible en la bandeja.

## 8. Límites conocidos

- No hay Web Push en el navegador: la app web muestra la bandeja, pero el
  aviso con la app cerrada requiere la app móvil.
- Las preferencias también controlan qué se guarda en la bandeja
  (`encolar_notificacion` llama a `debe_notificar`). Si el usuario apaga
  `push_activo`, deja de recibir avisos en la bandeja.
- La entrega final depende de FCM/APNs y de la batería/ahorros del teléfono.

## 9. Pruebas

- `tests/notificaciones.test.ts`: reglas de preferencias, contenido y tokens.
- `tests/edgePagos.test.ts`: no cubre FCM, pero el adaptador `_shared/fcm.ts`
  está aislado para probarse con un `fetch` falso.
