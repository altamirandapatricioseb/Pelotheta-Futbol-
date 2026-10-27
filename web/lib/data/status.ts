import 'server-only';

import { createApiClient } from '@/lib/supabase/server';

export interface StatusRow {
  key: string;
  value: string;
  updatedAt: string | null;
}

export type StatusResult =
  | { ok: true; rows: StatusRow[] }
  // Código estable de error (sección 16.6): PEL-DB-001 = la base no responde.
  | { ok: false; code: 'PEL-DB-001'; detail: string };

/** Lee la fila de prueba de la etapa 1 desde la vista pública `api.system_status`. */
export async function getSystemStatus(): Promise<StatusResult> {
  try {
    const supabase = createApiClient();
    const { data, error } = await supabase.from('system_status').select('key, value, updated_at').order('key').limit(50);
    if (error) {
      return { ok: false, code: 'PEL-DB-001', detail: error.message };
    }
    const rows = data
      .filter((row): row is { key: string; value: string; updated_at: string | null } => row.key !== null && row.value !== null)
      .map((row) => ({ key: row.key, value: row.value, updatedAt: row.updated_at }));
    return { ok: true, rows };
  } catch (cause) {
    // Supabase pausado, red caída o variables de entorno inválidas: la página no se rompe.
    return { ok: false, code: 'PEL-DB-001', detail: cause instanceof Error ? cause.message : 'error desconocido' };
  }
}
