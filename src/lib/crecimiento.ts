/**
 * Crecimiento: cupones, referidos y cobertura (capa Supabase).
 * El servidor vuelve a validar TODO; estas funciones solo transportan datos.
 */

import { supabase } from './supabase'
import { normalizarCodigoCupon, validarCupon, type Cupon, type ResultadoCupon } from './cupones'
import { normalizarCodigoReferido } from './referidos'

export type ResultadoCuponServidor = ResultadoCupon

/** Valida contra la RPC (misma regla que `cupones.ts`) antes de mostrar el total. */
export async function validarCuponServidor(codigo: string, montoCentavos: number): Promise<ResultadoCuponServidor> {
  const limpio = normalizarCodigoCupon(codigo)
  if (!limpio) return { valido: false, motivo: 'Escribe un código de cupón.', descuentoCentavos: 0, totalCentavos: montoCentavos }
  const { data, error } = await supabase.rpc('validar_cupon', {
    p_codigo: limpio,
    p_monto_centavos: Math.max(0, Math.round(montoCentavos)),
  })
  if (error) throw error
  const fila = (Array.isArray(data) ? data[0] : data) as {
    valido?: boolean; motivo?: string; descuento_centavos?: number; total_centavos?: number
  } | null
  return {
    valido: Boolean(fila?.valido),
    motivo: fila?.motivo ?? '',
    descuentoCentavos: Number(fila?.descuento_centavos ?? 0),
    totalCentavos: Number(fila?.total_centavos ?? montoCentavos),
  }
}

/**
 * Aplica el cupón a una solicitud ya creada (antes de pagar).
 * Devuelve el descuento en centavos. El servidor registra el uso.
 */
export async function aplicarCuponSolicitud(solicitudId: number, codigo: string): Promise<number> {
  const { data, error } = await supabase.rpc('aplicar_cupon_solicitud', {
    p_solicitud_id: solicitudId,
    p_codigo: normalizarCodigoCupon(codigo),
  })
  if (error) throw error
  return Number(data ?? 0)
}

/** Atajo local para la vista previa (sin red). El cobro usa el servidor. */
export function previsualizarCupon(cupon: Cupon | null, montoCentavos: number): ResultadoCupon {
  return validarCupon(cupon, montoCentavos)
}

export type CodigoReferido = { codigo: string }

export async function getMiCodigoReferido(): Promise<string> {
  const { data, error } = await supabase.rpc('mi_codigo_referido')
  if (error) throw error
  return String(data ?? '')
}

export async function vincularReferido(codigo: string): Promise<void> {
  const limpio = normalizarCodigoReferido(codigo)
  if (!limpio) throw new Error('Escribe un código de referido.')
  const { error } = await supabase.rpc('vincular_referido', { p_codigo: limpio })
  if (error) throw error
}

export type Referido = {
  id: number
  codigo: string
  estado: 'pendiente' | 'recompensado' | 'expirado'
  recompensaCop: number
  creadoEn: string
  completadoEn: string | null
  /** true si el usuario es quien invitó; false si es el invitado. */
  esInvitador: boolean
}

/** Referidos donde el usuario participa (como invitador o como invitado). */
export async function getMisReferidos(usuarioId: string): Promise<Referido[]> {
  const { data, error } = await supabase
    .from('referidos')
    .select('id,codigo,referidor_id,estado,recompensa_cop,creado_en,completado_en')
    .order('creado_en', { ascending: false })
  if (error) throw error
  return (data ?? []).map(r => ({
    id: Number(r.id), codigo: String(r.codigo), estado: r.estado as Referido['estado'],
    recompensaCop: Number(r.recompensa_cop), creadoEn: String(r.creado_en),
    completadoEn: r.completado_en ?? null,
    esInvitador: r.referidor_id === usuarioId,
  }))
}

export type Cobertura = {
  barrioId: number
  barrio: string
  activo: boolean
  recargoCop: number
  nota: string | null
}

export async function getCobertura(): Promise<Cobertura[]> {
  const { data, error } = await supabase.rpc('cobertura_visible')
  if (error) throw error
  return ((data ?? []) as { barrio_id: number; barrio: string; activo: boolean; recargo_cop: number | null; nota: string | null }[]).map(c => ({
    barrioId: Number(c.barrio_id), barrio: String(c.barrio), activo: Boolean(c.activo),
    recargoCop: Number(c.recargo_cop ?? 0), nota: c.nota ?? null,
  }))
}
