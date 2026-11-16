/**
 * Avatares de técnicos.
 *
 * La foto se recorta a un cuadrado de 512×512 y se vuelve a codificar como JPEG
 * antes de subirla. Así:
 *  · se corrige la orientación EXIF de las fotos tomadas con el celular,
 *  · se eliminan metadatos y transparencias,
 *  · todos los dispositivos reciben exactamente el mismo archivo nítido y
 *    liviano (~60–120 KB) en lugar de una foto original de 5–12 MB.
 *
 * La ruta es fija (`<tecnico_id>/avatar.jpg`) y se sube con `upsert`. La URL
 * pública se guarda con `?v=<timestamp>` para invalidar la caché del CDN y del
 * WebView cuando la persona cambia su foto.
 */

import { supabase } from './supabase'
import { guardarFotoTecnico } from './api'

export const BUCKET_AVATARES = 'avatares-tecnicos'
/** Lado del cuadrado final. 512 px se ve nítido hasta en pantallas 3x. */
export const LADO_AVATAR = 512
const CALIDAD_JPEG = 0.9
/** Tope de entrada: por encima de esto ni siquiera se intenta decodificar. */
export const AVATAR_MAX_BYTES = 12 * 1024 * 1024

type Lienzo = CanvasRenderingContext2D

function dibujar(ctx: Lienzo, origen: CanvasImageSource, ancho: number, alto: number) {
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, LADO_AVATAR, LADO_AVATAR)
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  // Recorte centrado tipo `object-cover`.
  const escala = Math.max(LADO_AVATAR / ancho, LADO_AVATAR / alto)
  const destinoAncho = ancho * escala
  const destinoAlto = alto * escala
  ctx.drawImage(origen, (LADO_AVATAR - destinoAncho) / 2, (LADO_AVATAR - destinoAlto) / 2, destinoAncho, destinoAlto)
}

function cargarImagen(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('No pudimos leer la imagen. Prueba con otra foto.'))
    img.src = url
  })
}

async function decodificarYdibujar(archivo: Blob, ctx: Lienzo) {
  // `imageOrientation: 'from-image'` respeta la rotación EXIF en navegadores modernos.
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(archivo, { imageOrientation: 'from-image' })
      try { dibujar(ctx, bitmap, bitmap.width, bitmap.height) } finally { bitmap.close() }
      return
    } catch {
      // Navegador sin soporte para esa opción: se usa el elemento <img>.
    }
  }

  const url = URL.createObjectURL(archivo)
  try {
    const img = await cargarImagen(url)
    dibujar(ctx, img, img.naturalWidth, img.naturalHeight)
  } finally {
    URL.revokeObjectURL(url)
  }
}

/** Recorta y recomprime la foto. Devuelve un JPEG cuadrado listo para subir. */
export async function recortarAvatar(archivo: Blob): Promise<Blob> {
  if (!archivo.type.startsWith('image/')) {
    throw new Error('Selecciona una imagen (JPG, PNG o WebP).')
  }
  if (archivo.size > AVATAR_MAX_BYTES) {
    throw new Error('La foto es demasiado grande. Usa una de menos de 12 MB.')
  }

  const canvas = document.createElement('canvas')
  canvas.width = LADO_AVATAR
  canvas.height = LADO_AVATAR
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Tu dispositivo no permite editar imágenes.')

  await decodificarYdibujar(archivo, ctx)

  const jpeg = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', CALIDAD_JPEG))
  if (!jpeg) throw new Error('No pudimos preparar la foto. Intenta de nuevo.')
  return jpeg
}

function mensajeSubida(error: { message?: string }): string {
  const m = String(error.message ?? '')
  if (/bucket not found/i.test(m)) return 'Falta aplicar la actualización de avatares en Supabase.'
  if (/row-level security|unauthorized|permission/i.test(m)) return 'No pudimos guardar la foto con tu cuenta. Vuelve a iniciar sesión.'
  if (/exceeded the maximum allowed size|payload too large/i.test(m)) return 'La foto sigue siendo muy pesada. Prueba con otra.'
  if (/failed to fetch|network/i.test(m)) return 'Sin conexión. Revisa tu internet e intenta de nuevo.'
  return 'No pudimos subir la foto. Intenta de nuevo.'
}

/**
 * Sube el avatar del técnico y guarda la URL en su ficha.
 * Devuelve la URL nueva (con caché invalidada) para mostrarla de inmediato.
 */
export async function subirAvatarTecnico(tecnicoId: number, archivo: Blob): Promise<string> {
  const jpeg = await recortarAvatar(archivo)
  const ruta = `${tecnicoId}/avatar.jpg`

  const { error } = await supabase.storage.from(BUCKET_AVATARES).upload(ruta, jpeg, {
    upsert: true,
    contentType: 'image/jpeg',
    cacheControl: '31536000',
  })
  if (error) throw new Error(mensajeSubida(error))

  const { data } = supabase.storage.from(BUCKET_AVATARES).getPublicUrl(ruta)
  const url = `${data.publicUrl}?v=${Date.now()}`
  await guardarFotoTecnico(url)
  return url
}
