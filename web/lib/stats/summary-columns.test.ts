import { describe, expect, it } from 'vitest';

import type { PlayerSummary } from '@/lib/data/players';

import { columnValue, rankAndPercentile, SUMMARY_COLUMNS } from './summary-columns';

const base: PlayerSummary = {
  playerId: 1,
  name: 'Jugador de prueba',
  shortName: null,
  position: 'Delantero',
  shirtNumber: 9,
  age: 25,
  heightCm: 180,
  matches: 10,
  starts: 8,
  minutes: 900,
  goals: 6,
  assists: 3,
  goalContributions: 9,
  yellowCards: 2,
  redCards: 0,
};

const column = (key: string) => {
  const found = SUMMARY_COLUMNS.find((c) => c.key === key);
  if (!found) throw new Error(key);
  return found;
};

describe('columnValue', () => {
  it('devuelve totales o valores cada 90 minutos', () => {
    expect(columnValue(base, column('goals'), false)).toBe(6);
    expect(columnValue(base, column('goals'), true)).toBe(0.6);
  });

  it('no convierte a 90 lo que no tiene sentido (partidos, minutos)', () => {
    expect(columnValue(base, column('matches'), true)).toBe(10);
  });

  it('la calificación queda no disponible (nivel C)', () => {
    expect(columnValue(base, column('rating'), false)).toBeNull();
  });

  it('sin minutos no hay valor cada 90', () => {
    expect(columnValue({ ...base, minutes: 0 }, column('goals'), true)).toBeNull();
  });
});

describe('rankAndPercentile', () => {
  it('ubica el valor en el plantel', () => {
    expect(rankAndPercentile([1, 5, 3, 9], 5)).toEqual({ rank: 2, percentile: 67 });
    expect(rankAndPercentile([1, 5, 3, 9], 9)).toEqual({ rank: 1, percentile: 100 });
  });
});
