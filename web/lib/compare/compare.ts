// Interfaz 5 (9.7): comparación de un jugador contra referencias.
//
// Reglas: el jugador principal nunca entra en su propia referencia; los arqueros solo se
// comparan con arqueros y los de campo con los de campo; cada estadística respeta su sentido
// (`higher_is_better`): «mejor» no es «más alto». La zona, el carril y la posición salen de
// `api.player_position`, que usa el mapeo de la tabla `position_zone_map` (no del código).

import { playerValue, rankAndPercentile, type PlayerRow, type StatDef } from '@/lib/stats/catalog';

export type RefKind = 'plantel' | 'zona' | 'carril' | 'posicion' | 'jugador';
export interface RefSpec {
  kind: RefKind;
  playerId?: number;
}
export type AverageMode = 'simple' | 'ponderado';
export type Period = 'temporada' | 'ultimos5' | 'ultimos10' | 'ultimo_mes';

export const PERIODS: { id: Period; label: string }[] = [
  { id: 'temporada', label: 'Temporada' },
  { id: 'ultimos5', label: 'Últimos 5 partidos' },
  { id: 'ultimos10', label: 'Últimos 10 partidos' },
  { id: 'ultimo_mes', label: 'Último mes' },
];

export const MAX_REFS = 3;
const DEFAULT_REFS: RefSpec[] = [{ kind: 'plantel' }, { kind: 'posicion' }];
const GROUP_KINDS = new Set<RefKind>(['plantel', 'zona', 'carril', 'posicion']);

export interface PlayerPosition {
  playerId: number;
  positionRaw: string;
  zone: string | null;
  lane: string | null;
  role: string | null;
  /** 'linea': la fuente solo da la línea general y zona y posición coinciden. */
  level: 'posicion' | 'linea';
}

/** Referencias de la URL («plantel,posicion,jugador-22»): hasta 3, sin repetir. */
export function parseRefs(raw: string | undefined): RefSpec[] {
  const out: RefSpec[] = [];
  for (const part of (raw ?? '').split(',')) {
    const player = /^jugador-(\d{1,9})$/.exec(part);
    const spec: RefSpec | null = player
      ? { kind: 'jugador', playerId: Number(player[1]) }
      : GROUP_KINDS.has(part as RefKind)
        ? { kind: part as RefKind }
        : null;
    if (!spec || out.some((r) => sameRef(r, spec))) continue;
    out.push(spec);
    if (out.length === MAX_REFS) break;
  }
  return out.length ? out : DEFAULT_REFS;
}

export const sameRef = (a: RefSpec, b: RefSpec) => a.kind === b.kind && a.playerId === b.playerId;

export function refsToParam(refs: readonly RefSpec[]): string {
  return refs.map((r) => (r.kind === 'jugador' ? `jugador-${String(r.playerId)}` : r.kind)).join(',');
}

const ZONE_LINE: Record<string, string> = {
  Arco: 'Arquero',
  Defensa: 'Defensor',
  Mediocampo: 'Mediocampista',
  Ataque: 'Delantero',
};

/** Línea del jugador (Arquero, Defensor, Mediocampista o Delantero): la del plantel o la de su zona. */
export function lineOf(row: PlayerRow, position: PlayerPosition | undefined): string | null {
  return row.position ?? (position?.zone ? (ZONE_LINE[position.zone] ?? null) : null);
}

export function isGoalkeeper(row: PlayerRow, position: PlayerPosition | undefined): boolean {
  return position?.zone === 'Arco' || row.position === 'Arquero';
}

/**
 * Grupo base de las medias: los del mismo tipo (arqueros o de campo), sin el jugador principal
 * y con al menos `minMinutes` minutos.
 */
export function referencePool(
  players: readonly PlayerRow[],
  main: PlayerRow,
  positions: ReadonlyMap<number, PlayerPosition>,
  minMinutes: number,
): PlayerRow[] {
  const keeper = isGoalkeeper(main, positions.get(main.playerId));
  return players.filter(
    (p) =>
      p.playerId !== main.playerId && p.minutes >= minMinutes && isGoalkeeper(p, positions.get(p.playerId)) === keeper,
  );
}

/** Jugadores que forman una referencia. Un jugador elegido a mano tiene que ser del mismo tipo. */
export function referenceMembers(
  spec: RefSpec,
  main: PlayerRow,
  pool: readonly PlayerRow[],
  positions: ReadonlyMap<number, PlayerPosition>,
  players: readonly PlayerRow[],
): PlayerRow[] {
  const mine = positions.get(main.playerId);
  switch (spec.kind) {
    case 'plantel':
      return [...pool];
    case 'zona':
      return mine?.zone ? pool.filter((p) => positions.get(p.playerId)?.zone === mine.zone) : [];
    case 'carril':
      return mine?.zone && mine.lane
        ? pool.filter((p) => {
            const other = positions.get(p.playerId);
            return other?.zone === mine.zone && other.lane === mine.lane;
          })
        : [];
    case 'posicion':
      return mine?.role ? pool.filter((p) => positions.get(p.playerId)?.role === mine.role) : [];
    case 'jugador': {
      const other = players.find((p) => p.playerId === spec.playerId);
      if (!other || other.playerId === main.playerId) return [];
      const same = isGoalkeeper(other, positions.get(other.playerId)) === isGoalkeeper(main, mine);
      return same ? [other] : [];
    }
  }
}

