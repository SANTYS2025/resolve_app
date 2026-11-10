# Decisiones de producto (features 7–30)

Este documento registra las decisiones tomadas cuando el requisito era ambiguo.
La regla fue elegir la opción **más simple compatible con el proyecto actual** y
dejarla explícita.

## Dinero

| Tema | Decisión | Motivo |
|---|---|---|
| Unidad | Enteros en **centavos** | Evita errores de coma flotante. |
| Comisión Resolve | **10 %** por defecto (`pct_bps = 1000`), configurable | Valor inicial razonable y ajustable por admin. |
| Redondeo | Al centavo más cercano (half-up) | Coincide entre SQL, Edge Function y tests. |
| Base de comisión | Monto **bruto aprobado** (ya con descuento del cupón) | Es lo que realmente entra. |
| Reembolso total | Estado `reembolsada` | Claro para el historial. |
| Reembolso parcial | Estado `reembolso_parcial` | Distingue el caso sin perder trazabilidad. |
| Comisión reversada | Proporcional al monto reembolsado | No se regala ni se cobra de más. |
| Payout al técnico | Se registra el neto; el abono real es manual | No hay integración de dispersión todavía. |

## Pagos internos y proveedor diferido

- **Decisión vigente:** los pagos reales con Wompi/ePayco y el cobro automático
  con tarjeta están **diferidos** hasta que la empresa tenga RUT.
- El proveedor activo es `interno` (`pagos_config.proveedor_activo`) y
  `pagos_reales_habilitados = false`. La app no llama a ninguna Edge Function de
  Wompi.
- Solo se confirman métodos manuales habilitados: **Nequi, Bancolombia,
  Daviplata y efectivo**. Los demás (tarjetas, Google Pay y Bre-B) siguen
  visibles con la etiqueta **PRONTO**, deshabilitados en la UI y rechazados por
  el servidor. El CHECK conserva los valores históricos para no romper registros.
- El técnico es quien pulsa “Confirmar pago recibido”; el cliente solo elige y
  guarda el método. Es la opción más simple y coincide con quién recibe el
  dinero.
- Referencia interna determinista `resolve-sol-<id>-interno`: repetir la
  confirmación devuelve la misma transacción, sin duplicar comisión ni eventos.
- El monto **siempre** lo calcula el servidor con el mismo precio base que ve el
  cliente: `(precio_final ?? precio_estimado_max ?? precio_estimado_min) * 100 -
  descuento_centavos`. Así funciona aunque `completar_solicitud` todavía no haya
  fijado `precio_final`.
- Los reembolsos internos se registran y aplican en la misma RPC; el dinero
  físico se devuelve por fuera de la app.
- El adaptador de Wompi se conserva en `supabase/functions/` y
  `src/lib/pagosGateway.ts` queda como abstracción sin llamadas, lista para
  conectarse después.
- Las llaves futuras serán secrets del servidor (nunca `VITE_*`) y el webhook
  exigirá firma. Un evento duplicado no volverá a aplicar comisión ni
  notificaciones.

## Cola de solicitudes y disponibilidad

- Un técnico está **DISPONIBLE** cuando no tiene ninguna solicitud en estado
  activo (`aceptada`, `confirmada`, `en_camino`, `en_proceso`, `llego`) y
  **OCUPADO** cuando atiende una. `completada`, `cancelada`, `rechazada` y
  `expirada` nunca lo mantienen ocupado.
- La columna histórica `tecnicos.disponible` no se usa para decidir: la
  disponibilidad se deriva de las solicitudes reales y se refresca con Realtime
  (y un refresco periódico en Inicio).
- Mientras está ocupado puede recibir, aceptar o rechazar solicitudes. Aceptar
  una nueva la deja en `en_espera` (o `confirmada_en_espera` si el cliente ya
  confirmó); nunca se rechaza por estar ocupado.
- Al terminar, cancelar o rechazar el servicio actual, la solicitud en espera
  más antigua se activa en la misma transacción
  (`activar_siguiente_solicitud`): `en_espera → aceptada` y
  `confirmada_en_espera → confirmada`. El cliente recibe el aviso
  “¡Ahora la solicitud actual eres tú!”.
