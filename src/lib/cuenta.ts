/**
 * Cuenta: consentimiento legal y eliminación de la propia cuenta.
 *
 * La eliminación real vive en la RPC `eliminar_mi_cuenta` (migración
 * `20261114_eliminar_cuenta_y_legales.sql`): anonimiza el perfil, borra los
 * datos personales y elimina el usuario de Auth. Aquí solo se limpian los
 * archivos de Storage (mejor esfuerzo) antes de llamar a la RPC.
 */

import { supabase } from './supabase'
import { getMiTecnicoId } from './api'
import { VERSION_LEGAL } from '../content/legal'
import type { DocumentoLegalId } from '../content/legal'
import { BUCKET_DOCUMENTOS, BUCKET_PORTAFOLIO } from './tecnicosExtras'
import { BUCKET_AVATARES } from './avatares'

const BUCKETS_TECNICO = [BUCKET_DOCUMENTOS, BUCKET_PORTAFOLIO, BUCKET_AVATARES]

/**
 * Borra los archivos del técnico en los tres buckets. Si una política de
 * Storage lo impide, se continúa: la RPC igual elimina las filas de la base.
 */
async function borrarArchivosDelTecnico(): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return
  let tecnicoId: number | null = null
  try { tecnicoId = await getMiTecnicoId(user.id) } catch { tecnicoId = null }
  if (!tecnicoId) return

  const carpeta = String(tecnicoId)
  for (const bucket of BUCKETS_TECNICO) {
    try {
      const { data: archivos } = await supabase.storage.from(bucket).list(carpeta, { limit: 1000 })
      const rutas = (archivos ?? [])
        .filter(a => a.id != null && a.name)
        .map(a => `${carpeta}/${a.name}`)
      if (rutas.length > 0) await supabase.storage.from(bucket).remove(rutas)
    } catch (e) {
      console.warn(`No se pudieron borrar los archivos de ${bucket}:`, e)
    }
  }
}

/**
 * Elimina la cuenta del usuario autenticado. Es irreversible.
 * El servidor rechaza la operación si hay un servicio activo.
 */
export async function eliminarMiCuenta(): Promise<void> {
  await borrarArchivosDelTecnico()
  const { error } = await supabase.rpc('eliminar_mi_cuenta')
  if (error) throw error
  // El usuario ya no existe en Auth: se limpia la sesión local sin llamar al
  // servidor (el token actual ya no es válido).
  try { await supabase.auth.signOut({ scope: 'local' }) } catch { /* la sesión ya no es válida */ }
}

/** Deja constancia del consentimiento (idempotente por usuario/tipo/versión). */
export async function registrarConsentimiento(
  tipo: DocumentoLegalId = 'terminos',
  version = VERSION_LEGAL,
): Promise<void> {
  const { error } = await supabase.rpc('registrar_consentimiento', {
    p_tipo: tipo,
    p_version: version,
  })
  if (error) throw error
}
