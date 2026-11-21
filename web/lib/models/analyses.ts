// Paneles de Probabilidad y Estadística de cada interfaz. Cada constructor recibe los datos que la
// página ya cargó y devuelve análisis listos para graficar (serializables, calculados en el servidor).
// Todo se recalcula con cada carga de datos y para cualquier equipo.

import {
  type Anova,
  anova,
  chi2Independence,
  describe,
  fVariances,
  mean,
  ols,
  type Regression,
  type Summary,
  tCrit,
  twoProportions,
  welch,
} from './inference';
import {
  betaPdf,
  binomPmf,
  type Fit,
  goodnessOfFit,
  normalCdf,
  normalPdf,
  oneProportion,
  pearson,
  poissonPmf,
  qqPoints,
  seeded,
  simpleFit,
  wilson,
} from './probability';

export const ALPHA = 0.05;
export type Format = 'num' | 'pct' | 'eur' | 'int';

interface Base {
  id: string;
  title: string;
  intro: string;
  /** Conclusión en palabras (con la decisión de la prueba cuando hay una). */
  reading?: string;
}

export type Analysis = Base &
  (
    | {
        kind: 'dist';
        xTitle: string;
        model: string;
        bars: { label: string; observed: number; expected: number }[];
        fit: Fit | null;
      }
    | {
        kind: 'pmf';
        xTitle: string;
        bars: { label: string; p: number; highlight?: boolean; approx?: number }[];
        approxLabel?: string;
      }
    | {
        kind: 'ci';
        format: Format;
        rows: { label: string; est: number; lo: number; hi: number; n: number }[];
        ref?: { label: string; value: number };
      }
    | {
        kind: 'tests';
        rows: {
          question: string;
          test: string;
          a: string;
          b: string;
          letter: string;
          statistic: number;
          df: string;
          p: number;
        }[];
        labels: [string, string];
      }
    | { kind: 'box'; format: Format; log?: boolean; rows: { label: string; summary: Summary }[] }
    | {
        kind: 'scatter';
        xTitle: string;
        yTitle: string;
        points: { key: string; x: number; y: number; label?: string }[];
        line: { x: number; y: number }[];
        note: string;
      }
    | { kind: 'corr'; labels: string[]; matrix: number[][]; pvals: number[][]; n: number }
    | { kind: 'anova'; result: Anova; rows: { label: string; summary: Summary }[]; format: Format }
    | {
        kind: 'contingency';
        rowLabels: string[];
        colLabels: string[];
        table: number[][];
        expected: number[][];
        residuals: number[][];
        statistic: number;
        df: number;
        p: number;
      }
    | { kind: 'regression'; result: Regression }
    | {
        kind: 'curves';
        xTitle: string;
        yTitle: string;
        curves: { key: string; label: string; color: string; points: { x: number; y: number }[] }[];
      }
  );

const f2 = (v: number) => v.toFixed(2).replace('.', ',');
const pc = (v: number) => `${(100 * v).toFixed(1).replace('.', ',')} %`;
const pv = (p: number) => (p < 0.001 ? '< 0,001' : p.toFixed(3).replace('.', ','));
const decide = (p: number, yes: string, no: string) =>
  `${p < ALPHA ? 'Se rechaza H₀' : 'No se rechaza H₀'} (p = ${pv(p)}): ${p < ALPHA ? yes : no}`;
const numbers = (xs: (number | null | undefined)[]) =>
  xs.filter((v): v is number => typeof v === 'number' && Number.isFinite(v));

/** Media con su intervalo t del 95 %. */
function meanCi(label: string, xs: number[]) {
  const s = describe(xs);
  return { label, est: s.mean, lo: s.ciLow, hi: s.ciHigh, n: s.n };
}

function propCi(label: string, x: number, n: number) {
  const w = wilson(x, n);
  return { label, est: w.p, lo: w.lo, hi: w.hi, n };
}

/** Histograma de conteos (0, 1, 2…) contra una Poisson con la media observada y su bondad de ajuste. */
function poissonDist(id: string, title: string, what: string, xs: number[]): Analysis | null {
  if (xs.length < 8) return null;
  const lambda = mean(xs);
  const top = Math.max(4, ...xs);
  const counts = Array.from({ length: top + 1 }, (_, k) => xs.filter((v) => v === k).length);
  const expected = counts.map((_, k) =>
    k === top
      ? xs.length * (1 - counts.slice(0, top).reduce((s, _c, j) => s + poissonPmf(j, lambda), 0))
      : xs.length * poissonPmf(k, lambda),
  );
  const fit = goodnessOfFit(counts, expected, 1);
  return {
    id,
    kind: 'dist',
    title,
    intro: `Cuántas veces pasó cada cantidad de ${what} (barras) contra lo que espera una distribución de Poisson con la misma media, λ = ${f2(lambda)} (puntos). H₀: los datos siguen esa Poisson.`,
    xTitle: what.charAt(0).toUpperCase() + what.slice(1),
    model: `Poisson(λ = ${f2(lambda)})`,
    bars: counts.map((o, k) => ({
      label: k === top ? `${String(k)}+` : String(k),
      observed: o,
      expected: expected[k] ?? 0,
    })),
    fit,
    reading: fit
      ? `χ² = ${f2(fit.statistic)} con ${String(fit.df)} gl. ${decide(fit.p, 'los datos no siguen una Poisson.', 'la Poisson describe bien los datos.')}`
      : 'Muy pocos datos para la prueba de bondad de ajuste.',
  };
}

