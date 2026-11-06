import { useEffect, useState } from 'react'
import type { User } from '@supabase/supabase-js'
import { supabase } from './supabase'
import { ESTADOS_PAGO, esMetodoPago, estadoPagoInicial } from './pagos'
import type { MetodoPago, PagoEstado } from './pagos'
import { estaDisponibleAhora, fechaLocal } from './disponibilidad'
import type { Bloqueo, Franja } from './disponibilidad'
import { ESTADOS_ACTIVOS_TECNICO } from './solicitudes'

/* ───────── Tipos ───────── */
export type Rol = 'cliente' | 'tecnico' | 'admin'
export type Genero = 'hombre' | 'mujer'
export type Perfil = { id: string; nombre: string; email: string; telefono: string | null; rol: Rol }
export type Categoria = { id: number; nombre: string; icono: string | null }
export type Barrio = { id: number; nombre: string }
export type Disponibilidad = { dia_semana: number; hora_inicio: string; hora_fin: string }

export type WorkerType = {
  id: number; name: string; trade: string; description: string
  category: string; categoryId: number | null; neighborhood: string
  rating: number; reviews: number; priceMin: number; priceMax: number
  years: number; jobs: number; avatar: string; verified: boolean
  genero: Genero // define la foto por defecto cuando el técnico no subió una
  /** Está dentro de su horario, sin bloqueo hoy y sin un servicio activo. */
  disponibleAhora: boolean
}

/** Calificación de 1 a 5 con las tres preguntas de comportamiento. */
export type Calificacion = { puntuacion: number; puntualidad: number; trato: number; cumplimiento: number; comentario: string | null }

export type Pedido = {
  id: number; estado: string; fecha: string; descripcion: string
  nombreContacto: string; telefonoContacto: string
  direccion: string | null // dirección de residencia del cliente (solicitudes antiguas: null)
  diagnostico: string | null; diagnosticoEn: string | null // lo registra el técnico tras aceptar
  precioMin: number | null; precioMax: number | null; precioFinal: number | null
  descuentoCentavos: number // cupón aplicado (centavos); 0 si no hay cupón
  cuponCodigo: string | null
  tecnicoId: number; tecnicoNombre: string
  calificada: boolean // true si QUIEN CONSULTA ya calificó este servicio
  calificacionCliente: Calificacion | null // lo que el cliente calificó: la ve el técnico
  metodoPago: MetodoPago | null // el cliente lo elige al crear la solicitud (puede cambiarlo al terminarla)
  metodoPagoEn: string | null
  pagoEstado: PagoEstado
}

/** Mensaje del chat privado de una solicitud. */
export type MensajeSolicitud = {
  id: number
  solicitudId: number
  autorId: string
  autorRol: 'cliente' | 'tecnico'
  contenido: string
  creadoEn: string // ISO 8601
}

/** Cuenta bancaria donde el técnico recibe las transferencias. */
export type CuentaBancaria = {
  banco: string
  tipoCuenta: 'ahorros' | 'corriente'
  numeroCuenta: string
  titular: string
  documento: string | null
  actualizadoEn: string
}

/* ───────── Utilidades ───────── */
export function errMsg(e: unknown): string {
  const m = typeof e === 'object' && e !== null && 'message' in e
    ? String((e as { message: unknown }).message) : String(e ?? '')
  if (/invalid login credentials/i.test(m)) return 'Correo o contraseña incorrectos.'
  if (/already registered|already been registered/i.test(m)) return 'Ese correo ya está registrado.'
  if (/rate limit/i.test(m)) return 'Demasiados intentos. Espera unos minutos e intenta de nuevo.'
  if (/email not confirmed/i.test(m)) return 'Confirma tu correo antes de ingresar.'
  if (/failed to fetch|networkerror/i.test(m)) return 'Sin conexión. Revisa tu internet.'
  if (/database error saving new user/i.test(m)) return 'No se pudo crear tu cuenta. Intenta de nuevo en unos minutos.'
  if (/could not find the function|function .* does not exist/i.test(m)) return 'Falta aplicar una actualización de la base de datos. Contacta al administrador.'
  if (/relation .* does not exist|column .* does not exist/i.test(m)) return 'Falta aplicar la migración de chat y pagos en Supabase. Contacta al administrador.'
  return m || 'Ocurrió un error inesperado.'
}

