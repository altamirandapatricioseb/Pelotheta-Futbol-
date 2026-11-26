import { describe, expect, it } from 'vitest';

import {
  compareAnalyses,
  matchAnalyses,
  playerAnalyses,
  predictorAnalyses,
  seriesAnalyses,
  situationAnalyses,
  squadAnalyses,
  styleAnalyses,
  type TeamMatchLike,
  teamAnalyses,
  valueAnalyses,
} from './analyses';
import { seeded } from './probability';

// Datos sintéticos con semilla: cada constructor tiene que devolver análisis serializables (se mandan
// del servidor al navegador) y nada con NaN, y callar cuando la muestra es chica.
const rand = seeded(7);
const int = (max: number) => Math.floor(rand() * (max + 1));

const matches: TeamMatchLike[] = Array.from({ length: 30 }, (_, i) => ({
  home: i % 2 === 0,
  goalsFor: int(3),
  goalsAgainst: int(2),
  competitionName: i % 3 === 0 ? 'Copa' : 'Liga',
  stats: { xg: Math.round(rand() * 300) / 100 },
}));

const ok = (analyses: unknown[]) => {
  expect(analyses.length).toBeGreaterThan(0);
  const json = JSON.stringify(analyses);
  expect(json).not.toContain('NaN');
  expect(JSON.parse(json)).toEqual(analyses);
};

describe('paneles de probabilidad y estadística', () => {
  it('equipo, predictor y partido', () => {
    ok(teamAnalyses(matches));
    ok(predictorAnalyses(matches));
    ok(matchAnalyses(matches[0] as TeamMatchLike, matches));
  });

  it('con pocos partidos no inventa nada', () => {
    expect(teamAnalyses(matches.slice(0, 3))).toEqual([]);
    expect(matchAnalyses(matches[0] as TeamMatchLike, matches.slice(0, 2))).toEqual([]);
    expect(seriesAnalyses([{ value: 1, date: '2026-01-01' }], 'x')).toEqual([]);
    expect(compareAnalyses({ name: 'a', ratings: [7] }, { name: 'b', ratings: [6, 7, 8] })).toEqual([]);
  });

  it('situaciones', () => {
    const rows = Array.from({ length: 6 }, (_, i) => ({
      title: `Situación ${String(i)}`,
      param: `s${String(i)}`,
      n: 10 + i,
      w: 3 + int(5),
      base: 0.4,
    }));
    ok(situationAnalyses(rows, 45));
  });

  it('plantel, jugador y comparación', () => {
    const players = Array.from({ length: 24 }, (_, i) => ({
      name: `J${String(i)}`,
      position: ['Arquero', 'Defensor', 'Mediocampista', 'Delantero'][i % 4] ?? null,
      minutes: 500 + int(1500),
      stats: {
        calificacion: 6 + rand() * 2,
        goles_sin_penal: int(8),
        npxg: rand() * 6,
        remates: int(40),
        xa: rand() * 4,
        pases_clave: int(30),
        regates_exitosos: int(25),
        entradas_ganadas: int(40),
        intercepciones: int(30),
        pct_pases: 60 + rand() * 30,
      },
    }));
    ok(squadAnalyses(players));
    const games = Array.from({ length: 20 }, (_, i) => ({
      home: i % 2 === 0,
      started: i % 3 !== 0,
      minutes: 45 + int(45),
      rating: 6 + rand() * 2,
      goals: int(1),
    }));
    ok(playerAnalyses(games));
    const ratings = () => Array.from({ length: 12 }, () => 6 + rand() * 2);
    ok(compareAnalyses({ name: 'a', ratings: ratings() }, { name: 'b', ratings: ratings() }));
  });

  it('estilos, valor y series', () => {
    const rows = Array.from({ length: 20 }, () => ({ features: { a: rand(), b: rand(), c: rand() } }));
    ok(styleAnalyses(rows, { a: 'A', b: 'B', c: 'C' }));
    const values = Array.from({ length: 30 }, (_, i) => {
      const predicted = 1e6 + rand() * 5e6;
      return { name: `J${String(i)}`, actual: predicted * (0.6 + rand() * 0.8), predicted };
    });
    ok(valueAnalyses(values));
    const points = Array.from({ length: 20 }, (_, i) => ({
      value: 5 + rand() * 3,
      date: `2026-${String(1 + (i % 12)).padStart(2, '0')}-10`,
    }));
    ok(seriesAnalyses(points, 'Calificación'));
  });
});