/** Histograma de una variable continua contra la normal con la misma media y desvío. */
function normalDist(id: string, title: string, what: string, xs: number[], bins = 8): Analysis | null {
  if (xs.length < 15) return null;
  const s = describe(xs);
  const lo = s.min;
  const w = (s.max - s.min) / bins || 1;
  const counts = Array.from(
    { length: bins },
    (_, i) => xs.filter((v) => (i === bins - 1 ? v >= lo + i * w : v >= lo + i * w && v < lo + (i + 1) * w)).length,
  );
  const expected = counts.map((_, i) => {
    const a = i === 0 ? -Infinity : lo + i * w;
    const b = i === bins - 1 ? Infinity : lo + (i + 1) * w;
    return xs.length * (normalCdf(b, s.mean, s.sd) - normalCdf(a, s.mean, s.sd));
  });
  const fit = goodnessOfFit(counts, expected, 2);
  return {
    id,
    kind: 'dist',
    title,
    intro: `Histograma de ${what} (barras) contra una normal con la misma media (${f2(s.mean)}) y desvío (${f2(s.sd)}) (puntos). H₀: los datos son normales.`,
    xTitle: what.charAt(0).toUpperCase() + what.slice(1),
    model: `Normal(μ = ${f2(s.mean)}, σ = ${f2(s.sd)})`,
    bars: counts.map((o, i) => ({ label: f2(lo + (i + 0.5) * w), observed: o, expected: expected[i] ?? 0 })),
    fit,
    reading: fit
      ? `χ² = ${f2(fit.statistic)} con ${String(fit.df)} gl. ${decide(fit.p, 'no son normales: conviene cuidar las pruebas que suponen normalidad.', 'la normal es un buen modelo.')}`
      : 'Muy pocos datos para la prueba de bondad de ajuste.',
  };
}

function qq(id: string, what: string, xs: number[]): Analysis | null {
  if (xs.length < 10) return null;
  const pts = qqPoints(xs);
  const r = pearson(
    pts.map((p) => p.x),
    pts.map((p) => p.y),
  ).r;
  return {
    id,
    kind: 'scatter',
    title: `¿${what.charAt(0).toUpperCase() + what.slice(1)} es normal? (gráfico Q-Q)`,
    intro:
      'Cada punto es un dato estandarizado contra el cuantil que tendría en una normal. Si los puntos siguen la diagonal, la normal es un buen modelo; si se curvan en las puntas, hay colas más pesadas o asimetría.',
    xTitle: 'Cuantil teórico de la normal (z)',
    yTitle: 'Valor observado estandarizado',
    points: pts.map((p, i) => ({ key: String(i), x: p.x, y: p.y })),
    line: [
      { x: -3, y: -3 },
      { x: 3, y: 3 },
    ],
    note: `Correlación del Q-Q: ${f2(r)} (cuanto más cerca de 1, más normal).`,
  };
}

function regressionScatter(
  id: string,
  title: string,
  intro: string,
  xTitle: string,
  yTitle: string,
  pts: { key: string; x: number; y: number; label?: string }[],
): Analysis | null {
  if (pts.length < 8) return null;
  const x = pts.map((p) => p.x);
  const y = pts.map((p) => p.y);
  const { a, b } = simpleFit(x, y);
  const r = pearson(x, y);
  const lo = Math.min(...x);
  const hi = Math.max(...x);
  return {
    id,
    kind: 'scatter',
    title,
    intro,
    xTitle,
    yTitle,
    points: pts,
    line: [
      { x: lo, y: a + b * lo },
      { x: hi, y: a + b * hi },
    ],
    note: `Recta: ${yTitle.toLowerCase()} = ${f2(a)} ${b < 0 ? '−' : '+'} ${f2(Math.abs(b))} · ${xTitle.toLowerCase()}. r = ${f2(r.r)}, R² = ${f2(r.r * r.r)}, n = ${String(r.n)}.`,
    reading: `H₀: no hay relación lineal (ρ = 0). t = ${f2(r.t)} con ${String(r.n - 2)} gl. ${decide(r.p, 'hay relación lineal.', 'no hay evidencia de relación lineal.')}`,
  };
}

function correlation(
  id: string,
  title: string,
  intro: string,
  cols: { label: string; values: number[] }[],
): Analysis | null {
  const n = cols[0]?.values.length ?? 0;
  if (n < 8 || cols.length < 3) return null;
  const tests = cols.map((a) => cols.map((b) => pearson(a.values, b.values)));
  return {
    id,
    kind: 'corr',
    title,
    intro,
    labels: cols.map((c) => c.label),
    matrix: tests.map((r) => r.map((t) => t.r)),
    pvals: tests.map((r) => r.map((t) => t.p)),
    n,
  };
}

function binomialNext(id: string, wins: number, n: number, games = 5): Analysis {
  const p = wins / n;
  const bars = Array.from({ length: games + 1 }, (_, k) => ({ label: String(k), p: binomPmf(k, games, p) }));
  const atLeast = bars.slice(Math.ceil(games / 2)).reduce((s, b) => s + b.p, 0);
  return {
    id,
    kind: 'pmf',
    title: `¿Cuántos de los próximos ${String(games)} partidos gana? (binomial)`,
    intro: `Si cada partido fuera independiente y se ganara con la misma probabilidad que en la temporada (p = ${pc(p)}), las victorias en ${String(games)} partidos siguen una binomial(n = ${String(games)}, p).`,
    xTitle: 'Victorias',
    bars,
    reading: `Probabilidad de ganar ${String(Math.ceil(games / 2))} o más: ${pc(atLeast)}. Esperanza: ${f2(games * p)} victorias; varianza: ${f2(games * p * (1 - p))}.`,
  };
}

/** Teorema central del límite: medias de muestras de tamaño m (remuestreo con semilla) contra la normal. */
function centralLimit(id: string, what: string, xs: number[], m = 10, reps = 400): Analysis | null {
  if (xs.length < 10) return null;
  const rnd = seeded(xs.length * 31 + 7);
  const means = Array.from({ length: reps }, () =>
    mean(Array.from({ length: m }, () => xs[Math.floor(rnd() * xs.length)] as number)),
  );
  const d = normalDist(
    id,
    `Teorema central del límite: el promedio de ${String(m)} partidos`,
    `promedios de ${what}`,
    means,
    10,
  );
  if (!d) return null;
  const s = describe(xs);
  return {
    ...d,
    intro: `Se toman ${String(reps)} muestras al azar de ${String(m)} partidos (con reposición) y se calcula el promedio de ${what} de cada una. Aunque los datos originales no sean normales, los promedios se acercan a una normal con media μ = ${f2(s.mean)} y desvío σ/√n = ${f2(s.sd / Math.sqrt(m))}.`,
  };
}

