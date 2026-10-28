// Tablero de Situaciones (Interfaz 4, 9.6): tipos, filtros y orden de las tarjetas.
// Funciones puras y testeadas; el lienzo (zoom, arrastre, minimapa) vive en el componente.

export interface SituationRow {
  param: string;
  order: number;
  n: number;
  w: number;
  d: number;
  l: number;
  winPct: number;
  ppg: number;
  goalDiff: number;
  base: number;
  delta: number;
  gf: number;
  ga: number;
  cleanPct: number;
  scoredPct: number;
  /** Base de Boca en toda la temporada para las otras métricas. */
  base2: { ppg: number; gf: number; ga: number; clean: number };
  matchIds: number[];
}

export type MainMetric = 'win_pct' | 'ppg' | 'goal_diff' | 'gf' | 'ga' | 'clean_pct';

export interface SituationCard {
  id: string;
  category: string;
  title: string;
  condition: string;
  params: string;
  measured: string;
  required: string;
  level: string;
  available: boolean;
  estimated: boolean;
  reason: string;
  /** Métrica que destaca la tarjeta (la que mejor responde su pregunta). */
  mainMetric: MainMetric;
  rows: SituationRow[];
}

export interface SituationMatch {
  date: string;
  competition: string;
  opponent: string;
  home: boolean;
  goalsFor: number;
  goalsAgainst: number;
  result: string;
}

export interface CardFilters {
  query?: string;
  category?: string;
  level?: string;
  onlyData?: boolean;
  hideSmall?: boolean;
}

export type CardSort = 'categoria' | 'destacados' | 'muestra';

/** Muestra pequeña de 9.6: menos de 5 partidos en la fila. */
export const SMALL_SAMPLE = 5;

export const CATEGORY_NAMES: Record<string, string> = {
  A: 'Marcador y remontadas',
  B: 'Resultados y goles',
  C: 'Tiros y ataque',
  D: 'Posesión y circulación',
  E: 'Defensa',
  F: 'Pelota parada',
  G: 'Disciplina y árbitros',
  H: 'Local, visitante y contexto',
  I: 'Forma y rachas',
  J: 'Jugadores y plantel',
  K: 'Tiempo y ritmo',
};

const fold = (text: string) => text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export function filterCards(cards: readonly SituationCard[], f: CardFilters): SituationCard[] {
  const query = f.query ? fold(f.query.trim()) : '';
  return cards.flatMap((c) => {
    if (f.category && c.category !== f.category) return [];
    if (f.level && c.level !== f.level) return [];
    if (query && !fold(`${c.title} ${c.condition} ${c.params} ${c.id}`).includes(query)) return [];
    const rows = f.hideSmall ? c.rows.filter((r) => r.n >= SMALL_SAMPLE) : c.rows;
    if (f.onlyData && (!c.available || rows.length === 0)) return [];
    return [{ ...c, rows }];
  });
}

export const METRICS: Record<MainMetric, { label: string; unit: string; scale: number; higherIsBetter: boolean }> = {
  win_pct: { label: 'victorias', unit: '%', scale: 100, higherIsBetter: true },
  ppg: { label: 'puntos por partido', unit: 'pts', scale: 3, higherIsBetter: true },
  goal_diff: { label: 'diferencia de gol', unit: 'goles', scale: 3, higherIsBetter: true },
  gf: { label: 'goles a favor por partido', unit: 'goles', scale: 3, higherIsBetter: true },
  ga: { label: 'goles en contra por partido', unit: 'goles', scale: 3, higherIsBetter: false },
  clean_pct: { label: 'vallas invictas', unit: '%', scale: 100, higherIsBetter: true },
};

/** Valor de la métrica principal en una fila, su base de temporada y si está mejor que la base. */
export function headline(
  row: SituationRow,
  metric: MainMetric,
): { value: number; base: number; diff: number; better: boolean } {
  const pick: Record<MainMetric, [number, number]> = {
    win_pct: [row.winPct, row.base],
    ppg: [row.ppg, row.base2.ppg],
    goal_diff: [row.goalDiff, row.base2.gf - row.base2.ga],
    gf: [row.gf, row.base2.gf],
    ga: [row.ga, row.base2.ga],
    clean_pct: [row.cleanPct, row.base2.clean],
  };
  const [value, base] = pick[metric];
  const diff = value - base;
  return { value, base, diff, better: METRICS[metric].higherIsBetter ? diff > 0 : diff < 0 };
}

/**
 * La diferencia contra la base más alejada de 0 entre las filas con muestra suficiente, relativa a
 * la escala de la métrica (para comparar puntos con porcentajes); null si no hay filas.
 */
export function strongestDelta(card: SituationCard): number | null {
  const scale = METRICS[card.mainMetric].scale;
  return card.rows
    .filter((r) => r.n >= SMALL_SAMPLE)
    .map((r) => headline(r, card.mainMetric).diff / scale)
    .reduce<number | null>((best, d) => (best === null || Math.abs(d) > Math.abs(best) ? d : best), null);
}

const totalN = (c: SituationCard) => c.rows.reduce((a, r) => a + r.n, 0);

export function sortCards(cards: readonly SituationCard[], mode: CardSort): SituationCard[] {
  const list = [...cards];
  if (mode === 'destacados') {
    // Las tarjetas sin filas comparables van al final.
    const strength = (c: SituationCard) => {
      const d = strongestDelta(c);
      return d === null ? -1 : Math.abs(d);
    };
    return list.sort((a, b) => strength(b) - strength(a));
  }
  if (mode === 'muestra') return list.sort((a, b) => totalN(b) - totalN(a));
  return list.sort((a, b) => a.category.localeCompare(b.category) || a.id.localeCompare(b.id));
}
