/**
 * Calendario de disponibilidad del técnico (lógica pura).
 *
 * El modelo existente (`public.disponibilidades`) guarda franjas semanales:
 * dia_semana (0 = domingo … 6 = sábado), hora_inicio, hora_fin, activo.
 * Se mantiene ese modelo y se añaden bloqueos por fecha concreta.
 */

export type Franja = {
  dia_semana: number
  hora_inicio: string
  hora_fin: string
  activo?: boolean
}

export type Bloqueo = { fecha: string; motivo?: string | null }

export const DIAS_SEMANA = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado']

/** Normaliza "7:5" o "07:05:00" a "HH:MM". Devuelve null si no es una hora válida. */
export function normalizarHora(hora: string): string | null {
  const m = /^(\d{1,2})(?::(\d{1,2}))?(?::\d{1,2})?$/.exec(String(hora).trim())
  if (!m) return null
  const h = Number(m[1])
  const min = Number(m[2] ?? 0)
  if (!Number.isInteger(h) || !Number.isInteger(min) || h < 0 || h > 23 || min < 0 || min > 59) return null
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`
}

export function horaAMinutos(hora: string): number | null {
  const h = normalizarHora(hora)
  if (!h) return null
  const [hh, mm] = h.split(':').map(Number)
  return hh * 60 + mm
}

/** Valida una franja individual. Devuelve el error o null. */
export function validarFranja(f: Franja): string | null {
  if (!Number.isInteger(f.dia_semana) || f.dia_semana < 0 || f.dia_semana > 6) return 'El día de la semana no es válido.'
  const ini = horaAMinutos(f.hora_inicio)
  const fin = horaAMinutos(f.hora_fin)
  if (ini == null || fin == null) return 'Escribe horas válidas (HH:MM).'
  if (fin <= ini) return 'La hora de fin debe ser posterior a la de inicio.'
  if (fin - ini < 30) return 'Cada franja debe durar al menos 30 minutos.'
  return null
}

/**
 * Valida la agenda completa: franjas válidas y sin solapamientos el mismo día.
 * Las franjas con `activo === false` se ignoran (no se guardan).
 */
export function validarAgenda(franjas: Franja[]): string | null {
  const activas = franjas.filter(f => f.activo !== false)
  if (activas.length === 0) return 'Agrega al menos una franja de disponibilidad.'
  for (const f of activas) {
    const err = validarFranja(f)
    if (err) return `${DIAS_SEMANA[f.dia_semana] ?? 'Día'}: ${err}`
  }
  for (let dia = 0; dia <= 6; dia++) {
    const delDia = activas.filter(f => f.dia_semana === dia)
      .map(f => ({ ini: horaAMinutos(f.hora_inicio)!, fin: horaAMinutos(f.hora_fin)! }))
      .sort((a, b) => a.ini - b.ini)
    for (let i = 1; i < delDia.length; i++) {
      if (delDia[i].ini < delDia[i - 1].fin) {
        return `${DIAS_SEMANA[dia]}: las franjas se solapan.`
      }
    }
  }
  return null
}

/** Fecha local en formato YYYY-MM-DD. */
export function fechaLocal(d: Date = new Date()): string {
  return d.toLocaleDateString('en-CA')
}

/**
 * ¿El técnico está dentro de su horario ahora?
 * `bloqueos` son fechas YYYY-MM-DD en las que no atiende.
 */
export function estaDisponibleAhora(
  franjas: Franja[],
  ahora: Date = new Date(),
  bloqueos: Bloqueo[] = [],
): boolean {
  if (bloqueos.some(b => b.fecha === fechaLocal(ahora))) return false
  const dia = ahora.getDay()
  const min = ahora.getHours() * 60 + ahora.getMinutes()
  return franjas.some(f => {
    if (f.activo === false || f.dia_semana !== dia) return false
    const ini = horaAMinutos(f.hora_inicio)
    const fin = horaAMinutos(f.hora_fin)
    return ini != null && fin != null && min >= ini && min < fin
  })
}

/** Texto compacto: "Lun 08:00–12:00 · Mar 14:00–18:00". */
export function resumenAgenda(franjas: Franja[], corto = true): string {
  const nombres = corto ? ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'] : DIAS_SEMANA
  return franjas
    .filter(f => f.activo !== false)
    .slice()
    .sort((a, b) => a.dia_semana - b.dia_semana || a.hora_inicio.localeCompare(b.hora_inicio))
    .map(f => `${nombres[f.dia_semana]} ${f.hora_inicio.slice(0, 5)}–${f.hora_fin.slice(0, 5)}`)
    .join(' · ')
}