/** Devuelve 10 dígitos de celular colombiano o null si es inválido. */
export function normCel(s: string): string | null {
  let d = s.replace(/\D/g, '')
  if (d.length === 12 && d.startsWith('57')) d = d.slice(2)
  return /^3\d{9}$/.test(d) ? d : null
}

export const fmt = (n: number) => '$' + n.toLocaleString('es-CO')

/* ───────── Filtros de entrada (se aplican mientras el usuario escribe) ───────── */
/** Solo dígitos (celular, cédula, años, tarifas). `max` recorta el largo. */
export const soloDigitos = (v: string, max = 20) => v.replace(/\D/g, '').slice(0, max)
/** Nombres: letras (con tildes/ñ), espacios, apóstrofo, punto y guion. */
export const soloNombre = (v: string, max = 60) => v.replace(/[^\p{L}\s'.-]/gu, '').replace(/\s{2,}/g, ' ').slice(0, max)
/** Dirección: letras, números y signos habituales (# - . , ° / ). */
export const soloDireccion = (v: string, max = 150) => v.replace(/[^\p{L}\p{N}\s#.,°/\-ºª]/gu, '').replace(/\s{2,}/g, ' ').slice(0, max)
export const esCorreo = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s)

/**
 * Enlace de Google Maps con RUTA hacia el domicilio. En el celular abre la app de Maps.
 * Se agrega "Pasto, Nariño" para acotar la búsqueda (la app opera en Pasto).
 */
export const urlGoogleMaps = (direccion: string) =>
  `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(`${direccion}, Pasto, Nariño, Colombia`)}&travelmode=driving`

/**
 * Quita identificadores de iconos Font Awesome que llegan pegados al texto
 * ("fa-hammer Carpintería", "fas fa-wrench Plomería") y deja solo el nombre.
 */
export function limpiarEtiqueta(s: string | null | undefined): string {
  const t = (s ?? '').replace(/\b(?:fa-[\w-]+|fa[srlbd]?)(?![\w-])/gi, ' ').replace(/\s+/g, ' ').trim()
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : ''
}

// Nombres femeninos que NO terminan en "a" y masculinos que SÍ terminan en "a" (respaldo de inferirGenero)
const FEM_SIN_A = new Set(['carmen', 'beatriz', 'isabel', 'mercedes', 'pilar', 'rosario', 'dolores', 'soledad', 'esther', 'ruth', 'raquel', 'miriam', 'noemi', 'yaneth', 'jennifer', 'ingrid', 'maribel', 'rocio', 'consuelo', 'luz', 'flor', 'inés', 'ines'])
const MASC_CON_A = new Set(['luca', 'nicola', 'joshua', 'elia', 'jha', 'borja', 'barrabas'])

/**
 * Respaldo cuando el técnico no tiene `genero` guardado: se deduce del PRIMER nombre.
 * Es una heurística; lo correcto es guardar el género en el registro (ver V1Screen).
 */
export function inferirGenero(nombreCompleto: string): Genero {
  const primero = nombreCompleto.trim().split(/\s+/)[0]?.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '') ?? ''
  if (FEM_SIN_A.has(primero)) return 'mujer'
  if (MASC_CON_A.has(primero)) return 'hombre'
  return primero.endsWith('a') ? 'mujer' : 'hombre'
}

/* ───────── Hook de datos (loading / error / reload) ───────── */
export function useData<T>(fn: () => Promise<T>, deps: unknown[], initial: T) {
  const [data, setData] = useState<T>(initial)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    let alive = true
    setLoading(true); setError(null)
    fn()
      .then(d => { if (alive) setData(d) })
      .catch(e => { console.error(e); if (alive) setError(errMsg(e)) })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick])

  return { data, loading, error, reload: () => setTick(t => t + 1) }
}

