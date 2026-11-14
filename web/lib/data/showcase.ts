import 'server-only';

import { getChartCatalog } from '@/lib/data/charts';
import { getTeamMatches } from '@/lib/data/team';
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
  matches: number;
  goals: number;
  charts: number;
  shots: ShowcaseShot[];
}

/** Lo mínimo que necesita la portada: cuatro números y los remates de Boca para el canvas. */
export async function getShowcaseData(): Promise<ShowcaseData> {
  const [matches, charts, shots] = await Promise.all([
    getTeamMatches(),
    getChartCatalog(),
    createApiClient().from('boca_shot').select('outcome, xg, x, y').eq('boca_shot', true).limit(2000),
  ]);
  const ms = matches.ok ? matches.data : [];
  return {
    matches: ms.length,
    goals: ms.reduce((a, m) => a + m.goalsFor, 0),
    charts: charts.ok ? charts.data.length : 0,
    shots: (shots.data ?? []).flatMap((s) =>
      s.x === null || s.y === null || s.xg === null ? [] : [{ x: s.x, y: s.y, xg: s.xg, goal: s.outcome === 'goal' }],
    ),
  };
}
