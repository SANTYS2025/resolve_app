# Logotipos oficiales y recursos gráficos

Documento de trazabilidad del punto 13. Registra **qué recurso** usa Resolve,
**de dónde salió** y **cómo se verificó**. Ningún logotipo fue generado con IA,
recreado a mano ni tomado de capturas de pantalla.

## Regla de uso

- Los logotipos se usan solo para **identificar el método de pago** que el
  cliente elige. No implican patrocinio, alianza ni endorsement de la marca.
- Se conservan **proporciones y colores originales**. El componente
  `MetodoPagoLogo` ajusta solo la altura y deja que el ancho se calcule solo
  (`object-fit: contain`), sin estirar ni recortar.
- Los métodos aún no habilitados (tarjeta, Google Pay y Bre-B) **no**
  muestran logotipos de marca: usan iconos genéricos de Material Symbols para no
  fabricar una marca ni sugerir que el pago ya está disponible.
- No se usa el logotipo de Google Maps porque la app **no tiene SDK ni
  integración real** con Google Maps. Solo abre enlaces externos de ruta.

## Recursos incorporados

| Marca | Archivo | Formato | Fuente oficial | Notas |
|---|---|---|---|---|
| Nequi | `src/assets/brand/nequi.png` | PNG 256×256 transparente, 2.3 KB | Asset oficial del kit de prensa de Nequi, servido por `nequi.com.co` (`https://cdn.prod.website-files.com/6317a229ebf7723658463b4b/652fd8c4a4ac25119892bb21_256x256%20N.png`). Página: comunicado de la nueva identidad gráfica (18 oct. 2023). | Es el icono oficial “N” (negro + cuadrado magenta). No se recoloreó. El wordmark oficial del sitio es la versión clara para fondo oscuro (#ECE7F5); por eso se usa el icono de la app, no una versión alterada. |
| Bancolombia | `src/assets/brand/bancolombia.svg` | SVG vectorial, 6.9 KB | `https://www.bancolombia.com/wcm/connect/a67af2d6-c768-4f4f-a33b-fd58074f7ce9/logo-bancolombia-black.svg?MOD=AJPERES` (sitio oficial `bancolombia.com`). | Logotipo negro vigente, `viewBox="0 0 217 61"`, color original `#2C2A29`. Sin modificaciones. |
| Daviplata | `src/assets/brand/daviplata.svg` | SVG vectorial, 6.5 KB | Kit oficial `Logo y manual DaviPlata.zip` publicado en el portal para desarrolladores: `https://sunegocio.daviplata.com/sites/default/files/2022-10/Logo%20y%20manual%20DaviPlata.zip` → archivo `Daviplata.ai`, página 0 (logo a color). | Vector convertido a SVG con PyMuPDF, recortado a los límites del contenido (sin fondo) y sin cambiar los colores oficiales `#FF1A25` y `#1F191A`. Se eliminaron metadatos/clip paths innecesarios. |

### Iconos genéricos

Los iconos que no representan una marca externa son **Material Symbols
Outlined** de Google Fonts, licencia Apache 2.0:

- `credit_card` (tarjeta de crédito/débito)
- `account_balance_wallet` (Google Pay, deshabilitado)
- `swap_horiz` (Bre-B, deshabilitado)
- `payments` (efectivo habilitado; icono financiero de billete, no una marca inventada)
- `my_location`, `near_me`, `directions`, `map`, `location_on` (GPS y rutas)

Rutas oficiales:
`https://fonts.gstatic.com/s/i/short-term/release/materialsymbolsoutlined/<nombre>/default/24px.svg`

## Dónde se usan

| Pantalla / bloque | Archivo | Componente |
|---|---|---|
| Selección de método al crear la solicitud | `src/App.tsx` | `MetodoPagoGrid` |
| Confirmación “¡Solicitud enviada!” | `src/App.tsx` | `ConfirmScreen` |
| Detalle de la solicitud (cliente) | `src/App.tsx` | `PagoBox` |
| Información de pago del técnico | `src/App.tsx` | `PagoResumenTecnico` |
| Historial de pagos y reembolsos | `src/features/Extras.tsx` | `TransactionsScreen` |
| Atribución de geocodificación | `src/App.tsx` | Formulario de dirección (Nominatim/OSM) |
| Botones de ruta/ubicación | `src/App.tsx`, `src/features/Extras.tsx` | `DatosServicio`, `RastreoUbicacion` |

El mapeo vive en `src/components/MetodoPagoLogo.tsx`; los iconos en
`src/components/IconoMaterial.tsx`. `src/lib/pagos.ts` sigue siendo lógica pura
(sin importar imágenes), por lo que sus tests se ejecutan en Node sin Vite.

## OpenStreetMap y Nominatim

- La geocodificación inversa del formulario usa **Nominatim / OpenStreetMap**.
- Se muestra la atribución **“© OpenStreetMap contributors”** con enlace a
  `https://www.openstreetmap.org/copyright` justo debajo del botón de ubicación.
- No se muestra el logotipo de Google Maps en ninguna pantalla. Los botones
  dicen “Abrir ruta en el mapa” / “Cómo llegar en el mapa” y los enlaces
  externos siguen abriendo la app de mapas del celular.

## Verificación realizada

- `npx tsc --noEmit`: sin errores.
- `npm test`: **98/98** pruebas aprobadas (incluye catálogo de pagos).
- `npm run build`: compilación correcta. Recursos emitidos:
  `daviplata.svg` 6.54 KB, `bancolombia.svg` 6.97 KB; `nequi.png` queda
  embebido por ser menor a 4 KB.
- Render de comprobación en Edge headless a 390 CSS px y escala 2×: los tres
  logotipos conservan proporción, no hay pixelación ni recortes y se leen sobre
  fondo blanco.
- Validación XML de los SVG y verificación de que el PNG de Nequi tiene canal
  alfa y los colores oficiales.

## Entrega del APK

- Archivo: `apk/ResolvePasto-debug.apk`
- Tamaño: **5.291.187 bytes** (≈ 5,05 MiB). Incremento frente al APK anterior:
  **5.501 bytes**, por los dos SVG y el PNG embebido.
- SHA-256: `C99B988882A7F04E8652D39944C41571DE3936A78C7ADF6779E1ABB64442583C`
- Contenido comprobado dentro del APK:
  `assets/public/assets/bancolombia-C9aOz93v.svg`,
  `assets/public/assets/daviplata-CTcIF8eX.svg` y el PNG de Nequi embebido en
  el bundle JS. Los SHA-256 de los SVG dentro del APK coinciden con los archivos
  fuente de `src/assets/brand/`.

## Limitaciones y supuestos

- **Supuesto:** usar el icono “N” de Nequi como identificador oficial, ya que el
  wordmark disponible en el sitio es la variante clara para fondos oscuros y no
  se permite recolorear logotipos.
- Las condiciones de marca pueden cambiar. Antes de una publicación comercial,
  conviene revisar el manual vigente de cada empresa; este documento deja la
  fuente exacta para repetir la descarga.
- No se implementaron pasarelas de pago reales: el punto 13 es solo identidad
  visual. Nequi, Bancolombia y Daviplata siguen siendo transferencias manuales
  confirmadas por el técnico.
- La verificación visual se hizo en un navegador con viewport móvil. La
  comprobación final en un dispositivo Android real queda a cargo del usuario.