const RESULTS = ['Victoria', 'Empate', 'Derrota'];
const resultOf = (gf: number, ga: number) => (gf > ga ? 0 : gf === ga ? 1 : 2);

export interface TeamMatchLike {
  home: boolean;
  goalsFor: number;
  goalsAgainst: number;
  competitionName: string;
  stats: Record<string, number>;
}

/** Equipo: goles, resultados, localía, competiciones y xG. */
export function teamAnalyses(matches: TeamMatchLike[]): Analysis[] {
  if (matches.length < 8) return [];
  const gf = matches.map((m) => m.goalsFor);
  const ga = matches.map((m) => m.goalsAgainst);
  const wins = matches.filter((m) => m.goalsFor > m.goalsAgainst).length;
  const draws = matches.filter((m) => m.goalsFor === m.goalsAgainst).length;
  const home = matches.filter((m) => m.home);
  const away = matches.filter((m) => !m.home);
  const lambda = mean(gf);
  const out: (Analysis | null)[] = [
    poissonDist('goles-favor', 'Goles a favor por partido (Poisson)', 'goles a favor', gf),
    poissonDist('goles-contra', 'Goles en contra por partido (Poisson)', 'goles en contra', ga),
    {
      id: 'proximo-goles',
      kind: 'pmf',
      title: '¿Cuántos goles hace en el próximo partido? (Poisson)',
      intro: `Con λ = ${f2(lambda)} goles por partido, la probabilidad de cada cantidad de goles en un partido.`,
      xTitle: 'Goles',
      bars: Array.from({ length: 7 }, (_, k) => ({ label: String(k), p: poissonPmf(k, lambda) })),
      reading: `P(no convierte) = ${pc(poissonPmf(0, lambda))} · P(2 o más) = ${pc(1 - poissonPmf(0, lambda) - poissonPmf(1, lambda))}.`,
    },
    binomialNext('binomial', wins, matches.length),
    {
      id: 'intervalos',
      kind: 'ci',
      title: 'Estimación por intervalos (95 %)',
      intro: `Los ${String(matches.length)} partidos son una muestra del rendimiento del equipo. Media con intervalo t de Student y proporciones con intervalo de Wilson.`,
      format: 'num',
      rows: [meanCi('Goles a favor por partido', gf), meanCi('Goles en contra por partido', ga)],
    },
    {
      id: 'intervalos-resultado',
      kind: 'ci',
      title: 'Proporción de cada resultado (95 %)',
      intro: 'Proporción de victorias, empates y derrotas con su intervalo de confianza de Wilson.',
      format: 'pct',
      rows: [
        propCi('Victorias', wins, matches.length),
        propCi('Empates', draws, matches.length),
        propCi('Derrotas', matches.length - wins - draws, matches.length),
      ],
    },
  ];
  if (home.length >= 3 && away.length >= 3) {
    const hw = home.filter((m) => m.goalsFor > m.goalsAgainst).length;
    const aw = away.filter((m) => m.goalsFor > m.goalsAgainst).length;
    const t = welch(
      home.map((m) => m.goalsFor),
      away.map((m) => m.goalsFor),
    );
    const tga = welch(
      home.map((m) => m.goalsAgainst),
      away.map((m) => m.goalsAgainst),
    );
    const f = fVariances(
      home.map((m) => m.goalsFor),
      away.map((m) => m.goalsFor),
    );
    const z = twoProportions(hw, home.length, aw, away.length);
    out.push(
      {
        id: 'localia-cajas',
        kind: 'box',
        title: 'Goles a favor de local y de visitante',
        intro: 'Diagramas de caja: el rombo es la media; la raya, la mediana.',
        format: 'num',
        rows: [
          { label: 'Local', summary: describe(home.map((m) => m.goalsFor)) },
          { label: 'Visitante', summary: describe(away.map((m) => m.goalsFor)) },
        ],
      },
      {
        id: 'localia-pruebas',
        kind: 'tests',
        title: '¿Jugar de local cambia algo? (pruebas de hipótesis)',
        intro: 'Dos muestras independientes (partidos de local y de visitante). H₀ en cada fila: no hay diferencia.',
        labels: ['Local', 'Visitante'],
        rows: [
          {
            question: 'Goles a favor por partido',
            test: 't de Welch',
            a: f2(mean(home.map((m) => m.goalsFor))),
            b: f2(mean(away.map((m) => m.goalsFor))),
            letter: 't',
            statistic: t.statistic,
            df: f2(t.df as number),
            p: t.p,
          },
          {
            question: 'Goles en contra por partido',
            test: 't de Welch',
            a: f2(mean(home.map((m) => m.goalsAgainst))),
            b: f2(mean(away.map((m) => m.goalsAgainst))),
            letter: 't',
            statistic: tga.statistic,
            df: f2(tga.df as number),
            p: tga.p,
          },
          {
            question: 'Dispersión de los goles a favor',
            test: 'F de varianzas',
            a: '',
            b: '',
            letter: 'F',
            statistic: f.statistic,
            df: (f.df as number[]).join('; '),
            p: f.p,
          },
          {
            question: 'Proporción de victorias',
            test: 'z de dos proporciones',
            a: pc(z.p1),
            b: pc(z.p2),
            letter: 'z',
            statistic: z.statistic,
            df: '–',
            p: z.p,
          },
        ],
      },
    );
    const table = [home, away].map((g) =>
      RESULTS.map((_, j) => g.filter((m) => resultOf(m.goalsFor, m.goalsAgainst) === j).length),
    );
    const c = chi2Independence(table);
    out.push({
      id: 'localia-contingencia',
      kind: 'contingency',
      title: '¿El resultado depende de la localía? (tabla de contingencia)',
      intro:
        'H₀: el resultado es independiente de jugar de local. Observados y, abajo, los esperados si fueran independientes.',
      rowLabels: ['Local', 'Visitante'],
      colLabels: RESULTS,
      table,
      ...c,
      df: c.df as number,
      reading: `χ² = ${f2(c.statistic)} con ${String(c.df)} gl. ${decide(c.p, 'el resultado depende de la localía.', 'no hay evidencia de que dependa.')} Con pocos partidos, varias celdas esperan menos de 5: tomarlo con cuidado.`,
    });
  }
  const comps = [...new Set(matches.map((m) => m.competitionName))]
    .map((name) => ({ name, xs: matches.filter((m) => m.competitionName === name).map((m) => m.goalsFor) }))
    .filter((g) => g.xs.length >= 3);
  if (comps.length >= 2) {
    const a = anova(comps.map((g) => g.xs));
    out.push({
      id: 'anova-competicion',
      kind: 'anova',
      title: '¿Hace más goles en alguna competición? (ANOVA)',
      intro: 'H₀: la media de goles a favor es la misma en todas las competiciones (con al menos 3 partidos).',
      result: a,
      rows: comps.map((g) => ({ label: g.name, summary: describe(g.xs) })),
      format: 'num',
      reading: `F = ${f2(a.f)} con (${String(a.dfb)}; ${String(a.dfw)}) gl. ${decide(a.p, `la competición sí cambia los goles (η² = ${pc(a.eta2)}).`, 'no hay evidencia de diferencia entre competiciones.')}`,
    });
  }
  const withXg = matches.filter((m) => typeof m.stats.xg === 'number');
  out.push(
    regressionScatter(
      'goles-xg',
      'Goles contra xG (regresión lineal simple)',
      'Cada punto es un partido. Si el equipo convierte lo que genera, la pendiente se acerca a 1.',
      'xG',
      'Goles',
      withXg.map((m, i) => ({ key: String(i), x: m.stats.xg as number, y: m.goalsFor })),
    ),
    qq('qq-xg', 'el xG por partido', numbers(withXg.map((m) => m.stats.xg))),
    centralLimit('tcl', 'goles a favor', gf),
  );
  return out.filter((a): a is Analysis => a !== null);
}

