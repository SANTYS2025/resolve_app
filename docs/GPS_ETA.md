# GPS del técnico, ETA y pérdida de señal

## 1. Qué se guarda

Solo la **última** posición de cada técnico en `public.ubicaciones_tecnicos`
(una fila por técnico). No se guarda un historial de recorrido: así la tabla es
pequeña y el canal Realtime barato.

| Columna | Uso |
|---|---|
| `tecnico_id` | PK; una posición vigente por técnico. |
| `solicitud_id` | Servicio para el que se comparte. |
| `lat`, `lng` | Coordenadas validadas en el servidor. |
| `precision_m` | Precisión reportada por el GPS. |
| `compartiendo` | `false` al llegar, terminar o cancelar. |
| `actualizado_en` | Frescura de la señal. |

## 2. Quién puede ver qué

- El **técnico** ve su propia posición.
- El **cliente** ve la posición únicamente:
  - de una solicitud suya,
  - mientras `compartiendo = true`, y
  - mientras el estado sea `confirmada`, `en_camino` o `llego`.
- Al pasar a `completada`, `cancelada`, `rechazada` o `expirada`, un trigger
  (`trg_solicitudes_cerrar_ubicacion`) pone `compartiendo = false`.
- `detener_ubicacion()` permite al técnico dejar de compartir manualmente.

## 3. Publicación desde el teléfono

`usePublicarUbicacion(solicitudId, activo)` en `src/lib/ubicacion.ts`:

- usa `navigator.geolocation.watchPosition` con alta precisión,
- envía como máximo **1 punto cada 10 s**,
- y solo si se movió más de ~10 m (o es el primer punto),
- llama a la RPC `publicar_ubicacion`,
- al desmontar (o al cambiar de estado) llama a `detener_ubicacion`.

La RPC valida en el servidor que quien publica sea el técnico asignado y que el
servicio esté en curso. No confía en el `solicitud_id` del cliente.

## 4. Realtime

`useUbicacionEnVivo(solicitudId, destino)` abre **un solo canal**:

```ts
supabase
  .channel(`ubicacion-solicitud-${solicitudId}`)
  .on('postgres_changes', {
    event: '*',
    schema: 'public',
    table: 'ubicaciones_tecnicos',
    filter: `solicitud_id=eq.${solicitudId}`,
  }, ...)
```

No hay polling agresivo ni un canal por técnico. Al recibir un cambio se vuelve
a leer la última fila; además se reevalúa la frescura cada 15 s para que la ETA
desaparezca aunque no lleguen más eventos.

## 5. Cálculo de la ETA

`src/lib/geo.ts`:

- distancia Haversine en línea recta,
- factor de ruta urbana `1.35`,
- velocidad urbana de referencia `22 km/h`,
- buffer de `3 min`,
- mínimo `1 min`.

La ETA se calcula **solo en el cliente**; el servidor no inventa tiempos.

## 6. Pérdida de señal (decisión de producto)

| Tiempo desde la última posición | Estado | Qué ve el cliente |
|---|---|---|
| ≤ 90 s | `reciente` | ETA normal (“Llega en ~N min”). |
| 90 s – 5 min | `debil` | ETA aproximada + “Señal débil”. |
| > 5 min | `sin_senal` | **Sin ETA numérica**: última ubicación conocida + “Sin señal”. |
| Nunca reportó | `sin_datos` | “Aún no tenemos la ubicación del técnico.” |

Nunca se muestra una ETA numérica con datos de más de 5 minutos.

## 7. Destino del cliente

El cliente intenta obtener su ubicación actual **una vez** al abrir el
seguimiento:

- Si acepta el permiso, se calcula la ETA contra ese punto.
- Si lo niega o falla, se muestra la última ubicación del técnico y el enlace a
  Google Maps, **sin ETA numérica**.

No se guarda la ubicación del cliente en la base.

## 8. Privacidad y batería

- La ubicación se comparte solo durante el servicio activo.
- Al terminar/cancelar se apaga automáticamente.
- El envío está limitado por tiempo y distancia.
- El cliente no puede leer posiciones históricas ni de otros servicios.

## 9. Pruebas

- `tests/geo.test.ts`: distancia, ETA, umbrales de señal y casos sin datos.
- `tests/disponibilidad.test.ts`: agenda y bloqueos del técnico (relacionado,
  pero independiente del GPS).