/* ───────── Perfil ───────── */
const PERFIL_COLS = 'id,nombre,email,telefono,rol'

/** Lee el perfil; si el trigger no lo creó, lo crea (respaldo seguro vía RLS). */
export async function ensurePerfil(user: User): Promise<Perfil> {
  const { data, error } = await supabase.from('usuarios').select(PERFIL_COLS).eq('id', user.id).maybeSingle()
  if (error) throw error
  if (data) return data as Perfil

  const nuevo = {
    id: user.id,
    nombre: String(user.user_metadata?.nombre || user.email || 'Usuario'),
    email: user.email ?? '',
    rol: user.user_metadata?.rol === 'tecnico' ? 'tecnico' : 'cliente',
  }
  const { data: creado, error: e2 } = await supabase.from('usuarios').insert(nuevo).select(PERFIL_COLS).single()
  if (e2) throw e2
  return creado as Perfil
}

export async function getMiTecnicoId(usuarioId: string): Promise<number | null> {
  const { data, error } = await supabase.from('tecnicos').select('id').eq('usuario_id', usuarioId).order('id').limit(1)
  if (error) throw error
  return data?.[0]?.id ?? null
}

export async function getMiVerificacion(usuarioId: string): Promise<{ verificado: boolean; estado: string | null } | null> {
  const { data, error } = await supabase
    .from('tecnicos').select('verificado, verificaciones(estado)').eq('usuario_id', usuarioId).maybeSingle()
  if (error) throw error
  if (!data) return null
  const v = data.verificaciones as unknown as { estado: string } | { estado: string }[] | null
  const estado = Array.isArray(v) ? v[0]?.estado ?? null : v?.estado ?? null
  return { verificado: data.verificado as boolean, estado }
}

/**
 * Estado de aprobación del técnico que inició sesión.
 * Aprobado = `tecnicos.verificado = true`. Es la MISMA regla que usa el catálogo público,
 * así que un técnico solo recibe solicitudes si también aparece en el catálogo.
 * `tieneFicha=false` significa que aún no completó el registro de su oficio.
 */
export async function getEstadoAprobacion(usuarioId: string): Promise<{ tieneFicha: boolean; aprobado: boolean }> {
  const v = await getMiVerificacion(usuarioId)
  if (!v) return { tieneFicha: false, aprobado: false }
  return { tieneFicha: true, aprobado: v.verificado === true }
}

/** Guarda el género del técnico tras registrarse. Mejor esfuerzo: si la columna o la política no existen, se ignora. */
export async function guardarGenero(usuarioId: string, genero: Genero): Promise<void> {
  const { error } = await supabase.from('tecnicos').update({ genero }).eq('usuario_id', usuarioId)
  if (error) console.warn('No se pudo guardar el género (¿corriste la migración?):', error.message)
}

/* ───────── Catálogo ───────── */
export async function getCategorias(): Promise<Categoria[]> {
  const { data, error } = await supabase.from('categorias').select('id,nombre,icono').eq('activa', true).order('nombre')
  if (error) throw error
  return (data ?? []).map(c => ({ ...c, nombre: limpiarEtiqueta(c.nombre) }))
}

export async function getBarrios(): Promise<Barrio[]> {
  const { data, error } = await supabase.from('barrios').select('id,nombre').eq('activo', true).order('nombre')
  if (error) throw error
  return data ?? []
}

type TecnicoRow = {
  id: number; nombre_publico: string; especialidad: string; descripcion: string | null
  precio_min: number | string; precio_max: number | string; anios_experiencia: number
  foto_url: string | null; verificado: boolean; categoria_id: number | null
  categoria: string | null; barrio: string | null
  rating: number | string; resenas: number; trabajos: number
}

