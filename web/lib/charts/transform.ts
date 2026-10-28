// Transformaciones de datos de los gráficos (Interfaz 1): funciones puras y testeadas.

type Num = number | null;

/** Suma acumulada; un n/d no suma (la línea sigue con el último valor). */
export function cumulative(values: readonly Num[]): number[] {
  let total = 0;
  return values.map((v) => (total += v ?? 0));
}

/** Promedio móvil de los últimos `n` valores con dato; null si el punto no tiene dato. */
export function rolling(values: readonly Num[], n: number): Num[] {
  return values.map((v, i) => {
    if (v === null) return null;
    // Hacia atrás hasta juntar n valores con dato (los n/d no cuentan ni cortan la ventana).
    const window = values
      .slice(0, i + 1)
      .filter((x): x is number => x !== null)
      .slice(-n);
    return window.reduce((a, b) => a + b, 0) / window.length;
  });
}

export interface Bin {
  from: number;
  to: number;
  count: number;
}

/** Histograma de `k` intervalos iguales entre el mínimo y el máximo. */
export function bins(values: readonly number[], k: number): Bin[] {
  if (values.length === 0) return [];
  const min = Math.min(...values);
  const max = Math.max(...values);
  const width = (max - min) / k || 1;
  const out = Array.from({ length: k }, (_, i) => ({ from: min + i * width, to: min + (i + 1) * width, count: 0 }));
  for (const v of values) {
    const index = Math.min(k - 1, Math.floor((v - min) / width));
    const bin = out[index];
    if (bin) bin.count += 1;
  }
  return out;
}

/** Correlación de Pearson; null si alguna serie no varía. */
export function pearson(x: readonly number[], y: readonly number[]): number | null {
  const n = Math.min(x.length, y.length);
  if (n < 3) return null;
  const mx = x.slice(0, n).reduce((a, b) => a + b, 0) / n;
  const my = y.slice(0, n).reduce((a, b) => a + b, 0) / n;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = (x[i] ?? 0) - mx;
    const dy = (y[i] ?? 0) - my;
    sxy += dx * dy;
    sxx += dx * dx;
    syy += dy * dy;
  }
  return sxx === 0 || syy === 0 ? null : sxy / Math.sqrt(sxx * syy);
}

/** Matriz de conteos de pares (fila, columna) con el orden dado. */
export function countMatrix(pairs: readonly [string, string][], rows: readonly string[], cols: readonly string[]) {
  const m = rows.map(() => cols.map(() => 0));
  for (const [r, c] of pairs) {
    const i = rows.indexOf(r);
    const j = cols.indexOf(c);
    const row = m[i];
    if (row && j >= 0) row[j] = (row[j] ?? 0) + 1;
  }
  return m;
}

/** Puestos de 1 a n; los empates comparten el puesto promedio. */
function ranks(values: readonly number[]): number[] {
  const order = values.map((v, i) => [v, i] as const).sort((a, b) => a[0] - b[0]);
  const out = new Array<number>(values.length);
  for (let i = 0; i < order.length;) {
    let j = i;
    while (j + 1 < order.length && order[j + 1]?.[0] === order[i]?.[0]) j++;
    for (let k = i; k <= j; k++) out[order[k]?.[1] ?? 0] = (i + j) / 2 + 1;
    i = j + 1;
  }
  return out;
}

/** Correlación de Spearman: Pearson de los puestos (mide si el orden coincide). */
export function spearman(x: readonly number[], y: readonly number[]): number | null {
  const n = Math.min(x.length, y.length);
  return pearson(ranks(x.slice(0, n)), ranks(y.slice(0, n)));
}