export interface SituationRowLike {
  title: string;
  param: string;
  n: number;
  w: number;
  base: number;
}

/** Situaciones: cada «cuando pasa X» es una proporción condicional con su intervalo y su prueba. */
export function situationAnalyses(rows: SituationRowLike[], baseWinPct: number | null): Analysis[] {
  const base = (baseWinPct ?? 0) / 100;
  const tested = rows
    .filter((r) => r.n >= 8 && r.param)
    .map((r) => ({ ...r, ...oneProportion(r.w, r.n, base) }))
    .sort((a, b) => a.p - b.p)
    .slice(0, 14);
  if (!tested.length || !base) return [];
  const best = tested[0];
  return [
    {
      id: 'situaciones-ic',
      kind: 'ci',
      title: 'Probabilidad condicional de ganar (intervalos del 95 %)',
      intro: `P(ganar | situación): proporción de victorias cuando se da cada situación, con su intervalo de Wilson. La línea es P(ganar) en toda la temporada (${pc(base)}). Si el intervalo no la toca, la situación cambia de verdad la probabilidad. Se muestran las 14 con la prueba más fuerte (al menos 8 partidos).`,
      format: 'pct',
      rows: tested.map((r) => propCi(`${r.title}: ${r.param}`, r.w, r.n)),
      ref: { label: 'Temporada', value: base },
    },
    {
      id: 'situaciones-pruebas',
      kind: 'tests',
      title: '¿La situación cambia la probabilidad de ganar? (z de una proporción)',
      intro: `H₀: P(ganar | situación) = P(ganar) = ${pc(base)}. Con muchas pruebas a la vez, alguna sale significativa por azar: mirar las de p muy chico.`,
      labels: ['En la situación', 'Temporada'],
      rows: tested.map((r) => ({
        question: `${r.title}: ${r.param} (n = ${String(r.n)})`,
        test: 'z de una proporción',
        a: pc(r.w / r.n),
        b: pc(base),
        letter: 'z',
        statistic: r.z,
        df: '–',
        p: r.p,
      })),
      reading: best
        ? `Teorema de Bayes: P(situación | ganó) = P(ganar | situación) · P(situación) / P(ganar). Por ejemplo, «${best.title}: ${best.param}» pasó en ${String(best.n)} partidos y se ganaron ${String(best.w)}.`
        : undefined,
    },
  ];
}

export interface PlayerLike {
  name: string;
  position: string | null;
  minutes: number;
  stats: Record<string, number>;
}

const per90 = (p: PlayerLike, key: string) => {
  const v = p.stats[key];
  return v === undefined || !p.minutes ? null : (v / p.minutes) * 90;
};

const KEY_STATS: { key: string; label: string; rate: boolean }[] = [
  { key: 'goles_sin_penal', label: 'Goles', rate: true },
  { key: 'npxg', label: 'npxG', rate: true },
  { key: 'remates', label: 'Remates', rate: true },
  { key: 'xa', label: 'xA', rate: true },
  { key: 'pases_clave', label: 'Pases clave', rate: true },
  { key: 'regates_exitosos', label: 'Regates', rate: true },
  { key: 'entradas_ganadas', label: 'Entradas', rate: true },
  { key: 'intercepciones', label: 'Intercepciones', rate: true },
  { key: 'pct_pases', label: '% pases', rate: false },
  { key: 'calificacion', label: 'Calificación', rate: false },
];

