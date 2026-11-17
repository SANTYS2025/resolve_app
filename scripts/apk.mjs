/**
 * Genera el APK de prueba en UNA sola ruta: `apk/ResolvePasto.apk`.
 *
 * Uso:
 *   npm run apk
 *
 * Hace todo el proceso:
 *   1. Busca un JDK 21+ (JAVA_HOME o el que trae Android Studio).
 *   2. Busca el Android SDK (ANDROID_HOME o la ruta por defecto).
 *   3. Compila la app web (`vite build`).
 *   4. Copia la app web dentro del proyecto Android (`cap sync`).
 *   5. Compila el APK de debug con Gradle.
 *   6. Deja el resultado en `apk/ResolvePasto.apk` y borra los demás APK.
 *
 * No firma para producción: para Google Play usa el workflow de release
 * (ver `docs/GENERAR_APK.md`, sección 6B).
 */
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const androidDir = path.join(root, 'android')
const apkDir = path.join(root, 'apk')
const destino = path.join(apkDir, 'ResolvePasto.apk')
const esWindows = process.platform === 'win32'

const info = (texto) => console.log(`\n▶ ${texto}`)
const ok = (texto) => console.log(`✔ ${texto}`)

function fallar(texto) {
  console.error(`\n✖ ${texto}\n`)
  process.exit(1)
}

