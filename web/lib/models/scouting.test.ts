import { describe, expect, it } from 'vitest';

import { type MarketPlayer, scoutReports, type SquadPlayer, teamNeeds } from './scouting';

const own = (id: number, position: string, minutes: number, age = 25, goles = 5): SquadPlayer => ({
  id,
  name: `J${String(id)}`,
  position,
  age,
  minutes,
  contractYears: 3,
  value: 6e6,
  stats: { calificacion: 7, goles_sin_penal: goles, pases: minutes / 2, goles_recibidos: 10 },
});

// Plantel completo salvo delanteros: uno solo y viejo. Cuatro arqueros: sobra.
const squad: SquadPlayer[] = [
  own(1, 'Arquero', 3000, 34),
  own(2, 'Arquero', 900),
  own(3, 'Arquero', 600),
  own(4, 'Arquero', 100),
  ...Array.from({ length: 8 }, (_, i) => own(10 + i, 'Defensor', 2500 - i * 200)),
  ...Array.from({ length: 8 }, (_, i) => own(20 + i, 'Mediocampista', 2500 - i * 200)),
  own(30, 'Delantero', 2800, 33, 2),
];

const market = (withStats: boolean): MarketPlayer[] =>
  Array.from({ length: 60 }, (_, i): MarketPlayer => ({
    name: `M${String(i)}`,
    team: 'Otro',
    position: ['Arquero', 'Defensor', 'Mediocampista', 'Delantero'][i % 4] as string,
    age: 18 + (i % 15),
    value: 5e5 + i * 2e5,
    minutes: withStats ? 2000 : null,
    stats: withStats ? { goles_sin_penal: i % 20, calificacion: 6.5 + (i % 10) / 10, pases: 900 } : {},
  }));

describe('ojeador', () => {
  it('el puesto flaco y viejo es la mayor necesidad; cuatro arqueros no son necesidad', () => {
    const needs = teamNeeds(squad);
    expect(needs[0]?.group).toBe('Delantero');
    expect(needs.find((n) => n.group === 'Arquero')?.score ?? 10).toBeLessThan(3);
    expect(needs.every((n) => n.score >= 0 && n.score <= 10 && n.reference === 'plantel')).toBe(true);
    expect(needs.find((n) => n.group === 'Arquero')?.players).toHaveLength(4);
  });

  it('con estadísticas de la liga, mide contra la liga y marca lo flojo', () => {
    const needs = teamNeeds(squad, market(true));
    const del = needs.find((n) => n.group === 'Delantero');
    expect(del?.reference).toBe('liga');
    expect(del?.weakStats[0]?.percentile ?? 100).toBeLessThan(40);
    const reports = scoutReports(market(true), needs);
    expect(reports.some((r) => r.strengths.length > 0)).toBe(true);
  });

  it('arma las tres categorías con notas acotadas, sin saturar el nivel', () => {
    const reports = scoutReports(market(false), teamNeeds(squad));
    expect(new Set(reports.map((r) => r.category))).toEqual(new Set(['necesidad', 'oportunidad', 'promesa']));
    expect(reports.every((r) => r.score >= 0 && r.score <= 10 && r.potential >= r.ability - 5)).toBe(true);
    expect(reports.filter((r) => r.category === 'promesa').every((r) => (r.player.age ?? 99) <= 21)).toBe(true);
    expect(reports.filter((r) => r.ability >= 95).length).toBeLessThan(reports.length / 3);
  });

  it('sin mercado no inventa informes', () => {
    expect(scoutReports([], teamNeeds(squad))).toEqual([]);
  });
});
