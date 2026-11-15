import 'server-only';

import { getChartCatalog } from '@/lib/data/charts';
import { createApiClient } from '@/lib/supabase/server';

export interface ShowcaseShot {
  /** Distancia al arco como fracción de media cancha (0 = línea de gol). */
  x: number;
  /** Ancho de la cancha, de 0 a 1. */
  y: number;
  xg: number;
  goal: boolean;
}

export interface ShowcaseData {
  /** Tamaño del sistema, no de un equipo: gráficos y situaciones del catálogo. */
  charts: number;
  situations: number;
  /** Remates reales para el canvas de la portada (material visual, sin cifras en pantalla). */
  shots: ShowcaseShot[];
}

/** Lo mínimo que necesita la portada; si la base no responde, la portada igual se dibuja. */
export async function getShowcaseData(): Promise<ShowcaseData> {
  const api = createApiClient();
  const [charts, situations, shots] = await Promise.all([
    getChartCatalog(),
    api.from('situational_catalog').select('card_id', { count: 'exact', head: true }),
    api.from('boca_shot').select('outcome, xg, x, y').eq('boca_shot', true).limit(2000),
  ]);
  return {
    charts: charts.ok ? charts.data.length : 0,
    situations: situations.count ?? 0,
    shots: (shots.data ?? []).flatMap((s) =>
      s.x === null || s.y === null || s.xg === null ? [] : [{ x: s.x, y: s.y, xg: s.xg, goal: s.outcome === 'goal' }],
    ),
  };
}