/** Devuelve la versión mayor del JDK de una carpeta, o null si no sirve. */
function versionJava(home) {
  const ejecutable = path.join(home, 'bin', esWindows ? 'java.exe' : 'java')
  if (!fs.existsSync(ejecutable)) return null
  const salida = spawnSync(ejecutable, ['-version'], { encoding: 'utf8' })
  const texto = `${salida.stdout ?? ''}${salida.stderr ?? ''}`
  const coincidencia = texto.match(/version "(\d+)(?:\.(\d+))?/)
  if (!coincidencia) return null
  const mayor = Number(coincidencia[1])
  return mayor === 1 ? Number(coincidencia[2]) : mayor
}

function carpetasDe(base, patron) {
  try {
    return fs
      .readdirSync(base, { withFileTypes: true })
      .filter((entrada) => entrada.isDirectory() && (!patron || patron.test(entrada.name)))
      .map((entrada) => path.join(base, entrada.name))
  } catch {
    return []
  }
}

/** Candidatos a JDK, en orden de preferencia. */
function candidatosJava() {
  const casa = os.homedir()
  const candidatos = [
    process.env.JAVA_HOME,
    process.env.JDK_HOME,
    'C:\\Program Files\\Android\\Android Studio\\jbr',
    path.join(process.env.LOCALAPPDATA ?? '', 'Programs', 'Android Studio', 'jbr'),
    path.join(process.env.PROGRAMFILES ?? 'C:\\Program Files', 'Android', 'Android Studio', 'jbr'),
    '/Applications/Android Studio.app/Contents/jbr/Contents/Home',
    '/usr/local/opt/openjdk@21',
  ]

  const buscadores = [
    'C:\\Program Files\\Java',
    'C:\\Program Files\\Eclipse Adoptium',
    path.join(process.env.LOCALAPPDATA ?? '', 'Programs', 'Eclipse Adoptium'),
    path.join(casa, '.jdks'),
    path.join(casa, '.gradle', 'jdks'),
    '/Library/Java/JavaVirtualMachines',
    '/usr/lib/jvm',
  ]
  for (const base of buscadores) candidatos.push(...carpetasDe(base))

  return candidatos.filter(Boolean)
}

function elegirJava() {
  const vistos = new Set()
  const validos = []
  for (const candidato of candidatosJava()) {
    const home = path.resolve(candidato)
    if (vistos.has(home) || !fs.existsSync(home)) continue
    vistos.add(home)
    const mayor = versionJava(home)
    if (mayor && mayor >= 21) validos.push({ home, mayor })
  }
  if (validos.length === 0) {
    fallar(
      'No se encontró un JDK 21 o superior.\n' +
        'Instala el JDK 21 (o abre Android Studio una vez) y vuelve a ejecutar `npm run apk`.\n' +
        'También puedes definir JAVA_HOME a la carpeta del JDK 21.',
    )
  }
  // Preferimos el primero de la lista (JAVA_HOME / Android Studio) y no el más nuevo.
  return validos[0]
}

function elegirSdk() {
  const candidatos = [
    process.env.ANDROID_HOME,
    process.env.ANDROID_SDK_ROOT,
    path.join(process.env.LOCALAPPDATA ?? '', 'Android', 'Sdk'),
    path.join(os.homedir(), 'Library', 'Android', 'sdk'),
    path.join(os.homedir(), 'Android', 'Sdk'),
    '/usr/local/lib/android/sdk',
  ].filter(Boolean)

  for (const candidato of candidatos) {
    const sdk = path.resolve(candidato)
    if (fs.existsSync(path.join(sdk, 'platforms')) || fs.existsSync(path.join(sdk, 'platform-tools'))) {
      return sdk
    }
  }

  fallar(
    'No se encontró el Android SDK.\n' +
      'Instálalo desde Android Studio (SDK Manager) y define ANDROID_HOME.\n' +
      'Ruta habitual en Windows: %LOCALAPPDATA%\\Android\\Sdk',
  )
}

function ejecutar(comando, args, opciones = {}) {
  const resultado = spawnSync(comando, args, { stdio: 'inherit', ...opciones })
  if (resultado.error) fallar(`No se pudo ejecutar ${path.basename(comando)}: ${resultado.error.message}`)
  if (resultado.status !== 0) fallar(`Falló: ${path.basename(comando)} ${args.join(' ')}`)
}

function tamanoLegible(bytes) {
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}

function main() {
  if (!fs.existsSync(androidDir)) {
    fallar('No existe la carpeta `android/`. Ejecuta primero `npx cap add android`.')
  }

  info('Buscando JDK 21+')
  const java = elegirJava()
  ok(`JDK ${java.mayor}: ${java.home}`)

  info('Buscando Android SDK')
  const sdk = elegirSdk()
  ok(`SDK: ${sdk}`)

  const entorno = {
    ...process.env,
    JAVA_HOME: java.home,
    ANDROID_HOME: sdk,
    ANDROID_SDK_ROOT: sdk,
  }

  info('Compilando la app web')
  ejecutar(process.execPath, [path.join(root, 'node_modules', 'vite', 'bin', 'vite.js'), 'build'], {
    cwd: root,
    env: entorno,
  })

  info('Copiando la app web dentro de Android')
  ejecutar(
    process.execPath,
    [path.join(root, 'node_modules', '@capacitor', 'cli', 'bin', 'capacitor'), 'sync', 'android'],
    { cwd: root, env: entorno },
  )

  info('Compilando el APK de debug')
  // Llamamos al wrapper de Gradle con Java directamente: evita depender de la
  // shell del sistema y usa el JDK 21+ que acabamos de elegir.
  const wrapper = path.join(androidDir, 'gradle', 'wrapper', 'gradle-wrapper.jar')
  if (!fs.existsSync(wrapper)) fallar(`Falta ${wrapper}. Ejecuta \`npx cap sync android\`.`)
  ejecutar(
    path.join(java.home, 'bin', esWindows ? 'java.exe' : 'java'),
    ['-classpath', wrapper, 'org.gradle.wrapper.GradleWrapperMain', 'assembleDebug', '--no-daemon'],
    { cwd: androidDir, env: entorno },
  )

  const generado = path.join(androidDir, 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk')
  if (!fs.existsSync(generado)) fallar(`Gradle terminó pero no se encontró ${generado}`)

  fs.mkdirSync(apkDir, { recursive: true })
  for (const archivo of fs.readdirSync(apkDir)) {
    if (archivo.toLowerCase().endsWith('.apk')) fs.rmSync(path.join(apkDir, archivo), { force: true })
  }
  fs.copyFileSync(generado, destino)
  // Dejamos una sola ruta de APK en el proyecto.
  fs.rmSync(generado, { force: true })

  const bytes = fs.statSync(destino).size
  ok(`APK listo: ${destino} (${tamanoLegible(bytes)})`)
  console.log('\nCópialo al celular e instálalo (permite "origen desconocido").\n')
}

main()
