# Despliegue en Supabase

## 0. Estado actual (importante)

El proyecto enlazado (`supabase/.temp/linked-project.json`) **no tiene aplicada
ninguna migración** en su historial remoto y tampoco existen todavía las tablas
nuevas (`transacciones`, `cupones`, `ubicaciones_tecnicos`, etc.). Las features
7–30 están implementadas en código, pero **requieren ejecutar las migraciones**
antes de probarlas contra la base real.

Las migraciones se revisaron de forma estática; no se pudieron ejecutar en un
Postgres local porque el entorno no tiene Docker/Podman.

## 1. Requisitos

- Supabase CLI (`npx supabase --version`).
- Proyecto enlazado (`npx supabase link --project-ref <ref>`).
- En Windows/PowerShell usar `npx.cmd` y **no** encadenar con `&&`.

## 2. Orden de migraciones

Ejecutar en este orden (el nombre ya ordena):

```
20261020_solicitud_eventos.sql
20261027_categoria_genero_tecnicos.sql
20261028_solo_tecnicos_aprobados.sql
20261029_tecnico_ve_sus_solicitudes.sql
20261030_desactivar_reconocimiento_facial_temporal.sql
20261031_direccion_diagnostico_calificaciones.sql
20261101_chat_pagos_cuenta_bancaria.sql
20261102_completar_solicitud.sql
20261103_confirmacion_tecnico_estados.sql
20261104_notificaciones_soporte.sql
20261105_pagos_wompi.sql
20261106_gps_eta.sql
20261107_clientes_tecnicos.sql
20261108_crecimiento.sql
20261109_pagos_internos.sql
20261110_archivos_tecnicos.sql
```

Cada archivo es idempotente (`if not exists`, `create or replace`, `drop ...
if exists`). Aun así, no saltes el orden: `20261105` depende de
`20261104` (notificaciones), `20261108` depende de `20261105`
(transacciones para recompensar referidos) y `20261109` depende de
`20261105` (`aplicar_reembolso`). `20261110` requiere `20261107` y crea los
buckets de Storage.

### Opción A: CLI

```bash
npx supabase db push
```

### Opción B: SQL Editor

Abrir cada archivo y ejecutar **todo el bloque** de una vez. Si algo falla, el
editor muestra la línea; corregir y volver a ejecutar el archivo completo.

## 3. Edge Functions

En esta etapa (pagos reales diferidos) solo es necesaria la de push:

```bash
npx supabase functions deploy enviar-push
```

Las funciones de Wompi (`wompi-checkout`, `wompi-webhook`,
`wompi-reembolso`) se conservan en el repositorio como adaptador futuro y **no
se llaman desde la app**. Cuando se habiliten los pagos reales:

```bash
npx supabase functions deploy wompi-checkout
npx supabase functions deploy wompi-webhook --no-verify-jwt
npx supabase functions deploy wompi-reembolso
```

`wompi-webhook` es la **única** que va con `--no-verify-jwt`: Wompi no envía un
JWT de Supabase. La función valida la firma del evento y exige
`WOMPI_SECRETO_EVENTOS`.

`enviar-push` no necesita `--no-verify-jwt`: se autentica con
`x-push-secreto` o con el bearer de service role.

## 4. Secrets

Los secrets de Wompi **no se configuran todavía**. El día que se habiliten:

```bash
npx supabase secrets set \
  WOMPI_ENTORNO=sandbox \
  WOMPI_LLAVE_PUBLICA=pub_test_... \
  WOMPI_LLAVE_PRIVADA=prv_test_... \
  WOMPI_SECRETO_INTEGRIDAD=... \
  WOMPI_SECRETO_EVENTOS=... \
  WOMPI_URL_RETORNO=https://resolvepasto.co/pago/resultado
```

Push:

```bash
npx supabase secrets set \
  PUSH_SECRETO=<cadena larga aleatoria> \
  FCM_SERVICE_ACCOUNT_JSON="$(cat service-account.json)"
```

