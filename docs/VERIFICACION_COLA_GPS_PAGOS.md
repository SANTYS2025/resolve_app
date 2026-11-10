# Verificación: cola de solicitudes, GPS, contraseñas y pagos

Fecha: 2026-11-11
Proyecto Supabase: `resolve_db` (`mgqrnhidrqznxiojmjlt`, producción)

## Respaldo previo

- Ruta: `backups/20261111_pre_cola_gps/`
- Contenido: 33 tablas, 558 filas (`data/*.json`), `schema.sql`, `manifest.json` y README.
- Se tomó antes de aplicar cualquier cambio de esquema.

## Migraciones

| Migración | Contenido | Estado |
|---|---|---|
| `20261111_cola_solicitudes_gps_daviplata.sql` | Estados `en_espera` / `confirmada_en_espera`, `en_espera_desde`, `latitud`, `longitud`, Daviplata, activación transaccional y RPCs de cola | Aplicada |
| `20261112_cola_lock_tecnico.sql` | `pg_advisory_xact_lock` por técnico en aceptar, activar, completar y cambiar estado | Aplicada |

Ambas quedaron registradas en `supabase_migrations.schema_migrations` junto con
`20261109` y `20261110`. Verificado en remoto:

- Columnas `en_espera_desde`, `latitud`, `longitud`.
- `solicitudes_metodo_pago_check` incluye los 8 valores (los 4 habilitados y los 4 históricos).
- RPCs `aceptar_solicitud`, `activar_siguiente_solicitud`, `completar_solicitud`,
  `cambiar_estado_solicitud`, `confirmar_tecnico` y `registrar_metodo_pago`.
- Las cuatro funciones de cola contienen `pg_advisory_xact_lock`.

## Pruebas automatizadas

- `npx tsc --noEmit`: sin errores.
- `npm test`: **98 pruebas, 98 correctas, 0 fallidas**.
- Archivos nuevos/actualizados: `tests/solicitudes.test.ts`, `tests/pagos.test.ts`,
  `tests/pagosCore.test.ts`, `tests/geocodificacion.test.ts`, `tests/auth.test.ts`.

## Pruebas transaccionales contra Supabase (revertidas)

Se ejecutaron bloques SQL `DO` que terminan con `RAISE EXCEPTION` para forzar el
rollback. Al final se comprobó que la base sigue con **90 solicitudes, 0 activas,
0 en espera y 4 completadas**: no quedó ningún dato de prueba.

| # | Prueba | Resultado |
|---|---|---|
| 1 | Técnico sin solicitudes activas aparece DISPONIBLE | OK (0 activos → DISPONIBLE) |
| 2 | Al finalizar el último servicio vuelve a DISPONIBLE | OK |
| 3 | Al iniciar un servicio aparece OCUPADO | OK (aceptar → 1 activo) |
| 4 | Recibir otra solicitud mientras está ocupado | OK (insertada en `pendiente`) |
| 5 | Aceptarla deja la solicitud EN ESPERA | OK (`en_espera`) |
| 6 | Terminar el servicio activa la siguiente | OK (`en_espera → aceptada`, la más antigua) |
| 7 | El cliente recibe el aviso de su turno | Verificado en `realtime.ts`: `TEXTO_ACTIVACION` exacto al pasar de `en_espera`/`confirmada_en_espera` a `aceptada`/`confirmada` |
| 8 | Cancelaciones y rechazos dentro de la cola | OK (rechazo en espera y cancelación activa activan la siguiente) |
| 9 | Registro con contraseñas coincidentes | OK (`validarNuevaPassword` + UI) |
| 10 | Registro con contraseñas diferentes bloqueado | OK (mensaje exacto “Las contraseñas no coinciden”) |
| 11 | Mostrar/ocultar contraseña | Implementado con `type` dinámico en registro y login; validado por TypeScript |
| 12 | GPS con permiso concedido | OK en pruebas unitarias con geolocalización simulada |
| 13 | GPS con permiso denegado | OK (`mensajeGeolocalizacion` código 1) |
| 14 | Entrada manual de direcciones | OK (el campo sigue editable y es obligatorio) |
| 15 | Coordenadas guardadas correctamente | OK (latitud/longitud persistidas en la solicitud) |
| 16 | Nequi, Bancolombia, Daviplata y efectivo funcionan | OK (los 4 se registran y guardan) |
| 17 | Los demás métodos aparecen PRONTO y no son seleccionables | OK (Bre-B, tarjetas y Google Pay rechazados por el servidor) |
| 18 | Cambios reflejados en Supabase y en ambas interfaces | OK (esquema/RPCs aplicados; UI cliente y técnico actualizadas) |

Pruebas adicionales de la cola:

- La solicitud completada no cuenta como activa.
- Una solicitud en espera no puede iniciar desplazamiento/GPS antes de su turno.
- El cliente puede confirmar una solicitud en espera (`confirmada_en_espera`) y al
  activarse pasa a `confirmada`.
- El método guardado no cambia cuando se intenta uno bloqueado.

## APK

- Ruta: `apk/ResolvePasto-debug.apk`
- Tamaño: **5.291.187 bytes**
- SHA-256: `C99B988882A7F04E8652D39944C41571DE3936A78C7ADF6779E1ABB64442583C`
- Compilado con: `npm run build` → `npx cap sync android` → `gradlew assembleDebug`.

## Limitaciones

- No fue posible probar con cuentas reales de cliente y técnico en un dispositivo
  Android desde este entorno: no hay credenciales ni interacción física con el
  teléfono. Las pruebas de base de datos y unitarias cubren la lógica, pero falta
  la validación final en dispositivo.
- La geolocalización nativa y el permiso de ubicación de Android deben probarse en
  el teléfono; las pruebas unitarias simulan la API del navegador.
- La geocodificación inversa depende de un proveedor público (Nominatim). Sin
  internet o con CORS bloqueado se muestra el error y se conserva la entrada
  manual; no se inventan direcciones.
- Las notificaciones push reales (FCM) no se probaron de extremo a extremo. El
  aviso de turno se verificó en el canal Realtime y en el respaldo de polling.
- Los pagos siguen siendo manuales de demostración: no hay pasarela ni cobro
  automático. El técnico confirma el pago recibido.
- La activación de la siguiente solicitud depende de Realtime y de un refresco de
  respaldo cada 30 s en Inicio; en redes inestables puede tardar unos segundos.