/** Por qué una referencia no se puede usar con este jugador (null si se puede). */
export function refProblem(
  spec: RefSpec,
  main: PlayerRow,
  positions: ReadonlyMap<number, PlayerPosition>,
  players: readonly PlayerRow[],
): string | null {
  const mine = positions.get(main.playerId);
  switch (spec.kind) {
    case 'plantel':
      return null;
    case 'zona':
      return mine?.zone ? null : 'su zona no está informada';
    case 'carril':
      return mine?.zone && mine.lane ? null : 'la fuente no informa su carril';
    case 'posicion':
      return mine?.role ? null : 'su posición no está informada';
    case 'jugador': {
      const other = players.find((p) => p.playerId === spec.playerId);
      if (!other) return 'el otro jugador no jugó en este período';
      if (other.playerId === main.playerId) return 'es el mismo jugador';
      return isGoalkeeper(other, positions.get(other.playerId)) === isGoalkeeper(main, mine)
        ? null
        : 'los arqueros solo se comparan con arqueros';
    }
  }
}

const LANE: Record<string, string> = { izquierda: 'por izquierda', centro: 'por el centro', derecha: 'por derecha' };

/** Nombre largo (tarjetas) y corto (leyendas) de una referencia. */
export function referenceLabel(
  spec: RefSpec,
  mine: PlayerPosition | undefined,
  players: readonly PlayerRow[],
): { long: string; short: string } {
  switch (spec.kind) {
    case 'plantel':
      // Un arquero solo se compara con arqueros: el «plantel» son los otros arqueros.
      return mine?.zone === 'Arco'
        ? { long: 'Media de los arqueros del plantel', short: 'Arqueros' }
        : { long: 'Media del plantel', short: 'Plantel' };
    case 'zona':
      return { long: `Media de la zona (${mine?.zone ?? 'n/d'})`, short: mine?.zone ?? 'Zona' };
    case 'carril': {
      const lane = mine?.lane ? (LANE[mine.lane] ?? mine.lane) : 'n/d';
      return { long: `Media de ${mine?.zone ?? 'la zona'} ${lane}`, short: `${mine?.zone ?? 'Zona'} ${lane}` };
    }
    case 'posicion':
      return { long: `Media de la posición (${mine?.role ?? 'n/d'})`, short: mine?.role ?? 'Posición' };
    case 'jugador': {
      const other = players.find((p) => p.playerId === spec.playerId);
      const name = other?.shortName ?? other?.name ?? 'Jugador';
      return { long: other?.name ?? 'Jugador', short: name };
    }
  }
}

const numberOf = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** Media de la referencia: simple o ponderada por minutos. `n` = jugadores con dato. */
export function referenceValue(
  members: readonly PlayerRow[],
  stat: StatDef,
  per90: boolean,
  mode: AverageMode,
): { value: number | null; n: number } {
  const pairs = members.flatMap((p) => {
    const v = numberOf(playerValue(p, stat, per90));
    return v === null ? [] : [[v, p.minutes] as const];
  });
  if (pairs.length === 0) return { value: null, n: 0 };
  if (mode === 'ponderado') {
    const weight = pairs.reduce((a, [, m]) => a + m, 0);
    if (weight > 0) return { value: pairs.reduce((a, [v, m]) => a + v * m, 0) / weight, n: pairs.length };
  }
  return { value: pairs.reduce((a, [v]) => a + v, 0) / pairs.length, n: pairs.length };
}

function sd(values: readonly number[]): number | null {
  if (values.length < 2) return null;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const out = Math.sqrt(values.reduce((a, v) => a + (v - mean) ** 2, 0) / values.length);
  return out > 0 ? out : null;
}

export type Verdict = 'mejor' | 'peor' | 'igual';

export interface RefCell {
  value: number | null;
  /** Jugadores con dato en la referencia. */
  n: number;
  diff: number | null;
  diffPct: number | null;
  verdict: Verdict | null;
  /** Diferencia estandarizada, con signo de «mejor» (positivo) o «peor» (negativo). */
  z: number | null;
  /** Dónde cae el valor de la referencia entre el grupo (0 a 100), para el radar. */
  percentile: number | null;
}

