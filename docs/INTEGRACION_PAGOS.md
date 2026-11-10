# Pagos internos, comisiones y reembolsos

Esta guía describe la etapa **actual**: Resolve Pasto todavía no tiene RUT, así
que los pagos reales con Wompi/ePayco y los cobros automáticos con tarjeta están
**diferidos**. El historial, las comisiones y los reembolsos ya funcionan con un
proveedor **interno** trazable e idempotente.

El frontend nunca ve llaves privadas. El día que se habilite el proveedor real,
solo cambia el origen de la confirmación (webhook firmado); las tablas y las
pantallas se mantienen.

## 1. Flujo actual (sin proveedor real)

1. El cliente elige el método de pago al crear la solicitud
   (`metodo_pago`, `metodo_pago_en`, `pago_estado`).
2. Solo los métodos manuales se pueden confirmar:
   `nequi`, `bancolombia`, `daviplata` y `efectivo`.
3. Cuando el servicio está `completada`, el cliente confirma o cambia el método.
4. El técnico ve el método y pulsa **“Confirmar pago recibido”**. Eso llama a la
   RPC `registrar_pago_interno(solicitud_id, metodo)`.
5. La RPC calcula el monto en el servidor:
   `(precio_final ?? precio_estimado_max ?? precio_estimado_min) * 100 −
   descuento_centavos`, registra la transacción aprobada, la comisión y el neto,
   marca `solicitudes.pago_estado = 'pagado'` y encola notificaciones.
6. Tarjeta, Google Pay y Bre-B se muestran como **“Pronto”**: no se pueden
   seleccionar ni cobrar hasta habilitar pagos reales.

### Métodos

| Método | `metodo_pago` | Estado inicial | Cómo se confirma |
|---|---|---|---|
| Tarjeta de crédito | `tarjeta_credito` | `pendiente` | Diferido (pagos reales) |
| Tarjeta débito | `tarjeta_debito` | `pendiente` | Diferido (pagos reales) |
| Google Pay | `google_pay` | `pendiente` | Diferido (pagos reales) |
| Nequi | `nequi` | `pendiente` | El técnico confirma al recibir |
| Bancolombia | `bancolombia` | `pendiente` | El técnico confirma al recibir |
| Daviplata | `daviplata` | `pendiente` | El técnico confirma al recibir |
| Bre-B | `bre_b` | `pendiente` | Diferido (próximamente) |
| Efectivo | `efectivo` | `efectivo` | El técnico confirma al recibir |

## 2. Piezas del código

### Frontend

| Archivo | Responsabilidad |
|---|---|
| `src/lib/pagosCore.ts` | Reglas puras: comisión, referencias internas, reembolsos, firma Wompi futura. |
| `src/lib/pagos.ts` | Catálogo de métodos, estados y textos; interruptor de pagos reales. |
| `src/lib/pagosGateway.ts` | Abstracción de pasarela **sin llamadas**: hoy devuelve “diferido”. |
| `src/lib/transacciones.ts` | Historial, `registrarPagoInterno`, reembolsos vía RPC. |
| `src/lib/ganancias.ts` | Resúmenes de ingresos/comisiones para el técnico. |
| `src/App.tsx` (`PagoBox`, `PagoResumenTecnico`) | El cliente guarda el método; el técnico confirma el pago. |
| `src/features/Extras.tsx` | Historial de transacciones, reembolsos y cupón. |

### Edge Functions (`supabase/functions/`)

Las funciones de Wompi se conservan como **adaptador futuro**. La app no las
invoca en esta etapa.

| Función | Uso actual | Uso futuro |
|---|---|---|
| `wompi-checkout` | No se llama | Devuelve la URL firmada del checkout. |
| `wompi-webhook` | No se llama | Valida firma y registra el evento aprobado. |
| `wompi-reembolso` | No se llama | Anula el cobro en Wompi. |
| `enviar-push` | Se puede desplegar | Envía notificaciones pendientes a FCM. |

### Base de datos

- `20261105_pagos_wompi.sql`: `comisiones_config`, `transacciones`,
  `transacciones_eventos`, `reembolsos`, `aplicar_reembolso`.
- `20261108_crecimiento.sql`: cupones y descuentos en la solicitud.
- `20261109_pagos_internos.sql`: `pagos_config`, `configurar_pagos`,
  `registrar_pago_interno` y la versión interna de `solicitar_reembolso`.

## 3. Comisiones

- Se guardan en **centavos** (integer).
- Configuración por defecto: **10 %** (`pct_bps = 1000`) y mínimo `0`.
- La comisión se calcula sobre el **monto bruto aprobado** (lo que pagó el
  cliente, ya con descuento aplicado), redondeando al centavo más cercano
  (mitad hacia arriba).
- Se guarda en `transacciones.comision_centavos`; el neto del técnico en
  `neto_centavos = monto − comisión`.
- El administrador puede cambiarla con la RPC `actualizar_comision`.

## 4. Reembolsos

- El cliente llama a `solicitar_reembolso` (mínimo 10 caracteres de motivo).
  Queda registrado en `reembolsos` y **nunca se borra**.
- En modo interno, la misma RPC aplica el reembolso de inmediato:
  - total → `reembolsada`,
  - parcial → `reembolso_parcial`.
