// Códigos de error estables (16.6). Cada uno tiene su artículo en docs/soporte/<código>.md, con qué lo
// causa, qué ve quien usa el sitio y cómo se resuelve. Un código no cambia de significado nunca.

export const REPO_URL = 'https://github.com/altamirandapatricioseb/Pelotheta-Futbol-';

export const ERRORS = {
  'PEL-DB-001': {
    message: 'la base de datos no responde.',
    hint: 'Puede estar pausada por inactividad. Probá de nuevo en unos minutos.',
  },
  'PEL-NF-404': {
    message: 'no existe esa página o ese dato.',
    hint: 'Puede ser un enlace viejo o un jugador que ya no está en el plantel.',
  },
  'PEL-SRC-003': {
    message: 'una fuente de datos falló en la última corrida.',
    hint: 'Los datos de esa fuente quedan como estaban hasta la próxima carga exitosa.',
  },
  'PEL-DATA-010': {
    message: 'un dato quedó fuera de rango y se apartó.',
    hint: 'El pipeline lo guarda en cuarentena y no lo publica hasta revisarlo.',
  },
  'PEL-UPD-001': {
    message: 'el botón Actualizar no está habilitado en este despliegue.',
    hint: 'Falta configurar el token de GitHub en Vercel.',
  },
  'PEL-UPD-002': {
    message: 'no se pudo consultar el estado de la actualización.',
    hint: 'GitHub no respondió. Probá de nuevo en un rato.',
  },
  'PEL-UPD-003': {
    message: 'la última actualización falló.',
    hint: 'Se puede volver a intentar; si se repite, mirá el paso que falló.',
  },
} as const;

export type ErrorCode = keyof typeof ERRORS;

/** Artículo de la base de conocimiento para un código. */
export function articleUrl(code: ErrorCode): string {
  return `${REPO_URL}/blob/main/docs/soporte/${code}.md`;
}

/** Issue ya completado para reportar un dato incorrecto en una página (sin formulario propio). */
export function reportUrl(pageUrl: string): string {
  const params = new URLSearchParams({
    template: 'dato_incorrecto.yml',
    title: 'Dato incorrecto: ',
    pagina: pageUrl,
  });
  return `${REPO_URL}/issues/new?${params.toString()}`;
}
