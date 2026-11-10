/**
 * Transacciones, comisiones y reembolsos (capa Supabase del cliente).
 * La lógica pura vive en `pagosCore.ts`; aquí solo se lee/escribe.
 *
 * Etapa actual: no hay proveedor real conectado. El pago manual lo confirma el
 * técnico y queda en la misma tabla `transacciones`, con comisión y eventos.
 * Cuando se habilite Wompi/ePayco, solo cambia el origen de la confirmación;
 * el historial, la comisión y los reembolsos ya son trazables.
 */

import { supabase } from './supabase'
import { errMsg } from './api'
import type { EstadoTransaccion } from './pagosCore'

export type Transaccion = {
  id: number
  solicitudId: number
  clienteId: string
  tecnicoId: number | null
  proveedor: 'interno' | 'wompi' | 'epayco' | 'efectivo' | 'transferencia'
  referencia: string
  proveedorTransaccionId: string | null
  estado: EstadoTransaccion
  montoCentavos: number
  comisionCentavos: number
  netoCentavos: number
  reembolsadoCentavos: number
  comisionReversadaCentavos: number
  moneda: string
  metodoPago: string | null
  creadaEn: string
  actualizadaEn: string
}

export type TransaccionEvento = {
  id: number
  tipo: string
  detalle: Record<string, unknown>
  creadoEn: string
}

export type Reembolso = {
  id: number
  transaccionId: number
  montoCentavos: number
  motivo: string
  estado: 'solicitado' | 'procesando' | 'aprobado' | 'rechazado' | 'fallido'
  creadoEn: string
}

type FilaTx = {
  id: number; solicitud_id: number; cliente_id: string; tecnico_id: number | null
  proveedor: Transaccion['proveedor']; referencia: string; proveedor_transaccion_id: string | null
  estado: EstadoTransaccion; monto_centavos: number; comision_centavos: number; neto_centavos: number
  reembolsado_centavos: number; comision_reversada_centavos: number; moneda: string
  metodo_pago: string | null; creada_en: string; actualizada_en: string
}

function mapTx(f: FilaTx): Transaccion {
  return {
    id: f.id,
    solicitudId: f.solicitud_id,
    clienteId: f.cliente_id,
    tecnicoId: f.tecnico_id,
    proveedor: f.proveedor,
    referencia: f.referencia,
    proveedorTransaccionId: f.proveedor_transaccion_id,
    estado: f.estado,
    montoCentavos: f.monto_centavos,
    comisionCentavos: f.comision_centavos,
    netoCentavos: f.neto_centavos,
    reembolsadoCentavos: f.reembolsado_centavos,
    comisionReversadaCentavos: f.comision_reversada_centavos,
    moneda: f.moneda,
    metodoPago: f.metodo_pago,
    creadaEn: f.creada_en,
    actualizadaEn: f.actualizada_en,
  }
}

const COLS = 'id,solicitud_id,cliente_id,tecnico_id,proveedor,referencia,proveedor_transaccion_id,estado,monto_centavos,comision_centavos,neto_centavos,reembolsado_centavos,comision_reversada_centavos,moneda,metodo_pago,creada_en,actualizada_en'

/** Historial visible para el usuario (cliente o técnico) según RLS. */
export async function getMisTransacciones(): Promise<Transaccion[]> {
  const { data, error } = await supabase
    .from('transacciones')
    .select(COLS)
    .order('creada_en', { ascending: false })
    .limit(100)
  if (error) throw error
  return ((data ?? []) as unknown as FilaTx[]).map(mapTx)
}

export async function getTransaccionesSolicitud(solicitudId: number): Promise<Transaccion[]> {
  const { data, error } = await supabase
    .from('transacciones')
    .select(COLS)
    .eq('solicitud_id', solicitudId)
    .order('creada_en', { ascending: false })
  if (error) throw error
  return ((data ?? []) as unknown as FilaTx[]).map(mapTx)
}

export async function getEventosTransaccion(transaccionId: number): Promise<TransaccionEvento[]> {
  const { data, error } = await supabase
    .from('transacciones_eventos')
    .select('id,tipo,detalle,creado_en')
    .eq('transaccion_id', transaccionId)
    .order('creado_en')
  if (error) throw error
  return ((data ?? []) as { id: number; tipo: string; detalle: Record<string, unknown>; creado_en: string }[])
    .map(e => ({ id: e.id, tipo: e.tipo, detalle: e.detalle ?? {}, creadoEn: e.creado_en }))
}

