import { describe, expect, it } from 'vitest';

import {
  extremeOf,
  aggregateTeam,
  formatStat,
  playerValue,
  rankAndPercentile,
  type PlayerRow,
  type StatDef,
  type TeamMatchRow,
} from './catalog';

function stat(overrides: Partial<StatDef>): StatDef {
  return {
    id: 'x',
    entity: 'player',
    name: 'Prueba',
    short: 'P',
    description: 'Estadística de prueba.',
    reading: 'Más alto es mejor.',
    group: 'Resumen',
    category: 'ataque',
    unit: 'goles',
    source: 'promiedos',
    level: 'B',
    formula: '',
    higherIsBetter: true,
    available: true,
    estimated: false,
    per90: true,
    rule: 'suma',
    arg1: 'goals',
    arg2: '',
    factor: 1,
    ...overrides,
  };
}

const player: PlayerRow = {
  playerId: 1,
  name: 'Jugador de prueba',
  shortName: null,
  position: 'Delantero',
  shirtNumber: 9,
  age: 25,
  heightCm: 180,
  weightKg: null,
  foot: 'R',
  nationality: 'ARG',
  matches: 10,
  minutes: 900,
  stats: { goles: 6, pct_pases: 81.25 },
};

describe('playerValue', () => {
  it('lee el valor calculado en la base y lo pasa a 90 minutos si corresponde', () => {
    const goles = stat({ id: 'goles' });
    expect(playerValue(player, goles, false)).toBe(6);
    expect(playerValue(player, goles, true)).toBe(0.6);
  });

  it('no pasa a 90 los porcentajes', () => {
    expect(playerValue(player, stat({ id: 'pct_pases', rule: 'cociente', per90: false }), true)).toBe(81.25);
  });

  it('nivel C y valores ausentes son n/d (null)', () => {
    expect(playerValue(player, stat({ id: 'presiones', rule: 'nd', level: 'C' }), false)).toBeNull();
    expect(playerValue(player, stat({ id: 'xg' }), false)).toBeNull();
  });

  it('los datos de la ficha salen de la fila', () => {
    expect(playerValue(player, stat({ id: 'edad', rule: 'perfil', arg1: 'edad', per90: false }), false)).toBe(25);
    expect(playerValue(player, stat({ id: 'pie', rule: 'perfil', arg1: 'pie', per90: false }), false)).toBe('Derecho');
  });

  it('sin minutos no hay valor cada 90', () => {
    expect(playerValue({ ...player, minutes: 0 }, stat({ id: 'goles' }), true)).toBeNull();
  });
});

function match(id: number, stats: Record<string, number>, extra: Partial<TeamMatchRow> = {}): TeamMatchRow {
  return {
    matchId: id,
    date: '2026-03-01',
    competitionCode: 'liga',
    competitionName: 'Liga',
    opponent: 'Rival',
    home: true,
    goalsFor: 1,
    goalsAgainst: 0,
    referee: 'Árbitro',
    venue: 'La Bombonera',
    stats,
    ...extra,
  };
}

