import { describe as group, expect, it } from 'vitest';

import {
  anova,
  chi2Independence,
  describe,
  fVariances,
  ols,
  pChi2,
  pF,
  pT,
  pZ,
  tCrit,
  twoProportions,
  welch,
} from './inference';

group('inferencia', () => {
  it('las distribuciones dan los valores de tabla', () => {
    expect(pT(2.228, 10)).toBeCloseTo(0.05, 3);
    expect(pF(3.49, 2, 20)).toBeCloseTo(0.05, 2);
    expect(pChi2(3.841, 1)).toBeCloseTo(0.05, 3);
    expect(pChi2(11.07, 5)).toBeCloseTo(0.05, 3);
    expect(pZ(1.96)).toBeCloseTo(0.05, 3);
    expect(tCrit(0.05, 10)).toBeCloseTo(2.228, 2);
  });

  it('descriptiva', () => {
    const s = describe([2, 4, 4, 4, 5, 5, 7, 9]);
    expect(s.mean).toBe(5);
    expect(s.median).toBe(4.5);
    expect(s.sd).toBeCloseTo(2.138, 3);
    expect(s.ciLow).toBeLessThan(5);
  });

  it('pruebas de dos muestras', () => {
    const a = [10, 11, 12, 13, 14, 15];
    const b = [20, 21, 22, 23, 24, 25];
    expect(welch(a, b).p).toBeLessThan(0.001);
    expect(welch(a, a).p).toBeCloseTo(1, 5);
    expect(fVariances(a, b).statistic).toBeCloseTo(1, 10);
    expect(twoProportions(50, 100, 50, 100).p).toBeCloseTo(1, 5);
    expect(twoProportions(80, 100, 20, 100).p).toBeLessThan(0.001);
  });

  it('ANOVA de un factor (ejemplo con F conocida)', () => {
    // Medias 2, 4, 6 con la misma dispersión: SSB = 24, SSW = 6, F = 12 con (2, 6).
    const r = anova([
      [1, 2, 3],
      [3, 4, 5],
      [5, 6, 7],
    ]);
    expect(r.f).toBeCloseTo(12, 10);
    expect(r.p).toBeCloseTo(0.008, 3);
    expect(r.eta2).toBeCloseTo(0.8, 10);
  });

  it('contingencia: tabla independiente da χ² = 0', () => {
    const r = chi2Independence([
      [10, 20],
      [20, 40],
    ]);
    expect(r.statistic).toBeCloseTo(0, 10);
    expect(r.df).toBe(1);
  });

  it('regresión múltiple recupera los coeficientes', () => {
    const x = Array.from({ length: 30 }, (_, i) => [i, (i * 7) % 5]);
    const y = x.map(([a = 0, b = 0]) => 3 + 2 * a - 1.5 * b + (a % 2 ? 0.01 : -0.01));
    const r = ols(x, y, ['a', 'b']);
    expect(r?.beta[0]).toBeCloseTo(3, 1);
    expect(r?.beta[1]).toBeCloseTo(2, 2);
    expect(r?.beta[2]).toBeCloseTo(-1.5, 2);
    expect(r?.r2).toBeGreaterThan(0.999);
  });
});