export async function getTecnicos(): Promise<WorkerType[]> {
  const { data, error } = await supabase
    .from('tecnicos_publicos').select('*')
    .eq('verificado', true) // solo técnicos aprobados
    .order('rating', { ascending: false }).order('resenas', { ascending: false }).limit(100)
  if (error) throw error

  // Género por técnico (vista tecnicos_genero de la migración). Si no existe aún, se deduce del nombre.
  const generos = new Map<number, Genero>()
  const g = await supabase.from('tecnicos_genero').select('id,genero')
  if (!g.error) for (const r of (g.data ?? []) as { id: number; genero: string | null }[]) if (r.genero === 'hombre' || r.genero === 'mujer') generos.set(r.id, r.genero)

  /*
   * Disponibilidad "ahora": horario semanal + bloqueos de hoy + servicio activo.
   * Si el técnico aún no configuró horario, no se oculta: se considera
   * disponible salvo que tenga un servicio en curso (decisión compatible con
   * los técnicos existentes, que no tenían agenda).
   */
  const [disp, bloqueos, activas] = await Promise.all([
    supabase.from('disponibilidades').select('tecnico_id,dia_semana,hora_inicio,hora_fin').eq('activo', true),
    supabase.from('bloqueos_agenda').select('tecnico_id,fecha').eq('fecha', fechaLocal()),
    supabase.from('solicitudes').select('tecnico_id').in('estado', [...ESTADOS_ACTIVOS_TECNICO]).not('tecnico_id', 'is', null),
  ])

  const franjasPorTecnico = new Map<number, Franja[]>()
  for (const f of (disp.error ? [] : (disp.data ?? [])) as { tecnico_id: number; dia_semana: number; hora_inicio: string; hora_fin: string }[]) {
    const lista = franjasPorTecnico.get(f.tecnico_id) ?? []
    lista.push({ dia_semana: f.dia_semana, hora_inicio: f.hora_inicio, hora_fin: f.hora_fin })
    franjasPorTecnico.set(f.tecnico_id, lista)
  }
  const bloqueados = new Set<number>(
    (bloqueos.error ? [] : (bloqueos.data ?? [])).map(b => Number((b as { tecnico_id: number }).tecnico_id)),
  )
  const ocupados = new Set<number>(
    (activas.error ? [] : (activas.data ?? [])).map(s => Number((s as { tecnico_id: number }).tecnico_id)),
  )
  const ahora = new Date()

  return ((data ?? []) as TecnicoRow[]).map(t => {
    const franjas = franjasPorTecnico.get(t.id) ?? []
    const bloqueoHoy: Bloqueo[] = bloqueados.has(t.id) ? [{ fecha: fechaLocal(ahora) }] : []
    const enHorario = franjas.length === 0 ? !bloqueados.has(t.id) : estaDisponibleAhora(franjas, ahora, bloqueoHoy)
    return {
      id: t.id, name: t.nombre_publico, trade: limpiarEtiqueta(t.especialidad), description: t.descripcion ?? '',
      category: limpiarEtiqueta(t.categoria), categoryId: t.categoria_id,
      genero: generos.get(t.id) ?? inferirGenero(t.nombre_publico), neighborhood: t.barrio ?? '',
      rating: Number(t.rating), reviews: t.resenas,
      priceMin: Number(t.precio_min), priceMax: Number(t.precio_max),
      years: t.anios_experiencia, jobs: t.trabajos, avatar: t.foto_url ?? '', verified: t.verificado,
      disponibleAhora: enHorario && !ocupados.has(t.id),
    }
  })
}

export async function getTotalTecnicos(): Promise<number> {
  const { count, error } = await supabase.from('tecnicos_publicos').select('id', { count: 'exact', head: true }).eq('verificado', true)
  if (error) throw error
  return count ?? 0
}

export async function getDisponibilidades(tecnicoId: number): Promise<Disponibilidad[]> {
  const { data, error } = await supabase
    .from('disponibilidades').select('dia_semana,hora_inicio,hora_fin')
    .eq('tecnico_id', tecnicoId).eq('activo', true).order('dia_semana').order('hora_inicio')
  if (error) throw error
  return data ?? []
}

