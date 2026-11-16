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
| JDK | **21** | compilar Android (Capacitor 8 no compila con 17) |
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
```

## Scripts

| Comando | Qué hace |
|---|---|
| `npm run dev` | servidor de desarrollo con recarga en caliente |
| `npm test` | suite completa (98 pruebas) |
| `npm run build` | compila la app web en `dist/` |
| `npm run preview` | sirve `dist/` localmente |
| `npm run format` | formatea con oxfmt |

Antes de subir cambios conviene ejecutar `npx tsc --noEmit`, `npm test` y
`npm run build`.

## APK de Android

El APK **ya no se versiona en Git**: se publica como asset del *Release* del tag
correspondiente. Para compilarlo localmente:

```powershell
$env:JAVA_HOME = "C:\Program Files\Android\Android Studio\jbr"
$env:ANDROID_HOME = "$env:LOCALAPPDATA\Android\Sdk"
npm run build
npx cap sync android
cd android
./gradlew assembleDebug
```

Resultado: `android/app/build/outputs/apk/debug/app-debug.apk`.
Guía detallada (incluido el APK firmado de release): [`docs/GENERAR_APK.md`](docs/GENERAR_APK.md).

### Publicar una versión nueva

El workflow [`.github/workflows/android-release.yml`](.github/workflows/android-release.yml)
se dispara al empujar un tag `v*`. Compila, corre las pruebas y adjunta
`ResolvePasto-<tag>.apk` al Release de ese tag (creándolo si no existe).

```bash
# 1. Asegúrate de que main está al día y en verde
git switch main
git pull
npm test

# 2. Crea el tag anotado y publícalo
git tag -a v1.0.0 -m "Resolve Pasto 1.0.0"
git push origin v1.0.0

# 3. Sigue el workflow en la pestaña Actions del repositorio.
#    Al terminar, el APK queda en:
#    https://github.com/SANTYS2025/resolve_app/releases/tag/v1.0.0
```

Notas:

- El `versionName` del APK se toma del tag (`v1.1.0` → `1.1.0`) y el
  `versionCode` se calcula como `mayor*10000 + menor*100 + parche`. El cambio se
  hace **solo en CI**; `android/app/build.gradle` no se modifica en el repo.
- El APK del workflow es **debug**, firmado con la clave de depuración del
  runner. Si ya tienes instalada una compilación local, puede que Android pida
  desinstalarla antes de instalar la del Release (claves distintas).
- Para distribuir en Google Play hace falta un **AAB firmado** con tu keystore
  (ver `docs/GENERAR_APK.md`). No subas el keystore ni sus contraseñas.

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
