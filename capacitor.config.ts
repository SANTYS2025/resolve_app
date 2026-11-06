import type { CapacitorConfig } from '@capacitor/cli'

/**
 * Empaqueta la app web (carpeta `dist`, generada por `npm run build`) como app Android.
 * SUPUESTO: el identificador del paquete es co.resolve.pasto. Cámbialo ANTES de `npx cap add android`
 * si quieres otro (no se puede cambiar fácilmente después de publicar en Play Store).
 */
const config: CapacitorConfig = {
  appId: 'co.resolve.pasto',
  appName: 'Resolve Pasto',
  webDir: 'dist',
  backgroundColor: '#000032',
  android: { backgroundColor: '#000032' },
  plugins: {
    // Requiere: npm install @capacitor/status-bar  (evita que el contenido quede bajo la barra de estado)
    StatusBar: { overlaysWebView: false, backgroundColor: '#000032', style: 'DARK' },
  },
}

export default config
