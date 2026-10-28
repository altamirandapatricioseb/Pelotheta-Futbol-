import { describe, expect, it } from 'vitest';

import { leagueComparison, type ClubRow } from './league';

const clubs: ClubRow[] = [
  { team: 'Boca Juniors', stats: { goals_for: 1.5, goals_against: 0.8, clean_sheets: 14, games: 31 } },
  { team: 'River Plate', stats: { goals_for: 1.4, goals_against: 0.9, clean_sheets: 12, games: 31 } },
  { team: 'Otro', stats: { goals_for: 0.5, goals_against: 1.4, clean_sheets: 5, games: 30 } },
];

describe('leagueComparison', () => {
  it('promedio de la liga por partido y percentil de Boca', () => {
    const goals = leagueComparison('eq_goles_favor', true, clubs);
    expect(goals?.average).toBeCloseTo((1.5 + 1.4 + 0.5) / 3);
    expect(goals?.bocaPercentile).toBe(100);
  });

  it('si más bajo es mejor, el percentil se invierte', () => {
    expect(leagueComparison('eq_goles_contra', false, clubs)?.bocaPercentile).toBe(100);
  });

  it('las que la fuente da como total se pasan a porcentaje de partidos', () => {
    const cs = leagueComparison('eq_pct_vallas', true, clubs);
    expect(cs?.average).toBeCloseTo(((14 / 31 + 12 / 31 + 5 / 30) / 3) * 100);
  });

  it('sin equivalente en la liga, no hay comparación', () => {
    expect(leagueComparison('eq_dominio', true, clubs)).toBeNull();
  });
});
