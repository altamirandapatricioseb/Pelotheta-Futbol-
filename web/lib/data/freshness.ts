import 'server-only';

import { createApiClient } from '@/lib/supabase/server';

export interface Freshness {
  /** Fecha y hora (ISO) de la última carga exitosa, o null si nunca hubo una. */
  lastUpdate: string | null;
  /** Estado de la última corrida de la fuente principal. */
  sourceStatus: 'ok' | 'parcial' | 'error' | 'omitido' | null;
  /** false si la base no respondió (pausada o caída). */
  reachable: boolean;
}

/** Última actualización y estado de las fuentes, para el header de todas las páginas. */
export async function getFreshness(): Promise<Freshness> {
  try {
    const supabase = createApiClient();
    const [status, sources] = await Promise.all([
      supabase.from('system_status').select('value, updated_at').eq('key', 'ultima_actualizacion').maybeSingle(),
      supabase
        .from('source_status')
        .select('source, last_status, last_success_at')
        .eq('source', 'promiedos')
        .maybeSingle(),
    ]);
    if (status.error || sources.error) return { lastUpdate: null, sourceStatus: null, reachable: false };
    const lastStatus = sources.data?.last_status;
    return {
      lastUpdate: sources.data?.last_success_at ?? null,
      sourceStatus:
        lastStatus === 'ok' || lastStatus === 'parcial' || lastStatus === 'error' || lastStatus === 'omitido'
          ? lastStatus
          : null,
      reachable: true,
    };
  } catch {
    return { lastUpdate: null, sourceStatus: null, reachable: false };
  }
}