/* ───────── Solicitudes ───────── */
/**
 * Crea la solicitud con el método de pago elegido por el cliente.
 *
 * El método se guarda desde el primer momento (ya no se pregunta al final):
 *   · `metodo_pago`     → uno de los 7 métodos del catálogo.
 *   · `metodo_pago_en`  → momento de la elección.
 *   · `pago_estado`     → estado inicial coherente (efectivo / pendiente).
 *
 * Los pagos con tarjeta/Google Pay están diferidos. El pago manual lo confirma
 * el técnico con `registrarPagoInterno`; ver `docs/INTEGRACION_PAGOS.md`.
 */
export async function crearSolicitud(p: {
  clienteId: string; tecnicoId: number; nombre: string; telefono: string; direccion: string; fecha: string; descripcion: string
  metodoPago: MetodoPago
}): Promise<number> {
  const { data, error } = await supabase.from('solicitudes').insert({
    cliente_id: p.clienteId, tecnico_id: p.tecnicoId,
    nombre_contacto: p.nombre, telefono_contacto: p.telefono, direccion: p.direccion,
    fecha_servicio: p.fecha, descripcion: p.descripcion,
    metodo_pago: p.metodoPago,
    metodo_pago_en: new Date().toISOString(),
    pago_estado: estadoPagoInicial(p.metodoPago),
  }).select('id').single()
  if (error) throw error
  return data.id as number
}

type CalRow = { rol_autor: 'cliente' | 'tecnico'; puntuacion: number; puntualidad: number; trato: number; cumplimiento: number; comentario: string | null }
type PedidoRow = {
  id: number; estado: string; fecha_servicio: string; descripcion: string
  nombre_contacto: string; telefono_contacto: string
  direccion?: string | null; diagnostico?: string | null; diagnostico_en?: string | null
  precio_estimado_min: number | null; precio_estimado_max: number | null; precio_final: number | null
  descuento_centavos?: number | null; cupon_codigo?: string | null
  metodo_pago?: string | null; metodo_pago_en?: string | null; pago_estado?: string | null
  tecnico_id: number
  tecnicos: { nombre_publico: string } | { nombre_publico: string }[] | null
  calificaciones: unknown
  solicitud_calificaciones?: CalRow[] | null
}

const COLS_BASE = 'id,estado,fecha_servicio,descripcion,nombre_contacto,telefono_contacto,' +
  'precio_estimado_min,precio_estimado_max,precio_final,tecnico_id,tecnicos(nombre_publico),calificaciones(id)'
// Con las columnas/tablas de la migración 20261031. RLS devuelve solo las calificaciones que el usuario puede ver.
const COLS_V2 = COLS_BASE + ',direccion,diagnostico,diagnostico_en,solicitud_calificaciones(rol_autor,puntuacion,puntualidad,trato,cumplimiento,comentario)'
// Con las columnas de pago de la migración 20261101.
const COLS_V3 = COLS_V2 + ',metodo_pago,metodo_pago_en,pago_estado'
// Con las columnas de cupón de la migración 20261108.
const COLS_V4 = COLS_V3 + ',descuento_centavos,cupon_codigo'

