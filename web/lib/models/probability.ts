// Probabilidad: distribuciones discretas (binomial, Poisson) y continuas (normal, beta), intervalos
// para una proporción, prueba de una proporción, correlación de Pearson, bondad de ajuste y gráfico
// Q-Q. Complementa a `inference.ts` (t, F, χ², ANOVA, regresión).

import { pChi2, pT, pZ } from './inference';

function logFactorial(n: number): number {
  let s = 0;
  for (let i = 2; i <= n; i++) s += Math.log(i);
  return s;
}

const safeLog = (v: number) => Math.log(v || 1e-300);

export const binomPmf = (k: number, n: number, p: number) =>
  k < 0 || k > n
    ? 0
    : Math.exp(logFactorial(n) - logFactorial(k) - logFactorial(n - k) + k * safeLog(p) + (n - k) * safeLog(1 - p));

export const poissonPmf = (k: number, lambda: number) =>
  k < 0 ? 0 : Math.exp(-lambda + k * safeLog(lambda) - logFactorial(k));

export const normalPdf = (x: number, mu: number, sd: number) =>
  Math.exp(-0.5 * ((x - mu) / sd) ** 2) / (sd * Math.sqrt(2 * Math.PI));

/** Función de distribución normal (Abramowitz y Stegun 7.1.26 sobre erf). */
export function normalCdf(x: number, mu = 0, sd = 1): number {
  const z = (x - mu) / (sd * Math.SQRT2);
  const t = 1 / (1 + 0.3275911 * Math.abs(z));
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-z * z);
  return 0.5 * (1 + (z >= 0 ? y : -y));
}

/** Cuantil de la normal estándar (algoritmo de Acklam). */
export function normalQuantile(p: number): number {
  const a = [
    -39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628277459239,
  ];
  const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572];
  const c = [
    -0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968,
    2.938163982698783,
  ];
  const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
  const pl = 0.02425;
  const poly = (co: number[], x: number) => co.reduce((acc, v) => acc * x + v, 0);
  if (p < pl) {
    const q = Math.sqrt(-2 * Math.log(p));
    return poly(c, q) / (poly(d, q) * q + 1);
  }
  if (p > 1 - pl) {
    const q = Math.sqrt(-2 * Math.log(1 - p));
    return -poly(c, q) / (poly(d, q) * q + 1);
  }
  const q = p - 0.5;
  const r = q * q;
  return (poly(a, r) * q) / (poly(b, r) * r + 1);
}

/** log Γ por Stirling con corrimiento (suficiente para graficar densidades beta). */
function lgammaStirling(x: number): number {
  let shift = 0;
  let v = x;
  while (v < 7) {
    shift -= Math.log(v);
    v += 1;
  }
  return shift + (v - 0.5) * Math.log(v) - v + 0.5 * Math.log(2 * Math.PI) + 1 / (12 * v) - 1 / (360 * v ** 3);
}

export const betaPdf = (x: number, a: number, b: number) =>
  x <= 0 || x >= 1
    ? 0
    : Math.exp(
        (a - 1) * Math.log(x) +
          (b - 1) * Math.log(1 - x) -
          (lgammaStirling(a) + lgammaStirling(b) - lgammaStirling(a + b)),
      );

/** Intervalo de Wilson del 95 % para una proporción. */
export function wilson(x: number, n: number, z = 1.96): { p: number; lo: number; hi: number } {
  if (!n) return { p: 0, lo: 0, hi: 1 };
  const p = x / n;
  const den = 1 + (z * z) / n;
  const center = (p + (z * z) / (2 * n)) / den;
  const half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / den;
  return { p, lo: Math.max(0, center - half), hi: Math.min(1, center + half) };
}

/** Prueba z de una proporción contra un valor de referencia p0. */
export function oneProportion(x: number, n: number, p0: number): { z: number; p: number } {
  const z = (x / n - p0) / Math.sqrt((p0 * (1 - p0)) / n);
  return Number.isFinite(z) ? { z, p: pZ(z) } : { z: 0, p: 1 };
}

/** Correlación de Pearson con su prueba t (H₀: ρ = 0). */
export function pearson(x: number[], y: number[]): { r: number; t: number; p: number; n: number } {
  const n = x.length;
  const mx = x.reduce((a, b) => a + b, 0) / n;
  const my = y.reduce((a, b) => a + b, 0) / n;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = (x[i] as number) - mx;
    const dy = (y[i] as number) - my;
    sxy += dx * dy;
    sxx += dx * dx;
    syy += dy * dy;
  }
  const r = sxx && syy ? sxy / Math.sqrt(sxx * syy) : 0;
  const t = Math.abs(r) < 1 ? r * Math.sqrt((n - 2) / (1 - r * r)) : 0;
  return { r, t, p: n > 2 ? pT(t, n - 2) : 1, n };
}

/** Recta de mínimos cuadrados y = a + b·x. */
export function simpleFit(x: number[], y: number[]): { a: number; b: number } {
  const n = x.length;
  const mx = x.reduce((s, v) => s + v, 0) / n;
  const my = y.reduce((s, v) => s + v, 0) / n;
  let sxy = 0;
  let sxx = 0;
  for (let i = 0; i < n; i++) {
    sxy += ((x[i] as number) - mx) * ((y[i] as number) - my);
    sxx += ((x[i] as number) - mx) ** 2;
  }
  const b = sxx ? sxy / sxx : 0;
  return { a: my - b * mx, b };
}

export interface Fit {
  statistic: number;
  df: number;
  p: number;
}

/**
 * Bondad de ajuste χ²: observados contra esperados, juntando celdas hasta que cada una espere
 * al menos 5 (regla habitual). `estimated` = parámetros estimados de los datos (restan grados).
 */
export function goodnessOfFit(observed: number[], expected: number[], estimated: number): Fit | null {
  const o: number[] = [];
  const e: number[] = [];
  let ao = 0;
  let ae = 0;
  observed.forEach((v, i) => {
    ao += v;
    ae += expected[i] ?? 0;
    if (ae >= 5) {
      o.push(ao);
      e.push(ae);
      ao = 0;
      ae = 0;
    }
  });
  if (ae > 0 && e.length) {
    o[o.length - 1] = (o[o.length - 1] as number) + ao;
    e[e.length - 1] = (e[e.length - 1] as number) + ae;
  }
  const df = e.length - 1 - estimated;
  if (df < 1) return null;
  const statistic = o.reduce((s, v, i) => s + (v - (e[i] as number)) ** 2 / (e[i] as number), 0);
  return { statistic, df, p: pChi2(statistic, df) };
}

/** Puntos del gráfico Q-Q normal: cuantil teórico (z) contra el valor estandarizado observado. */
export function qqPoints(xs: number[]): { x: number; y: number }[] {
  const s = [...xs].sort((a, b) => a - b);
  const n = s.length;
  const m = s.reduce((a, b) => a + b, 0) / n;
  const sd = Math.sqrt(s.reduce((a, v) => a + (v - m) ** 2, 0) / (n - 1)) || 1;
  return s.map((v, i) => ({ x: normalQuantile((i + 0.5) / n), y: (v - m) / sd }));
}

/** Generador pseudoaleatorio con semilla (mulberry32): el mismo resultado en el servidor y en cada visita. */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
