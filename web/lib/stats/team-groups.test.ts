import { describe, expect, it } from 'vitest';

import type { TeamMatchRow } from './catalog';
import { groupMatches, resultLabel } from './team-groups';

function match(id: number, date: string, opponent: string, competition: string): TeamMatchRow {
  return {
    matchId: id,
    date,
    competitionCode: competition,
    competitionName: competition === 'liga' ? 'Liga Profesional' : 'Copa Argentina',
    opponent,
    home: id % 2 === 0,
    goalsFor: 2,
    goalsAgainst: 1,
    referee: null,
    venue: null,
    stats: {},
  };
}

const rows = [
  match(1, '2026-02-01', 'River', 'liga'),
  match(2, '2026-02-15', 'Racing', 'copa'),
  match(3, '2026-03-02', 'River', 'liga'),
];

describe('groupMatches', () => {
  it('por partido: una fila por partido, en orden de fecha', () => {
    const groups = groupMatches(rows, 'partido');
    expect(groups.map((g) => g.rows.length)).toEqual([1, 1, 1]);
    expect(groups[0]?.label).toContain('River');
  });

  it('por rival y por competición junta los partidos', () => {
    expect(groupMatches(rows, 'rival').map((g) => [g.label, g.rows.length])).toEqual([
      ['Racing', 1],
      ['River', 2],
    ]);
    // Las competiciones quedan en el orden de su primer partido.
    expect(groupMatches(rows, 'competicion').map((g) => [g.label, g.rows.length])).toEqual([
      ['Liga Profesional', 2],
      ['Copa Argentina', 1],
    ]);
  });

  it('por mes usa el nombre del mes en español', () => {
    expect(groupMatches(rows, 'mes').map((g) => g.label)).toEqual(['Febrero 2026', 'Marzo 2026']);
  });

  it('acumulada: una sola fila con todo', () => {
    const [all] = groupMatches(rows, 'acumulada');
    expect(all?.rows.length).toBe(3);
  });
});

describe('resultLabel', () => {
  it('marcador desde Boca y la letra del resultado', () => {
    expect(resultLabel(match(9, '2026-01-01', 'Rival', 'liga'))).toBe('2-1 G');
    expect(resultLabel({ ...match(9, '2026-01-01', 'Rival', 'liga'), goalsFor: 0 })).toBe('0-1 P');
  });
});