export async function getPedidos(perfil: Perfil): Promise<Pedido[]> {
  let filtroTec: number | null = null
  if (perfil.rol === 'tecnico') {
    filtroTec = await getMiTecnicoId(perfil.id)
    if (!filtroTec) return []
  }
  const consulta = (cols: string) => {
    const q = supabase.from('solicitudes').select(cols).order('creado_en', { ascending: false }).limit(50)
    return filtroTec ? q.eq('tecnico_id', filtroTec) : q.eq('cliente_id', perfil.id)
  }

  let res = await consulta(COLS_V4)
  // Si una migración aún no se ejecutó, la app sigue cargando con las columnas disponibles
  if (res.error) { const r4 = await consulta(COLS_V3); if (!r4.error) res = r4 }
  if (res.error) { const r2 = await consulta(COLS_V2); if (!r2.error) res = r2 }
  if (res.error) { const r3 = await consulta(COLS_BASE); if (!r3.error) res = r3 }
  if (res.error) throw res.error

  return ((res.data ?? []) as unknown as PedidoRow[]).map(r => {
    const t = Array.isArray(r.tecnicos) ? r.tecnicos[0] : r.tecnicos
    const legado = Array.isArray(r.calificaciones) ? r.calificaciones.length > 0 : !!r.calificaciones
    const cals = r.solicitud_calificaciones ?? []
    const miRol = perfil.rol === 'tecnico' ? 'tecnico' : 'cliente'
    const delCliente = cals.find(c => c.rol_autor === 'cliente') ?? null
    const pagoEstado: PagoEstado = (ESTADOS_PAGO as readonly string[]).includes(r.pago_estado ?? '')
      ? (r.pago_estado as PagoEstado) : 'pendiente'
    return {
      id: r.id, estado: r.estado, fecha: r.fecha_servicio, descripcion: r.descripcion,
      nombreContacto: r.nombre_contacto, telefonoContacto: r.telefono_contacto,
      direccion: r.direccion ?? null, diagnostico: r.diagnostico ?? null, diagnosticoEn: r.diagnostico_en ?? null,
      precioMin: r.precio_estimado_min, precioMax: r.precio_estimado_max, precioFinal: r.precio_final,
      descuentoCentavos: Math.max(0, Math.round(Number(r.descuento_centavos ?? 0))),
      cuponCodigo: r.cupon_codigo ?? null,
      tecnicoId: r.tecnico_id, tecnicoNombre: t?.nombre_publico ?? 'Técnico',
      calificada: cals.some(c => c.rol_autor === miRol) || (miRol === 'cliente' && legado),
      calificacionCliente: delCliente && { puntuacion: delCliente.puntuacion, puntualidad: delCliente.puntualidad, trato: delCliente.trato, cumplimiento: delCliente.cumplimiento, comentario: delCliente.comentario },
      metodoPago: esMetodoPago(r.metodo_pago) ? r.metodo_pago : null,
      metodoPagoEn: r.metodo_pago_en ?? null,
      pagoEstado,
    }
  })
}

export async function cambiarEstado(id: number, estado: string): Promise<void> {
  const { error } = await supabase.rpc('cambiar_estado_solicitud', { p_id: id, p_estado: estado })
  if (error) throw error
}

/**
 * Ejecuta una RPC de cambio de estado y confirma que la base de datos quedó en
 * el estado esperado. Así la interfaz no avanza si Supabase rechazó el cambio.
 */
async function cambiarEstadoConRpc(rpc: string, id: number, esperado: string): Promise<void> {
  const { error } = await supabase.rpc(rpc, { p_id: id })
  if (error) throw error
  const estado = await getEstadoSolicitud(id)
  if (estado !== esperado) {
    throw new Error(`La solicitud no quedó en estado "${esperado}" (estado actual: ${estado ?? 'desconocido'}).`)
  }
}

/**
 * El cliente confirma que desea el servicio con el técnico que aceptó.
 * Sin esta confirmación la solicitud no avanza a "en camino".
 */
export async function confirmarTecnico(id: number): Promise<void> {
  await cambiarEstadoConRpc('confirmar_tecnico', id, 'confirmada')
}

/**
 * El técnico abre la navegación al domicilio: la solicitud queda en "en_camino"
 * y el cliente ve "Técnico dirigiéndose a su domicilio".
 */
export async function iniciarDesplazamiento(id: number): Promise<void> {
  await cambiarEstadoConRpc('iniciar_desplazamiento', id, 'en_camino')
}

/**
 * El técnico marca que llegó al domicilio: el cliente ve "Técnico llegó".
 */
export async function marcarLlegada(id: number): Promise<void> {
  await cambiarEstadoConRpc('marcar_llegada', id, 'llego')
}

/**
 * Marca la solicitud como terminada (`estado = 'completada'`).
 *
 * ¿Por qué una RPC aparte? La función histórica `cambiar_estado_solicitud` aplica una
 * máquina de estados que exige pasar por `en_curso` antes de `completada`; esta app
 * marca el servicio directo desde `llego`, así que esa llamada se rechazaba y la
 * solicitud nunca se cerraba. `completar_solicitud` (migración 20261103) valida que
 * quien llama sea el técnico asignado y hace el UPDATE directamente.
 *
 * Después del RPC se vuelve a leer el estado para confirmar que el cambio quedó
 * persistido en la base de datos, no solo en la respuesta.
 */
