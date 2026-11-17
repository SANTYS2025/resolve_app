/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string
  readonly VITE_SUPABASE_ANON_KEY: string
  /** DSN de Sentry. Sin él, el monitoreo de errores queda desactivado. */
  readonly VITE_SENTRY_DSN?: string
  /** Versión mostrada en los eventos de Sentry (por ejemplo 1.0.0). */
  readonly VITE_APP_VERSION?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
