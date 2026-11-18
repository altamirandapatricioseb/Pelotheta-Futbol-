// Cuenta del predictor en el navegador, igual a la del pipeline (pipeline/match_predictor.py): con los
// β del modelo de Poisson y las variables de cada club se calcula cualquier cruce, incluida la media
// de una liga, de un país o de toda la zona. Así el selector no depende de escenarios precalculados.

export const MAX_GOALS = 6;

export interface Profile {
  name: string;
  attackHome: number;
  attackAway: number;
  defenseHome: number;
  defenseAway: number;
  value: number;
  elo: number;
  form: number;
  estimated: boolean;
  /** Cuántos clubes promedia (1 para un club). */
  count: number;
}

export type Venue = 'local' | 'visitante' | 'neutral';

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
const geo = (xs: number[]) => Math.exp(mean(xs.map((x) => Math.log(Math.max(x, 1e-9)))));

/** Club promedio de un grupo: medias geométricas de ataque, defensa y valor (el modelo usa sus ln). */
export function average(name: string, rows: Profile[]): Profile {
  return {
    name,
    attackHome: geo(rows.map((r) => r.attackHome)),
    attackAway: geo(rows.map((r) => r.attackAway)),
    defenseHome: geo(rows.map((r) => r.defenseHome)),
    defenseAway: geo(rows.map((r) => r.defenseAway)),
    value: geo(rows.map((r) => r.value)),
    elo: mean(rows.map((r) => r.elo)),
    form: mean(rows.map((r) => r.form)),
    estimated: rows.some((r) => r.estimated),
    count: rows.length,
  };
}

/** Variables de los dos equipos (como `sides` del pipeline): local primero. */
function sides(home: Profile, away: Profile, neutral: boolean) {
  const g = (a: number, b: number) => Math.sqrt(a * b);
  const attH = neutral ? g(home.attackHome, home.attackAway) : home.attackHome;
  const attA = neutral ? g(away.attackHome, away.attackAway) : away.attackAway;
  const defH = neutral ? g(home.defenseHome, home.defenseAway) : home.defenseHome;
  const defA = neutral ? g(away.defenseHome, away.defenseAway) : away.defenseAway;
  const ratio = Math.log(home.value / away.value);
  return [
    {
      ataque: Math.log(attH),
      defensa: Math.log(defA),
      valor: ratio,
      elo: (home.elo - away.elo) / 400,
      forma: home.form - away.form,
      local: neutral ? 0 : 1,
    },
    {
      ataque: Math.log(attA),
      defensa: Math.log(defH),
      valor: -ratio,
      elo: (away.elo - home.elo) / 400,
      forma: away.form - home.form,
      local: 0,
    },
  ] as const;
}

export interface Glm {
  names: string[];
  beta: number[];
}

/** Goles esperados (λ) del equipo propio y del rival según dónde se juega. */
export function lambdas(glm: Glm, own: Profile, rival: Profile, venue: Venue): { own: number; rival: number } {
  const ownHome = venue !== 'visitante';
  const [h, a] = ownHome ? sides(own, rival, venue === 'neutral') : sides(rival, own, false);
  const lam = (row: Record<string, number>) =>
    Math.exp((glm.beta[0] ?? 0) + glm.names.reduce((s, n, i) => s + (glm.beta[i + 1] ?? 0) * (row[n] ?? 0), 0));
  const lh = lam(h);
  const la = lam(a);
  return ownHome ? { own: lh, rival: la } : { own: la, rival: lh };
}

export function poissonPmf(k: number, lambda: number): number {
  let p = Math.exp(-lambda);
  for (let i = 1; i <= k; i++) p *= lambda / i;
  return p;
}

/** P(propio = i, rival = j), de 0 a MAX_GOALS, normalizada para sumar 1. */
export function scoreMatrix(own: number, rival: number): number[][] {
  const po = Array.from({ length: MAX_GOALS + 1 }, (_, i) => poissonPmf(i, own));
  const pr = Array.from({ length: MAX_GOALS + 1 }, (_, j) => poissonPmf(j, rival));
  const cells = po.map((x) => pr.map((y) => x * y));
  const total = cells.flat().reduce((a, b) => a + b, 0);
  return cells.map((row) => row.map((c) => c / total));
}

export function outcomes(matrix: number[][]): { win: number; draw: number; loss: number } {
  let win = 0;
  let draw = 0;
  matrix.forEach((row, i) => {
    row.forEach((c, j) => {
      if (i > j) win += c;
      else if (i === j) draw += c;
    });
  });
  return { win, draw, loss: 1 - win - draw };
}

/** Monte Carlo reproducible (semilla fija): n partidos simulados con Poisson de Knuth. */
export function simulate(own: number, rival: number, n = 10_000, seed = 2026) {
  let s = seed >>> 0;
  const rand = () => {
    // mulberry32
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const sample = (lambda: number) => {
    const limit = Math.exp(-lambda);
    let k = 0;
    let p = 1;
    for (;;) {
      p *= rand();
      if (p <= limit) return k;
      k += 1;
    }
  };
  let win = 0;
  let draw = 0;
  for (let i = 0; i < n; i++) {
    const a = sample(own);
    const b = sample(rival);
    if (a > b) win += 1;
    else if (a === b) draw += 1;
  }
  return { n, win: win / n, draw: draw / n, loss: (n - win - draw) / n };
}
