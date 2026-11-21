import { describe, expect, it } from 'vitest';

import {
  betaPdf,
  binomPmf,
  goodnessOfFit,
  normalCdf,
  normalQuantile,
  oneProportion,
  pearson,
  poissonPmf,
  qqPoints,
  seeded,
  simpleFit,
  wilson,
} from './probability';

describe('probabilidad', () => {
  it('las distribuciones suman 1 y dan valores conocidos', () => {
    const b = Array.from({ length: 11 }, (_, k) => binomPmf(k, 10, 0.3));
    expect(b.reduce((s, v) => s + v, 0)).toBeCloseTo(1, 10);
    expect(binomPmf(3, 10, 0.3)).toBeCloseTo(0.2668, 4);
    expect(poissonPmf(2, 1.5)).toBeCloseTo(0.251, 3);
    expect(normalCdf(1.96)).toBeCloseTo(0.975, 3);
    expect(normalQuantile(0.975)).toBeCloseTo(1.96, 3);
    // Beta(2, 2) = 6x(1 − x): en 0,5 vale 1,5.
    expect(betaPdf(0.5, 2, 2)).toBeCloseTo(1.5, 3);
  });

  it('intervalo de Wilson, prueba de una proporción y Pearson', () => {
    const w = wilson(50, 100);
    expect(w.lo).toBeCloseTo(0.404, 2);
    expect(w.hi).toBeCloseTo(0.596, 2);
    expect(oneProportion(50, 100, 0.5).p).toBeCloseTo(1, 5);
    const x = [1, 2, 3, 4, 5, 6];
    expect(pearson(x, x.map((v) => 2 * v + 1)).r).toBeCloseTo(1, 10);
    expect(simpleFit(x, x.map((v) => 2 * v + 1))).toEqual({ a: 1, b: 2 });
  });

  it('bondad de ajuste: datos que siguen el modelo no se rechazan', () => {
    const lambda = 1.4;
    const n = 400;
    const expected = Array.from({ length: 7 }, (_, k) => n * poissonPmf(k, lambda));
    const observed = expected.map((e) => Math.round(e));
    expect(goodnessOfFit(observed, expected, 1)?.p ?? 0).toBeGreaterThan(0.9);
  });

  it('Q-Q de datos normales queda cerca de la diagonal y la semilla es estable', () => {
    const rnd = seeded(7);
    const xs = Array.from({ length: 300 }, () => normalQuantile(Math.min(0.999, Math.max(0.001, rnd()))));
    const q = qqPoints(xs);
    expect(Math.abs((q[150]?.y ?? 9) - (q[150]?.x ?? 0))).toBeLessThan(0.2);
    expect(seeded(3)()).toBe(seeded(3)());
  });
});
