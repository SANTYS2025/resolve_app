/**
 * Cliente de Supabase con la llave de servicio.
 * NUNCA se importa desde el frontend: solo vive en Edge Functions.
 */

import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2'

export function adminClient(): SupabaseClient {
  const url = Deno.env.get('SUPABASE_URL')
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !key) throw new Error('Faltan SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en los secrets.')
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
}

/** Cliente con el JWT del usuario, para que `auth.uid()` funcione en las RPC. */
export function userClient(req: Request): SupabaseClient {
  const url = Deno.env.get('SUPABASE_URL')
  const anon = Deno.env.get('SUPABASE_ANON_KEY')
  const auth = req.headers.get('Authorization') ?? ''
  if (!url || !anon) throw new Error('Faltan SUPABASE_URL o SUPABASE_ANON_KEY en los secrets.')
  return createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: auth } },
  })
}

/** Usuario autenticado o null. */
export async function usuarioDe(req: Request) {
  const auth = req.headers.get('Authorization') ?? ''
  if (!auth.startsWith('Bearer ')) return null
  const admin = adminClient()
  const { data, error } = await admin.auth.getUser(auth.slice(7))
  if (error) return null
  return data.user
}
