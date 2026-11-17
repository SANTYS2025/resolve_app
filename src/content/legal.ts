/**
 * Textos legales de Resolve Pasto.
 *
 * ⚠️ BORRADOR — requiere revisión por un abogado antes de publicar en Play Store.
 * Los textos describen el funcionamiento real de la app, pero no sustituyen una
 * revisión jurídica de la Ley 1581 de 2012, el Decreto 1377 de 2013 y las
 * normas de protección al consumidor aplicables en Colombia.
 */

export type DocumentoLegalId = 'terminos' | 'privacidad' | 'datos'

export type SeccionLegal = {
  titulo: string
  parrafos: string[]
}

export type DocumentoLegal = {
  id: DocumentoLegalId
  titulo: string
  resumen: string
  version: string
  actualizado: string
  secciones: SeccionLegal[]
}

export const VERSION_LEGAL = '2026-11-14'

export const AVISO_BORRADOR =
  'BORRADOR — requiere revisión por un abogado antes de publicar la app en Google Play.'

export const DOCUMENTOS_LEGALES: DocumentoLegal[] = [
  {
    id: 'terminos',
    titulo: 'Términos y condiciones',
    resumen: 'Reglas para usar Resolve Pasto como cliente o como técnico.',
    version: VERSION_LEGAL,
    actualizado: '14 de noviembre de 2026',
    secciones: [
      {
        titulo: '1. Qué es Resolve Pasto',
        parrafos: [
          'Resolve Pasto es una plataforma que conecta a personas que necesitan un servicio para el hogar con técnicos independientes de Pasto, Colombia.',
          'Resolve no presta directamente los servicios de plomería, electricidad, cerrajería ni otros oficios. El contrato del servicio se celebra entre el cliente y el técnico.',
        ],
      },
      {
        titulo: '2. Cuenta y requisitos',
        parrafos: [
          'Para usar la app debes ser mayor de edad y registrar datos veraces. Cada persona es responsable de mantener la confidencialidad de su contraseña.',
          'Los técnicos deben completar su registro, aportar la documentación solicitada y ser aprobados antes de recibir solicitudes. La aprobación no garantiza la calidad del trabajo ni reemplaza la verificación que haga el cliente.',
        ],
      },
      {
        titulo: '3. Uso permitido',
        parrafos: [
          'No está permitido usar la app para actividades ilegales, suplantar a otra persona, publicar contenido ofensivo, acosar a otros usuarios, intentar acceder a cuentas ajenas o manipular pagos y calificaciones.',
          'Podemos suspender o cancelar una cuenta que incumpla estas reglas o que represente un riesgo para otros usuarios.',
        ],
      },
      {
        titulo: '4. Solicitudes, precios y pagos',
        parrafos: [
          'El cliente describe el trabajo, elige un método de pago y confirma la solicitud. El precio final lo acuerdan el cliente y el técnico dentro del rango de referencia mostrado en la app.',
          'Los pagos con tarjeta, Google Pay y otros medios electrónicos pueden ser procesados por pasarelas externas. Los pagos en efectivo, Nequi, Bancolombia o Bre-B se confirman directamente con el técnico.',
          'La comisión de Resolve se calcula sobre el valor del servicio y se muestra antes de confirmar el pago cuando aplica.',
        ],
      },
      {
        titulo: '5. Cancelaciones y servicios no realizados',
        parrafos: [
          'El cliente puede cancelar mientras la solicitud esté pendiente o aceptada. Si el técnico ya se desplazó, las partes deben acordar un cobro justo por el desplazamiento.',
          'Si el servicio no se realiza o presenta un problema, el cliente puede reportarlo desde la app. Los reembolsos se evalúan caso por caso y dependen del medio de pago y del estado de la transacción.',
        ],
      },
      {
        titulo: '6. Responsabilidad',
        parrafos: [
          'Resolve facilita el contacto, el seguimiento y el registro de la transacción, pero no responde por la calidad, seguridad o resultado del trabajo realizado por un técnico independiente.',
          'El técnico es responsable de contar con las herramientas, la experiencia y los permisos necesarios para el oficio que ofrece. El cliente es responsable de entregar información correcta sobre el domicilio y el problema.',
        ],
      },
      {
        titulo: '7. Propiedad intelectual',
        parrafos: [
          'La marca, el logo, el diseño y el código de Resolve Pasto pertenecen a sus titulares. El usuario conserva los derechos sobre las fotos y textos que suba, y autoriza su uso únicamente para operar la plataforma.',
        ],
      },
      {
        titulo: '8. Cambios y contacto',
        parrafos: [
          'Podemos actualizar estos términos cuando cambie el servicio o la ley. La versión vigente y su fecha se muestran en esta pantalla.',
          'Para dudas sobre estos términos escribe a soporte@resolvepasto.com.',
        ],
      },
    ],
  },
  {
    id: 'privacidad',
    titulo: 'Política de privacidad',
    resumen: 'Qué datos usamos, para qué y con quién se comparten.',
    version: VERSION_LEGAL,
    actualizado: '14 de noviembre de 2026',
    secciones: [
      {
        titulo: '1. Datos que recolectamos',
        parrafos: [
          'Datos de cuenta: nombre, correo electrónico, teléfono, rol (cliente o técnico) y contraseña cifrada.',
          'Datos del servicio: dirección, descripción del problema, fecha, método de pago, precio acordado, mensajes del chat, calificaciones y reportes.',
          'Datos de técnicos: cédula, documentos de verificación, especialidad, barrio, tarifas, portafolio y foto de perfil.',
          'Datos técnicos: identificador del dispositivo, token de notificaciones, registros de errores y ubicación aproximada mientras el técnico comparte su recorrido.',
        ],
      },
      {
        titulo: '2. Para qué los usamos',
        parrafos: [
          'Crear y administrar la cuenta, conectar cliente y técnico, mostrar el estado del servicio, procesar pagos, calcular la llegada estimada, enviar notificaciones, prevenir fraudes y atender soporte.',
          'También usamos datos agregados para mejorar la app. No vendemos datos personales ni los usamos para publicidad de terceros.',
        ],
      },
      {
        titulo: '3. Con quién se comparten',
        parrafos: [
          'Con la contraparte del servicio: el técnico ve el nombre, teléfono y dirección del cliente cuando acepta; el cliente ve el nombre público y el contacto del técnico.',
          'Con proveedores que nos ayudan a operar: Supabase (base de datos y autenticación), pasarelas de pago, Firebase Cloud Messaging y el servicio de monitoreo de errores. Estos proveedores solo reciben lo necesario para prestar su servicio.',
          'Con autoridades cuando exista una obligación legal o una investigación de fraude.',
        ],
      },
      {
        titulo: '4. Ubicación',
        parrafos: [
          'El cliente puede usar su ubicación actual una vez para calcular la llegada del técnico; no se guarda en la base de datos.',
          'El técnico comparte su ubicación solo durante un servicio activo. Se guarda únicamente la última posición, no un historial de recorrido, y se deja de compartir al llegar, terminar o cancelar.',
        ],
      },
      {
        titulo: '5. Conservación y seguridad',
        parrafos: [
          'Conservamos los datos mientras la cuenta esté activa y, después, los registros financieros y de servicio que la ley exija. Al eliminar la cuenta se anonimizan los datos personales y se borran los archivos asociados cuando sea posible.',
          'Usamos conexiones cifradas, permisos por fila en la base de datos y acceso restringido a los documentos de verificación. Ningún sistema es infalible, pero aplicamos medidas razonables de seguridad.',
        ],
      },
      {
        titulo: '6. Tus derechos',
        parrafos: [
          'Puedes conocer, actualizar, rectificar y solicitar la eliminación de tus datos. También puedes revocar la autorización de tratamiento cuando no exista un deber legal de conservarlos.',
          'Desde la app puedes eliminar tu cuenta en Perfil → Eliminar mi cuenta. Si tienes un servicio activo, primero debes terminarlo o cancelarlo.',
          'Para ejercer tus derechos escribe a privacidad@resolvepasto.com. Responderemos en los plazos legales.',
        ],
      },
      {
        titulo: '7. Menores de edad',
        parrafos: [
          'La app no está dirigida a menores de 18 años. Si detectamos una cuenta de un menor, la suspendemos y eliminamos sus datos.',
        ],
      },
    ],
  },
  {
    id: 'datos',
    titulo: 'Autorización de tratamiento de datos',
    resumen: 'Consentimiento informado conforme a la Ley 1581 de 2012.',
    version: VERSION_LEGAL,
    actualizado: '14 de noviembre de 2026',
    secciones: [
      {
        titulo: '1. Responsable',
        parrafos: [
          'El responsable del tratamiento es Resolve Pasto. Canal de atención: privacidad@resolvepasto.com.',
        ],
      },
      {
        titulo: '2. Autorización',
        parrafos: [
          'Al marcar la casilla de aceptación y crear una cuenta, autorizas de forma previa, expresa e informada el tratamiento de tus datos personales para las finalidades descritas en la Política de privacidad.',
          'La autorización cubre datos de identificación, contacto, ubicación, documentos de verificación, información del servicio, mensajes, calificaciones y datos técnicos del dispositivo.',
        ],
      },
      {
        titulo: '3. Datos sensibles',
        parrafos: [
          'Los documentos de cédula y las selfies de verificación pueden contener datos sensibles. Se solicitan solo a técnicos, se usan exclusivamente para verificar identidad y se almacenan en un bucket privado con acceso restringido.',
          'No es obligatorio entregar datos sensibles para usar la app como cliente. Un técnico que no quiera aportarlos no podrá completar la verificación ni recibir solicitudes.',
        ],
      },
      {
        titulo: '4. Vigencia y revocatoria',
        parrafos: [
          'La autorización dura mientras exista la cuenta y el tiempo necesario para cumplir obligaciones legales, contables o de defensa.',
          'Puedes revocarla eliminando tu cuenta o escribiendo a privacidad@resolvepasto.com. La revocatoria no borra los registros que debamos conservar por ley, pero sí detiene el uso de tus datos para nuevas finalidades.',
        ],
      },
      {
        titulo: '5. Canales y respuesta',
        parrafos: [
          'Las consultas y reclamos se atienden por privacidad@resolvepasto.com. Recibirás respuesta en un máximo de quince (15) días hábiles para consultas y quince (15) días hábiles para reclamos, prorrogables conforme a la ley.',
        ],
      },
    ],
  },
]

export function documentoLegal(id: DocumentoLegalId): DocumentoLegal {
  return DOCUMENTOS_LEGALES.find(d => d.id === id) ?? DOCUMENTOS_LEGALES[0]
}
