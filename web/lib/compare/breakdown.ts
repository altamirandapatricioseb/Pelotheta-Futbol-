// Desglose de una estadística dentro de Comparar (9.7 y 9.8): las ventanas se arman en el
// navegador a partir de la serie partido a partido de cada jugador (`api.stat_series`), así las
// dos columnas (jugador principal y el otro) usan exactamente las mismas reglas. Las ventanas de
// días se miden hacia atrás desde el último partido cargado de Boca, no desde hoy.

import type { StatDef } from '@/lib/stats/catalog';

export interface BreakdownPoint {
  matchId: number;
  date: string;
  competitionCode: string;
  competition: string;
  opponent: string;
  home: boolean;
  /** G, E o P (resultado de Boca). */
  result: string;
  minutes: number | null;
  /** Titular (true), entró desde el banco (false) o sin dato (null). */
  started: boolean | null;
  num: number | null;
  den: number | null;
  value: number | null;
}

export interface WindowValue {
  n: number;
  value: number | null;
  total: number | null;
  best: number | null;
  worst: number | null;
}

export interface Window extends WindowValue {
  key: string;
  label: string;
}

export interface WindowGroup {
  id: string;
  title: string;
  windows: Window[];
}

const sum = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0);

/** Valor de un grupo de partidos: promedio por partido (los cocientes, suma sobre suma). */
export function aggregate(points: readonly BreakdownPoint[], stat: StatDef): WindowValue {
  const withValue = points.filter((p): p is BreakdownPoint & { value: number } => p.value !== null);
  const values = withValue.map((p) => p.value);
  if (values.length === 0) return { n: 0, value: null, total: null, best: null, worst: null };
  let value = sum(values) / values.length;
  if (stat.rule === 'cociente') {
    const num = sum(withValue.map((p) => p.num ?? 0));
    const den = sum(withValue.map((p) => p.den ?? 0));
    if (den > 0) value = (num / den) * stat.factor;
  }
  const countable = stat.rule === 'suma' || stat.rule === 'diferencia' || stat.rule === 'adicion';
  return {
    n: values.length,
    value,
    total: countable ? sum(values) : null,
    best: stat.higherIsBetter ? Math.max(...values) : Math.min(...values),
    worst: stat.higherIsBetter ? Math.min(...values) : Math.max(...values),
  };
}

const MONTHS = [
  'Enero',
  'Febrero',
  'Marzo',
  'Abril',
  'Mayo',
  'Junio',
  'Julio',
  'Agosto',
  'Septiembre',
  'Octubre',
  'Noviembre',
  'Diciembre',
];

function daysBefore(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

/** Agrupa por clave conservando el orden de aparición. */
function by<T>(items: readonly T[], keyOf: (t: T) => string): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const it of items) out.set(keyOf(it), [...(out.get(keyOf(it)) ?? []), it]);
  return out;
}