export async function completarSolicitud(id: number): Promise<void> {
  const { error } = await supabase.rpc('completar_solicitud', { p_id: id })
  if (error) throw error
  const estado = await getEstadoSolicitud(id)
  if (estado !== 'completada') {
    throw new Error(`La solicitud no quedó terminada (estado actual: ${estado ?? 'desconocido'}).`)
  }
}

/** El técnico registra (o corrige) el diagnóstico del daño. El servidor valida que sea SU solicitud aceptada. */
export async function guardarDiagnostico(solicitudId: number, texto: string): Promise<void> {
  const { error } = await supabase.rpc('guardar_diagnostico', { p_id: solicitudId, p_texto: texto })
  if (error) throw error
}

/** Calificación bidireccional: el servidor decide si quien llama es el cliente o el técnico de la solicitud. */
export async function calificarSolicitud(p: {
  solicitudId: number; puntuacion: number; puntualidad: number; trato: number; cumplimiento: number; comentario: string
}): Promise<void> {
  const { error } = await supabase.rpc('calificar_solicitud', {
    p_solicitud_id: p.solicitudId, p_puntuacion: p.puntuacion, p_puntualidad: p.puntualidad,
    p_trato: p.trato, p_cumplimiento: p.cumplimiento, p_comentario: p.comentario.trim() || null,
  })
  if (error) throw error
}

/* ───────── Chat por solicitud ───────── */
type MensajeRow = {
  id: number; solicitud_id: number; autor_id: string; autor_rol: 'cliente' | 'tecnico'
  contenido: string; creado_en: string
}

/** Historial del chat. La RLS solo devuelve mensajes de solicitudes del usuario. */
export async function getMensajes(solicitudId: number): Promise<MensajeSolicitud[]> {
  const { data, error } = await supabase
    .from('solicitud_mensajes')
    .select('id,solicitud_id,autor_id,autor_rol,contenido,creado_en')
    .eq('solicitud_id', solicitudId)
    .order('creado_en', { ascending: true })
    .order('id', { ascending: true })
  if (error) throw error
  return ((data ?? []) as MensajeRow[]).map(m => ({
    id: m.id, solicitudId: m.solicitud_id, autorId: m.autor_id, autorRol: m.autor_rol,
    contenido: m.contenido, creadoEn: m.creado_en,
  }))
}

/**
 * Envía un mensaje. El servidor valida que el usuario sea participante y que la
 * solicitud siga en un estado activo (migración 20261103); si no, devuelve un
 * error legible.
 */
export async function enviarMensaje(solicitudId: number, texto: string): Promise<void> {
  const { error } = await supabase.rpc('enviar_mensaje_solicitud', { p_id: solicitudId, p_texto: texto.trim() })
  if (error) throw error
}

/** Estado actual de una solicitud (para refrescar el permiso del chat en vivo). */
export async function getEstadoSolicitud(id: number): Promise<string | null> {
  const { data, error } = await supabase.from('solicitudes').select('estado').eq('id', id).maybeSingle()
  if (error) throw error
  return (data as { estado: string } | null)?.estado ?? null
}

/* ───────── Pago ───────── */
/** El cliente registra el método elegido. Devuelve el `pago_estado` resultante. */
export async function registrarMetodoPago(solicitudId: number, metodo: MetodoPago): Promise<PagoEstado> {
  const { data, error } = await supabase.rpc('registrar_metodo_pago', { p_id: solicitudId, p_metodo: metodo })
  if (error) throw error
  return (ESTADOS_PAGO as readonly string[]).includes(String(data)) ? (data as PagoEstado) : 'pendiente'
}

/* ───────── Cuenta bancaria del técnico ───────── */
type CuentaRow = {
  banco: string; tipo_cuenta: 'ahorros' | 'corriente'; numero_cuenta: string
  titular: string; documento: string | null; actualizado_en: string
}

