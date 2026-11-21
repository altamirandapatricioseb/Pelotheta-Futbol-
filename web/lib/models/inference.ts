// Estadística inferencial sin dependencias: distribuciones t, F, χ² y normal, descriptiva, pruebas
// de medias, varianzas y proporciones, ANOVA de un factor, tabla de contingencia y regresión lineal
// múltiple por mínimos cuadrados. Fórmulas de Walpole y Montgomery; funciones especiales de Numerical Recipes.

function lgamma(x: number): number {
  const c = [
    76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155, 0.1208650973866179e-2,
    -0.5395239384953e-5,
  ];
  let y = x;
  const t = x + 5.5 - (x + 0.5) * Math.log(x + 5.5);
  let s = 1.000000000190015;
  for (const ci of c) s += ci / ++y;
  return -t + Math.log((2.5066282746310005 * s) / x);
}

const TINY = 1e-300;
const guard = (v: number) => (Math.abs(v) < TINY ? TINY : v);

function betacf(a: number, b: number, x: number): number {
  let c = 1;
  let d = 1 / guard(1 - ((a + b) * x) / (a + 1));
  let h = d;
  for (let m = 1; m <= 300; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((a + m2 - 1) * (a + m2));
    d = 1 / guard(1 + aa * d);
    c = guard(1 + aa / c);
    h *= d * c;
    aa = (-(a + m) * (a + b + m) * x) / ((a + m2) * (a + m2 + 1));
    d = 1 / guard(1 + aa * d);
    c = guard(1 + aa / c);
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < 3e-14) break;
  }
  return h;
}

/** Beta incompleta regularizada I_x(a, b). */
export function ibeta(x: number, a: number, b: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const bt = Math.exp(lgamma(a + b) - lgamma(a) - lgamma(b) + a * Math.log(x) + b * Math.log(1 - x));
  return x < (a + 1) / (a + b + 2) ? (bt * betacf(a, b, x)) / a : 1 - (bt * betacf(b, a, 1 - x)) / b;
}

/** Gamma incompleta regularizada inferior P(a, x). */
function gammaP(a: number, x: number): number {
  if (x <= 0) return 0;
  if (x < a + 1) {
    let total = 1 / a;
    let del = total;
    for (let n = 1; n < 500; n++) {
      del *= x / (a + n);
      total += del;
      if (Math.abs(del) < Math.abs(total) * 1e-14) break;
    }
    return total * Math.exp(-x + a * Math.log(x) - lgamma(a));
  }
  let b = x + 1 - a;
  let c = 1 / TINY;
  let d = 1 / b;
  let h = d;
  for (let i = 1; i < 500; i++) {
    const an = -i * (i - a);
    b += 2;
    d = 1 / guard(an * d + b);
    c = guard(b + an / c);
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < 1e-14) break;
  }
  return 1 - Math.exp(-x + a * Math.log(x) - lgamma(a)) * h;
}

/** p bilateral de una t de Student. */
export const pT = (t: number, df: number) => ibeta(df / (df + t * t), df / 2, 0.5);
/** p de cola superior de una F. */
export const pF = (f: number, d1: number, d2: number) => (f <= 0 ? 1 : ibeta(d2 / (d2 + d1 * f), d2 / 2, d1 / 2));
/** p de cola superior de una χ². */
export const pChi2 = (x: number, k: number) => 1 - gammaP(k / 2, x / 2);
/** p bilateral de una normal estándar. */
export const pZ = (z: number) => pChi2(z * z, 1);