/** Jugadores: calificación por puesto, normalidad, correlaciones y regresión múltiple. */
export function squadAnalyses(players: PlayerLike[]): Analysis[] {
  const regular = players.filter((p) => p.minutes >= 450 && typeof p.stats.calificacion === 'number');
  if (regular.length < 10) return [];
  const ratings = regular.map((p) => p.stats.calificacion as number);
  const groups = ['Arquero', 'Defensor', 'Mediocampista', 'Delantero']
    .map((g) => ({ label: g, xs: regular.filter((p) => p.position === g).map((p) => p.stats.calificacion as number) }))
    .filter((g) => g.xs.length >= 2);
  const out: (Analysis | null)[] = [];
  if (groups.length >= 2) {
    const a = anova(groups.map((g) => g.xs));
    out.push({
      id: 'calificacion-puesto',
      kind: 'anova',
      title: '¿La calificación depende del puesto? (ANOVA)',
      intro: `Jugadores con 450 minutos o más (n = ${String(regular.length)}). H₀: la calificación media es la misma en todos los puestos.`,
      result: a,
      rows: groups.map((g) => ({ label: g.label, summary: describe(g.xs) })),
      format: 'num',
      reading: `F = ${f2(a.f)} con (${String(a.dfb)}; ${String(a.dfw)}) gl. ${decide(a.p, `el puesto cambia la calificación (η² = ${pc(a.eta2)}).`, 'no hay evidencia de que el puesto la cambie.')}`,
    });
  }
  out.push(
    normalDist('calificacion-normal', 'Distribución de la calificación (normal)', 'calificación', ratings, 6),
    qq('calificacion-qq', 'la calificación', ratings),
  );
  const cols = KEY_STATS.map((s) => ({
    label: s.label,
    values: regular.map((p) => (s.rate ? per90(p, s.key) : (p.stats[s.key] ?? null))),
  })).filter((c) => c.values.every((v) => v !== null)) as { label: string; values: number[] }[];
  out.push(
    correlation(
      'correlaciones',
      'Correlaciones entre estadísticas (cada 90 minutos)',
      'Coeficiente de Pearson entre cada par de estadísticas del plantel. Verde: relación positiva fuerte; rojo: negativa. El asterisco marca las significativas (p < 0,05).',
      cols,
    ),
    regressionScatter(
      'goles-npxg',
      'Goles contra npxG por jugador (regresión simple)',
      'Cada punto es un jugador (totales de la temporada). Arriba de la recta convierte más de lo que generan sus remates.',
      'npxG',
      'Goles sin penal',
      regular
        .filter((p) => typeof p.stats.npxg === 'number' && typeof p.stats.goles_sin_penal === 'number')
        .map((p) => ({
          key: p.name,
          x: p.stats.npxg as number,
          y: p.stats.goles_sin_penal as number,
          label: (p.stats.goles_sin_penal as number) >= 3 ? p.name : undefined,
        })),
    ),
  );
  const predictors = ['npxg', 'xa', 'entradas_ganadas', 'pct_pases'];
  const usable = regular.filter((p) => predictors.every((k) => typeof p.stats[k] === 'number'));
  if (usable.length >= predictors.length + 5) {
    const reg = ols(
      usable.map((p) => [
        per90(p, 'npxg') ?? 0,
        per90(p, 'xa') ?? 0,
        per90(p, 'entradas_ganadas') ?? 0,
        p.stats.pct_pases as number,
      ]),
      usable.map((p) => p.stats.calificacion as number),
      ['npxG cada 90', 'xA cada 90', 'Entradas cada 90', '% pases'],
    );
    if (reg)
      out.push({
        id: 'regresion-calificacion',
        kind: 'regression',
        title: '¿Qué explica la calificación? (regresión lineal múltiple)',
        intro:
          'Calificación = β₀ + β₁·npxG + β₂·xA + β₃·entradas (cada 90) + β₄·% pases. Cada β es cuánto cambia la calificación por una unidad más de esa estadística, con las demás fijas.',
        result: reg,
        reading: `R² = ${f2(reg.r2)}: estas cuatro estadísticas explican el ${pc(reg.r2)} de las diferencias de calificación. ${decide(reg.pF, 'el modelo en conjunto es significativo.', 'el modelo en conjunto no es significativo.')}`,
      });
  }
  return out.filter((a): a is Analysis => a !== null);
}

export interface PlayerMatchLike {
  home: boolean;
  started: boolean | null;
  minutes: number | null;
  rating: number | null;
  goals: number | null;
}