- La comisión se reversa en la misma proporción y se acumula en
  `comision_reversada_centavos`.
- Cada paso queda en `transacciones_eventos`.
- El dinero físico se devuelve por fuera de la app; el registro es la fuente de
  verdad.
- Con un proveedor real habilitado, la fila quedaría en `solicitado` hasta que
  el webhook o el equipo confirmen la anulación.

## 5. Idempotencia

- Pago interno: referencia determinista `resolve-sol-<solicitud_id>-interno`.
- Repetir `registrar_pago_interno` devuelve la misma transacción y no duplica
  comisión ni eventos.
- Pago real futuro: `resolve-sol-<solicitud_id>` y reintentos
  `resolve-sol-<solicitud_id>-rN`.
- `proveedor_transaccion_id` es único para los cobros reales.
- `registrar_evento_wompi` ignora eventos repetidos de una transacción ya
  finalizada.

## 6. Configuración del proveedor (cuando se habilite)

La tabla `pagos_config` tiene una sola fila:

```sql
select * from public.pagos_config;
-- proveedor_activo = 'interno'
-- pagos_reales_habilitados = false
```

Un administrador puede preparar el cambio:

```sql
select public.configurar_pagos('wompi', true);
```

Antes de hacerlo deben existir los secrets **solo en el servidor**:

```env
WOMPI_ENTORNO=sandbox            # o produccion
WOMPI_LLAVE_PUBLICA=pub_test_...
WOMPI_LLAVE_PRIVADA=prv_test_...
WOMPI_SECRETO_INTEGRIDAD=...
WOMPI_SECRETO_EVENTOS=...
WOMPI_URL_RETORNO=https://resolvepasto.co/pago/resultado
```

- `WOMPI_LLAVE_PUBLICA` + `WOMPI_SECRETO_INTEGRIDAD` → checkout.
- `WOMPI_LLAVE_PRIVADA` → consulta de la transacción y reembolsos.
- `WOMPI_SECRETO_EVENTOS` → validación de la firma del webhook.
- `SUPABASE_URL`, `SUPABASE_ANON_KEY` y `SUPABASE_SERVICE_ROLE_KEY` las inyecta
  Supabase automáticamente.

> Si `WOMPI_SECRETO_EVENTOS` falta, el webhook rechaza **todos** los eventos.
> Es intencional: preferimos no acreditar pagos sin firma.

Cuando se conecte ePayco, se añade su adaptador en `_shared/` y se amplía el
CHECK de `pagos_config.proveedor_activo`; el resto del modelo no cambia.

## 7. Configurar el webhook en Wompi (futuro)

1. En el panel de Wompi, crear un evento de **transacción actualizada**.
2. URL: `https://<proyecto>.supabase.co/functions/v1/wompi-webhook`.
3. Copiar el secreto de eventos a `WOMPI_SECRETO_EVENTOS`.
4. Desplegar la función **sin verificación de JWT**:

```bash
npx supabase functions deploy wompi-webhook --no-verify-jwt
```

La firma se valida con `SHA-256(propiedades + timestamp + secreto)`, usando
`signature.properties`, `signature.checksum` y `timestamp` del evento.

## 8. Despliegue

```bash
# 1) Migraciones (en orden)
npx supabase db push

# 2) Funciones (en esta etapa solo push es necesaria)
npx supabase functions deploy enviar-push

# 3) Cuando se habiliten los pagos reales
npx supabase functions deploy wompi-checkout
npx supabase functions deploy wompi-webhook --no-verify-jwt
npx supabase functions deploy wompi-reembolso
```

En Windows/PowerShell usa `npx.cmd` y no encadenes comandos con `&&`.

## 9. Pruebas sin red

- `tests/pagosCore.test.ts`: pago exitoso/fallido, comisión, referencia interna,
  reembolso total/parcial y firma.
- `tests/pagos.test.ts`: métodos diferidos y validación de selección.
- `tests/edgePagos.test.ts`: compara la copia del servidor con la del frontend y
  prueba la validación de firma.
- `tests/cupones.test.ts`: reglas de descuento.
- Los adaptadores de Wompi aceptan `fetchImpl` para probarse con un `fetch`
  falso, sin llamar a la pasarela.

```bash
npm.cmd test
```

## 10. Seguridad

- Ninguna llave `WOMPI_*` vive en el cliente ni en variables `VITE_*`.
- `registrar_pago_interno` valida sesión, participación, estado `completada` y
  que el proveedor interno esté activo. El monto lo calcula el servidor.
- `registrar_evento_wompi` solo es ejecutable por `service_role`.
- El webhook valida la firma antes de tocar la base.
- Las tablas de transacciones tienen RLS: cada usuario ve solo lo suyo.

## 11. Pendiente de infraestructura

- [ ] Ejecutar las migraciones en el proyecto real (hoy el historial remoto
      está vacío).
- [ ] Crear las credenciales de Wompi/ePayco cuando la empresa tenga RUT.
- [ ] Configurar los secrets y el webhook antes de habilitar pagos reales.
- [ ] Probar un pago aprobado, uno declinado y un reembolso total/parcial en
      sandbox.
- [ ] Definir el mecanismo de payout al técnico (el neto queda registrado en
      `transacciones`; la transferencia se hace por fuera).
