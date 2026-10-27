// Identidad del sistema (sección 9.10).
export const SYSTEM_NAME = 'Pelotheta Θ';
export const TEAM_NAME = 'Boca Juniors';
export const SITE_DESCRIPTION =
  'Sistema de análisis de datos de Boca Juniors: estadísticas, métricas propias y comparaciones. Proyecto de portfolio sin fines comerciales.';

// Imágenes que provee el dueño en web/public/brand/. next.config.ts revisa en el build cuáles
// existen y deja la ruta en estas variables; si falta una, se usa el respaldo de texto
// (sin imagen rota y sin errores en la consola).
export const TEAM_PHOTO_SRC = process.env.NEXT_PUBLIC_TEAM_PHOTO ?? '';
export const SYSTEM_LOGO_SRC = process.env.NEXT_PUBLIC_SYSTEM_LOGO ?? '';
