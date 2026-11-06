/**
 * Herramientas del técnico: agenda con bloqueos, portafolio, documentos y
 * disponibilidad real. El horario semanal sigue viviendo en `disponibilidades`.
 */

import { supabase } from './supabase'
import { getDisponibilidades, getMiTecnicoId, type Disponibilidad } from './api'
import { estaDisponibleAhora, type Bloqueo, type Franja } from './disponibilidad'

export type BloqueoAgenda = { id: number; fecha: string; motivo: string | null }
export type PortafolioItem = {
  id: number
  titulo: string
  descripcion: string | null
  /** Enlace manual (compatibilidad) o URL pública derivada del archivo. */
  url: string | null
  /** Ruta dentro del bucket `portafolio-tecnicos`. */
  archivoPath: string | null
  creadoEn: string
}
export type DocumentoTecnico = {
  id: number
  tipo: 'cedula_frente' | 'cedula_reverso' | 'selfie' | 'certificado' | 'otro'
  nombre: string
  /** Enlace manual (compatibilidad) o URL firmada resuelta por la UI. */
  url: string | null
  /** Ruta dentro del bucket privado `documentos-tecnicos`. */
  archivoPath: string | null
  estado: 'pendiente' | 'aprobado' | 'rechazado'
  creadoEn: string
}

export const BUCKET_PORTAFOLIO = 'portafolio-tecnicos'
export const BUCKET_DOCUMENTOS = 'documentos-tecnicos'

export const TIPOS_DOCUMENTO: { id: DocumentoTecnico['tipo']; nombre: string }[] = [
  { id: 'cedula_frente', nombre: 'Cédula (frente)' },
  { id: 'cedula_reverso', nombre: 'Cédula (reverso)' },
  { id: 'selfie', nombre: 'Selfie de verificación' },
  { id: 'certificado', nombre: 'Certificado del oficio' },
  { id: 'otro', nombre: 'Otro documento' },
]

export async function getBloqueos(tecnicoId: number): Promise<BloqueoAgenda[]> {
  const { data, error } = await supabase
    .from('bloqueos_agenda')
    .select('id,fecha,motivo')
    .eq('tecnico_id', tecnicoId)
    .gte('fecha', new Date().toLocaleDateString('en-CA'))
    .order('fecha')
  if (error) throw error
  return (data ?? []).map(b => ({ id: Number(b.id), fecha: String(b.fecha), motivo: b.motivo ?? null }))
}

export async function crearBloqueo(fecha: string, motivo: string | null): Promise<number> {
  const { data, error } = await supabase.rpc('crear_bloqueo_agenda', {
    p_fecha: fecha,
    p_motivo: motivo?.trim() || null,
  })
  if (error) throw error
  return Number(data)
}

export async function eliminarBloqueo(id: number): Promise<void> {
  const { error } = await supabase.rpc('eliminar_bloqueo_agenda', { p_id: id })
  if (error) throw error
}

export async function getPortafolio(tecnicoId: number): Promise<PortafolioItem[]> {
  const { data, error } = await supabase
    .from('portafolio_tecnicos')
    .select('id,titulo,descripcion,url,archivo_path,creado_en')
    .eq('tecnico_id', tecnicoId)
    .order('creado_en', { ascending: false })
  if (error) throw error
  return (data ?? []).map(p => ({
    id: Number(p.id), titulo: String(p.titulo), descripcion: p.descripcion ?? null,
    url: p.url ?? null, archivoPath: p.archivo_path ?? null, creadoEn: String(p.creado_en),
  }))
}

export async function guardarPortafolio(usuarioId: string, p: {
  titulo: string; descripcion?: string; url?: string; archivoPath?: string
}): Promise<void> {
  const tecnicoId = await getMiTecnicoId(usuarioId)
  if (!tecnicoId) throw new Error('Solo un técnico puede publicar portafolio.')
  const url = p.url?.trim() || null
  const archivoPath = p.archivoPath?.trim() || null
  if (!url && !archivoPath) throw new Error('Sube una foto o pega un enlace.')
  const { error } = await supabase.from('portafolio_tecnicos').insert({
    tecnico_id: tecnicoId,
    titulo: p.titulo.trim(),
    descripcion: p.descripcion?.trim() || null,
    url,
    archivo_path: archivoPath,
  })
  if (error) throw error
}

export async function eliminarPortafolio(id: number): Promise<void> {
  const { error } = await supabase.from('portafolio_tecnicos').delete().eq('id', id)
  if (error) throw error
}

