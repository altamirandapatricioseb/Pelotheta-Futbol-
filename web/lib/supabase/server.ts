import 'server-only';

import { createClient } from '@supabase/supabase-js';

import type { Database } from '@/lib/database.types';
import { readPublicEnv } from '@/lib/env';

// Los datos cambian una vez por mes (carga mensual), así que alcanza con revalidar cada 6 horas
// (sección 8, punto 8). La página se renderiza por request por el nonce de la CSP, pero las
// respuestas de Supabase quedan en la caché de datos de Next.js durante este tiempo.
export const REVALIDATE_SECONDS = 6 * 60 * 60;

/** Etiqueta de caché de todas las lecturas: se invalida cuando termina una carga (botón Actualizar). */
export const DATA_CACHE_TAG = 'supabase-datos';

const BUILD = process.env.VERCEL_DEPLOYMENT_ID ?? process.env.VERCEL_GIT_COMMIT_SHA ?? 'local';

/**
 * Cliente de solo lectura contra el esquema `api`, con la clave publicable.
 * Vive en un módulo `server-only`: la web nunca consulta la base desde el navegador.
 */
export function createApiClient() {
  const env = readPublicEnv();
  return createClient<Database, 'api'>(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
    db: { schema: 'api' },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: {
      fetch: (input, init) => {
        // La caché de datos de Vercel sobrevive a los deploys y su clave incluye los headers: con la
        // versión en un header, un deploy nuevo nunca lee respuestas guardadas por el anterior (con
        // otra forma de datos; así el predictor nuevo leyó una corrida vieja sin sus β).
        const headers = new Headers(init?.headers);
        headers.set('x-pelotheta-build', BUILD);
        return fetch(input, {
          ...init,
          headers,
          next: { revalidate: REVALIDATE_SECONDS, tags: [DATA_CACHE_TAG] },
        });
      },
    },
  });
}
