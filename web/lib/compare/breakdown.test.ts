import { describe, expect, it } from 'vitest';

import type { StatDef } from '@/lib/stats/catalog';

import { aggregate, breakdownWindows, mergeMatches, type BreakdownPoint } from './breakdown';

function stat(over: Partial<StatDef> = {}): StatDef {
  return {
    id: 'remates',
    entity: 'player',
    name: 'Remates',
    short: 'Rem.',
    description: '',
    reading: '',
    group: 'Ataque',
    category: 'ataque',
    unit: 'remates',
    source: '',
    level: 'A',
    formula: '',
    higherIsBetter: true,
    available: true,
    estimated: false,
    per90: true,
    rule: 'suma',
    arg1: 'shots',
    arg2: '',
    factor: 1,
    lines: ['todas'],
    key: false,
    ...over,
  };
}

function point(i: number, over: Partial<BreakdownPoint> = {}): BreakdownPoint {
  return {
    matchId: i,
    date: `2026-0${String(i < 4 ? 8 : 9)}-${String(10 + i)}`,
    competitionCode: i % 2 ? 'liga' : 'copa',
    competition: i % 2 ? 'Liga' : 'Copa',
    opponent: i <= 2 ? 'River' : `Rival ${String(i)}`,
    home: i % 2 === 0,
    result: i === 1 ? 'P' : i === 2 ? 'E' : 'G',
    minutes: i === 5 ? 30 : 90,
    started: i !== 5,
    num: null,
    den: null,
    value: i,
    ...over,
  };
}

const points = [1, 2, 3, 4, 5].map((i) => point(i));

describe('agregado de un grupo de partidos', () => {
  it('promedio, total, mejor y peor', () => {
    expect(aggregate(points, stat())).toEqual({ n: 5, value: 3, total: 15, best: 5, worst: 1 });
  });

  it('los porcentajes son suma sobre suma', () => {
    const pct = stat({ rule: 'cociente', factor: 100, per90: false });
    const pts = [point(1, { num: 8, den: 10, value: 80 }), point(2, { num: 1, den: 10, value: 10 })];
    expect(aggregate(pts, pct).value).toBe(45);
    expect(aggregate(pts, pct).total).toBeNull();
  });

  it('si menos es mejor, el mejor es el más bajo', () => {
    expect(aggregate(points, stat({ higherIsBetter: false }))).toMatchObject({ best: 1, worst: 5 });
  });

  it('sin partidos con dato, n = 0 y sin valor', () => {
    expect(aggregate([point(1, { value: null })], stat())).toEqual({
      n: 0,
      value: null,
      total: null,
      best: null,
      worst: null,
    });
  });
});

describe('ventanas del desglose', () => {
  const groups = breakdownWindows(points, stat(), '2026-09-15');
  const get = (group: string, key: string) => groups.find((g) => g.id === group)?.windows.find((w) => w.key === key);

  it('recientes y por días desde el último partido cargado', () => {
    expect(get('recientes', 'u3')).toMatchObject({ n: 3, value: 4 });
    expect(get('dias', 'd7')).toMatchObject({ n: 2, value: 4.5 });
  });

  it('por mes, competición, localía, resultado, titularidad y minutos', () => {
    expect(get('mes', '2026-08')).toMatchObject({ label: 'Agosto 2026', n: 3 });
    expect(get('competicion', 'copa')).toMatchObject({ n: 2, value: 3 });
    expect(get('localia', 'local')).toMatchObject({ n: 2 });
    expect(get('resultado', 'G')).toMatchObject({ label: 'En victorias', n: 3, value: 4 });
    expect(get('resultado', 'P')).toMatchObject({ label: 'En derrotas', n: 1, value: 1 });
    expect(get('titularidad', 'suplente')).toMatchObject({ n: 1, value: 5 });
    expect(get('minutos', 'completo')).toMatchObject({ n: 4 });
  });

  it('por rival solo con 2 o más partidos', () => {
    expect(groups.find((g) => g.id === 'rival')?.windows.map((w) => w.key)).toEqual(['River']);
  });
});

describe('partidos de los dos jugadores', () => {
  it('une por partido, del más reciente al más viejo, y marca quién jugó', () => {
    const a = [point(1), point(3)];
    const b = [point(3, { value: 7 }), point(4, { value: 2 })];
    expect(mergeMatches(a, b).map((m) => [m.matchId, m.a, m.b])).toEqual([
      [4, null, 2],
      [3, 3, 7],
      [1, 1, null],
    ]);
  });
});
