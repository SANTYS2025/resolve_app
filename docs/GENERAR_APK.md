# Generar el APK de Resolve Pasto (Android)

La app es web (React + Vite). Se convierte en APK con **Capacitor**, que la empaqueta dentro de una app Android nativa.
Todo lo que necesita (iconos, pantalla de inicio, `capacitor.config.ts`) ya está en el proyecto.

## 0. Requisitos (una sola vez)
| Herramienta | Versión | Para qué |
|---|---|---|
| Node.js | 20 o superior | compilar la app web |
| JDK | **21** (Capacitor 8 no compila con 17) | compilar Android |
| Android Studio | reciente (con Android SDK 34+) | trae Gradle y el emulador |

Variables de entorno de Android Studio/Windows: define `JAVA_HOME` (carpeta del JDK **21**) y `ANDROID_HOME` (carpeta del SDK).

> Si en el computador solo hay JDK 17, instala un JDK 21 y apunta `JAVA_HOME` a él **solo para compilar**.
> En la compilación de este proyecto se usó un JDK 21 portable en
> `%TEMP%\opencode\jdk21\jdk-21.0.12.1+1` (fuera del repositorio).
>
> ```powershell
> $env:JAVA_HOME = "$env:TEMP\opencode\jdk21\jdk-21.0.12.1+1"
> $env:ANDROID_HOME = "$env:LOCALAPPDATA\Android\Sdk"
> $env:ANDROID_SDK_ROOT = $env:ANDROID_HOME
> ```

El archivo **`.env`** (con `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY`) debe existir en la raíz del proyecto **cuando compilas**: esos valores quedan incluidos dentro del APK.

`VITE_PAGOS_FUNCION` **ya no se usa**. Los pagos reales con tarjeta/Google Pay
están **diferidos** hasta que la empresa tenga RUT: la app solo registra pagos
manuales (efectivo, Nequi, Bancolombia, Bre-B) y el técnico los confirma. Las
llaves futuras de Wompi/ePayco serán secretos del servidor, nunca variables
`VITE_*`. Ver `docs/INTEGRACION_PAGOS.md`.

## 1. Instalar dependencias
En la carpeta `resolve_figma`:

```bash
npm install
npm install @capacitor/core @capacitor/android @capacitor/status-bar
npm install -D @capacitor/cli @capacitor/assets

# Push nativo (opcional pero necesario para notificaciones con la app cerrada)
npm install @capacitor/push-notifications
```

Para push también debes agregar `android/app/google-services.json` (Firebase)
y el plugin de Google Services en Gradle. Sin ese archivo, la app funciona y
muestra que el push no está disponible; las notificaciones quedan en la bandeja
de Supabase.

## 2. Compilar la app web
```bash
npm run build
```
Genera la carpeta `dist/`. Si falla, no sigas: el APK usaría una versión vieja o vacía.

## 3. Crear el proyecto Android (solo la primera vez)
```bash
npx cap add android
```
Crea la carpeta `android/`. El identificador del paquete es `co.resolve.pasto` (se define en `capacitor.config.ts`).

## 4. Iconos y pantalla de inicio
Usa las imágenes de la carpeta `assets/` (`icon-only.png`, `icon-foreground.png`, `splash.png`):

```bash
npx capacitor-assets generate --android
```

**Si ese comando falla con `sharp`** (pasa con Node 24, porque no hay binario compatible),
usa el script incluido, que genera exactamente los mismos iconos, icono adaptativo y splash
con System.Drawing de Windows:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\android-iconos.ps1
```

El fondo del icono adaptativo queda en `#000032`, el azul del logo (archivo
`android/app/src/main/res/values/ic_launcher_background.xml`).

## 5. Copiar la app web dentro de Android
```bash
npx cap sync android
```

## 5B. Base de datos (obligatorio para chat y pagos)
Antes de usar el APK, aplica las migraciones en **Supabase → SQL Editor**:

```
supabase/migrations/20261101_chat_pagos_cuenta_bancaria.sql
supabase/migrations/20261102_completar_solicitud.sql
supabase/migrations/20261103_confirmacion_tecnico_estados.sql
supabase/migrations/20261104_notificaciones_soporte.sql
supabase/migrations/20261105_pagos_wompi.sql
supabase/migrations/20261106_gps_eta.sql
supabase/migrations/20261107_clientes_tecnicos.sql
supabase/migrations/20261108_crecimiento.sql
supabase/migrations/20261109_pagos_internos.sql
supabase/migrations/20261110_archivos_tecnicos.sql
```