/** Cuenta del técnico que inició sesión. La RLS impide leer la de otro técnico. */
export async function getMiCuentaBancaria(usuarioId: string): Promise<CuentaBancaria | null> {
  const tecnicoId = await getMiTecnicoId(usuarioId)
  if (!tecnicoId) return null
  const { data, error } = await supabase
    .from('cuentas_bancarias_tecnicos')
    .select('banco,tipo_cuenta,numero_cuenta,titular,documento,actualizado_en')
    .eq('tecnico_id', tecnicoId)
    .maybeSingle()
  // Antes de correr la migración la tabla no existe: el perfil sigue funcionando sin la sección.
  if (error) {
    if (/does not exist/i.test(error.message)) return null
    throw error
  }
  if (!data) return null
  const c = data as CuentaRow
  return {
    banco: c.banco, tipoCuenta: c.tipo_cuenta, numeroCuenta: c.numero_cuenta,
    titular: c.titular, documento: c.documento, actualizadoEn: c.actualizado_en,
  }
}

/** Crea o actualiza la cuenta bancaria del técnico autenticado. */
export async function guardarCuentaBancaria(p: {
  banco: string; tipoCuenta: 'ahorros' | 'corriente'; numeroCuenta: string; titular: string; documento: string
}): Promise<void> {
  const { error } = await supabase.rpc('guardar_cuenta_bancaria', {
    p_banco: p.banco.trim(), p_tipo_cuenta: p.tipoCuenta, p_numero_cuenta: p.numeroCuenta.trim(),
    p_titular: p.titular.trim(), p_documento: p.documento.trim() || null,
  })
  if (error) throw error
}

export async function calificar(p: {
  solicitudId: number; clienteId: string; tecnicoId: number; puntuacion: number; comentario: string
}): Promise<void> {
  const { error } = await supabase.from('calificaciones').insert({
    solicitud_id: p.solicitudId, cliente_id: p.clienteId, tecnico_id: p.tecnicoId,
    puntuacion: p.puntuacion, comentario: p.comentario.trim() || null,
  })
  if (error) {
    if (error.code === '23505') throw new Error('Ya calificaste este servicio.')
    throw error
  }
}

export async function registrarTecnico(p: {
  nombre: string; telefono: string; cedula: string; categoriaId: number; barrioId: number
  especialidad: string; descripcion: string; precioMin: number; precioMax: number; anios: number
}): Promise<number> {
  const { data, error } = await supabase.rpc('registrar_tecnico', {
    p_nombre: p.nombre, p_telefono: p.telefono, p_cedula: p.cedula,
    p_categoria_id: p.categoriaId, p_barrio_id: p.barrioId,
    p_especialidad: p.especialidad, p_descripcion: p.descripcion,
    p_precio_min: p.precioMin, p_precio_max: p.precioMax, p_anios: p.anios,
  })
  if (error) throw error
  return data as number
}

/* ───────── Historial de eventos (auditoría) ───────── */
export type SolicitudEvento = {
  id: number
  tipo: 'creada' | 'asignada' | 'estado_cambiado' | 'precio_actualizado' | 'diagnostico_registrado' | 'calificada'
  estadoAnterior: string | null; estadoNuevo: string | null
  actorNombre: string; actorRol: string
  detalle: Record<string, unknown>
  creadoEn: string // ISO 8601
}

type EventoRow = {
  id: number; tipo: SolicitudEvento['tipo']; estado_anterior: string | null; estado_nuevo: string | null
  actor_nombre: string; actor_rol: string; detalle: Record<string, unknown> | null; creado_en: string
}

/** Historial cronológico de una solicitud (RPC con control de acceso en el servidor). */
export async function getHistorial(solicitudId: number): Promise<SolicitudEvento[]> {
  const { data, error } = await supabase.rpc('historial_solicitud', { p_id: solicitudId })
  if (error) throw error
  return ((data ?? []) as EventoRow[]).map(e => ({
    id: e.id, tipo: e.tipo, estadoAnterior: e.estado_anterior, estadoNuevo: e.estado_nuevo,
    actorNombre: e.actor_nombre, actorRol: e.actor_rol, detalle: e.detalle ?? {}, creadoEn: e.creado_en,
  }))
}
