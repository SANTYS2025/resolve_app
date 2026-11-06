/**
 * Recuperación de contraseña y validaciones de autenticación (lógica pura).
 *
 * Se apoya en Supabase Auth:
 *  · `resetPasswordForEmail(email, { redirectTo })` envía el correo.
 *  · El enlace vuelve con `type=recovery`; Supabase emite PASSWORD_RECOVERY.
 *  · Con la sesión de recuperación se llama `updateUser({ password })`.
 */

export const MIN_PASSWORD = 8
export const MAX_PASSWORD = 72

export function validarCorreoRecuperacion(email: string): string | null {
  const e = String(email ?? '').trim()
  if (!e) return 'Escribe tu correo electrónico.'
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e)) return 'Ingresa un correo válido.'
  return null
}

export function validarNuevaPassword(password: string, confirmacion: string): string | null {
  if (!password) return 'Escribe tu nueva contraseña.'
  if (password.length < MIN_PASSWORD) return `La contraseña debe tener mínimo ${MIN_PASSWORD} caracteres.`
  if (password.length > MAX_PASSWORD) return `La contraseña no puede superar ${MAX_PASSWORD} caracteres.`
  if (password !== confirmacion) return 'Las contraseñas no coinciden.'
  if (/^\s+$/.test(password)) return 'La contraseña no puede ser solo espacios.'
  return null
}

/** Mensajes de error de Supabase Auth traducidos para la recuperación. */
export function mensajeErrorRecuperacion(error: unknown): string {
  const m = typeof error === 'object' && error !== null && 'message' in error
    ? String((error as { message: unknown }).message)
    : String(error ?? '')
  if (/rate limit|too many/i.test(m)) return 'Demasiados intentos. Espera unos minutos antes de volver a intentar.'
  if (/invalid email|unable to validate email/i.test(m)) return 'Ese correo no es válido.'
  if (/user not found/i.test(m)) return 'No encontramos una cuenta con ese correo.'
  if (/same password|should be different/i.test(m)) return 'La nueva contraseña debe ser diferente a la anterior.'
  if (/expired|invalid.*token|otp/i.test(m)) return 'El enlace venció o ya se usó. Solicita uno nuevo.'
  if (/failed to fetch|networkerror/i.test(m)) return 'Sin conexión. Revisa tu internet e intenta de nuevo.'
  return m || 'No se pudo completar la recuperación. Intenta de nuevo.'
}

/** Indica si la URL de retorno trae un enlace de recuperación. */
export function esEnlaceRecuperacion(hash: string, search: string): boolean {
  const h = String(hash ?? '')
  const s = String(search ?? '')
  return /(?:^|[#&?])type=recovery(?:&|$)/.test(h) || /(?:^|[#&?])type=recovery(?:&|$)/.test(s)
    || /(?:^|[#&?])error_code=otp_expired(?:&|$)/.test(h)
}