export interface StatComparison {
  stat: StatDef;
  player: number | null;
  /** Percentil del jugador entre su grupo base (con él incluido). */
  percentile: number | null;
  refs: RefCell[];
  /** Falta el valor del jugador: la fila se ve gris y no cuenta en el resumen. */
  missing: boolean;
}

/** Porcentaje del grupo que queda peor que un valor de afuera del grupo. */
function percentileAmong(values: readonly number[], value: number, higherIsBetter: boolean): number | null {
  if (values.length === 0) return null;
  const worse = values.filter((v) => (higherIsBetter ? v < value : v > value)).length;
  const equal = values.filter((v) => v === value).length;
  return Math.round(((worse + equal / 2) / values.length) * 100);
}

/** Una estadística del jugador contra cada referencia. */
export function compareStat(
  stat: StatDef,
  main: PlayerRow,
  groups: readonly (readonly PlayerRow[])[],
  pool: readonly PlayerRow[],
  per90: boolean,
  mode: AverageMode,
): StatComparison {
  const player = numberOf(playerValue(main, stat, per90));
  const poolValues = pool.flatMap((p) => {
    const v = numberOf(playerValue(p, stat, per90));
    return v === null ? [] : [v];
  });
  const everyone = player === null ? poolValues : [...poolValues, player];
  const percentile =
    player !== null && everyone.length > 1 ? rankAndPercentile(everyone, player, stat.higherIsBetter).percentile : null;
  const poolSd = sd(everyone);
  const refs = groups.map((members): RefCell => {
    const { value, n } = referenceValue(members, stat, per90, mode);
    const groupValues = members.flatMap((p) => {
      const v = numberOf(playerValue(p, stat, per90));
      return v === null ? [] : [v];
    });
    const refPercentile = value === null ? null : percentileAmong(everyone, value, stat.higherIsBetter);
    if (player === null || value === null) {
      return { value, n, diff: null, diffPct: null, verdict: null, z: null, percentile: refPercentile };
    }
    const diff = player - value;
    const tolerance = 1e-9 * Math.max(1, Math.abs(value));
    const signed = stat.higherIsBetter ? diff : -diff;
    const verdict: Verdict = Math.abs(diff) <= tolerance ? 'igual' : signed > 0 ? 'mejor' : 'peor';
    const spread = sd(groupValues) ?? poolSd;
    return {
      value,
      n,
      diff,
      diffPct: value !== 0 ? (diff / Math.abs(value)) * 100 : null,
      verdict,
      z: spread ? signed / spread : null,
      percentile: refPercentile,
    };
  });
  return { stat, player, percentile, refs, missing: player === null };
}

/** Cuántas estadísticas quedan mejor, peor o igual que una referencia (sin datos aparte). */
export function summarize(
  rows: readonly StatComparison[],
  refIndex: number,
): { better: number; worse: number; equal: number; missing: number } {
  const out = { better: 0, worse: 0, equal: 0, missing: 0 };
  for (const r of rows) {
    const verdict = r.refs[refIndex]?.verdict ?? null;
    if (verdict === 'mejor') out.better += 1;
    else if (verdict === 'peor') out.worse += 1;
    else if (verdict === 'igual') out.equal += 1;
    else out.missing += 1;
  }
  return out;
}

// Minutos, partidos y carga física dicen cuánto juega, no cómo juega: no son fortaleza ni debilidad.
const USAGE_GROUPS = new Set(['Participación', 'Físico y carga']);

/**
 * Las `k` mayores fortalezas y debilidades contra una referencia, por diferencia estandarizada
 * (sin las de uso: minutos, partidos, carga).
 */
export function strengths(
  rows: readonly StatComparison[],
  refIndex: number,
  k: number,
): { best: StatComparison[]; worst: StatComparison[] } {
  const scored = rows.flatMap((r) => {
    const z = r.refs[refIndex]?.z ?? null;
    return z === null || USAGE_GROUPS.has(r.stat.group) ? [] : [{ r, z }];
  });
  return {
    best: scored
      .filter((s) => s.z > 0)
      .sort((a, b) => b.z - a.z)
      .slice(0, k)
      .map((s) => s.r),
    worst: scored
      .filter((s) => s.z < 0)
      .sort((a, b) => a.z - b.z)
      .slice(0, k)
      .map((s) => s.r),
  };
}

export interface Section {
  id: string;
  name: string;
  /** Nombre corto para los ejes del radar. */
  short: string;
  groups: string[];
  goalkeepersOnly?: boolean;
}

