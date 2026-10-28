import 'server-only';

import type { DataResult } from '@/lib/data/players';
import { createApiClient } from '@/lib/supabase/server';

export interface ChartDef {
  id: string;
  category: string;
  title: string;
  type: string;
  available: boolean;
  /** Por qué no hay datos (solo si `available` es false). */
  reason: string;
  /** Destino del botón «Ver origen de los datos» (9.9) y su tooltip; null si no tiene. */
  origin: { href: string; label: string } | null;
  /** Estadística desglosada a la que lleva el doble clic (9.8); null si el gráfico no tiene una. */
  detail: { href: string; label: string } | null;
}

function fail(cause: unknown): { ok: false; code: 'PEL-DB-001'; detail: string } {
  return { ok: false, code: 'PEL-DB-001', detail: cause instanceof Error ? cause.message : String(cause) };
}

/** Páginas a las que puede llevar el botón de origen; cualquier otra se descarta (sin enlaces rotos). */
const PAGES = new Set(['equipo', 'jugadores', 'situaciones', 'comparar']);
const PARAMS = /^([a-z]+=[a-z0-9_]+(&[a-z]+=[a-z0-9_]+)*)?$/;

/** Catálogo de gráficos de la Interfaz 1 con su origen (`api.chart_catalog` y `api.chart_source_map`). */
export async function getChartCatalog(): Promise<DataResult<ChartDef[]>> {
  try {
    const api = createApiClient();
    const [charts, sources] = await Promise.all([
      api
        .from('chart_catalog')
        .select('chart_id, category, title_es, chart_type, available, reason_es, sort_order')
        .order('sort_order')
        .limit(300),
      api.from('chart_source_map').select('chart_id, target_type, target_ref, params, label_es').limit(600),
    ]);
    if (charts.error) return fail(charts.error.message);
    const origin = new Map<string, { href: string; label: string }>();
    const detail = new Map<string, { href: string; label: string }>();
    for (const s of sources.data ?? []) {
      if (!s.chart_id || !s.target_ref || !PARAMS.test(s.params ?? '')) continue;
      const params = new URLSearchParams(s.params ?? '');
      if (s.target_type === 'desglosada') {
        const stat = params.get('stat');
        params.delete('stat');
        if (stat && !detail.has(s.chart_id)) {
          detail.set(s.chart_id, {
            href: `/estadistica/${stat}?${params.toString()}`,
            label: s.label_es ?? 'Desglosada',
          });
        }
        continue;
      }
      if (!PAGES.has(s.target_ref) || origin.has(s.chart_id)) continue;
      origin.set(s.chart_id, {
        href: s.params ? `/${s.target_ref}?${s.params}` : `/${s.target_ref}`,
        label: s.label_es ?? 'Origen',
      });
    }
    return {
      ok: true,
      data: charts.data.flatMap((c): ChartDef[] =>
        c.chart_id && c.category && c.title_es
          ? [
              {
                id: c.chart_id,
                category: c.category,
                title: c.title_es,
                type: c.chart_type ?? '',
                available: c.available ?? false,
                reason: c.reason_es ?? '',
                origin: origin.get(c.chart_id) ?? null,
                detail: detail.get(c.chart_id) ?? null,
              },
            ]
          : [],
      ),
    };
  } catch (cause) {
    return fail(cause);
  }
}
