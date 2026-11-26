import { describe, expect, it, vi } from 'vitest';

import type { PlayerProfile } from '@/lib/data/parquet';

vi.mock('server-only', () => ({}));

const { alternatives, needs, opportunities, prospects, similarity } = await import('./league-scout');

// El perfil tiene columnas libres (`pct_…`, `per90_…`): el literal se arma y se convierte al tipo.
const player = (name: string, team: string, pct: number, extra: Record<string, number | null> = {}) =>
  ({
    player_id: name,
    player_name: name,
    team_name: team,
    position: 'Delantero',
    minutes: 900,
    matches: 10,
    pct_goals: pct,
    pct_expected_goals: pct,
    pct_key_pass: pct,
    pct_won_tackle: pct,
    ...extra,
  }) as unknown as PlayerProfile;

describe('ojeador y alternativas de liga', () => {
  it('el parecido usa solo las estadísticas en común y pide al menos cuatro', () => {
    expect(similarity(player('a', 'X', 80), player('b', 'Y', 60))).toBeCloseTo(0.8);
    expect(similarity(player('a', 'X', 80), player('b', 'Y', 60, { pct_won_tackle: null }))).toBeNull();
  });

  it('las alternativas son de otro club y de la misma posición, de la más parecida', () => {
    const me = player('yo', 'X', 70);
    const league = [player('mate', 'X', 70), player('lejos', 'Y', 10), player('cerca', 'Z', 65)];
    expect(alternatives([me], league)[0]?.similar.map((s) => s.player.player_name)).toEqual(['cerca', 'lejos']);
  });

  it('lo que le falta: la estadística más baja del plantel y los mejores de otros clubes', () => {
    const squad = ['a', 'b', 'c'].map((n) => player(n, 'X', 50, { pct_won_tackle: 10 }));
    const league = [...squad, player('tanque', 'Y', 40, { pct_won_tackle: 95 })];
    const [first] = needs(squad, league, 1, 1);
    expect(first?.stat).toBe('won_tackle');
    expect(first?.picks.map((p) => p.player_name)).toEqual(['tanque']);
  });

  it('oportunidades y jóvenes dejan afuera al propio club', () => {
    const value = (name: string, team: string, gap: number, age: number) => ({
      player_name: name,
      team_name: team,
      position_group: null,
      age,
      value_eur: 1,
      predicted_eur: 100 - age,
      gap_pct: gap,
    });
    const values = [value('propio', 'X', -90, 19), value('barato', 'Y', -50, 25), value('caro', 'Y', 40, 20)];
    expect(opportunities(values, 'X').map((v) => v.player_name)).toEqual(['barato']);
    expect(prospects(values, 'X').map((v) => v.player_name)).toEqual(['caro']);
  });
});
