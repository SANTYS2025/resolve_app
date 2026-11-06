/**
 * Herramientas del cliente: favoritos y reportes de problemas.
 * Las políticas RLS impiden ver o modificar datos de otros clientes.
 */

import { supabase } from './supabase'

export type ReporteProblema = {
  id: number
  solicitudId: number
  categoria: 'no_llego' | 'trabajo_incompleto' | 'cobro_indebido' | 'trato' | 'otro'
  descripcion: string
  estado: 'abierto' | 'en_revision' | 'resuelto' | 'cerrado'
  creadoEn: string
}

export const CATEGORIAS_REPORTE: { id: ReporteProblema['categoria']; nombre: string }[] = [
  { id: 'no_llego', nombre: 'El técnico no llegó' },
  { id: 'trabajo_incompleto', nombre: 'El trabajo quedó incompleto o mal' },
  { id: 'cobro_indebido', nombre: 'Cobro indebido' },
  { id: 'trato', nombre: 'Trato inadecuado' },
  { id: 'otro', nombre: 'Otro problema' },
]

export async function getMisFavoritos(): Promise<number[]> {
  const { data, error } = await supabase.from('favoritos').select('tecnico_id')
  if (error) throw error
  return (data ?? []).map(f => Number(f.tecnico_id))
}

/** Devuelve true si el técnico quedó guardado como favorito. */
export async function alternarFavorito(tecnicoId: number): Promise<boolean> {
  const { data, error } = await supabase.rpc('alternar_favorito', { p_tecnico_id: tecnicoId })
  if (error) throw error
  return Boolean(data)
}

export async function getReportesSolicitud(solicitudId: number): Promise<ReporteProblema[]> {
  const { data, error } = await supabase
    .from('reportes_problemas')
    .select('id,solicitud_id,categoria,descripcion,estado,creado_en')
    .eq('solicitud_id', solicitudId)
    .order('creado_en', { ascending: false })
  if (error) throw error
  return (data ?? []).map(r => ({
    id: Number(r.id),
    solicitudId: Number(r.solicitud_id),
    categoria: r.categoria as ReporteProblema['categoria'],
    descripcion: String(r.descripcion),
    estado: r.estado as ReporteProblema['estado'],
    creadoEn: String(r.creado_en),
  }))
}

export async function reportarProblema(
  solicitudId: number,
  categoria: ReporteProblema['categoria'],
  descripcion: string,
): Promise<number> {
  const { data, error } = await supabase.rpc('reportar_problema', {
    p_solicitud_id: solicitudId,
    p_categoria: categoria,
    p_descripcion: descripcion,
  })
  if (error) throw error
  return Number(data)
}