- La activación y las aceptaciones usan bloqueo de fila y un lock de transacción
  por técnico (`pg_advisory_xact_lock`) para impedir dos servicios simultáneos.
- Una solicitud en espera no puede navegar ni activar el GPS de seguimiento
  hasta que sea su turno.
- La vista del técnico separa **SERVICIO ACTUAL**, **SOLICITUDES EN ESPERA**
  (en orden de aceptación) y **NUEVAS SOLICITUDES**; el historial tiene su propia
  pestaña **SOLICITUDES TERMINADAS**.

## GPS en el formulario de solicitud

- El permiso se pide **solo** al tocar “USAR MI UBICACIÓN ACTUAL”; nunca al abrir
  el formulario.
- Se obtienen coordenadas con alta precisión y se validan sus rangos. Si la
  precisión reportada es baja (>200 m), se avisa para revisar la dirección.
- La geocodificación inversa usa Nominatim (OpenStreetMap) y compone la
  dirección en español. Si falla, no se inventa una dirección: se muestra el
  error y se mantiene la entrada manual. La UI muestra la atribución
  “© OpenStreetMap contributors” con enlace a su copyright.
- La dirección queda editable y se guarda junto con `latitud` y `longitud` en la
  solicitud.

## Registro e inicio de sesión

- El registro pide contraseña y confirmación, cada una con icono de ojo. Se
  valida el mínimo de 8 caracteres y que coincidan antes de crear la cuenta.
- El inicio de sesión tiene icono de ojo. Mostrar/ocultar solo cambia el `type`
  del input: no altera Supabase Auth ni el almacenamiento.

## Cupones

- Se validan en el servidor (`validar_cupon`) antes de descontar.
- Se guardan en centavos en la solicitud para que el cobro use el monto exacto.
- **Un cupón por solicitud** (índice único en `cupones_usos.solicitud_id`).
- El cupón se **consume al aplicarlo**, no al pagar. Es la opción más simple y
  evita que dos clientes reserven el mismo último uso. Si el cliente no paga,
  el uso queda consumido; se documenta como limitación.
- El descuento nunca deja el total negativo.
- La caja de cupón solo aparece cuando el servicio está `completada` y el pago
  sigue pendiente, igual que la RPC; antes de eso el cliente no puede aplicarlo.

## Referidos

- Código generado en el servidor a partir del nombre + sufijo del UUID.
- Se vincula **una sola vez** y **antes del primer pago aprobado**.
- La recompensa ($10.000 COP por defecto) queda registrada como
  `recompensado` cuando el invitado paga; **no se mueve dinero
  automáticamente**.
- La notificación de recompensa usa tipo `pago` (no `promocion`) porque es un
  crédito y las promociones vienen apagadas por defecto.

## Cobertura por barrio

- Es **informativa**: `activo`, `recargo_cop` y `nota`.
- No bloquea la creación de solicitudes; solo se muestra en la pantalla de
  referidos/cobertura.
- Se administra por SQL/service role; los usuarios solo leen.

## GPS y ETA

- Solo la última posición por técnico (sin historial).
- Un canal Realtime por solicitud.
- Publicación limitada a 1 punto/10 s y >10 m de movimiento.
- Señal ≤90 s: ETA confiable.
- 90 s–5 min: ETA aproximada + aviso de señal débil.
- >5 min: sin ETA numérica; última ubicación + “Sin señal”.
- El destino es la geolocalización del cliente **una vez**; si la niega, no hay
  ETA numérica.
- Al terminar/cancelar el servicio se deja de compartir automáticamente.

## Identidad visual y logotipos

- Los métodos habilitados usan los logotipos oficiales de Nequi, Bancolombia y
  Daviplata, centralizados en `src/components/MetodoPagoLogo.tsx`. Los recursos
  y sus fuentes exactas están en `docs/LOGOTIPOS_OFICIALES.md`.
- Nequi se identifica con el icono oficial “N”; el wordmark del sitio es la
  versión clara para fondo oscuro y no se recolorea.
- Tarjeta, Google Pay, Bre-B y efectivo usan iconos genéricos de Material
  Symbols (Apache 2.0). Efectivo no representa una marca externa; los demás
  están deshabilitados y no se debe fabricar una marca ni sugerir disponibilidad.