/** Un jugador: su calificación partido a partido, goles y diferencias de local o titular. */
export function playerAnalyses(matches: PlayerMatchLike[]): Analysis[] {
  const rated = matches.filter((m) => m.rating !== null);
  if (rated.length < 8) return [];
  const r = rated.map((m) => m.rating as number);
  const good = r.filter((v) => v >= 7).length;
  const out: (Analysis | null)[] = [
    normalDist('jugador-normal', 'Su calificación partido a partido (normal)', 'calificación', r, 6),
    {
      id: 'jugador-ic',
      kind: 'ci',
      title: 'Estimación por intervalos (95 %)',
      intro:
        'Calificación media con intervalo t de Student; proporción de partidos con 7 o más con intervalo de Wilson.',
      format: 'num',
      rows: [meanCi('Calificación media', r)],
    },
    {
      id: 'jugador-ic-prop',
      kind: 'ci',
      title: 'Partidos con calificación de 7 o más (95 %)',
      intro: 'Proporción de partidos buenos, con su intervalo de confianza.',
      format: 'pct',
      rows: [propCi('Calificación 7 o más', good, r.length)],
    },
  ];
  const home = rated.filter((m) => m.home).map((m) => m.rating as number);
  const away = rated.filter((m) => !m.home).map((m) => m.rating as number);
  const st = rated.filter((m) => m.started === true).map((m) => m.rating as number);
  const sub = rated.filter((m) => m.started === false).map((m) => m.rating as number);
  const rows: Extract<Analysis, { kind: 'tests' }>['rows'] = [];
  if (home.length >= 3 && away.length >= 3) {
    const t = welch(home, away);
    rows.push({
      question: 'Calificación de local contra visitante',
      test: 't de Welch',
      a: f2(mean(home)),
      b: f2(mean(away)),
      letter: 't',
      statistic: t.statistic,
      df: f2(t.df as number),
      p: t.p,
    });
    const f = fVariances(home, away);
    rows.push({
      question: 'Regularidad de local contra visitante',
      test: 'F de varianzas',
      a: '',
      b: '',
      letter: 'F',
      statistic: f.statistic,
      df: (f.df as number[]).join('; '),
      p: f.p,
    });
  }
  if (st.length >= 3 && sub.length >= 3) {
    const t = welch(st, sub);
    rows.push({
      question: 'Calificación de titular contra suplente',
      test: 't de Welch',
      a: f2(mean(st)),
      b: f2(mean(sub)),
      letter: 't',
      statistic: t.statistic,
      df: f2(t.df as number),
      p: t.p,
    });
  }
  if (rows.length)
    out.push(
      {
        id: 'jugador-cajas',
        kind: 'box',
        title: 'Calificación según el partido',
        intro: 'Diagramas de caja de su calificación en cada grupo de partidos.',
        format: 'num',
        rows: [
          ...(home.length >= 3 ? [{ label: 'Local', summary: describe(home) }] : []),
          ...(away.length >= 3 ? [{ label: 'Visitante', summary: describe(away) }] : []),
          ...(st.length >= 3 ? [{ label: 'Titular', summary: describe(st) }] : []),
          ...(sub.length >= 3 ? [{ label: 'Suplente', summary: describe(sub) }] : []),
        ],
      },
      {
        id: 'jugador-pruebas',
        kind: 'tests',
        title: '¿Rinde distinto según el partido? (pruebas de hipótesis)',
        intro: 'H₀ en cada fila: no hay diferencia entre los dos grupos de partidos.',
        labels: ['Grupo 1', 'Grupo 2'],
        rows,
      },
    );
  out.push(
    regressionScatter(
      'jugador-minutos',
      'Calificación contra minutos jugados (regresión simple)',
      'Cada punto es un partido.',
      'Minutos',
      'Calificación',
      rated
        .filter((m) => m.minutes !== null)
        .map((m, i) => ({ key: String(i), x: m.minutes as number, y: m.rating as number })),
    ),
    qq('jugador-qq', 'su calificación', r),
  );
  const goals = matches.filter((m) => m.goals !== null && (m.minutes ?? 0) > 0).map((m) => m.goals as number);
  if (goals.some((g) => g > 0)) {
    const lambda = mean(goals);
    out.push(poissonDist('jugador-goles', 'Sus goles por partido (Poisson)', 'goles', goals), {
      id: 'jugador-marca',
      kind: 'pmf',
      title: '¿Convierte en el próximo partido? (Poisson y geométrica)',
      intro: `Con λ = ${f2(lambda)} goles por partido, P(convierte) = 1 − e^(−λ). La geométrica da cuántos partidos hay que esperar hasta el próximo gol.`,
      xTitle: 'Partido en que vuelve a convertir',
      bars: Array.from({ length: 8 }, (_, k) => {
        const p = 1 - poissonPmf(0, lambda);
        return { label: String(k + 1), p: (1 - p) ** k * p };
      }),
      reading: `P(convierte en un partido) = ${pc(1 - poissonPmf(0, lambda))}. Espera media hasta el próximo gol: ${f2(1 / (1 - poissonPmf(0, lambda)))} partidos.`,
    });
  }
  return out.filter((a): a is Analysis => a !== null);
}

/** Comparar: dos jugadores partido a partido. */
export function compareAnalyses(
  a: { name: string; ratings: number[] },
  b: { name: string; ratings: number[] },
): Analysis[] {
  if (a.ratings.length < 3 || b.ratings.length < 3) return [];
  const t = welch(a.ratings, b.ratings);
  const f = fVariances(a.ratings, b.ratings);
  const ga = a.ratings.filter((v) => v >= 7).length;
  const gb = b.ratings.filter((v) => v >= 7).length;
  const z = twoProportions(ga, a.ratings.length, gb, b.ratings.length);
  return [
    {
      id: 'comparar-cajas',
      kind: 'box',
      title: 'Calificación partido a partido',
      intro: 'Diagramas de caja de la calificación de cada uno en los partidos que jugó.',
      format: 'num',
      rows: [
        { label: a.name, summary: describe(a.ratings) },
        { label: b.name, summary: describe(b.ratings) },
      ],
    },
    {
      id: 'comparar-ic',
      kind: 'ci',
      title: 'Calificación media (intervalos del 95 %)',
      intro: 'Si los intervalos no se tocan, la diferencia es clara.',
      format: 'num',
      rows: [meanCi(a.name, a.ratings), meanCi(b.name, b.ratings)],
    },
    {
      id: 'comparar-pruebas',
      kind: 'tests',
      title: '¿Uno rinde más o es más regular? (pruebas de hipótesis)',
      intro: 'Dos muestras independientes: los partidos de cada uno. H₀ en cada fila: son iguales.',
      labels: [a.name, b.name],
      rows: [
        {
          question: 'Calificación media',
          test: 't de Welch',
          a: f2(mean(a.ratings)),
          b: f2(mean(b.ratings)),
          letter: 't',
          statistic: t.statistic,
          df: f2(t.df as number),
          p: t.p,
        },
        {
          question: 'Regularidad (varianza)',
          test: 'F de varianzas',
          a: f2(describe(a.ratings).sd),
          b: f2(describe(b.ratings).sd),
          letter: 'F',
          statistic: f.statistic,
          df: (f.df as number[]).join('; '),
          p: f.p,
        },
        {
          question: 'Partidos con 7 o más',
          test: 'z de dos proporciones',
          a: pc(z.p1),
          b: pc(z.p2),
          letter: 'z',
          statistic: z.statistic,
          df: '–',
          p: z.p,
        },
      ],
    },
  ];
}

