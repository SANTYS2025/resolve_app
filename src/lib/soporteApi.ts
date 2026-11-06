/**
 * Tickets de soporte (capa Supabase). Las FAQ y validaciones viven en
 * `soporte.ts`; aquí solo se persiste el ticket.
 */

import { supabase } from './supabase'
import type { CategoriaTicket } from './soporte'

export type TicketSoporte = {
  id: number
  categoria: CategoriaTicket
  asunto: string
  descripcion: string
  estado: 'abierto' | 'en_revision' | 'resuelto' | 'cerrado'
  respuesta: string | null
  solicitudId: number | null
  creadoEn: string
}

export async function getMisTickets(): Promise<TicketSoporte[]> {
  const { data, error } = await supabase
    .from('tickets_soporte')
    .select('id,categoria,asunto,descripcion,estado,respuesta,solicitud_id,creado_en')
    .order('creado_en', { ascending: false })
    .limit(50)
  if (error) throw error
  return (data ?? []).map(t => ({
    id: Number(t.id),
    categoria: t.categoria as CategoriaTicket,
    asunto: String(t.asunto),
    descripcion: String(t.descripcion),
    estado: t.estado as TicketSoporte['estado'],
    respuesta: t.respuesta ?? null,
    solicitudId: t.solicitud_id == null ? null : Number(t.solicitud_id),
    creadoEn: String(t.creado_en),
  }))
}

export async function crearTicket(p: {
  categoria: CategoriaTicket
  asunto: string
  descripcion: string
  solicitudId?: number | null
}): Promise<number> {
  const { data, error } = await supabase.rpc('crear_ticket_soporte', {
    p_categoria: p.categoria,
    p_asunto: p.asunto.trim(),
    p_descripcion: p.descripcion.trim(),
    p_solicitud_id: p.solicitudId ?? null,
  })
  if (error) throw error
  return Number(data)
}
