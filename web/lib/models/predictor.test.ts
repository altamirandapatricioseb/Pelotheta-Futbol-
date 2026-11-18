import { describe, expect, it } from 'vitest';

import { average, lambdas, outcomes, type Profile, scoreMatrix, simulate } from './predictor';

const club = (name: string, value: number, attack = 1): Profile => ({
  name,
  attackHome: attack,
  attackAway: attack,
  defenseHome: 1,
  defenseAway: 1,
  value,
  elo: 1500,
  form: 1.35,
  estimated: false,
  count: 1,
});

const glm = { names: ['ataque', 'defensa', 'valor', 'local'], beta: [0.1, 0.1, 0.1, 0.2, 0.25] };

describe('predictor en la web', () => {
  it('la matriz es una distribución conjunta y las tres probabilidades suman 1', () => {
    const m = scoreMatrix(1.4, 1.1);
    expect(m.flat().reduce((a, b) => a + b, 0)).toBeCloseTo(1, 10);
    const o = outcomes(m);
    expect(o.win + o.draw + o.loss).toBeCloseTo(1, 10);
    expect(o.win).toBeGreaterThan(o.loss);
  });

  it('el plantel más caro y la localía suben los goles esperados', () => {
    const own = club('Propio', 1e8);
    const rival = club('Rival', 2e7);
    const home = lambdas(glm, own, rival, 'local');
    const away = lambdas(glm, own, rival, 'visitante');
    const neutral = lambdas(glm, own, rival, 'neutral');
    expect(home.own).toBeGreaterThan(home.rival);
    expect(home.own).toBeGreaterThan(neutral.own);
    // De visitante no hay localía; con ataque y defensa promedio da lo mismo que en cancha neutral.
    expect(neutral.own).toBeCloseTo(away.own, 10);
    expect(away.rival).toBeGreaterThan(neutral.rival); // el rival sí juega de local
    // Cancha neutral y mismos equipos: simétrico.
    const even = lambdas(glm, club('A', 5e7), club('B', 5e7), 'neutral');
    expect(even.own).toBeCloseTo(even.rival, 10);
  });

  it('la media de un grupo usa la media geométrica del valor', () => {
    const avg = average('Media', [club('A', 1e6), club('B', 1e8)]);
    expect(avg.value).toBeCloseTo(1e7, 0);
    expect(avg.count).toBe(2);
  });

  it('la simulación se parece a la cuenta exacta y es reproducible', () => {
    const exact = outcomes(scoreMatrix(1.5, 0.9));
    const sim = simulate(1.5, 0.9);
    expect(sim.win).toBeCloseTo(exact.win, 1);
    expect(simulate(1.5, 0.9).win).toBe(sim.win);
  });
});