Las tres primeras son la base del chat y del flujo de estados. Las siguientes
agregan notificaciones/soporte, transacciones y comisiones, GPS/ETA, favoritos y
herramientas del técnico, cupones/referidos/cobertura, pagos internos y los
buckets de Storage para portafolio/documentos. Sin ellas, las pantallas nuevas
muestran error de tabla o RPC faltante.

Detalle completo y verificación: `docs/DESPLIEGUE_SUPABASE.md`.

## 6A. APK de PRUEBA (el más rápido)
```bash
cd android
./gradlew.bat assembleDebug --no-daemon   # en Linux/Mac: ./gradlew assembleDebug
```
Resultado: `android/app/build/outputs/apk/debug/app-debug.apk`

En este proyecto ya se generó una copia lista para instalar en:
`apk/ResolvePasto-debug.apk`.

(Alternativa con interfaz: `npx cap open android` → en Android Studio, menú **Build → Build Bundle(s) / APK(s) → Build APK(s)**.)

## 6B. APK FIRMADO (para repartir a otras personas)
1. Crea tu llave de firma (**guárdala y no la pierdas**; sin ella no podrás actualizar la app):
   ```bash
   keytool -genkey -v -keystore resolve.keystore -alias resolve -keyalg RSA -keysize 2048 -validity 10000
   ```
2. En Android Studio: **Build → Generate Signed Bundle / APK → APK**, elige `resolve.keystore`, variante **release**.
3. Resultado: `android/app/release/app-release.apk`.

> Google Play no acepta APK: pide **AAB** (en el mismo asistente elige *Android App Bundle*).
> No subas `resolve.keystore` ni sus contraseñas a Git.

## 7. Instalarlo en el celular
- **Por cable:** activa *Opciones de desarrollador → Depuración USB* y ejecuta `adb install -r app-debug.apk`.
- **Sin cable:** copia el `.apk` al celular (WhatsApp, Drive, USB), ábrelo y permite *Instalar apps de origen desconocido*.

## 8. Cada vez que cambies el código
```bash
npm test          # pruebas de chat, métodos de pago y estados de la solicitud
npm run build
npx cap sync android
cd android && ./gradlew.bat assembleDebug --no-daemon
```

Si cambias las imágenes de `assets/`, vuelve a ejecutar
`powershell -ExecutionPolicy Bypass -File scripts\android-iconos.ps1` antes de `cap sync`.

## Notas para esta app
- **Internet:** la app necesita conexión (Supabase y tiempo real por WebSocket seguro). Sin internet no carga datos.
- **Sesión:** se guarda en el almacenamiento local del dispositivo (`localStorage`, persistencia explícita de Supabase). Al cerrar y volver a abrir la app, o al cambiar de pestaña, la sesión se restaura; solo se pierde al tocar **Cerrar sesión** o si el token caduca y no se puede refrescar.
- **Chat por solicitud:** solo lo ven el cliente y el técnico asignado. Se puede escribir mientras el servicio está en curso (`aceptada`, `confirmada`, `en_camino`, `llego`); al terminarse queda en solo lectura.
- **Pagos:** el cliente elige el método **al crear la solicitud** y queda guardado. Al terminar el servicio puede cambiarlo entre los métodos manuales. El técnico pulsa **Confirmar pago recibido** y queda la transacción con comisión y neto. Tarjeta/Google Pay/Bre-B aparecen como **“Pronto”** porque los pagos reales están diferidos (ver `docs/INTEGRACION_PAGOS.md`); Nequi, Bancolombia, Daviplata y efectivo se acuerdan directamente con el técnico.
- **Cuenta bancaria del técnico:** el técnico verificado la registra en **Perfil** y solo él puede verla.
- **Disponibilidad del técnico:** se calcula con sus solicitudes activas. Sin servicios activos dice **Disponible**; al aceptar uno pasa a **Ocupado** en esa solicitud. Las solicitudes nuevas siguen llegando y, si las acepta, quedan en cola (`en_espera`) y se activan automáticamente al terminar la actual, en orden de aceptación.
- **Correo de confirmación al registrarse:** el enlace se abre en el navegador del celular; luego la persona vuelve a la app e ingresa.
- **Google Maps y GPS:** el botón “Usar Google Maps para ir al domicilio” abre Maps con la ruta y marca la solicitud como **en camino**. Mientras está en camino, la app comparte la ubicación del técnico (máx. 1 punto/10 s) y el cliente ve el mapa y la ETA. **Llegué al destino** registra la llegada. Si el técnico pierde señal >5 min, el cliente ve la última ubicación y “Sin señal”, sin ETA numérica.
- **Notificaciones:** la bandeja vive en Supabase. Para push con la app cerrada se necesita `@capacitor/push-notifications`, `google-services.json` y desplegar `enviar-push`. Sin eso, la app sigue funcionando y solo muestra los avisos en la bandeja.
- **Reconocimiento facial (cuando lo implementes):** habrá que agregar el permiso de cámara en `android/app/src/main/AndroidManifest.xml`.
- **Botón "atrás" de Android:** por defecto cierra la app desde la pantalla principal. Si quieres que navegue entre pantallas, hay que añadir el plugin `@capacitor/app` y manejar el evento `backButton`.

