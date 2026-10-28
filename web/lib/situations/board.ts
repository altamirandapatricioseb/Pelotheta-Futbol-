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
  matchIds: number[];
}

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

/** La diferencia contra la base más alejada de 0 entre las filas con muestra suficiente (null si no hay). */
export function strongestDelta(card: SituationCard): number | null {
  return card.rows
    .filter((r) => r.n >= SMALL_SAMPLE)
    .reduce<number | null>((best, r) => (best === null || Math.abs(r.delta) > Math.abs(best) ? r.delta : best), null);
}

const totalN = (c: SituationCard) => c.rows.reduce((a, r) => a + r.n, 0);

export function sortCards(cards: readonly SituationCard[], mode: CardSort): SituationCard[] {
  const list = [...cards];
  if (mode === 'destacados') {
    return list.sort((a, b) => Math.abs(strongestDelta(b) ?? -1) - Math.abs(strongestDelta(a) ?? -1));
  }
  if (mode === 'muestra') return list.sort((a, b) => totalN(b) - totalN(a));
  return list.sort((a, b) => a.category.localeCompare(b.category) || a.id.localeCompare(b.id));
}