/** Alternativas: correlación entre las estadísticas que usa el agrupamiento. */
export function styleAnalyses(
  rows: { features: Record<string, number> }[],
  labels: Record<string, string>,
): Analysis[] {
  const keys = Object.keys(rows[0]?.features ?? {}).filter((k) => rows.every((r) => typeof r.features[k] === 'number'));
  const a = correlation(
    'estilos-correlacion',
    'Correlación entre las estadísticas del agrupamiento',
    'Coeficiente de Pearson entre las estadísticas cada 90 que usa K-means. Las muy correlacionadas miden casi lo mismo: por eso se resumen en componentes principales. El asterisco marca p < 0,05.',
    keys.map((k) => ({ label: labels[k] ?? k, values: rows.map((r) => r.features[k] as number) })),
  );
  return a ? [a] : [];
}

/** Valor: diagnóstico de la regresión del valor de mercado (residuos). */
export function valueAnalyses(rows: { name: string; actual: number | null; predicted: number | null }[]): Analysis[] {
  const ok = rows.filter((r) => r.actual && r.predicted && r.actual > 0 && r.predicted > 0);
  if (ok.length < 8) return [];
  const fitted = ok.map((r) => Math.log10(r.predicted as number));
  const res = ok.map((r) => Math.log10(r.actual as number) - Math.log10(r.predicted as number));
  const out: (Analysis | null)[] = [
    {
      id: 'valor-residuos',
      kind: 'scatter',
      title: 'Residuos contra valores ajustados',
      intro:
        'Supuesto de la regresión: los residuos (log₁₀ real − log₁₀ esperado) no muestran forma y tienen la misma dispersión en todo el rango. Si forman un embudo o una curva, el modelo deja algo afuera.',
      xTitle: 'log₁₀ del valor esperado',
      yTitle: 'Residuo',
      points: ok.map((r, i) => ({
        key: r.name,
        x: fitted[i] as number,
        y: res[i] as number,
        label: Math.abs(res[i] as number) > 0.3 ? r.name : undefined,
      })),
      line: [
        { x: Math.min(...fitted), y: 0 },
        { x: Math.max(...fitted), y: 0 },
      ],
      note: `Media de los residuos: ${f2(mean(res))} (debe ser cerca de 0).`,
      reading: (() => {
        const c = pearson(fitted, res.map(Math.abs));
        return `Correlación entre el ajustado y el tamaño del residuo: ${f2(c.r)}. ${decide(c.p, 'la dispersión cambia con el valor (heterocedasticidad).', 'no hay evidencia de que la dispersión cambie.')}`;
      })(),
    },
    normalDist('valor-residuos-normal', '¿Los residuos son normales?', 'residuos', res, 6),
    qq('valor-qq', 'el residuo', res),
  ];
  return out.filter((a): a is Analysis => a !== null);
}

/** Predictor: inferencia bayesiana de la probabilidad de ganar y aproximación normal a la Poisson. */
export function predictorAnalyses(matches: TeamMatchLike[]): Analysis[] {
  if (matches.length < 8) return [];
  const n = matches.length;
  const w = matches.filter((m) => m.goalsFor > m.goalsAgainst).length;
  // A priori: un equipo de liga gana cerca del 37 % de sus partidos, con el peso de 10 partidos.
  const a0 = 3.7;
  const b0 = 6.3;
  const a1 = a0 + w;
  const b1 = b0 + n - w;
  const grid = Array.from({ length: 99 }, (_, i) => (i + 1) / 100);
  const post = a1 / (a1 + b1);
  const sdPost = Math.sqrt((a1 * b1) / ((a1 + b1) ** 2 * (a1 + b1 + 1)));
  const wi = wilson(w, n);
  const lambda10 = mean(matches.map((m) => m.goalsFor)) * 10;
  const ks = Array.from({ length: Math.ceil(lambda10 * 2.2) + 1 }, (_, k) => k);
  return [
    {
      id: 'bayes',
      kind: 'curves',
      title: 'Probabilidad de ganar: inferencia clásica y bayesiana',
      intro: `Bayesiana: se parte de una creencia a priori, Beta(${f2(a0)}; ${f2(b0)}) (un equipo de liga gana cerca del 37 %), y se actualiza con los ${String(n)} partidos (${String(w)} victorias): la a posteriori es Beta(${f2(a1)}; ${f2(b1)}). Clásica: la proporción observada con su intervalo.`,
      xTitle: 'Probabilidad de ganar',
      yTitle: 'Densidad',
      curves: [
        {
          key: 'priori',
          label: 'A priori',
          color: 'var(--chart-axis)',
          points: grid.map((x) => ({ x, y: betaPdf(x, a0, b0) })),
        },
        {
          key: 'posteriori',
          label: 'A posteriori',
          color: 'var(--series-2)',
          points: grid.map((x) => ({ x, y: betaPdf(x, a1, b1) })),
        },
      ],
      reading: `Bayesiana: media a posteriori ${pc(post)}, intervalo creíble aproximado ${pc(Math.max(0, post - 1.96 * sdPost))} a ${pc(Math.min(1, post + 1.96 * sdPost))}. Clásica: ${pc(wi.p)} con intervalo de confianza de Wilson ${pc(wi.lo)} a ${pc(wi.hi)}. La bayesiana tira un poco hacia la media de la liga; con más partidos, las dos coinciden.`,
    },
    {
      id: 'normal-poisson',
      kind: 'pmf',
      title: 'Goles en los próximos 10 partidos: Poisson y su aproximación normal',
      intro: `La suma de goles en 10 partidos es Poisson con λ = ${f2(lambda10)}. Con λ grande, se aproxima por una normal con μ = λ y σ = √λ (con corrección por continuidad).`,
      xTitle: 'Goles en 10 partidos',
      bars: ks.map((k) => ({
        label: String(k),
        p: poissonPmf(k, lambda10),
        approx: normalCdf(k + 0.5, lambda10, Math.sqrt(lambda10)) - normalCdf(k - 0.5, lambda10, Math.sqrt(lambda10)),
      })),
      approxLabel: 'Normal aproximada',
      reading: `P(15 goles o más) según la Poisson: ${pc(1 - ks.filter((k) => k < 15).reduce((s, k) => s + poissonPmf(k, lambda10), 0))}; según la normal: ${pc(1 - normalCdf(14.5, lambda10, Math.sqrt(lambda10)))}.`,
    },
  ];
}