`SUPABASE_URL`, `SUPABASE_ANON_KEY` y `SUPABASE_SERVICE_ROLE_KEY` los inyecta
Supabase automáticamente en las Edge Functions.

> Nunca pongas estas llaves en `.env` con prefijo `VITE_`: quedarían dentro del
> APK.

## 5. Realtime

Las migraciones agregan a `supabase_realtime`:

- `public.notificaciones`
- `public.ubicaciones_tecnicos`

Verificar:

```sql
select schemaname, tablename
  from pg_publication_tables
 where pubname = 'supabase_realtime'
   and schemaname = 'public'
 order by tablename;
```

Si faltan, ejecutar el bloque `do $$ ... alter publication ... $$;` de la
migración correspondiente.

## 6. Verificación posterior

```sql
-- Proveedor activo: debe ser 'interno' con pagos reales deshabilitados
select * from public.pagos_config;

-- Comisión configurada
select * from public.comisiones_config;

-- Cupones
select public.validar_cupon('PROMO10', 10000000);

-- Código de referido del usuario actual (requiere sesión)
select public.mi_codigo_referido();

-- Cobertura
select * from public.cobertura_visible();

-- Últimas transacciones internas
select referencia, proveedor, estado, monto_centavos, comision_centavos, neto_centavos
  from public.transacciones
 order by creada_en desc
 limit 20;

-- Buckets de archivos del técnico
select id, public, file_size_limit, allowed_mime_types
  from storage.buckets
 where id in ('portafolio-tecnicos', 'documentos-tecnicos');

-- Notificaciones pendientes de push
select id, tipo, titulo, push_enviado, push_intentos
  from public.notificaciones
 where push_enviado = false
 order by creada_en
 limit 20;
```

## 7. Checklist de prueba manual

- [ ] Cliente crea solicitud y elige un método manual (tarjeta aparece “Pronto”).
- [ ] Técnico completa el servicio y registra precio final.
- [ ] Cliente aplica un cupón y ve el total con descuento.
- [ ] Cliente guarda el método; el técnico pulsa “Confirmar pago recibido”.
- [ ] Pago interno → `pago_estado = 'pagado'`, comisión y neto calculados.
- [ ] Repetir la confirmación no duplica la transacción (idempotencia).
- [ ] Reembolso total → `reembolsada` y comisión reversada.
- [ ] Reembolso parcial → `reembolso_parcial`.
- [ ] Técnico sube una foto de portafolio y un documento privado.
- [ ] Mensaje en el chat → notificación en la bandeja de la contraparte.
- [ ] Cambio de estado → notificación al cliente/técnico correcto.
- [ ] Técnico comparte ubicación en `en_camino`; el cliente la ve.
- [ ] Técnico deja de compartir o termina el servicio → deja de verse.
- [ ] Técnico bloquea un día en la agenda.
- [ ] Cliente guarda un técnico favorito.
- [ ] Cliente reporta un problema en un servicio completado.
- [ ] Recuperación de contraseña: correo → enlace → nueva contraseña.
- [ ] Push: registrar token y llamar a `enviar-push` con el secreto.

## 8. Pruebas automáticas

```bash
npx.cmd tsc --noEmit
npm.cmd test
npm.cmd run build
```

Los tests usan `node --test`, no necesitan red y cubren:

- pagos y comisión (`pagosCore`, `edgePagos`),
- cupones, referidos y cobertura,
- GPS/ETA y señal,
- disponibilidad y recomendación,
- notificaciones, auth, soporte y chat.

## 9. Notas de seguridad

- RLS activo en todas las tablas nuevas.
- `encolar_notificacion` y `registrar_evento_wompi` no están concedidas a
  `authenticated`.
- `preparar_transaccion` valida propiedad y estado; el monto real lo calcula la
  Edge Function.
- Los documentos de técnicos son privados.
- El webhook rechaza eventos sin firma.
- `enviar-push` rechaza peticiones sin secreto o service role.
