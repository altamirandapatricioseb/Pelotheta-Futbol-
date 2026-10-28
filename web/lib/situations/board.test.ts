import { describe, expect, it } from 'vitest';

import { filterCards, sortCards, strongestDelta, type SituationCard } from './board';

const row = (param: string, n: number, delta: number) => ({
  param,
  order: 1,
  n,
  w: 0,
  d: 0,
  l: 0,
  winPct: 0,
  ppg: 0,
  goalDiff: 0,
  base: 50,
  delta,
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
    expect(strongestDelta(CARDS[2] as SituationCard)).toBe(12);
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
