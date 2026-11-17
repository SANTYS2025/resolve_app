# Resolve Pasto

App móvil (React + Capacitor) para conectar clientes con técnicos de oficios en
Pasto: solicitudes, chat, seguimiento por GPS, pagos manuales y panel del
técnico. «Tu hogar en buenas manos».

## Stack

- **React 19** + **Vite 8** + **Tailwind CSS 4** (TypeScript 5.7).
- **Capacitor 8** para empaquetar como app Android (`android/`).
- **Supabase** para datos, autenticación y Storage.
- Pruebas con el runner nativo de Node (`node --test`).

## Requisitos

| Herramienta | Versión | Para qué |
|---|---|---|
| Node.js | 22 | desarrollo, pruebas y build web |
| JDK | **21 o superior** | compilar Android (Capacitor 8 no compila con 17) |
| Android SDK | API 34+ | compilar el APK |

## Puesta en marcha

```bash
npm ci
npm run dev        # http://localhost:8443
```

Crea un `.env` en la raíz (no se versiona) con las credenciales del proyecto:

```dotenv
VITE_SUPABASE_URL=https://<proyecto>.supabase.co
VITE_SUPABASE_ANON_KEY=<anon-key>
# Opcional: monitoreo de errores (Sentry). Sin DSN queda desactivado.
VITE_SENTRY_DSN=
VITE_APP_VERSION=1.0.0
```

## Scripts

| Comando | Qué hace |
|---|---|
| `npm run dev` | servidor de desarrollo con recarga en caliente |
| `npm test` | suite completa (101 pruebas) |
| `npm run build` | compila la app web en `dist/` |
| `npm run preview` | sirve `dist/` localmente |
| `npm run apk` | compila y deja el APK de prueba en `apk/ResolvePasto.apk` |
| `npm run format` | formatea con oxfmt |

Antes de subir cambios conviene ejecutar `npx tsc --noEmit`, `npm test` y
`npm run build`.

## APK y AAB de Android

El APK **ya no se versiona en Git**: se publica como asset del *Release* del tag
correspondiente. Para probar en el celular hay **una sola ruta**:

```bash
npm run apk
```

Resultado: **`apk/ResolvePasto.apk`**. Ese es el único APK que deja el script:
compila la web, sincroniza Capacitor, compila Android y borra los APK anteriores
(y el intermedio de Gradle). Detecta solo un JDK 21+ (usa el de Android Studio si
`JAVA_HOME` apunta a un JDK 17) y el Android SDK.

Guía detallada (incluido el AAB firmado de release): [`docs/GENERAR_APK.md`](docs/GENERAR_APK.md).

### Publicar una versión nueva

El workflow [`.github/workflows/android-release.yml`](.github/workflows/android-release.yml)
se dispara al empujar un tag `v*`. Compila, corre las pruebas, exige los secretos
de firma y adjunta `ResolvePasto-<tag>.aab` (Google Play) y
`ResolvePasto-<tag>.apk` (instalación directa) al Release de ese tag.

```bash
# 1. Asegúrate de que main está al día y en verde
git switch main
git pull
npm test

# 2. Crea el tag anotado y publícalo
git tag -a v1.0.0 -m "Resolve Pasto 1.0.0"
git push origin v1.0.0

# 3. Sigue el workflow en la pestaña Actions del repositorio.
#    Al terminar, los artefactos quedan en:
#    https://github.com/SANTYS2025/resolve_app/releases/tag/v1.0.0
```

Secretos que el workflow necesita (Settings → Secrets and variables → Actions):

| Secreto | Contenido |
|---|---|
| `RESOLVE_KEYSTORE_BASE64` | keystore `.jks` codificado en base64 |
| `RESOLVE_KEYSTORE_PASSWORD` | contraseña del keystore |
| `RESOLVE_KEY_ALIAS` | alias de la clave |
| `RESOLVE_KEY_PASSWORD` | contraseña de la clave |
| `GOOGLE_SERVICES_JSON` | *(opcional)* contenido de `android/app/google-services.json`; sin él el AAB no entrega push FCM |

Si falta un secreto de firma, el workflow falla **antes de compilar** con un
mensaje que dice cuál falta. El AAB sale con R8 (`minifyEnabled`) y
`shrinkResources` activos; las reglas de Capacitor y Firebase están en
`android/app/proguard-rules.pro`.

Notas:

- El `versionName` se toma del tag (`v1.1.0` → `1.1.0`) y el `versionCode` se
  calcula como `mayor*10000 + menor*100 + parche`. El cambio se hace **solo en
  CI**; `android/app/build.gradle` no se modifica en el repo.
- El APK del Release está firmado con el keystore de producción, igual que el
  AAB: se puede instalar encima de versiones anteriores firmadas con la misma
  clave. Un APK local de debug tiene otra firma y Android pedirá desinstalarlo.
- Nunca subas el keystore ni `android/keystore.properties`: están en
  `.gitignore` y en CI llegan como secretos.

## Estructura

```
src/            app React (pantallas, lógica, assets)
src/imports/    logo en uso por la app
android/        proyecto nativo generado por Capacitor
public/         recursos web (splash, iconos)
docs/           documentación funcional y técnica
docs/brand/     originales del logotipo (SVG y PNG)
tests/          pruebas de la lógica de negocio
supabase/       migraciones SQL
```

## Documentación

- [`docs/DECISIONES_PRODUCTO.md`](docs/DECISIONES_PRODUCTO.md)
- [`docs/GENERAR_APK.md`](docs/GENERAR_APK.md)
- [`docs/DESPLIEGUE_SUPABASE.md`](docs/DESPLIEGUE_SUPABASE.md)
- [`docs/LOGOTIPOS_OFICIALES.md`](docs/LOGOTIPOS_OFICIALES.md)
- [`docs/brand/README.md`](docs/brand/README.md) — marca, paleta y hashes
- [`docs/INTEGRACION_PAGOS.md`](docs/INTEGRACION_PAGOS.md)
- [`docs/GPS_ETA.md`](docs/GPS_ETA.md)
- [`docs/NOTIFICACIONES_PUSH.md`](docs/NOTIFICACIONES_PUSH.md)
- [`docs/LEGAL_Y_CUENTA.md`](docs/LEGAL_Y_CUENTA.md) — términos, privacidad, consentimiento y eliminación de cuenta
- [`docs/OBSERVABILIDAD.md`](docs/OBSERVABILIDAD.md) — monitoreo de errores con Sentry
