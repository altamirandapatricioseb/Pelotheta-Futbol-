import { describe, expect, it } from 'vitest';

import { filterCards, headline, sortCards, strongestDelta, type SituationCard } from './board';

const row = (param: string, n: number, delta: number) => ({
  param,
  order: 1,
  n,
  w: 0,
  d: 0,
  l: 0,
  winPct: 50 + delta,
  ppg: 0,
  goalDiff: 0,
  base: 50,
  delta,
  gf: 1,
  ga: 1,
  cleanPct: 30,
  scoredPct: 70,
  base2: { ppg: 1.5, gf: 1.4, ga: 0.9, clean: 40 },
  stats: {},
  baseStats: {},
  matchIds: [],
});

const card = (
  id: string,
  category: string,
  rows: SituationCard['rows'],
  extra: Partial<SituationCard> = {},
): SituationCard => ({
  id,
  category,
  title: `Tarjeta ${id}`,
  condition: 'Condición',
  params: '',
  measured: 'Resultado del partido',
  required: 'datos',
  level: 'A',
  available: true,
  estimated: false,
  reason: '',
  mainMetric: 'win_pct',
  extraMetrics: [],
  rows,
  ...extra,
});

const CARDS = [
  card('s001', 'A', [row('x', 10, 5)]),
  card('s002', 'A', [row('x', 3, -40)]),
  card('s030', 'C', [row('x', 20, 12)], { level: 'B' }),
  card('s043', 'D', [], { available: false, reason: 'falta' }),
];

describe('filterCards', () => {
  it('busca en título y condición sin importar tildes ni mayúsculas', () => {
    expect(filterCards(CARDS, { query: 'TARJETA S030' }).map((c) => c.id)).toEqual(['s030']);
    expect(filterCards(CARDS, { query: 'condicion' })).toHaveLength(4);
  });
  it('filtra por categoría, nivel y solo con datos', () => {
    expect(filterCards(CARDS, { category: 'A' }).map((c) => c.id)).toEqual(['s001', 's002']);
    expect(filterCards(CARDS, { level: 'B' }).map((c) => c.id)).toEqual(['s030']);
    expect(filterCards(CARDS, { onlyData: true }).map((c) => c.id)).toEqual(['s001', 's002', 's030']);
  });
  it('ocultar muestra pequeña saca las filas con n < 5 y las tarjetas que se quedan sin filas', () => {
    const out = filterCards(CARDS, { hideSmall: true, onlyData: true });
    expect(out.map((c) => c.id)).toEqual(['s001', 's030']);
  });
});

describe('strongestDelta y sortCards', () => {
  it('la diferencia más extrema contra la base, sin contar filas con muestra pequeña', () => {
    expect(strongestDelta(CARDS[2] as SituationCard)).toBeCloseTo(0.12);
    // s002 solo tiene una fila de 3 partidos: no compite en Destacados.
    expect(strongestDelta(CARDS[1] as SituationCard)).toBeNull();
    expect(strongestDelta(CARDS[3] as SituationCard)).toBeNull();
  });
  it('Destacados ordena por la diferencia más extrema; muestra, por partidos', () => {
    expect(sortCards(CARDS, 'destacados').map((c) => c.id)).toEqual(['s030', 's001', 's002', 's043']);
    expect(sortCards(CARDS, 'muestra').map((c) => c.id)).toEqual(['s030', 's001', 's002', 's043']);
    expect(sortCards(CARDS, 'categoria').map((c) => c.id)).toEqual(['s001', 's002', 's030', 's043']);
  });
});

describe('headline', () => {
  it('cada métrica se compara con su propia base y sabe si más es mejor', () => {
    const r = { ...row('x', 10, 5), ppg: 2.1, ga: 0.5, goalDiff: 1.2 };
    expect(headline(r, 'ppg')).toMatchObject({ value: 2.1, base: 1.5, better: true });
    expect(headline(r, 'ga')).toMatchObject({ value: 0.5, base: 0.9, better: true });
    expect(headline(r, 'goal_diff').base).toBeCloseTo(0.5);
    expect(headline({ ...r, cleanPct: 20 }, 'clean_pct')).toMatchObject({ value: 20, base: 40, better: false });
  });
  it('la diferencia relativa ordena Destacados entre métricas distintas', () => {
    const a = card('a', 'A', [{ ...row('x', 10, 0), ppg: 2.7 }], { mainMetric: 'ppg' });
    const b = card('b', 'A', [row('x', 10, 30)]);
    // +1,2 puntos sobre 3 (40 %) pesa más que +30 puntos de % sobre 100 (30 %).
    expect(sortCards([b, a], 'destacados').map((c) => c.id)).toEqual(['a', 'b']);
  });
});