export async function getMisDocumentos(usuarioId: string): Promise<DocumentoTecnico[]> {
  const tecnicoId = await getMiTecnicoId(usuarioId)
  if (!tecnicoId) return []
  const { data, error } = await supabase
    .from('documentos_tecnicos')
    .select('id,tipo,nombre,url,archivo_path,estado,creado_en')
    .eq('tecnico_id', tecnicoId)
    .order('creado_en', { ascending: false })
  if (error) throw error
  return (data ?? []).map(d => ({
    id: Number(d.id), tipo: d.tipo as DocumentoTecnico['tipo'], nombre: String(d.nombre),
    url: d.url ?? null, archivoPath: d.archivo_path ?? null,
    estado: d.estado as DocumentoTecnico['estado'], creadoEn: String(d.creado_en),
  }))
}

export async function guardarDocumento(usuarioId: string, d: {
  tipo: DocumentoTecnico['tipo']; nombre: string; url?: string; archivoPath?: string
}): Promise<void> {
  const tecnicoId = await getMiTecnicoId(usuarioId)
  if (!tecnicoId) throw new Error('Solo un técnico puede subir documentos.')
  const url = d.url?.trim() || null
  const archivoPath = d.archivoPath?.trim() || null
  if (!url && !archivoPath) throw new Error('Sube un archivo o pega un enlace.')
  const { error } = await supabase.from('documentos_tecnicos').insert({
    tecnico_id: tecnicoId,
    tipo: d.tipo,
    nombre: d.nombre.trim(),
    url,
    archivo_path: archivoPath,
  })
  if (error) throw error
}

/* ───────── Archivos en Supabase Storage ───────── */

function extensionDe(nombre: string, tipoMime: string): string {
  const ext = /\.([a-z0-9]{1,8})$/i.exec(nombre)?.[1]?.toLowerCase()
  if (ext) return ext
  if (tipoMime === 'application/pdf') return 'pdf'
  if (tipoMime === 'image/png') return 'png'
  if (tipoMime === 'image/webp') return 'webp'
  return 'jpg'
}

function nombreUnico(): string {
  const c = globalThis.crypto
  if (c && typeof c.randomUUID === 'function') return c.randomUUID()
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`
}

/**
 * Sube una foto de portafolio o un documento al bucket correspondiente.
 * Devuelve la ruta guardada en la base de datos (`<tecnico_id>/<uuid>.<ext>`).
 */
export async function subirArchivoTecnico(
  usuarioId: string,
  destino: 'portafolio' | 'documento',
  archivo: File,
): Promise<string> {
  const tecnicoId = await getMiTecnicoId(usuarioId)
  if (!tecnicoId) throw new Error('Solo un técnico puede subir archivos.')
  const bucket = destino === 'portafolio' ? BUCKET_PORTAFOLIO : BUCKET_DOCUMENTOS
  const path = `${tecnicoId}/${nombreUnico()}.${extensionDe(archivo.name, archivo.type)}`
  const { error } = await supabase.storage.from(bucket).upload(path, archivo, {
    cacheControl: '3600',
    upsert: false,
    contentType: archivo.type || undefined,
  })
  if (error) throw error
  return path
}

/** URL pública de una foto de portafolio (el bucket es de lectura pública). */
export function urlPublicaPortafolio(path: string): string {
  return supabase.storage.from(BUCKET_PORTAFOLIO).getPublicUrl(path).data.publicUrl
}

/** URL firmada temporal para ver un documento privado. */
export async function urlFirmadaDocumento(path: string, segundos = 600): Promise<string> {
  const { data, error } = await supabase.storage
    .from(BUCKET_DOCUMENTOS)
    .createSignedUrl(path, segundos)
  if (error) throw error
  return data.signedUrl
}

export type DisponibilidadReal = {
  franjas: Disponibilidad[]
  bloqueos: BloqueoAgenda[]
  disponibleAhora: boolean
}

/**
 * Combina horario semanal + bloqueos por fecha. No consulta solicitudes activas:
 * eso lo sigue resolviendo `disponibilidadTecnico` con las solicitudes.
 */
export async function getDisponibilidadReal(tecnicoId: number, ahora = new Date()): Promise<DisponibilidadReal> {
  const [franjas, bloqueos] = await Promise.all([getDisponibilidades(tecnicoId), getBloqueos(tecnicoId)])
  const paraCalculo: Franja[] = franjas.map(f => ({
    dia_semana: f.dia_semana,
    hora_inicio: f.hora_inicio,
    hora_fin: f.hora_fin,
  }))
  const bloqueosCalculo: Bloqueo[] = bloqueos.map(b => ({ fecha: b.fecha, motivo: b.motivo }))
  return {
    franjas,
    bloqueos,
    disponibleAhora: estaDisponibleAhora(paraCalculo, ahora, bloqueosCalculo),
  }
}