export async function getReembolsos(transaccionId: number): Promise<Reembolso[]> {
  const { data, error } = await supabase
    .from('reembolsos')
    .select('id,transaccion_id,monto_centavos,motivo,estado,creado_en')
    .eq('transaccion_id', transaccionId)
    .order('creado_en', { ascending: false })
  if (error) throw error
  return ((data ?? []) as { id: number; transaccion_id: number; monto_centavos: number; motivo: string; estado: Reembolso['estado']; creado_en: string }[])
    .map(r => ({ id: r.id, transaccionId: r.transaccion_id, montoCentavos: r.monto_centavos, motivo: r.motivo, estado: r.estado, creadoEn: r.creado_en }))
}

export async function getConfigComision(): Promise<{ pctBps: number; minimoCentavos: number }> {
  const { data, error } = await supabase
    .from('comisiones_config')
    .select('pct_bps,minimo_centavos')
    .eq('id', 1)
    .maybeSingle()
  if (error) throw error
  return { pctBps: Number(data?.pct_bps ?? 1000), minimoCentavos: Number(data?.minimo_centavos ?? 0) }
}

/**
 * Confirma un pago manual (Nequi / Bancolombia / Daviplata / efectivo).
 *
 * El servidor calcula el monto y la comisión; aquí no se envían valores de
 * dinero. Es idempotente: repetir la llamada devuelve la misma transacción.
 */
export async function registrarPagoInterno(solicitudId: number, metodo: string): Promise<Transaccion> {
  const { data, error } = await supabase.rpc('registrar_pago_interno', {
    p_solicitud_id: solicitudId,
    p_metodo: metodo,
  })
  if (error) throw error
  const fila = (Array.isArray(data) ? data[0] : data) as FilaTx | null
  if (!fila) throw new Error('El servidor no devolvió la transacción.')
  return mapTx(fila)
}

export type ResultadoReembolso = {
  estado: 'aprobado' | 'pendiente' | 'fallido' | 'error'
  mensaje: string
}

const MENSAJE_REEMBOLSO: Record<Reembolso['estado'], string> = {
  solicitado: 'Reembolso registrado. Queda pendiente de procesar.',
  procesando: 'Reembolso en proceso.',
  aprobado: 'Reembolso aprobado y registrado.',
  rechazado: 'El reembolso fue rechazado.',
  fallido: 'No se pudo completar el reembolso.',
}

/**
 * Solicita el reembolso (total o parcial) y deja rastro en el historial.
 *
 * Sin proveedor real el RPC `solicitar_reembolso` registra y aplica el
 * reembolso interno en el mismo acto. Con un proveedor habilitado, la fila
 * queda en `solicitado` y el webhook/equipo la procesa después.
 */
export async function solicitarReembolso(
  transaccionId: number,
  montoCentavos: number,
  motivo: string,
): Promise<ResultadoReembolso> {
  try {
    const { data, error } = await supabase.rpc('solicitar_reembolso', {
      p_transaccion_id: transaccionId,
      p_monto_centavos: Math.round(montoCentavos),
      p_motivo: motivo,
    })
    if (error) return { estado: 'error', mensaje: errMsg(error) }

    const reembolsoId = Number(data)
    if (!Number.isFinite(reembolsoId)) {
      return { estado: 'error', mensaje: 'El servidor no devolvió el reembolso.' }
    }

    const { data: fila, error: errFila } = await supabase
      .from('reembolsos')
      .select('estado')
      .eq('id', reembolsoId)
      .maybeSingle()
    if (errFila) return { estado: 'error', mensaje: errMsg(errFila) }

    const estado = (fila as { estado?: Reembolso['estado'] } | null)?.estado
    if (!estado) return { estado: 'pendiente', mensaje: MENSAJE_REEMBOLSO.solicitado }

    if (estado === 'aprobado') return { estado: 'aprobado', mensaje: MENSAJE_REEMBOLSO.aprobado }
    if (estado === 'rechazado' || estado === 'fallido') {
      return { estado: 'fallido', mensaje: MENSAJE_REEMBOLSO[estado] }
    }
    return { estado: 'pendiente', mensaje: MENSAJE_REEMBOLSO[estado] }
  } catch (e) {
    console.error(e)
    return { estado: 'error', mensaje: errMsg(e) }
  }
}