/** Valor crítico bilateral de la t (por bisección): el t con p = alpha. */
export function tCrit(alpha: number, df: number): number {
  let lo = 0;
  let hi = 100;
  for (let i = 0; i < 100; i++) {
    const mid = (lo + hi) / 2;
    if (pT(mid, df) > alpha) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
export const mean = (xs: number[]) => sum(xs) / xs.length;
const variance = (xs: number[]) => {
  const m = mean(xs);
  return sum(xs.map((x) => (x - m) ** 2)) / (xs.length - 1);
};

function quantile(sorted: number[], q: number): number {
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return (sorted[lo] as number) + ((sorted[hi] as number) - (sorted[lo] as number)) * (pos - lo);
}

export interface Summary {
  n: number;
  mean: number;
  sd: number;
  cv: number;
  min: number;
  q1: number;
  median: number;
  q3: number;
  max: number;
  skew: number;
  /** IC 95 % de la media (t). */
  ciLow: number;
  ciHigh: number;
}

/** Resumen descriptivo (n ≥ 2). */
export function describe(xs: number[]): Summary {
  const s = [...xs].sort((a, b) => a - b);
  const m = mean(s);
  const sd = Math.sqrt(variance(s));
  const n = s.length;
  const half = (tCrit(0.05, n - 1) * sd) / Math.sqrt(n);
  return {
    n,
    mean: m,
    sd,
    cv: sd / m,
    min: s[0] as number,
    q1: quantile(s, 0.25),
    median: quantile(s, 0.5),
    q3: quantile(s, 0.75),
    max: s[n - 1] as number,
    skew: sd ? sum(s.map((x) => ((x - m) / sd) ** 3)) / n : 0,
    ciLow: m - half,
    ciHigh: m + half,
  };
}

export interface TestResult {
  statistic: number;
  df: number | [number, number];
  p: number;
}

/** Comparación de medias de muestras independientes con varianzas distintas (Welch). */
export function welch(a: number[], b: number[]): TestResult & { diff: number } {
  const va = variance(a) / a.length;
  const vb = variance(b) / b.length;
  const se = Math.sqrt(va + vb);
  const t = se ? (mean(a) - mean(b)) / se : 0;
  const df = se ? (va + vb) ** 2 / (va ** 2 / (a.length - 1) + vb ** 2 / (b.length - 1)) : a.length + b.length - 2;
  return { statistic: t, df, p: pT(t, df), diff: mean(a) - mean(b) };
}

/** Comparación de varianzas (F bilateral, la mayor arriba). */
export function fVariances(a: number[], b: number[]): TestResult {
  const va = variance(a);
  const vb = variance(b);
  const [big, small, d1, d2] = va >= vb ? [va, vb, a.length - 1, b.length - 1] : [vb, va, b.length - 1, a.length - 1];
  const f = big / small;
  return { statistic: f, df: [d1, d2], p: Math.min(1, 2 * pF(f, d1, d2)) };
}

/** Comparación de dos proporciones (z con proporción combinada). */
export function twoProportions(
  x1: number,
  n1: number,
  x2: number,
  n2: number,
): TestResult & { p1: number; p2: number } {
  const p1 = x1 / n1;
  const p2 = x2 / n2;
  const pp = (x1 + x2) / (n1 + n2);
  const z = (p1 - p2) / Math.sqrt(pp * (1 - pp) * (1 / n1 + 1 / n2));
  return { statistic: Number.isFinite(z) ? z : 0, df: 1, p: Number.isFinite(z) ? pZ(z) : 1, p1, p2 };
}

export interface Anova {
  ssb: number;
  ssw: number;
  dfb: number;
  dfw: number;
  msb: number;
  msw: number;
  f: number;
  p: number;
  /** η²: proporción de la variabilidad que explica el factor. */
  eta2: number;
}

/** ANOVA de un factor. */
export function anova(groups: number[][]): Anova {
  const all = groups.flat();
  const grand = mean(all);
  const ssb = sum(groups.map((g) => g.length * (mean(g) - grand) ** 2));
  const ssw = sum(groups.map((g) => sum(g.map((x) => (x - mean(g)) ** 2))));
  const dfb = groups.length - 1;
  const dfw = all.length - groups.length;
  const msb = ssb / dfb;
  const msw = ssw / dfw;
  const f = msb / msw;
  return { ssb, ssw, dfb, dfw, msb, msw, f, p: pF(f, dfb, dfw), eta2: ssb / (ssb + ssw) };
}

/** Independencia en una tabla de contingencia (χ² de Pearson), con residuos estandarizados. */
export function chi2Independence(table: number[][]): TestResult & { expected: number[][]; residuals: number[][] } {
  const rows = table.map(sum);
  const cols = (table[0] ?? []).map((_, j) => sum(table.map((r) => r[j] ?? 0)));
  const n = sum(rows);
  const expected = table.map((_, i) => cols.map((c) => ((rows[i] ?? 0) * c) / n));
  const residuals = table.map((r, i) =>
    r.map((o, j) => {
      const e = expected[i]?.[j] ?? 0;
      return e ? (o - e) / Math.sqrt(e) : 0;
    }),
  );
  const chi = sum(residuals.flat().map((z) => z * z));
  const df = (rows.length - 1) * (cols.length - 1);
  return { statistic: chi, df, p: pChi2(chi, df), expected, residuals };
}

export interface Regression {
  names: string[];
  beta: number[];
  se: number[];
  t: number[];
  p: number[];
  r2: number;
  r2adj: number;
  f: number;
  pF: number;
  n: number;
  k: number;
}

/** Inversa por Gauss-Jordan con pivoteo parcial (null si es singular). */
function invert(m: number[][]): number[][] | null {
  const n = m.length;
  const a = m.map((r, i) => [...r, ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))]);
  for (let c = 0; c < n; c++) {
    let piv = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(a[r]?.[c] ?? 0) > Math.abs(a[piv]?.[c] ?? 0)) piv = r;
    if (Math.abs(a[piv]?.[c] ?? 0) < 1e-12) return null;
    [a[c], a[piv]] = [a[piv] as number[], a[c] as number[]];
    const row = a[c] as number[];
    const d = row[c] as number;
    for (let j = 0; j < 2 * n; j++) row[j] = (row[j] as number) / d;
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const other = a[r] as number[];
      const k = other[c] as number;
      for (let j = 0; j < 2 * n; j++) other[j] = (other[j] as number) - k * (row[j] as number);
    }
  }
  return a.map((r) => r.slice(n));
}

