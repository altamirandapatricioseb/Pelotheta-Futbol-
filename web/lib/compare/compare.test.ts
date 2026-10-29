import { describe, expect, it } from 'vitest';

import type { PlayerRow, StatDef } from '@/lib/stats/catalog';

import {
  compareStat,
  comparableStats,
  comparedLines,
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
  refSlot,
  playersByLine,
  sectionsFor,
  strengths,
  summarize,
  type PlayerPosition,
  type RefSpec,
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
    lines: ['todas'],
    key: false,
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
  it('vacío por defecto: nada elegido todavía', () => {
    expect(parseRefs(undefined)).toEqual([]);
    expect(parseRefs('cualquiera')).toEqual([]);
  });

  it('sin otro jugador, una sola media', () => {
    expect(parseRefs('defensores,equipo')).toEqual([{ kind: 'equipo' }]);
  });

  it('con otro jugador, él primero y las medias tildadas en su orden fijo', () => {
    expect(parseRefs('delanteros,jugador-7,equipo,jugador-9,posicion')).toEqual([
      { kind: 'jugador', playerId: 7 },
      { kind: 'equipo' },
      { kind: 'posicion' },
      { kind: 'linea', line: 'delantero' },
    ]);
  });

  it('vuelve a escribir las referencias en el mismo formato', () => {
    expect(
      refsToParam([
        { kind: 'linea', line: 'arquero' },
        { kind: 'jugador', playerId: 22 },
      ]),
    ).toBe('jugador-22,arqueros');
  });

  it('cada referencia tiene su color fijo', () => {
    expect(refSlot({ kind: 'jugador', playerId: 1 })).toBe(2);
    expect(refSlot({ kind: 'equipo' })).toBe(4);
    expect(refSlot({ kind: 'posicion' })).toBe(5);
    expect(refSlot({ kind: 'linea', line: 'arquero' })).toBe(6);
    expect(refSlot({ kind: 'linea', line: 'delantero' })).toBe(9);
  });
});

describe('grupo de referencia', () => {
  it('percentiles: nunca el principal, con mínimo de minutos y del mismo tipo', () => {
    expect(referencePool(players, p1, byId, 450).map((p) => p.playerId)).toEqual([2, 3]);
    expect(referencePool(players, p4, byId, 0).map((p) => p.playerId)).toEqual([]);
  });

  it('medias: equipo sin arqueros, cada línea y la posición; nunca el principal', () => {
    const ids = (spec: RefSpec, min = 0) => referenceMembers(spec, p1, players, byId, min).map((p) => p.playerId);
    expect(ids({ kind: 'equipo' })).toEqual([2, 3, 5]);
    expect(ids({ kind: 'equipo' }, 450)).toEqual([2, 3]);
    expect(ids({ kind: 'linea', line: 'delantero' })).toEqual([2, 5]);
    expect(ids({ kind: 'linea', line: 'arquero' })).toEqual([4]);
    expect(ids({ kind: 'posicion' })).toEqual([5]);
    expect(ids({ kind: 'jugador', playerId: 3 })).toEqual([3]);
  });

  it('un arquero elegido a mano contra un jugador de campo es decisión del usuario: se permite', () => {
    expect(referenceMembers({ kind: 'jugador', playerId: 4 }, p1, players, byId, 0)).toEqual([p4]);
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
    stat('goles', { lines: ['mediocampista', 'delantero'] }),
    stat('pases', { group: 'Creación', lines: ['todas'] }),
    stat('entradas', { group: 'Defensa', lines: ['defensor', 'mediocampista'] }),
    stat('offsides', { lines: ['delantero'] }),
    stat('edad', { rule: 'perfil' }),
    stat('presiones', { rule: 'nd' }),
    stat('atajadas', { group: 'Porteros', lines: ['arquero'] }),
    stat('raro', { group: 'Sin sección' }),
  ];
  const ids = (lines: string[], all = false) => comparableStats(catalog, new Set(lines), all).map((s) => s.id);

  it('por defecto, solo las de las líneas que se comparan', () => {
    expect(ids(['arquero'])).toEqual(['pases', 'atajadas']);
    expect(ids(['mediocampista'])).toEqual(['goles', 'pases', 'entradas']);
    expect(ids(['delantero', 'mediocampista'])).toEqual(['goles', 'pases', 'entradas', 'offsides']);
  });

  it('«todas» muestra todo menos perfil, n/d y lo sin sección; porteros solo si hay un arquero', () => {
    expect(ids(['delantero'], true)).toEqual(['goles', 'pases', 'entradas', 'offsides']);
    expect(ids(['delantero', 'arquero'], true)).toEqual(['goles', 'pases', 'entradas', 'offsides', 'atajadas']);
  });
});

describe('líneas que se comparan', () => {
  it('la del principal, la del otro jugador y la de cada media de línea', () => {
    expect([...comparedLines(p1, [{ kind: 'equipo' }], byId, players)]).toEqual(['delantero']);
    expect([...comparedLines(p1, [{ kind: 'jugador', playerId: 3 }], byId, players)].sort()).toEqual([
      'delantero',
      'mediocampista',
    ]);
    expect([...comparedLines(p1, [{ kind: 'linea', line: 'arquero' }], byId, players)].sort()).toEqual([
      'arquero',
      'delantero',
    ]);
  });
});

describe('orden de las secciones', () => {
  it('primero lo propio de la línea del jugador principal', () => {
    expect(sectionsFor('arquero')[0]?.id).toBe('porteros');
    expect(sectionsFor('defensor')[0]?.id).toBe('defensa');
    expect(sectionsFor('mediocampista')[0]?.id).toBe('creacion');
    expect(sectionsFor('delantero')[0]?.id).toBe('ataque');
    expect(sectionsFor(null).map((s) => s.id)).toHaveLength(9);
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
  it('avisa el motivo: posición sin dato o jugador ausente', () => {
    const noRole = new Map(byId);
    noRole.set(1, { ...pos(1, 'Ataque', 'Delantero centro'), role: null });
    expect(refProblem({ kind: 'equipo' }, p1, byId, players)).toBeNull();
    expect(refProblem({ kind: 'posicion' }, p1, noRole, players)).toBe('su posición no está informada');
    expect(refProblem({ kind: 'jugador', playerId: 4 }, p1, byId, players)).toBeNull();
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
  it('equipo, línea, posición y jugador', () => {
    expect(referenceLabel({ kind: 'equipo' }, byId.get(1), players).long).toBe('Media del equipo (sin arqueros)');
    expect(referenceLabel({ kind: 'linea', line: 'defensor' }, byId.get(1), players).long).toBe('Media de defensores');
    expect(referenceLabel({ kind: 'posicion' }, byId.get(1), players).short).toBe('Delantero centro');
    expect(referenceLabel({ kind: 'jugador', playerId: 3 }, byId.get(1), players).long).toBe('Jugador 3');
  });
});

describe('buscador de jugadores', () => {
  it('sin tildes ni mayúsculas, agrupado por línea y por minutos', () => {
    const named = [{ ...p2, name: 'Énner Valencia' }, p1, p3, p4, p5];
    expect(playersByLine(named, byId, 'enner').map((g) => [g.line, g.players.map((p) => p.playerId)])).toEqual([
      ['Delanteros', [2]],
    ]);
    expect(playersByLine(named, byId).map((g) => g.line)).toEqual(['Arqueros', 'Mediocampistas', 'Delanteros']);
    expect(playersByLine(named, byId)[2]?.players.map((p) => p.playerId)).toEqual([2, 1, 5]);
  });
});
