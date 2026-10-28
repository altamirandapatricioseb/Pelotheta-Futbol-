import { describe, expect, it } from 'vitest';

import type { PlayerRow, StatDef } from '@/lib/stats/catalog';

import {
  compareStat,
  comparableStats,
  lineOf,
  parseRefs,
  perMatchValue,
  periodMatchIds,
  quartiles,
  referencePerMatch,
  referenceMembers,
  referenceLabel,
  referencePool,
  refProblem,
  referenceValue,
  refsToParam,
  strengths,
  summarize,
  type PlayerPosition,
} from './compare';

function stat(id: string, over: Partial<StatDef> = {}): StatDef {
  return {
    id,
    entity: 'player',
    name: id,
    short: id,
    description: '',
    reading: '',
    group: 'Ataque',
    category: 'ataque',
    unit: 'goles',
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

function player(id: number, position: string, minutes: number, stats: Record<string, number>): PlayerRow {
  return {
    playerId: id,
    name: `Jugador ${String(id)}`,
    shortName: null,
    position,
    shirtNumber: null,
    age: null,
    heightCm: null,
    weightKg: null,
    foot: null,
    nationality: null,
    matches: Math.max(1, Math.round(minutes / 90)),
    minutes,
    stats,
  };
}

const pos = (playerId: number, zone: string, role: string, lane: string | null = 'centro'): PlayerPosition => ({
  playerId,
  positionRaw: role,
  zone,
  lane,
  role,
  level: 'posicion',
});

const goles = stat('goles');
const perdidas = stat('perdidas', { higherIsBetter: false });

const p1 = player(1, 'Delantero', 900, { goles: 6, perdidas: 10 });
const p2 = player(2, 'Delantero', 1800, { goles: 4, perdidas: 30 });
const p3 = player(3, 'Mediocampista', 900, { goles: 1, perdidas: 20 });
const p4 = player(4, 'Arquero', 900, { goles: 0 });
const p5 = player(5, 'Delantero', 90, { goles: 1, perdidas: 2 });
const players = [p1, p2, p3, p4, p5];
const positions = [
  pos(1, 'Ataque', 'Delantero centro'),
  pos(2, 'Ataque', 'Extremo', 'derecha'),
  pos(3, 'Mediocampo', 'Mediocampista central'),
  pos(4, 'Arco', 'Arquero'),
  pos(5, 'Ataque', 'Delantero centro'),
];
const byId = new Map(positions.map((p) => [p.playerId, p]));

describe('referencias en la URL', () => {
  it('lee hasta 3 referencias sin repetir y con plantel y posición por defecto', () => {
    expect(parseRefs(undefined)).toEqual([{ kind: 'plantel' }, { kind: 'posicion' }]);
    expect(parseRefs('zona,zona,jugador-7,carril,posicion')).toEqual([
      { kind: 'zona' },
      { kind: 'jugador', playerId: 7 },
      { kind: 'carril' },
    ]);
    expect(parseRefs('cualquiera')).toEqual([{ kind: 'plantel' }, { kind: 'posicion' }]);
  });

  it('vuelve a escribir las referencias en el mismo formato', () => {
    expect(refsToParam([{ kind: 'plantel' }, { kind: 'jugador', playerId: 22 }])).toBe('plantel,jugador-22');
  });
});

describe('grupo de referencia', () => {
  it('nunca incluye al jugador principal y respeta el mínimo de minutos', () => {
    const pool = referencePool(players, p1, byId, 450);
    expect(pool.map((p) => p.playerId)).toEqual([2, 3]);
  });

  it('separa arqueros de jugadores de campo', () => {
    expect(referencePool(players, p4, byId, 0).map((p) => p.playerId)).toEqual([]);
    expect(referencePool(players, p1, byId, 0).map((p) => p.playerId)).not.toContain(4);
  });

  it('filtra por zona, carril y posición según el mapeo', () => {
    const pool = referencePool(players, p1, byId, 0);
    const main = p1;
    expect(referenceMembers({ kind: 'zona' }, main, pool, byId, players).map((p) => p.playerId)).toEqual([2, 5]);
    expect(referenceMembers({ kind: 'carril' }, main, pool, byId, players).map((p) => p.playerId)).toEqual([5]);
    expect(referenceMembers({ kind: 'posicion' }, main, pool, byId, players).map((p) => p.playerId)).toEqual([5]);
    expect(
      referenceMembers({ kind: 'jugador', playerId: 3 }, main, pool, byId, players).map((p) => p.playerId),
    ).toEqual([3]);
  });

  it('no compara un arquero con un jugador de campo elegido a mano', () => {
    const pool = referencePool(players, p1, byId, 0);
    expect(referenceMembers({ kind: 'jugador', playerId: 4 }, p1, pool, byId, players)).toEqual([]);
  });
});

describe('promedio de la referencia', () => {
  const members = [p2, p3];

  it('promedio simple de los valores por 90', () => {
    // 4 goles en 1800 = 0,2 cada 90; 1 en 900 = 0,1 cada 90.
    expect(referenceValue(members, goles, true, 'simple').value).toBeCloseTo(0.15);
  });

  it('promedio ponderado por minutos', () => {
    // (0,2 × 1800 + 0,1 × 900) / 2700 = 0,1667.
    expect(referenceValue(members, goles, true, 'ponderado').value).toBeCloseTo(0.1667, 3);
  });

  it('sin miembros con dato no hay valor', () => {
    expect(referenceValue([p4], perdidas, false, 'simple')).toEqual({ value: null, n: 0 });
  });
});

describe('comparación de una estadística', () => {
  const pool = referencePool(players, p1, byId, 0);

  it('diferencia absoluta y porcentual, con el sentido de la estadística', () => {
    const row = compareStat(perdidas, p1, [[p2]], pool, false, 'simple');
    expect(row.player).toBe(10);
    expect(row.refs[0]?.diff).toBe(-20);
    expect(row.refs[0]?.diffPct).toBeCloseTo(-66.67, 1);
    // Menos pérdidas es mejor.
    expect(row.refs[0]?.verdict).toBe('mejor');
  });

  it('percentil del jugador entre su grupo', () => {
    const row = compareStat(goles, p1, [pool], pool, false, 'simple');
    expect(row.percentile).toBe(100);
  });

  it('sin dato del jugador la fila queda sin datos', () => {
    const row = compareStat(perdidas, p4, [[p2]], [p2], false, 'simple');
    expect(row.missing).toBe(true);
    expect(row.refs[0]?.verdict).toBeNull();
  });
});

describe('resumen', () => {
  const pool = referencePool(players, p1, byId, 0);
  const rows = [
    compareStat(goles, p1, [pool], pool, false, 'simple'),
    compareStat(perdidas, p1, [pool], pool, false, 'simple'),
    compareStat(stat('xg'), p1, [pool], pool, false, 'simple'),
  ];

  it('cuenta mejores, peores y sin datos (sin datos no cuenta)', () => {
    expect(summarize(rows, 0)).toEqual({ better: 2, worse: 0, equal: 0, missing: 1 });
  });

  it('ordena fortalezas por diferencia estandarizada', () => {
    const { best, worst } = strengths(rows, 0, 5);
    expect(best.map((r) => r.stat.id)).toEqual(['goles', 'perdidas']);
    expect(worst).toEqual([]);
  });
});

describe('estadísticas comparables', () => {
  const catalog = [
    goles,
    stat('edad', { rule: 'perfil' }),
    stat('presiones', { rule: 'nd' }),
    stat('atajadas', { group: 'Porteros' }),
    stat('raro', { group: 'Sin sección' }),
  ];

  it('deja afuera perfil, n/d y lo que no tiene sección; porteros solo para arqueros', () => {
    expect(comparableStats(catalog, false).map((s) => s.id)).toEqual(['goles']);
    expect(comparableStats(catalog, true).map((s) => s.id)).toEqual(['goles', 'atajadas']);
  });
});

describe('valor por partido para la línea de referencia', () => {
  it('conteos por partido y cocientes tal cual', () => {
    expect(perMatchValue(p2, goles)).toBeCloseTo(0.2);
    expect(perMatchValue(p2, stat('pct', { rule: 'cociente', per90: false, arg1: 'a' }))).toBeNull();
  });
});

describe('partidos de cada período', () => {
  const matches = [1, 2, 3, 4, 5, 6, 7].map((i) => ({
    matchId: i,
    date: `2026-0${String(i < 4 ? 1 : 3)}-${String(10 + i)}`,
    kickoff: `2026-0${String(i < 4 ? 1 : 3)}-${String(10 + i)}T20:00:00Z`,
    competitionCode: i % 2 ? 'liga' : 'copa',
  }));

  it('temporada filtra por competición', () => {
    expect([...periodMatchIds(matches, 'temporada', 'copa')].sort()).toEqual([2, 4, 6]);
    expect(periodMatchIds(matches, 'temporada', 'todas').size).toBe(7);
  });

  it('últimos 5 y último mes desde el último partido cargado', () => {
    expect([...periodMatchIds(matches, 'ultimos5', 'todas')].sort()).toEqual([3, 4, 5, 6, 7]);
    expect([...periodMatchIds(matches, 'ultimo_mes', 'todas')].sort()).toEqual([4, 5, 6, 7]);
  });
});

describe('rango y media por partido de la referencia', () => {
  it('cuartiles con interpolación lineal', () => {
    expect(quartiles([1, 2, 3, 4, 5])).toEqual({ min: 1, q1: 2, q3: 4, max: 5 });
    expect(quartiles([])).toBeNull();
  });

  it('media por partido de los miembros (simple o ponderada por minutos)', () => {
    // 4 goles en 20 partidos = 0,2; 1 gol en 10 partidos = 0,1.
    const members = [p2, p3];
    expect(referencePerMatch(members, goles, 'simple')).toBeCloseTo(0.15);
    expect(referencePerMatch(members, goles, 'ponderado')).toBeCloseTo(0.1667, 3);
  });
});

describe('referencias que no se pueden usar', () => {
  it('avisa el motivo: arquero contra jugador de campo, carril sin dato, jugador ausente', () => {
    const noLane = new Map(byId);
    noLane.set(1, { ...pos(1, 'Ataque', 'Delantero centro'), lane: null });
    expect(refProblem({ kind: 'plantel' }, p1, byId, players)).toBeNull();
    expect(refProblem({ kind: 'carril' }, p1, noLane, players)).toBe('la fuente no informa su carril');
    expect(refProblem({ kind: 'jugador', playerId: 4 }, p1, byId, players)).toBe(
      'los arqueros solo se comparan con arqueros',
    );
    expect(refProblem({ kind: 'jugador', playerId: 99 }, p1, byId, players)).toBe(
      'el otro jugador no jugó en este período',
    );
  });
});

describe('fortalezas sin uso ni carga', () => {
  it('minutos y carga física no cuentan como fortaleza o debilidad (miden cuánto juega)', () => {
    const minutos = stat('minutos', { group: 'Participación', per90: false });
    const pool = referencePool(players, p1, byId, 0).map((p) => ({ ...p, stats: { ...p.stats, minutos: p.minutes } }));
    const withMinutes = { ...p1, stats: { ...p1.stats, minutos: 5000 } };
    const rows = [compareStat(minutos, withMinutes, [pool], pool, false, 'simple')];
    expect(rows[0]?.refs[0]?.z).toBeGreaterThan(0);
    expect(strengths(rows, 0, 5).best).toEqual([]);
  });
});

describe('línea del jugador', () => {
  it('si el plantel no la informa, sale de la zona', () => {
    expect(lineOf({ ...p2, position: null }, byId.get(2))).toBe('Delantero');
    expect(lineOf(p3, byId.get(3))).toBe('Mediocampista');
    expect(lineOf({ ...p2, position: null }, undefined)).toBeNull();
  });
});

describe('nombres de las referencias', () => {
  it('para un arquero, el plantel son los otros arqueros', () => {
    expect(referenceLabel({ kind: 'plantel' }, byId.get(4), players).short).toBe('Arqueros');
    expect(referenceLabel({ kind: 'plantel' }, byId.get(1), players).short).toBe('Plantel');
    expect(referenceLabel({ kind: 'jugador', playerId: 3 }, byId.get(1), players).long).toBe('Jugador 3');
  });
});
