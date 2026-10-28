import { describe, expect, it } from 'vitest';

import { bins, countMatrix, cumulative, pearson, rolling, spearman } from './transform';

describe('cumulative', () => {
  it('suma acumulada saltando los n/d', () => {
    expect(cumulative([1, null, 2, 3])).toEqual([1, 1, 3, 6]);
  });
});

describe('rolling', () => {
  it('promedio móvil de los últimos n valores con dato', () => {
    expect(rolling([1, 2, 3, 4, 5], 3)).toEqual([1, 1.5, 2, 3, 4]);
    expect(rolling([1, null, 3], 2)).toEqual([1, null, 2]);
  });
});

describe('bins', () => {
  it('histograma de intervalos iguales; el máximo cae en el último', () => {
    const out = bins([0, 0.5, 1, 1.5, 2], 2);
    expect(out.map((b) => b.count)).toEqual([2, 3]);
    expect(out[0]?.from).toBe(0);
    expect(out[1]?.to).toBe(2);
  });
});

describe('pearson', () => {
  it('correlación perfecta, inversa y nula', () => {
    expect(pearson([1, 2, 3], [2, 4, 6])).toBeCloseTo(1);
    expect(pearson([1, 2, 3], [3, 2, 1])).toBeCloseTo(-1);
    expect(pearson([1, 1, 1], [1, 2, 3])).toBeNull();
  });
});

describe('countMatrix', () => {
  it('cuenta pares (fila, columna)', () => {
    const m = countMatrix(
      [
        ['G', 'E'],
        ['G', 'E'],
        ['P', 'G'],
      ],
      ['G', 'E', 'P'],
      ['G', 'E', 'P'],
    );
    expect(m[0]).toEqual([0, 2, 0]);
    expect(m[2]).toEqual([1, 0, 0]);
  });
});

describe('spearman', () => {
  it('correlación de los puestos: 1 si el orden coincide aunque la relación no sea lineal', () => {
    expect(spearman([1, 2, 3, 4], [1, 4, 9, 16])).toBeCloseTo(1);
    expect(spearman([1, 2, 3, 4], [8, 6, 4, 2])).toBeCloseTo(-1);
  });
  it('los empates comparten el puesto promedio', () => {
    // Puestos x: 1, 2,5, 2,5, 4; y: 1, 2, 3, 4 → Pearson de los puestos.
    expect(spearman([1, 2, 2, 3], [1, 2, 3, 4])).toBeCloseTo(0.9487, 3);
  });
  it('null con menos de tres pares', () => {
    expect(spearman([1, 2], [2, 1])).toBeNull();
  });
});
