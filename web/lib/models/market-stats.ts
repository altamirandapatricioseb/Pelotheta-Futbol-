// Estadística del mercado de pases para el Ojeador: cómo se reparte el valor por puesto
// (descriptiva y ANOVA), si puesto y edad están asociados (χ²), qué explica el precio
// (regresión múltiple) y si el plantel propio se parece a la liga (medias, varianzas y proporciones).
// Se recalcula con lo cargado, para cualquier equipo.

import {
  type Anova,
  anova,
  chi2Independence,
  describe,
  fVariances,
  ols,
  type Regression,
  type Summary,
  type TestResult,
  twoProportions,
  welch,
} from './inference';
import { GROUPS, type Group, type MarketPlayer, type SquadPlayer } from './scouting';

export const AGE_BANDS = [
  { label: 'Hasta 21', min: 0, max: 21 },
  { label: '22 a 25', min: 22, max: 25 },
  { label: '26 a 29', min: 26, max: 29 },
  { label: '30 o más', min: 30, max: 99 },
] as const;
const YOUNG = 23;
const ALPHA = 0.05;

export interface Comparison extends TestResult {
  id: 'medias' | 'varianzas' | 'proporciones';
  title: string;
  own: string;
  league: string;
  reject: boolean;
}

export interface MarketStats {
  alpha: number;
  /** Resumen del valor (€) por puesto, en el orden de GROUPS. */
  byGroup: { group: Group; summary: Summary; values: number[] }[];
  anova: Anova;
  contingency: { table: number[][]; expected: number[][]; residuals: number[][] } & TestResult;
  regression: Regression;
  /** Precio que espera la regresión para cada puesto y edad (curvas del gráfico). */
  curves: { group: Group; points: { x: number; y: number }[] }[];
  simpleR2: number;
  own: { summary: Summary; values: number[] } | null;
  league: { summary: Summary; values: number[] };
  comparisons: Comparison[];
}

const bandOf = (age: number) => AGE_BANDS.findIndex((b) => age >= b.min && age <= b.max);
const pct = (v: number) => `${(100 * v).toFixed(1).replace('.', ',')} %`;
const millions = (v: number) => `€ ${(v / 1e6).toFixed(2).replace('.', ',')} M`;
const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const sdOf = (xs: number[]) => Math.sqrt(xs.reduce((a, x) => a + (x - avg(xs)) ** 2, 0) / (xs.length - 1));

/** Diseño: edad, edad² y una variable indicadora por puesto (Arquero es la base). */
function design(age: number, group: Group): number[] {
  return [age, age * age, ...GROUPS.slice(1).map((g) => (g === group ? 1 : 0))];
}

/** El análisis del mercado o null si hay muy pocos jugadores para que tenga sentido. */
export function marketStats(market: MarketPlayer[], squad: SquadPlayer[]): MarketStats | null {
  const rows = market.flatMap((p) =>
    GROUPS.includes(p.position as Group) && p.value !== null && p.value > 0 && p.age !== null
      ? [{ group: p.position as Group, age: p.age, value: p.value }]
      : [],
  );
  const groups = GROUPS.map((g) => rows.filter((r) => r.group === g));
  if (groups.some((g) => g.length < 5)) return null;

  // El precio es muy asimétrico: ANOVA y regresión trabajan con log10 del valor.
  const logs = groups.map((g) => g.map((r) => Math.log10(r.value)));
  const table = GROUPS.map((g) =>
    AGE_BANDS.map((_, j) => rows.filter((r) => r.group === g && bandOf(r.age) === j).length),
  );
  const contingency = chi2Independence(table);
  const regression = ols(
    rows.map((r) => design(r.age, r.group)),
    rows.map((r) => Math.log10(r.value)),
    ['Edad', 'Edad²', ...GROUPS.slice(1)],
  );
  const simple = ols(
    rows.map((r) => [r.age]),
    rows.map((r) => Math.log10(r.value)),
    ['Edad'],
  );
  if (!regression || !simple) return null;
  const ages = rows.map((r) => r.age);
  const lo = Math.min(...ages);
  const hi = Math.max(...ages);
  const curves = GROUPS.map((group) => ({
    group,
    points: Array.from({ length: hi - lo + 1 }, (_, i) => {
      const x = lo + i;
      const z = [1, ...design(x, group)].reduce((a, v, j) => a + v * (regression.beta[j] ?? 0), 0);
      return { x, y: 10 ** z };
    }),
  }));

  const leagueValues = rows.map((r) => r.value);
  const ownRows = squad.flatMap((p) =>
    p.value !== null && p.value > 0 && p.age !== null ? [{ value: p.value, age: p.age }] : [],
  );
  const comparisons: Comparison[] = [];
  let own: MarketStats['own'] = null;
  if (ownRows.length >= 5) {
    const ownValues = ownRows.map((r) => r.value);
    own = { summary: describe(ownValues), values: ownValues };
    const ownLog = ownValues.map(Math.log10);
    const leagueLog = leagueValues.map(Math.log10);
    const t = welch(ownLog, leagueLog);
    const f = fVariances(ownLog, leagueLog);
    const youngOwn = ownRows.filter((r) => r.age <= YOUNG).length;
    const youngLeague = rows.filter((r) => r.age <= YOUNG).length;
    const z = twoProportions(youngOwn, ownRows.length, youngLeague, rows.length);
    comparisons.push(
      {
        id: 'medias',
        title: '¿El plantel vale en promedio lo mismo que la liga?',
        // Media geométrica: la media de los logaritmos vuelta a euros.
        own: millions(10 ** avg(ownLog)),
        league: millions(10 ** avg(leagueLog)),
        ...t,
        reject: t.p < ALPHA,
      },
      {
        id: 'varianzas',
        title: '¿Los precios del plantel están igual de dispersos que los de la liga?',
        own: `DE ${sdOf(ownLog).toFixed(2).replace('.', ',')}`,
        league: `DE ${sdOf(leagueLog).toFixed(2).replace('.', ',')}`,
        ...f,
        reject: f.p < ALPHA,
      },
      {
        id: 'proporciones',
        title: `¿Tiene la misma proporción de jugadores de ${String(YOUNG)} años o menos que la liga?`,
        own: pct(z.p1),
        league: pct(z.p2),
        ...z,
        reject: z.p < ALPHA,
      },
    );
  }
  return {
    alpha: ALPHA,
    byGroup: GROUPS.map((group, i) => ({
      group,
      summary: describe((groups[i] ?? []).map((r) => r.value)),
      values: (groups[i] ?? []).map((r) => r.value),
    })),
    anova: anova(logs),
    contingency: { table, ...contingency },
    regression,
    curves,
    simpleR2: simple.r2,
    own,
    league: { summary: describe(leagueValues), values: leagueValues },
    comparisons,
  };
}
