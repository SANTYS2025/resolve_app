/**
 * Centro de ayuda y soporte (lógica pura).
 * Los tickets se guardan en Supabase; aquí viven las preguntas frecuentes y
 * las validaciones del formulario.
 */

export type CategoriaTicket = 'pago' | 'servicio' | 'cuenta' | 'tecnico' | 'otro'

export type Faq = { id: string; categoria: CategoriaTicket; pregunta: string; respuesta: string }

export const CATEGORIAS_TICKET: { id: CategoriaTicket; nombre: string; icono: string }[] = [
  { id: 'pago', nombre: 'Pagos y reembolsos', icono: '💳' },
  { id: 'servicio', nombre: 'Problema con un servicio', icono: '🔧' },
  { id: 'cuenta', nombre: 'Mi cuenta', icono: '👤' },
  { id: 'tecnico', nombre: 'Ser técnico', icono: '🛠️' },
  { id: 'otro', nombre: 'Otro', icono: '💬' },
]

export const FAQ: Faq[] = [
  {
    id: 'pago-tarjeta',
    categoria: 'pago',
    pregunta: '¿Puedo pagar con tarjeta?',
    respuesta: 'Todavía no. Los pagos con tarjeta, Google Pay y Bre-B estarán disponibles pronto. Por ahora elige Nequi, Bancolombia, Daviplata o efectivo; el técnico confirma cuando recibe el dinero.',
  },
  {
    id: 'pago-efectivo',
    categoria: 'pago',
    pregunta: '¿Puedo pagar por Nequi, Bancolombia, Daviplata o en efectivo?',
    respuesta: 'Sí. Elige el método al crear la solicitud. Pídele los datos al técnico por el chat, haz la transferencia (o paga en efectivo al terminar) y confirma cuando hayas pagado.',
  },
  {
    id: 'reembolso',
    categoria: 'pago',
    pregunta: '¿Cómo pido un reembolso?',
    respuesta: 'Abre la solicitud terminada, entra a “Pagos” y usa “Solicitar reembolso”. Queda registrado en tu historial de transacciones. Con pagos manuales, el reembolso se registra de inmediato y el dinero se devuelve por el mismo medio acordado con el técnico.',
  },
  {
    id: 'servicio-problema',
    categoria: 'servicio',
    pregunta: 'El técnico no llegó o el trabajo quedó mal. ¿Qué hago?',
    respuesta: 'Reporta el problema desde la solicitud con el botón “Reportar problema”. Adjunta una descripción clara; el equipo puede revisar el historial, el chat y el pago para ayudarte.',
  },
  {
    id: 'seguimiento',
    categoria: 'servicio',
    pregunta: '¿Por qué no veo la ubicación del técnico?',
    respuesta: 'La ubicación solo se comparte mientras el servicio está “En camino” y el técnico dio permiso de ubicación. Si pierde señal, verás su última posición conocida y el aviso “Sin señal”; no inventamos una ETA.',
  },
  {
    id: 'cuenta-password',
    categoria: 'cuenta',
    pregunta: 'Olvidé mi contraseña',
    respuesta: 'En la pantalla de ingreso toca “¿Olvidaste tu contraseña?”. Te enviamos un enlace al correo registrado. El enlace vence por seguridad; si no llega, revisa spam o solicita otro.',
  },
  {
    id: 'cuenta-notificaciones',
    categoria: 'cuenta',
    pregunta: '¿Cómo desactivo las notificaciones de mensajes?',
    respuesta: 'Entra a Perfil → Notificaciones y desactiva “Mensajes”. Las alertas de seguridad y de tu cuenta se siguen enviando. También puedes bloquearlas desde los ajustes del teléfono.',
  },
  {
    id: 'tecnico-pagos',
    categoria: 'tecnico',
    pregunta: '¿Cuándo recibo el dinero de un servicio?',
    respuesta: 'Cuando confirmas el pago recibido (Nequi, Bancolombia, Daviplata o efectivo), se registra la comisión de Resolve y tu neto. El abono a tu cuenta bancaria se hace por fuera de la app; puedes ver el detalle en Ganancias.',
  },
  {
    id: 'tecnico-documentos',
    categoria: 'tecnico',
    pregunta: '¿Qué documentos necesito para verificarme?',
    respuesta: 'Cédula por ambas caras y una selfie. También puedes subir certificados de tu oficio en PDF o imagen (máx. 10 MB); quedan en tus documentos privados y solo los ve el equipo de verificación.',
  },
]

export function buscarFaq(texto: string, categoria?: CategoriaTicket | null): Faq[] {
  const q = String(texto ?? '').trim().toLowerCase()
  return FAQ.filter(f => {
    if (categoria && f.categoria !== categoria) return false
    if (!q) return true
    return `${f.pregunta} ${f.respuesta}`.toLowerCase().includes(q)
  })
}

export type NuevoTicket = { categoria: CategoriaTicket; asunto: string; descripcion: string; solicitudId?: number | null }

export function validarTicket(t: NuevoTicket): string | null {
  if (!CATEGORIAS_TICKET.some(c => c.id === t.categoria)) return 'Selecciona una categoría.'
  const asunto = String(t.asunto ?? '').trim()
  const desc = String(t.descripcion ?? '').trim()
  if (asunto.length < 5) return 'Escribe un asunto de al menos 5 caracteres.'
  if (asunto.length > 120) return 'El asunto no puede superar 120 caracteres.'
  if (desc.length < 20) return 'Cuéntanos qué pasó con al menos 20 caracteres.'
  if (desc.length > 2000) return 'La descripción no puede superar 2000 caracteres.'
  return null
}

export function nombreCategoria(categoria: string): string {
  return CATEGORIAS_TICKET.find(c => c.id === categoria)?.nombre ?? 'Otro'
}
