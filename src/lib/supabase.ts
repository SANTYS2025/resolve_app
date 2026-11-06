import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

/**
 * Cliente único de Supabase.
 *
 * Persistencia de sesión explícita: Supabase guarda el token en `localStorage`
 * (también dentro del WebView de Capacitor) y lo renueva solo. Así, recargar la
 * app, cambiar de pestaña o volver del segundo plano NO cierra la sesión.
 *
 * No se cambia `storageKey` para no invalidar las sesiones que ya existen en
 * los dispositivos de los usuarios.
 */
export const supabase = createClient(
  supabaseUrl,
  supabaseAnonKey,
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      // En el navegador/WebView el almacenamiento por defecto ya es localStorage.
      // Se declara aquí para que el comportamiento no dependa de los defaults.
      storage: typeof window !== 'undefined' ? window.localStorage : undefined,
    },
  },
)