/** Estadística desglosada: la serie partido a partido de una estadística. */
export function seriesAnalyses(points: { value: number | null; date: string }[], what: string): Analysis[] {
  const xs = points.filter((p) => p.value !== null).map((p) => p.value as number);
  if (xs.length < 8) return [];
  const half = Math.floor(xs.length / 2);
  const first = xs.slice(0, half);
  const second = xs.slice(half);
  const t = welch(first, second);
  const f = fVariances(first, second);
  const out: (Analysis | null)[] = [
    {
      id: 'serie-ic',
      kind: 'ci',
      title: 'Media por partido (intervalo del 95 %)',
      intro: `Media de ${what} por partido con intervalo t de Student (t crítico = ${f2(tCrit(0.05, xs.length - 1))}).`,
      format: 'num',
      rows: [meanCi('Toda la serie', xs), meanCi('Primera mitad', first), meanCi('Segunda mitad', second)],
    },
    {
      id: 'serie-pruebas',
      kind: 'tests',
      title: '¿Cambió entre la primera y la segunda mitad? (pruebas de hipótesis)',
      intro: 'Los partidos se parten en dos mitades por fecha. H₀: no cambió.',
      labels: ['Primera mitad', 'Segunda mitad'],
      rows: [
        {
          question: 'Media por partido',
          test: 't de Welch',
          a: f2(mean(first)),
          b: f2(mean(second)),
          letter: 't',
          statistic: t.statistic,
          df: f2(t.df as number),
          p: t.p,
        },
        {
          question: 'Dispersión',
          test: 'F de varianzas',
          a: '',
          b: '',
          letter: 'F',
          statistic: f.statistic,
          df: (f.df as number[]).join('; '),
          p: f.p,
        },
      ],
    },
    regressionScatter(
      'serie-tendencia',
      'Tendencia en la temporada (regresión simple)',
      'Cada punto es un partido en orden. Si la pendiente es significativa, la estadística viene subiendo o bajando.',
      'Partido',
      what.charAt(0).toUpperCase() + what.slice(1),
      xs.map((v, i) => ({ key: String(i), x: i + 1, y: v })),
    ),
    normalDist('serie-normal', 'Distribución de los valores por partido', what, xs, 6),
  ];
  return out.filter((a): a is Analysis => a !== null);
}

/** Partido: qué tan probable era el resultado con los goles esperados (Poisson independientes). */
export function matchAnalyses(match: TeamMatchLike, season: TeamMatchLike[]): Analysis[] {
  if (season.length < 5) return [];
  const lf = typeof match.stats.xg === 'number' ? match.stats.xg : mean(season.map((m) => m.goalsFor));
  const la = mean(season.map((m) => m.goalsAgainst));
  let win = 0;
  let draw = 0;
  for (let i = 0; i <= 10; i++)
    for (let j = 0; j <= 10; j++) {
      const p = poissonPmf(i, lf) * poissonPmf(j, la);
      if (i > j) win += p;
      else if (i === j) draw += p;
    }
  const exact = poissonPmf(match.goalsFor, lf) * poissonPmf(match.goalsAgainst, la);
  return [
    {
      id: 'partido-goles',
      kind: 'pmf',
      title: '¿Qué tan probables eran sus goles? (Poisson)',
      intro: `Goles esperados del equipo: λ = ${f2(lf)} (${typeof match.stats.xg === 'number' ? 'su xG en este partido' : 'su promedio de la temporada'}). La barra marcada es lo que pasó.`,
      xTitle: 'Goles del equipo',
      bars: Array.from({ length: 7 }, (_, k) => ({
        label: String(k),
        p: poissonPmf(k, lf),
        highlight: k === match.goalsFor,
      })),
      reading: `Con goles independientes (λ en contra = ${f2(la)}, su promedio de la temporada): P(ganar) = ${pc(win)}, P(empatar) = ${pc(draw)}, P(perder) = ${pc(1 - win - draw)}. P(este resultado exacto, ${String(match.goalsFor)}–${String(match.goalsAgainst)}) = ${pc(exact)}.`,
    },
    {
      id: 'partido-normal',
      kind: 'curves',
      title: '¿Fue un partido raro? (normal de la diferencia de gol)',
      intro: 'La diferencia de gol de la temporada aproximada por una normal; la línea vertical es la de este partido.',
      xTitle: 'Diferencia de gol',
      yTitle: 'Densidad',
      curves: (() => {
        const d = season.map((m) => m.goalsFor - m.goalsAgainst);
        const s = describe(d);
        const xs = Array.from({ length: 61 }, (_, i) => -6 + i * 0.2);
        const diff = match.goalsFor - match.goalsAgainst;
        const top = normalPdf(s.mean, s.mean, s.sd);
        return [
          {
            key: 'normal',
            label: 'Temporada',
            color: 'var(--series-2)',
            points: xs.map((x) => ({ x, y: normalPdf(x, s.mean, s.sd) })),
          },
          {
            key: 'partido',
            label: 'Este partido',
            color: 'var(--color-text)',
            points: [
              { x: diff, y: 0 },
              { x: diff, y: top },
            ],
          },
        ];
      })(),
      reading: (() => {
        const d = season.map((m) => m.goalsFor - m.goalsAgainst);
        const s = describe(d);
        const z = (match.goalsFor - match.goalsAgainst - s.mean) / s.sd;
        return `z = ${f2(z)}: ${Math.abs(z) >= 2 ? 'un resultado poco común (más de 2 desvíos de la media).' : 'dentro de lo normal para la temporada.'}`;
      })(),
    },
  ];
}
