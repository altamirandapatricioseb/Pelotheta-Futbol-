// Códigos de error estables (16.6). Un código no cambia de significado nunca. Cada uno tiene su
// explicación pública en /soporte (sale de acá) y su artículo de mantenimiento en docs/soporte/.

export interface ErrorInfo {
  title: string;
  message: string;
  hint: string;
  causes: readonly string[];
  fix: readonly string[];
}

export const ERRORS = {
  'PEL-DB-001': {
    title: 'La base de datos no responde',
    message: 'la base de datos no responde.',
    hint: 'Puede estar pausada por inactividad. Probá de nuevo en unos minutos.',
    causes: [
      'El proyecto gratuito de la base se pausa tras días sin actividad.',
      'Un corte del proveedor de la base.',
      'Una consulta más lenta que el límite de 3 segundos.',
    ],
    fix: ['Esperar unos minutos y recargar.', 'Ver /api/health: si dice «caida», el problema es de la base.'],
  },
  'PEL-NF-404': {
    title: 'No existe esa página o ese dato',
    message: 'no existe esa página o ese dato.',
    hint: 'Puede ser un enlace viejo o un jugador que ya no está en el plantel.',
    causes: [
      'Un enlace de antes de un cambio de rutas.',
      'Un jugador que dejó el plantel.',
      'Parámetros de la dirección que no son válidos.',
    ],
    fix: ['Volver al inicio y navegar desde ahí.'],
  },
  'PEL-SRC-003': {
    title: 'Una fuente de datos falló',
    message: 'una fuente de datos falló en la última corrida.',
    hint: 'Los datos de esa fuente quedan como estaban hasta la próxima carga exitosa.',
    causes: ['La fuente cambió su formato.', 'La fuente bloqueó o limitó los pedidos.', 'Venció la clave de una API.'],
    fix: ['Nada que hacer del lado de quien visita: los datos anteriores siguen publicados.'],
  },
  'PEL-DATA-010': {
    title: 'Dato fuera de rango',
    message: 'un dato quedó fuera de rango y se apartó.',
    hint: 'El pipeline lo guarda en cuarentena y no lo publica hasta revisarlo.',
    causes: ['La fuente publicó un valor imposible (por ejemplo, posesión de 140 %).', 'Un cambio de unidad.'],
    fix: ['El dato queda como n/d hasta revisarlo.'],
  },
  'PEL-UPD-001': {
    title: 'El botón Actualizar no está habilitado',
    message: 'el botón Actualizar no está habilitado en este despliegue.',
    hint: 'Falta configurar el token de GitHub en Vercel.',
    causes: ['El despliegue no tiene el token que dispara la actualización.'],
    fix: ['Los datos se siguen cargando con la actualización mensual automática.'],
  },
  'PEL-UPD-002': {
    title: 'No se pudo consultar la actualización',
    message: 'no se pudo consultar el estado de la actualización.',
    hint: 'GitHub no respondió. Probá de nuevo en un rato.',
    causes: ['Un corte o un límite de pedidos de GitHub.'],
    fix: ['Probar de nuevo en unos minutos.'],
  },
  'PEL-UPD-003': {
    title: 'La última actualización falló',
    message: 'la última actualización falló.',
    hint: 'Se puede volver a intentar; si se repite, mirá el paso que falló.',
    causes: ['Una fuente caída (PEL-SRC-003).', 'Un error del pipeline.', 'La base no aceptó la carga (PEL-DB-001).'],
    fix: ['Volver a intentar: la carga no duplica datos.'],
  },
} as const satisfies Record<string, ErrorInfo>;

export type ErrorCode = keyof typeof ERRORS;

/** Explicación pública de un código. */
export function articleUrl(code: ErrorCode): string {
  return `/soporte#${code}`;
}
