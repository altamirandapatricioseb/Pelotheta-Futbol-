import 'server-only';

import type { DataResult } from '@/lib/data/players';
import { createApiClient } from '@/lib/supabase/server';
import type { StatDef, StatLevel, StatRule, StatSet } from '@/lib/stats/catalog';

const LEVELS = new Set<string>(['A', 'B', 'C']);
const RULES = new Set<string>([
  'suma',
  'promedio',
  'cociente',
  'diferencia',
  'adicion',
  'perfil',
  'metrica',
  'especial',
  'nd',
]);

function fail(cause: unknown): { ok: false; code: 'PEL-DB-001'; detail: string } {
  return { ok: false, code: 'PEL-DB-001', detail: cause instanceof Error ? cause.message : String(cause) };
}

/** Catálogo de estadísticas de una entidad (jugador o equipo), indexado por id. */
export async function getCatalog(entity: 'player' | 'team'): Promise<DataResult<StatDef[]>> {
  try {
    const { data, error } = await createApiClient().from('stat_catalog').select('*').eq('entity', entity);
    if (error) return fail(error.message);
    // Lo que viene de la base se valida antes de usarlo: una fila rara se descarta (14.3).
    const stats = data.flatMap((r): StatDef[] =>
      r.stat_id && r.level && LEVELS.has(r.level) && r.rule && RULES.has(r.rule)
        ? [
            {
              id: r.stat_id,
              entity,
              name: r.name_es ?? r.stat_id,
              short: r.short_name ?? r.stat_id,
              description: r.description_es ?? '',
              group: r.stat_group ?? '',
              category: r.category ?? '',
              unit: r.unit ?? '',
              source: r.source ?? '',
              level: r.level as StatLevel,
              formula: r.formula ?? '',
              higherIsBetter: r.higher_is_better ?? true,
              available: r.available ?? false,
              estimated: r.estimated ?? false,
              per90: r.per90 ?? false,
              rule: r.rule as StatRule,
              arg1: r.arg1 ?? '',
              arg2: r.arg2 ?? '',
              factor: r.factor ?? 1,
            },
          ]
        : [],
    );
    return { ok: true, data: stats };
  } catch (cause) {
    return fail(cause);
  }
}

/** Conjuntos de columnas (el desplegable de categoría) en su orden. */
export async function getStatSets(entity: 'player' | 'team'): Promise<DataResult<StatSet[]>> {
  try {
    const { data, error } = await createApiClient()
      .from('stat_set')
      .select('set_id, name_es, description_es, stat_ids, sort_order')
      .eq('entity', entity)
      .order('sort_order');
    if (error) return fail(error.message);
    return {
      ok: true,
      data: data.flatMap((r) =>
        r.set_id && r.name_es && r.stat_ids
          ? [{ id: r.set_id, entity, name: r.name_es, description: r.description_es ?? '', statIds: r.stat_ids }]
          : [],
      ),
    };
  } catch (cause) {
    return fail(cause);
  }
}

/** Objeto JSON {id: valor} de la base, quedándose solo con los números. */
export function numericStats(json: unknown): Record<string, number> {
  if (json === null || typeof json !== 'object' || Array.isArray(json)) return {};
  const out: Record<string, number> = {};
  for (const [key, value] of Object.entries(json)) {
    const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN;
    if (Number.isFinite(n)) out[key] = n;
  }
  return out;
}