---

## Lista de pruebas en el celular (antes de entregar el APK)
Usa **dos celulares** (o un celular y el navegador): una cuenta de cliente y una de técnico aprobado.

**Cliente**
1. Iniciar sesión y ver el catálogo: solo aparecen técnicos aprobados, con sus fotos y especialidades sin texto raro.
2. La pantalla inicial muestra **Registrarme** (sin contador de técnicos) y los filtros por servicio se ven todos a la vez, sin desplazamiento horizontal.
3. Solicitar servicio: el celular muestra **teclado numérico** en "Celular"; la dirección es obligatoria (sin ella no deja enviar).
4. En el mismo formulario hay que elegir **cómo pagar** (7 métodos). Sin método no deja enviar; la pantalla de confirmación muestra el método elegido.
5. La pestaña inferior dice **Solicitudes**; la nueva solicitud aparece en "Pendiente" y **no** hay enlace "Ver historial".

**Técnico**
6. Al iniciar sesión cae en **Solicitudes** (no ve el catálogo de clientes). La solicitud nueva llega **sola**, con aviso, sin recargar. Arriba dice **Disponible**.
7. Antes de aceptar, la dirección aparece oculta. **Aceptar** → se muestran dirección, celular (toca para llamar), fecha y servicio, y el estado pasa a **Ocupado**.
8. Con el técnico ocupado, pedir otra solicitud desde otro cliente: la nueva aparece registrada, con el aviso de que no se puede aceptar hasta terminar la actual.
9. Escribir el **diagnóstico** y guardar.

**De vuelta en el cliente**
10. La solicitud muestra **“Técnico aceptó tu solicitud”** y el botón **Confirmar técnico**. Sin confirmar, el técnico no puede avanzar.
11. Al confirmar, el técnico ve el aviso “El cliente confirmó el servicio” y **Usar Google Maps para ir al domicilio**.
12. Ese botón abre Maps con la ruta **y** el cliente pasa a **“Técnico dirigiéndose a su domicilio”**.
13. El técnico toca **Llegué al destino** → el cliente ve **“Técnico llegó”** (los tres pasos quedan marcados).

**Cierre del servicio**
14. El técnico toca **Marcar terminada**. La solicitud sale de **Solicitudes vigentes**, aparece solo en **Historial de solicitudes finalizadas** y el técnico vuelve a **Disponible**. Al cliente le aparece automáticamente la pantalla **¿Cómo estuvo el servicio?**
15. Al enviar la calificación, en la misma pantalla el cliente ve y puede ajustar el método de pago; el técnico ve en el historial lo que el cliente calificó y comentó.
16. Recargar/cerrar y abrir la app: la solicitud terminada **no** reaparece como vigente en el técnico.

**Chat y pagos**
17. Con la solicitud activa, cliente y técnico abren **Chat**, envían mensajes y llegan solos al otro (sin recargar). Sigue escribible en **confirmada**, **en camino** y **llegó**. Un tercer usuario no puede leer ni escribir ese chat.
18. Al pasar a **Terminada**, el chat queda en solo lectura.
19. Elegir **Efectivo** → el técnico ve “Efectivo”. Elegir **Nequi / Bancolombia / Bre-B** → el cliente ve el aviso de pedirle los datos al técnico.
20. **Tarjeta / Google Pay** aparecen deshabilitados con “Pronto”; no se pueden elegir ni marcar como pagados.
20b. El técnico confirma el pago manual y el cliente ve **Pagado**; repetir la confirmación no duplica la transacción.
21. Técnico verificado → **Perfil → Cuenta bancaria**: guardar y volver a entrar; solo él ve los datos.

**General**
22. Girar el celular, abrir el teclado y volver a la app desde segundo plano: no se pierden datos ni se tapan botones.
23. Cerrar la app y abrirla de nuevo: la sesión sigue iniciada y se entra directo a la pantalla del rol.
24. Con modo avión unos segundos: el indicador muestra "Reconectando…" y al volver se actualiza solo.
