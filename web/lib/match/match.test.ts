import { describe, expect, it } from 'vitest';

import type { StatDef, TeamMatchRow } from '@/lib/stats/catalog';

import { matchGoals, neighbors, playerMatchValue, teamVsSeason } from './match';

function stat(id: string, over: Partial<StatDef> = {}): StatDef {
  return {
    id,
    entity: 'team',
    name: id,
    short: id,
    description: '',
    reading: '',
    group: 'Ataque',
    category: 'ataque',
    unit: '',
    source: '',
    level: 'A',
    formula: '',
    higherIsBetter: true,
    available: true,
    estimated: false,
    per90: true,
    rule: 'suma',
    arg1: id,
    arg2: '',
    factor: 1,
    ...over,
  };
}

const row = (matchId: number, stats: Record<string, number>): TeamMatchRow => ({
  matchId,
  date: `2026-03-${String(10 + matchId)}`,
  competitionCode: 'liga',
  competitionName: 'Liga',
  opponent: `Rival ${String(matchId)}`,
  home: matchId % 2 === 0,
  goalsFor: 1,
  goalsAgainst: 0,
  referee: null,
  venue: null,
  stats,
});

describe('goles del partido', () => {
  it('solo los remates que terminaron en gol, por minuto', () => {
    const goals = matchGoals([
      { minute: 70, outcome: 'goal', playerName: 'Merentiel', boca: true, penalty: false },
      { minute: 12, outcome: 'saved', playerName: 'Paredes', boca: true, penalty: false },
      { minute: 30, outcome: 'goal', playerName: null, boca: false, penalty: true },
    ]);
    expect(goals).toEqual([
      { minute: 30, player: 'Rival', boca: false, penalty: true },
      { minute: 70, player: 'Merentiel', boca: true, penalty: false },
    ]);
  });
});

describe('partido anterior y siguiente', () => {
  it('por orden de fecha; en los extremos no hay', () => {
    const list = [{ matchId: 3 }, { matchId: 1 }, { matchId: 2 }].map((m) => ({
      ...m,
      kickoff: `2026-0${String(m.matchId)}-01`,
    }));
    expect(neighbors(list, 2)).toEqual({ prev: 1, next: 3 });
    expect(neighbors(list, 1)).toEqual({ prev: null, next: 2 });
    expect(neighbors(list, 9)).toEqual({ prev: null, next: null });
  });
});

describe('estadística del equipo contra su promedio', () => {
  const remates = stat('remates', { arg1: 'shots' });
  const faltas = stat('faltas', { arg1: 'fouls', higherIsBetter: false });
  const pases = stat('pases', { arg1: 'passes' });
  const completos = stat('completos', { arg1: 'passes_ok' });
  const pct = stat('pct', { rule: 'cociente', arg1: 'completos', arg2: 'pases', factor: 100, per90: false });
  const byId = new Map([remates, faltas, pases, completos, pct].map((s) => [s.id, s]));
  const rows = [
    row(1, { shots: 10, fouls: 20, passes: 100, passes_ok: 80 }),
    row(2, { shots: 20, fouls: 10, passes: 300, passes_ok: 270 }),
  ];

  it('valor del partido, promedio por partido de la temporada y si fue mejor', () => {
    const [r, f] = teamVsSeason(rows[1] as TeamMatchRow, rows, [remates, faltas], byId);
    expect(r).toMatchObject({ value: 20, season: 15, verdict: 'mejor' });
    expect(f).toMatchObject({ value: 10, season: 15, verdict: 'mejor' });
  });

  it('los porcentajes de la temporada son suma sobre suma', () => {
    const [p] = teamVsSeason(rows[0] as TeamMatchRow, rows, [pct], byId);
    expect(p?.value).toBe(80);
    expect(p?.season).toBe(87.5);
    expect(p?.verdict).toBe('peor');
  });
});

describe('estadística de un jugador en el partido', () => {
  it('suma directa y cociente con las claves base', () => {
    const goles = stat('goles', { entity: 'player', arg1: 'goals' });
    const pases = stat('pases', { entity: 'player', arg1: 'passes' });
    const completos = stat('completos', { entity: 'player', arg1: 'passes_ok' });
    const pct = stat('pct', { entity: 'player', rule: 'cociente', arg1: 'completos', arg2: 'pases', factor: 100 });
    const byId = new Map([goles, pases, completos, pct].map((s) => [s.id, s]));
    const keys = { goals: 1, passes: 40, passes_ok: 30 };
    expect(playerMatchValue(keys, goles, byId)).toBe(1);
    expect(playerMatchValue(keys, pct, byId)).toBe(75);
    expect(playerMatchValue({}, goles, byId)).toBeNull();
  });
});