describe('aggregateTeam', () => {
  const byId = new Map<string, StatDef>([
    ['eq_goles_favor', stat({ id: 'eq_goles_favor', entity: 'team', arg1: 'goals_for' })],
    ['eq_xg', stat({ id: 'eq_xg', entity: 'team', arg1: 'xg', unit: 'xG' })],
    ['eq_remates', stat({ id: 'eq_remates', entity: 'team', arg1: 'shots_total' })],
  ]);
  const get = (id: string): StatDef => {
    const found = byId.get(id);
    if (!found) throw new Error(id);
    return found;
  };
  const rows = [
    match(1, { goals_for: 2, xg: 1.5, shots_total: 10 }),
    match(2, { goals_for: 1, shots_total: 5 }),
    match(3, { goals_for: 0, xg: 0.5, shots_total: 5 }),
  ];

  it('suma lo que hay y deja n/d si ningún partido tiene el dato', () => {
    expect(aggregateTeam(rows, get('eq_goles_favor'), byId)).toBe(3);
    expect(aggregateTeam(rows, stat({ id: 'eq_npxg', entity: 'team', arg1: 'npxg' }), byId)).toBeNull();
  });

  it('los compuestos usan solo los partidos con los dos datos', () => {
    const golesMenosXg = stat({
      id: 'g_xg',
      entity: 'team',
      rule: 'diferencia',
      arg1: 'eq_goles_favor',
      arg2: 'eq_xg',
    });
    // Partido 2 sin xG: no entra. (2 + 0) − (1,5 + 0,5) = 0.
    expect(aggregateTeam(rows, golesMenosXg, byId)).toBe(0);
    const golesPorRemate = stat({
      id: 'g_rem',
      entity: 'team',
      rule: 'cociente',
      arg1: 'eq_goles_favor',
      arg2: 'eq_remates',
      factor: 1,
    });
    expect(aggregateTeam(rows, golesPorRemate, byId)).toBe(0.15);
  });

  it('promedia por partido cuando se pide', () => {
    expect(aggregateTeam(rows, get('eq_goles_favor'), byId, { perMatch: true })).toBe(1);
  });

  it('las métricas por partido se suman o promedian; las de ventana salen aparte', () => {
    const metricRows = [match(1, { eq_xpts: 2 }), match(2, { eq_xpts: 1 })];
    const xpts = stat({ id: 'eq_xpts', entity: 'team', rule: 'metrica', arg1: 'xpts', arg2: 'suma' });
    expect(aggregateTeam(metricRows, xpts, byId)).toBe(3);
    const forma = stat({ id: 'eq_forma_5', entity: 'team', rule: 'especial', arg1: 'forma_5', arg2: 'ventana' });
    expect(aggregateTeam(metricRows, forma, byId)).toBeNull();
    expect(aggregateTeam(metricRows, forma, byId, { windowValue: 10 })).toBe(10);
  });

  it('por partido, las métricas de ventana usan el valor guardado del partido', () => {
    const hhi = stat({ id: 'eq_herfindahl', entity: 'team', rule: 'metrica', arg1: 'herfindahl', arg2: 'ventana' });
    const one = [match(1, { eq_herfindahl: 0.5 })];
    expect(aggregateTeam(one, hhi, byId)).toBe(0.5);
    expect(aggregateTeam([...one, match(2, { eq_herfindahl: 1 })], hhi, byId)).toBeNull();
  });

  it('los datos del partido solo existen para un partido', () => {
    const arbitro = stat({ id: 'eq_arbitro', entity: 'team', rule: 'perfil', arg1: 'arbitro' });
    expect(aggregateTeam(rows.slice(0, 1), arbitro, byId)).toBe('Árbitro');
    expect(aggregateTeam(rows, arbitro, byId)).toBeNull();
  });
});

describe('formatStat', () => {
  it('porcentajes con un decimal y conteos sin decimales', () => {
    expect(formatStat(81.25, stat({ unit: '%', rule: 'cociente' }), false)).toBe('81,3 %');
    expect(formatStat(6, stat({}), false)).toBe('6');
  });

  it('xG y cocientes con dos decimales; cada 90 con dos decimales', () => {
    expect(formatStat(1.234, stat({ unit: 'xG' }), false)).toBe('1,23');
    expect(formatStat(0.6, stat({}), true)).toBe('0,60');
  });

  it('n/d para los ausentes y el texto tal cual', () => {
    expect(formatStat(null, stat({}), false)).toBe('n/d');
    expect(formatStat('Derecho', stat({ rule: 'perfil' }), false)).toBe('Derecho');
  });
});

describe('rankAndPercentile', () => {
  it('ubica el valor en el plantel', () => {
    expect(rankAndPercentile([1, 5, 3, 9], 5, true)).toEqual({ rank: 2, percentile: 67 });
  });

  it('si más bajo es mejor, el primero es el más bajo', () => {
    expect(rankAndPercentile([1, 5, 3, 9], 1, false)).toEqual({ rank: 1, percentile: 100 });
  });
});

describe('extremeOf', () => {
  it('marca el mejor y el peor según higher_is_better', () => {
    expect(extremeOf([3, 5, 9], 9, true)).toBe('best');
    expect(extremeOf([3, 5, 9], 3, true)).toBe('worst');
    expect(extremeOf([3, 5, 9], 5, true)).toBeNull();
    // Más bajo es mejor (por ejemplo, goles recibidos): el orden se invierte.
    expect(extremeOf([3, 5, 9], 3, false)).toBe('best');
    expect(extremeOf([3, 5, 9], 9, false)).toBe('worst');
  });
  it('un empate en la punta sigue siendo el mejor', () => {
    expect(extremeOf([9, 9, 2], 9, true)).toBe('best');
  });
  it('sin comparación posible no marca nada', () => {
    expect(extremeOf([4], 4, true)).toBeNull();
    expect(extremeOf([4, 4, 4], 4, true)).toBeNull();
  });
});