/** Ventanas de tiempo y de contexto de un jugador, agrupadas como se muestran. */
export function breakdownWindows(points: readonly BreakdownPoint[], stat: StatDef, lastDate: string): WindowGroup[] {
  const played = points.filter((p) => p.value !== null).toSorted((a, b) => b.date.localeCompare(a.date));
  const win = (key: string, label: string, list: readonly BreakdownPoint[]): Window[] => {
    const agg = aggregate(list, stat);
    return agg.n ? [{ key, label, ...agg }] : [];
  };
  const groups: WindowGroup[] = [
    {
      id: 'recientes',
      title: 'Últimos partidos',
      windows: [
        ...win('u1', 'Último partido', played.slice(0, 1)),
        ...win('u3', 'Últimos 3', played.slice(0, 3)),
        ...win('u5', 'Últimos 5', played.slice(0, 5)),
        ...win('u10', 'Últimos 10', played.slice(0, 10)),
        ...win('temporada', 'Temporada', played),
      ],
    },
    {
      id: 'dias',
      title: 'Por días (desde el último partido cargado)',
      windows: [7, 14, 30, 60, 90].flatMap((d) =>
        win(
          `d${String(d)}`,
          `Últimos ${String(d)} días`,
          played.filter((p) => p.date > daysBefore(lastDate, d)),
        ),
      ),
    },
    {
      id: 'mes',
      title: 'Por mes',
      windows: [...by(played, (p) => p.date.slice(0, 7))].flatMap(([month, list]) =>
        win(month, `${MONTHS[Number(month.slice(5, 7)) - 1] ?? month} ${month.slice(0, 4)}`, list),
      ),
    },
    {
      id: 'competicion',
      title: 'Por competición',
      windows: [...by(played, (p) => p.competitionCode)].flatMap(([code, list]) =>
        win(code, list[0]?.competition ?? code, list),
      ),
    },
    {
      id: 'localia',
      title: 'Local y visitante',
      windows: [
        ...win(
          'local',
          'Local',
          played.filter((p) => p.home),
        ),
        ...win(
          'visitante',
          'Visitante',
          played.filter((p) => !p.home),
        ),
      ],
    },
    {
      id: 'resultado',
      title: 'Por resultado de Boca',
      windows: [
        ...win(
          'G',
          'En victorias',
          played.filter((p) => p.result === 'G'),
        ),
        ...win(
          'E',
          'En empates',
          played.filter((p) => p.result === 'E'),
        ),
        ...win(
          'P',
          'En derrotas',
          played.filter((p) => p.result === 'P'),
        ),
      ],
    },
    {
      id: 'titularidad',
      title: 'Titular o suplente',
      windows: [
        ...win(
          'titular',
          'Como titular',
          played.filter((p) => p.started === true),
        ),
        ...win(
          'suplente',
          'Entrando desde el banco',
          played.filter((p) => p.started === false),
        ),
      ],
    },
    {
      id: 'minutos',
      title: 'Minutos jugados',
      windows: [
        ...win(
          'completo',
          'Partido completo (90 o más)',
          played.filter((p) => (p.minutes ?? 0) >= 90),
        ),
        ...win(
          'parcial',
          'Menos de 90 minutos',
          played.filter((p) => p.minutes !== null && p.minutes < 90),
        ),
      ],
    },
    {
      id: 'rival',
      title: 'Por rival (2 o más partidos)',
      windows: [...by(played, (p) => p.opponent)]
        .filter(([, list]) => list.length >= 2)
        .flatMap(([opponent, list]) => win(opponent, opponent, list)),
    },
  ];
  return groups.filter((g) => g.windows.length > 0);
}

export interface MergedMatch {
  matchId: number;
  date: string;
  opponent: string;
  competition: string;
  home: boolean;
  result: string;
  /** Valor del jugador principal (null si no jugó o no hay dato). */
  a: number | null;
  /** Valor del otro jugador. */
  b: number | null;
  playedA: boolean;
  playedB: boolean;
}

/** Partidos de los dos jugadores unidos por partido, del más reciente al más viejo. */
export function mergeMatches(a: readonly BreakdownPoint[], b: readonly BreakdownPoint[]): MergedMatch[] {
  const out = new Map<number, MergedMatch>();
  for (const [list, side] of [
    [a, 'a'],
    [b, 'b'],
  ] as const) {
    for (const p of list) {
      const m = out.get(p.matchId) ?? {
        matchId: p.matchId,
        date: p.date,
        opponent: p.opponent,
        competition: p.competition,
        home: p.home,
        result: p.result,
        a: null,
        b: null,
        playedA: false,
        playedB: false,
      };
      if (side === 'a') {
        m.a = p.value;
        m.playedA = true;
      } else {
        m.b = p.value;
        m.playedB = true;
      }
      out.set(p.matchId, m);
    }
  }
  return [...out.values()].sort((x, y) => y.date.localeCompare(x.date));
}
