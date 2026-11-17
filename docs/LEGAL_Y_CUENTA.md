# Legal, consentimiento y eliminación de cuenta

## 1. Qué hay en la app

| Pieza | Archivo |
|---|---|
| Textos legales (borrador) | `src/content/legal.ts` |
| Pantalla de términos/privacidad/datos | `src/features/Legal.tsx` (`LegalScreen`) |
| Casilla obligatoria del registro | `src/features/Legal.tsx` (`AceptoLegal`) |
| Zona peligrosa del perfil | `src/features/Legal.tsx` (`EliminarCuentaBox`) |
| Lógica de cuenta | `src/lib/cuenta.ts` |
| Tabla, RPC y trigger | `supabase/migrations/20261114_eliminar_cuenta_y_legales.sql` |

La pantalla legal se abre desde:

- el registro (enlaces de la casilla de aceptación), y
- Perfil → **Términos y privacidad**.

## 2. Consentimiento

### En el registro

La casilla es **obligatoria**: sin ella, `signUp` no se ejecuta. El registro
envía en `user_metadata`:

```json
{
  "acepto_terminos": true,
  "acepto_terminos_en": "2026-11-14T12:00:00.000Z",
  "version_legal": "2026-11-14"
}
```

Un trigger sobre `auth.users` (`trg_consentimiento_alta`) inserta la fila en
`public.consentimientos`. Esto funciona **incluso si la cuenta requiere
confirmación por correo**, porque no depende de que exista sesión.

### Después del registro

`registrar_consentimiento(p_tipo, p_version)` permite dejar constancia de
aceptaciones posteriores (por ejemplo, al publicar una versión nueva de los
términos). Es idempotente por `(usuario_id, tipo, version)`.

### Tabla `consentimientos`

| Columna | Notas |
|---|---|
| `usuario_id` | FK a `auth.users`, `ON DELETE CASCADE`. |
| `tipo` | `terminos`, `privacidad` o `datos`. |
| `version` | Texto corto (1–40 caracteres). |
| `aceptado_en` | Fecha y hora del consentimiento. |

RLS: cada usuario solo ve e inserta sus propias filas. `anon` no tiene acceso.

## 3. Eliminación de cuenta

### Flujo del cliente

1. Perfil → **Eliminar mi cuenta**.
2. Escribe `ELIMINAR` para confirmar.
3. `src/lib/cuenta.ts` borra los archivos del técnico en Storage (mejor
   esfuerzo) y llama a la RPC `eliminar_mi_cuenta()`.
4. La RPC anonimiza el perfil, borra datos personales y elimina el usuario de
   Auth. La app limpia la sesión y vuelve al splash.

### Qué borra la RPC

- Notificaciones, tokens push, preferencias, consentimientos, favoritos,
  códigos de referido, tickets y reportes del usuario.
- Mensajes de chat escritos por el usuario.
- Comentarios de calificaciones (la puntuación se conserva para el historial).
- Si es técnico: documentos, portafolio, cuentas bancarias, disponibilidad,
  bloqueos, ubicación y verificaciones.

### Qué conserva (y por qué)

- `public.usuarios`: la fila se mantiene **anonimizada** (`Cuenta eliminada`,
  correo `eliminado+<uuid>@resolve.invalid`, sin teléfono, `activo = false`).
  Sus FKs desde `solicitudes.cliente_id` y `transacciones.cliente_id` son
  `ON DELETE RESTRICT`: borrarla rompería el historial financiero.
- `solicitudes` y `transacciones`: registros del servicio y del pago.
- `tecnicos`: ficha anonimizada (`Técnico eliminado`, sin foto ni descripción).
- El usuario de `auth.users` **sí se elimina**, así que el acceso queda
  revocado y el correo puede volver a registrarse.

### Bloqueo por servicio activo

La RPC rechaza la eliminación si el usuario (cliente o técnico) tiene una
solicitud en estado `pendiente`, `aceptada`, `confirmada`, `en_camino`,
`llego`, `en_proceso`, `en_curso`, `en_espera` o `confirmada_en_espera`.
El mensaje pide terminarla o cancelarla primero.

## 4. ⚠️ Antes de publicar en Google Play

Los textos son un **BORRADOR funcional**. Un abogado debe revisar, como mínimo:

- Ley 1581 de 2012 y Decreto 1377 de 2013 (tratamiento de datos personales).
- Autorización explícita para datos sensibles (cédula y selfie de técnicos).
- Estatuto del Consumidor (Ley 1480 de 2013): precios, cancelaciones,
  reembolsos y responsabilidad.
- Correos de contacto reales (`soporte@` y `privacidad@resolvepasto.com`).
- Plazos de respuesta y procedimiento de consultas/reclamos.
- Política de conservación de registros financieros.

Al cambiar los textos, actualiza `VERSION_LEGAL` en `src/content/legal.ts` y
vuelve a pedir la aceptación cuando corresponda.

## 5. Pendiente de aplicar en Supabase

La migración no se aplicó desde este entorno (no hay credenciales de la base):

```bash
npx supabase db push
# o pegar el archivo en el SQL Editor del proyecto
```

Verifica después:

```sql
select * from public.consentimientos limit 5;
select public.eliminar_mi_cuenta(); -- con un usuario de prueba
```