// Secciones de 9.7, armadas con los grupos del catálogo de estadísticas.
export const SECTIONS: Section[] = [
  { id: 'participacion', name: 'Participación', short: 'Participación', groups: ['Resumen', 'Participación'] },
  { id: 'ataque', name: 'Ataque', short: 'Ataque', groups: ['Ataque'] },
  { id: 'esperado', name: 'Rendimiento vs esperado', short: 'vs esperado', groups: ['Rendimiento vs esperado'] },
  { id: 'creacion', name: 'Creación y pase', short: 'Creación', groups: ['Creación'] },
  { id: 'defensa', name: 'Defensa', short: 'Defensa', groups: ['Defensa'] },
  { id: 'disciplina', name: 'Disciplina', short: 'Disciplina', groups: ['Disciplina'] },
  { id: 'fisico', name: 'Físico y carga', short: 'Físico', groups: ['Físico y carga'] },
  {
    id: 'impacto',
    name: 'Impacto (NR, EWA, ELA)',
    short: 'Impacto',
    groups: ['Métricas propias', 'Evolución y proyección'],
  },
  { id: 'porteros', name: 'Porteros', short: 'Porteros', groups: ['Porteros'], goalkeepersOnly: true },
];

const SECTION_OF = new Map(SECTIONS.flatMap((s) => s.groups.map((g) => [g, s] as const)));

export function sectionOf(stat: StatDef): Section | undefined {
  return SECTION_OF.get(stat.group);
}

/** Estadísticas numéricas con sección; la de porteros, solo si el principal es arquero. */
export function comparableStats(catalog: readonly StatDef[], goalkeeper: boolean): StatDef[] {
  return catalog.filter((s) => {
    const section = sectionOf(s);
    return s.available && s.rule !== 'perfil' && s.rule !== 'nd' && section && (goalkeeper || !section.goalkeepersOnly);
  });
}

/** Valor por partido (conteos divididos por partidos; cocientes y promedios tal cual). */
export function perMatchValue(row: PlayerRow, stat: StatDef): number | null {
  const raw = numberOf(playerValue(row, stat, false));
  if (raw === null) return null;
  if (!stat.per90) return raw;
  return row.matches > 0 ? raw / row.matches : null;
}

/** Media por partido de una referencia, para la línea partido a partido. */
export function referencePerMatch(members: readonly PlayerRow[], stat: StatDef, mode: AverageMode): number | null {
  const pairs = members.flatMap((p) => {
    const v = perMatchValue(p, stat);
    return v === null ? [] : [[v, p.minutes] as const];
  });
  if (pairs.length === 0) return null;
  const weight = pairs.reduce((a, [, m]) => a + m, 0);
  if (mode === 'ponderado' && weight > 0) return pairs.reduce((a, [v, m]) => a + v * m, 0) / weight;
  return pairs.reduce((a, [v]) => a + v, 0) / pairs.length;
}

/** Mínimo, cuartiles (interpolación lineal) y máximo, para el gráfico de bala. */
export function quartiles(values: readonly number[]): { min: number; q1: number; q3: number; max: number } | null {
  if (values.length === 0) return null;
  const sorted = values.toSorted((a, b) => a - b);
  const at = (q: number) => {
    const pos = (sorted.length - 1) * q;
    const lo = Math.floor(pos);
    const a = sorted[lo] ?? 0;
    const b = sorted[Math.min(lo + 1, sorted.length - 1)] ?? a;
    return a + (b - a) * (pos - lo);
  };
  return { min: sorted[0] ?? 0, q1: at(0.25), q3: at(0.75), max: sorted.at(-1) ?? 0 };
}

export interface WindowMatch {
  matchId: number;
  date: string;
  kickoff: string;
  competitionCode: string;
}

/**
 * Partidos de Boca de cada período, con las mismas reglas que `core.player_master_mv`: los
 * últimos 5 o 10 por fecha y hora, y el último mes medido desde el último partido cargado.
 */
export function periodMatchIds(matches: readonly WindowMatch[], period: Period, competition: string): Set<number> {
  const recent = matches.toSorted((a, b) => b.kickoff.localeCompare(a.kickoff));
  switch (period) {
    case 'temporada':
      return new Set(
        recent.filter((m) => competition === 'todas' || m.competitionCode === competition).map((m) => m.matchId),
      );
    case 'ultimos5':
      return new Set(recent.slice(0, 5).map((m) => m.matchId));
    case 'ultimos10':
      return new Set(recent.slice(0, 10).map((m) => m.matchId));
    case 'ultimo_mes': {
      const last = recent[0]?.date;
      if (!last) return new Set();
      const from = new Date(`${last}T00:00:00Z`);
      from.setUTCDate(from.getUTCDate() - 30);
      const limit = from.toISOString().slice(0, 10);
      return new Set(recent.filter((m) => m.date > limit).map((m) => m.matchId));
    }
  }
}

/** Código de ventana de `api.player_master`: la competición en la temporada, o el período. */
export function windowCode(period: Period, competition: string): string {
  return period === 'temporada' ? competition : period;
}
