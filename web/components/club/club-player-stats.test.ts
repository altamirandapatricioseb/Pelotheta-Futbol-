import { describe, expect, it } from 'vitest';

import { seasonLines } from './club-player-stats';

const game = (id: string, minutes: number, stats: Record<string, number>) => ({
  playerId: id,
  playerName: id,
  position: 'F',
  date: '2026-01-01',
  opponent: null,
  minutes,
  stats,
});

describe('totales de la temporada por jugador', () => {
  it('suma lo que hay, pesa la nota por minutos y ordena por minutos', () => {
    const lines = seasonLines([
      game('a', 90, { goals: 1, rating: 8 }),
      game('a', 30, { goals: 1, rating: 6 }),
      game('b', 200, { goals: 0 }),
    ]);
    expect(lines.map((l) => l.playerId)).toEqual(['b', 'a']);
    const a = lines[1];
    expect([a?.matches, a?.minutes, a?.stats.goals]).toEqual([2, 120, 2]);
    expect(a?.rating).toBeCloseTo(7.5);
    expect(lines[0]?.rating).toBeNull(); // sin notas, sin promedio
    expect(lines[0]?.stats.saves).toBeUndefined(); // lo que la fuente no trae no es 0
  });
});