/** Regresión lineal múltiple por mínimos cuadrados; X sin columna de unos (se agrega la ordenada). */
export function ols(x: number[][], y: number[], names: string[]): Regression | null {
  const X = x.map((r) => [1, ...r]);
  const n = X.length;
  const k = (X[0]?.length ?? 1) - 1;
  if (n <= k + 1) return null;
  const cols = (X[0] ?? []).map((_, j) => X.map((r) => r[j] as number));
  const xtx = cols.map((a) => cols.map((b) => sum(a.map((v, i) => v * (b[i] as number)))));
  const inv = invert(xtx);
  if (!inv) return null;
  const xty = cols.map((a) => sum(a.map((v, i) => v * (y[i] as number))));
  const beta = inv.map((r) => sum(r.map((v, j) => v * (xty[j] as number))));
  const fit = X.map((r) => sum(r.map((v, j) => v * (beta[j] as number))));
  const ym = mean(y);
  const sse = sum(y.map((v, i) => (v - (fit[i] as number)) ** 2));
  const sst = sum(y.map((v) => (v - ym) ** 2));
  const mse = sse / (n - k - 1);
  const se = inv.map((r, j) => Math.sqrt(mse * (r[j] as number)));
  const t = beta.map((b, j) => b / (se[j] as number));
  const r2 = 1 - sse / sst;
  const f = (sst - sse) / k / mse;
  return {
    names: ['Ordenada', ...names],
    beta,
    se,
    t,
    p: t.map((v) => pT(v, n - k - 1)),
    r2,
    r2adj: 1 - ((1 - r2) * (n - 1)) / (n - k - 1),
    f,
    pF: pF(f, k, n - k - 1),
    n,
    k,
  };
}