- No se muestra el logotipo de Google Maps: la app no usa su SDK. Los botones
  de ruta tienen texto neutro y los enlaces externos siguen funcionando.
- La atribución de OpenStreetMap/Nominatim es visible en el formulario de
  dirección.

## Notificaciones y push

- Preferencias por usuario; `promociones` apagado por defecto.
- La bandeja y la cola de push viven en Supabase.
- El envío real lo hace la Edge Function `enviar-push` con FCM HTTP v1.
- La app nativa registra el token con un adaptador aislado
  (`src/lib/push.ts`); el plugin es opcional.
- Sin FCM configurado, los avisos quedan en la bandeja y no se marcan como
  enviados.
- Limitación conocida: `debe_notificar` también filtra la bandeja, así que
  apagar `push_activo` silencia también la bandeja.

## Cuenta y soporte

- Recuperación de contraseña con Supabase Auth:
  `resetPasswordForEmail` → evento `PASSWORD_RECOVERY` → `updateUser`.
- La pantalla de reset se renderiza **sin** exigir un `Perfil` cargado, para
  que el enlace funcione incluso antes de restaurar la sesión.
- Soporte: tickets con categoría, asunto y descripción; respuesta del equipo y
  notificación tipo `sistema`.

## Técnicos

- La disponibilidad mantiene el modelo semanal existente
  (`disponibilidades`) y añade **bloqueos por fecha** (`bloqueos_agenda`).
- Portafolio y documentos se suben a **Supabase Storage**, con el enlace manual
  conservado como alternativa. Buckets: `portafolio-tecnicos` (público) y
  `documentos-tecnicos` (privado).
- Los archivos viven en `<tecnico_id>/<uuid>.<ext>` y las políticas comparan esa
  carpeta con el técnico autenticado. Los documentos se abren con URL firmada.
- Los documentos son privados: solo el técnico dueño y un admin los ven.
- La disponibilidad se deriva de las solicitudes activas; el horario semanal
  (`disponibilidades`) y los bloqueos por fecha (`bloqueos_agenda`) siguen
  aplicando para la agenda. Si un técnico no configuró horario, se considera
  disponible salvo que tenga un servicio activo. Es compatible con los técnicos
  existentes y evita ocultarlos a todos.
- Favoritos: un cliente puede guardar técnicos; se muestra en inicio y en el
  perfil del técnico.
- La recomendación ordena por calidad, cercanía (barrio), disponibilidad,
  confianza, precio y favoritos. La distancia real en km solo existe durante el
  seguimiento GPS; en la búsqueda se usa el barrio.

## UI y arquitectura

- El app real es `src/App.tsx`; los archivos de `screens/` son legados y no se
  usaron como base.
- Las pantallas nuevas viven en `src/features/Extras.tsx` y se enrutan desde el
  menú del perfil.
- Para no reescribir la app, `Extras.tsx` duplica primitivas visuales mínimas
  (colores, tarjetas, botones) en lugar de extraer/refactorizar componentes de
  `App.tsx`.
- El menú del perfil muestra entradas extra según el rol:
  - técnico: agenda, portafolio, ganancias;
  - cliente: historial de pagos.
- `PagoBox` guarda el método manual y ya no redirige a ninguna pasarela.
  `PagoResumenTecnico` muestra el botón “Confirmar pago recibido”, que llama a
  `registrar_pago_interno`. `procesarCobroAutomatico` queda como abstracción
  diferida y no se usa en la UI.

## Operación

- Las migraciones `20261109`, `20261110`, `20261111` y `20261112` ya están
  aplicadas en el proyecto Supabase enlazado y registradas en
  `supabase_migrations.schema_migrations`. La migración `20261111` crea la cola,
  el GPS y Daviplata; `20261112` agrega el lock por técnico.
- Antes de modificar la base se guardó un respaldo lógico en
  `backups/20261111_pre_cola_gps/` (33 tablas, 558 filas) con `data/*.json`,
  `schema.sql`, `manifest.json` y su README.
- Las integraciones externas (Wompi, FCM) están aisladas y son opcionales: sin
  credenciales la app sigue funcionando y muestra estados “no configurado”.
- Los tests corren sin red con `node --test` y `fetch` falso donde hace falta.
