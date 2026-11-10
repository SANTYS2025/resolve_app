/**
 * Logotipos de los métodos de pago.
 *
 * Solo se usan recursos oficiales de cada empresa (ver docs/LOGOTIPOS_OFICIALES.md):
 *  · Nequi: icono oficial "N" del kit de prensa (PNG transparente 256×256).
 *  · Bancolombia: logotipo oficial en SVG del sitio corporativo.
 *  · Daviplata: logotipo oficial a color extraído del kit de marca (SVG vectorial).
 *
 * Los métodos que todavía no están habilitados usan iconos genéricos de
 * Material Symbols, para no fabricar marcas ni sugerir que ya se pueden pagar.
 * Las imágenes conservan proporción y colores originales (object-fit: contain).
 */

import nequiLogo from '../assets/brand/nequi.png'
import bancolombiaLogo from '../assets/brand/bancolombia.svg'
import daviplataLogo from '../assets/brand/daviplata.svg'
import type { IconoMaterialNombre } from './IconoMaterial'
import { IconoMaterial } from './IconoMaterial'

const LOGOS: Record<string, { src: string; alt: string }> = {
  nequi: { src: nequiLogo, alt: 'Nequi' },
  bancolombia: { src: bancolombiaLogo, alt: 'Bancolombia' },
  daviplata: { src: daviplataLogo, alt: 'Daviplata' },
}

const ICONOS: Record<string, IconoMaterialNombre> = {
  tarjeta_credito: 'credit_card',
  tarjeta_debito: 'credit_card',
  google_pay: 'account_balance_wallet',
  bre_b: 'swap_horiz',
  efectivo: 'payments',
}

type Props = {
  id: string | null | undefined
  /** Altura visual en píxeles. El ancho se calcula solo para no deformar. */
  alto?: number
  className?: string
  /** Texto accesible; por defecto usa el nombre oficial de la marca. */
  title?: string
}

/**
 * Muestra el logotipo oficial del método o, si no tiene marca (tarjeta,
 * efectivo, Bre-B o método desconocido), un icono financiero genérico.
 */
export function MetodoPagoLogo({ id, alto = 20, className = '', title }: Props) {
  const logo = id ? LOGOS[id] : undefined

  if (logo) {
    return (
      <span
        className={`inline-flex flex-shrink-0 items-center justify-center ${className}`}
        style={{ height: alto }}
      >
        <img
          src={logo.src}
          alt={title ?? logo.alt}
          draggable={false}
          style={{ maxHeight: alto, maxWidth: alto * 4.5, width: 'auto', height: 'auto', objectFit: 'contain' }}
        />
      </span>
    )
  }

  return (
    <IconoMaterial
      name={ICONOS[id ?? ''] ?? 'payments'}
      size={alto}
      className={className}
      title={title}
    />
  )
}
