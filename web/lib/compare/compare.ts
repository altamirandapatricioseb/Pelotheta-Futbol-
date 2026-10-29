// Interfaz 5 (9.7): comparación de un jugador contra referencias.
//
// Se compara un jugador con UNA de estas opciones: la media del equipo, la media de una línea
// (arqueros, defensores, mediocampistas o delanteros), la media de su posición específica u otro
// jugador; con otro jugador se pueden sumar medias. Reglas: el jugador principal nunca entra en
// una media; cada estadística respeta su sentido (`higher_is_better`): «mejor» no es «más alto».
// La línea y la posición salen de `api.player_position` (mapeo en la tabla `position_zone_map`).

import type { Slot } from '@/components/charts/primitives';
import { playerValue, rankAndPercentile, type PlayerRow, type StatDef } from '@/lib/stats/catalog';

export type Line = 'arquero' | 'defensor' | 'mediocampista' | 'delantero';
export const LINES: { id: Line; plural: string; token: string }[] = [
  { id: 'arquero', plural: 'Arqueros', token: 'arqueros' },
  { id: 'defensor', plural: 'Defensores', token: 'defensores' },
  { id: 'mediocampista', plural: 'Mediocampistas', token: 'mediocampistas' },
  { id: 'delantero', plural: 'Delanteros', token: 'delanteros' },
];

export type RefKind = 'equipo' | 'linea' | 'posicion' | 'jugador';
export interface RefSpec {
  kind: RefKind;
  line?: Line;
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

export interface PlayerPosition {
  playerId: number;
  positionRaw: string;
  zone: string | null;
  lane: string | null;
  role: string | null;
  /** 'linea': la fuente solo da la línea general y la posición coincide con la línea. */
  level: 'posicion' | 'linea';
}

/** Las medias, en el orden fijo en que se muestran: equipo, posición y las cuatro líneas. */
export const MEDIAS: RefSpec[] = [
  { kind: 'equipo' },
  { kind: 'posicion' },
  ...LINES.map((l): RefSpec => ({ kind: 'linea', line: l.id })),
];

export const sameRef = (a: RefSpec, b: RefSpec) => a.kind === b.kind && a.line === b.line && a.playerId === b.playerId;

function token(r: RefSpec): string {
  if (r.kind === 'jugador') return `jugador-${String(r.playerId)}`;
  if (r.kind === 'linea') return LINES.find((l) => l.id === r.line)?.token ?? 'equipo';
  return r.kind;
}

function fromToken(part: string): RefSpec | null {
  const player = /^jugador-(\d{1,9})$/.exec(part);
  if (player) return { kind: 'jugador', playerId: Number(player[1]) };
  if (part === 'equipo' || part === 'posicion') return { kind: part };
  const line = LINES.find((l) => l.token === part);
  return line ? { kind: 'linea', line: line.id } : null;
}

/** Ordena: primero el otro jugador, después las medias en su orden fijo. */
function canonical(refs: readonly RefSpec[]): RefSpec[] {
  const rank = (r: RefSpec) => (r.kind === 'jugador' ? -1 : MEDIAS.findIndex((m) => sameRef(m, r)));
  return refs.toSorted((a, b) => rank(a) - rank(b));
}

/**
 * Referencias de la URL («jugador-22,equipo,defensores»). Sin otro jugador, una sola media; con
 * otro jugador, él más las medias que se tilden. Vacío = todavía no se eligió con qué comparar.
 */
export function parseRefs(raw: string | undefined): RefSpec[] {
  const out: RefSpec[] = [];
  for (const part of (raw ?? '').split(',')) {
    const spec = fromToken(part);
    if (!spec || out.some((r) => sameRef(r, spec))) continue;
    if (spec.kind === 'jugador' && out.some((r) => r.kind === 'jugador')) continue;
    out.push(spec);
  }
  const sorted = canonical(out);
  return sorted.some((r) => r.kind === 'jugador') ? sorted : sorted.slice(0, 1);
}

export function refsToParam(refs: readonly RefSpec[]): string {
  return canonical(refs).map(token).join(',');
}

/** Color fijo de cada referencia: el otro jugador rojo, el equipo azul y así (el principal es verde). */
export function refSlot(r: RefSpec): Slot {
  if (r.kind === 'jugador') return 2;
  if (r.kind === 'equipo') return 3;
  if (r.kind === 'posicion') return 4;
  return (5 + LINES.findIndex((l) => l.id === r.line)) as Slot;
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

const lineKey = (row: PlayerRow, position: PlayerPosition | undefined): Line | null =>
  (lineOf(row, position)?.toLocaleLowerCase('es-AR') as Line | undefined) ?? null;

export function isGoalkeeper(row: PlayerRow, position: PlayerPosition | undefined): boolean {
  return position?.zone === 'Arco' || row.position === 'Arquero';
}

/**
 * Grupo de los percentiles: los del mismo tipo (arqueros o de campo), sin el jugador principal y
 * con al menos `minMinutes` minutos.
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

/**
 * Jugadores que forman una referencia, sin el principal y con el mínimo de minutos. El equipo son
 * los jugadores de campo (los arqueros tienen su propia media). Un jugador elegido a mano puede
 * ser de cualquier línea: compararlo con otra es decisión del usuario.
 */
export function referenceMembers(
  spec: RefSpec,
  main: PlayerRow,
  players: readonly PlayerRow[],
  positions: ReadonlyMap<number, PlayerPosition>,
  minMinutes: number,
): PlayerRow[] {
  if (spec.kind === 'jugador') {
    const other = players.find((p) => p.playerId === spec.playerId);
    return other && other.playerId !== main.playerId ? [other] : [];
  }
  const mine = positions.get(main.playerId);
  const base = players.filter((p) => p.playerId !== main.playerId && p.minutes >= minMinutes);
  switch (spec.kind) {
    case 'equipo':
      return base.filter((p) => !isGoalkeeper(p, positions.get(p.playerId)));
    case 'linea':
      return base.filter((p) => lineKey(p, positions.get(p.playerId)) === spec.line);
    case 'posicion':
      return mine?.role ? base.filter((p) => positions.get(p.playerId)?.role === mine.role) : [];
  }
}

/** Por qué una referencia no se puede usar con este jugador (null si se puede). */
export function refProblem(
  spec: RefSpec,
  main: PlayerRow,
  positions: ReadonlyMap<number, PlayerPosition>,
  players: readonly PlayerRow[],
): string | null {
  if (spec.kind === 'posicion') return positions.get(main.playerId)?.role ? null : 'su posición no está informada';
  if (spec.kind !== 'jugador') return null;
  const other = players.find((p) => p.playerId === spec.playerId);
  if (!other) return 'el otro jugador no jugó en este período';
  return other.playerId === main.playerId ? 'es el mismo jugador' : null;
}

/** Nombre largo (tarjetas) y corto (leyendas) de una referencia. */
export function referenceLabel(
  spec: RefSpec,
  mine: PlayerPosition | undefined,
  players: readonly PlayerRow[],
): { long: string; short: string } {
  switch (spec.kind) {
    case 'equipo':
      return { long: 'Media del equipo (sin arqueros)', short: 'Equipo' };
    case 'linea': {
      const plural = LINES.find((l) => l.id === spec.line)?.plural ?? 'Línea';
      return { long: `Media de ${plural.toLocaleLowerCase('es-AR')}`, short: plural };
    }
    case 'posicion':
      return { long: `Media de la posición (${mine?.role ?? 'n/d'})`, short: mine?.role ?? 'Posición' };
    case 'jugador': {
      const other = players.find((p) => p.playerId === spec.playerId);
      return { long: other?.name ?? 'Jugador', short: other?.shortName ?? other?.name ?? 'Jugador' };
    }
  }
}

/** Texto para buscar sin tildes ni mayúsculas («Énner» se encuentra con «enner»). */
export function searchable(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLocaleLowerCase('es-AR').trim();
}

/** Jugadores agrupados por línea (arqueros, defensores, mediocampistas, delanteros), por minutos. */
export function playersByLine(
  players: readonly PlayerRow[],
  positions: ReadonlyMap<number, PlayerPosition>,
  query = '',
): { line: string; players: PlayerRow[] }[] {
  const q = searchable(query);
  const match = (p: PlayerRow) =>
    !q || searchable(p.name).includes(q) || (p.shortName ? searchable(p.shortName).includes(q) : false);
  const groups = [...LINES.map((l) => ({ line: l.plural, id: l.id })), { line: 'Sin posición', id: '' }];
  return groups.flatMap((g) => {
    const list = players
      .filter((p) => (lineKey(p, positions.get(p.playerId)) ?? '') === g.id && match(p))
      .toSorted((a, b) => b.minutes - a.minutes);
    return list.length ? [{ line: g.line, players: list }] : [];
  });
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

/**
 * Estadísticas numéricas con sección. Por defecto, solo las de las líneas que se comparan (según
 * la columna `lineas` del catálogo); con `all`, todas (la de porteros, solo si hay un arquero).
 */
export function comparableStats(catalog: readonly StatDef[], lines: ReadonlySet<string>, all = false): StatDef[] {
  return catalog.filter((s) => {
    const section = sectionOf(s);
    if (!s.available || s.rule === 'perfil' || s.rule === 'nd' || !section) return false;
    if (section.goalkeepersOnly && !lines.has('arquero')) return false;
    return all || s.lines.includes('todas') || s.lines.some((l) => lines.has(l));
  });
}

/**
 * Líneas que se comparan: la del principal, la del otro jugador y la de cada media de línea (las
 * medias del equipo y de la posición no suman línea), en minúscula como en el catálogo.
 */
export function comparedLines(
  main: PlayerRow,
  refs: readonly RefSpec[],
  positions: ReadonlyMap<number, PlayerPosition>,
  players: readonly PlayerRow[],
): Set<string> {
  const out = new Set<string>();
  const add = (row: PlayerRow | undefined) => {
    const line = row ? lineOf(row, positions.get(row.playerId)) : null;
    if (line) out.add(line.toLocaleLowerCase('es-AR'));
  };
  add(main);
  for (const r of refs) {
    if (r.kind === 'jugador') add(players.find((p) => p.playerId === r.playerId));
    if (r.kind === 'linea' && r.line) out.add(r.line);
  }
  return out;
}

// Orden de las secciones según la línea del principal: primero lo propio del puesto.
const SECTION_ORDER: Record<string, string[]> = {
  arquero: [
    'porteros',
    'participacion',
    'creacion',
    'impacto',
    'disciplina',
    'defensa',
    'fisico',
    'ataque',
    'esperado',
  ],
  defensor: [
    'defensa',
    'creacion',
    'participacion',
    'impacto',
    'disciplina',
    'ataque',
    'esperado',
    'fisico',
    'porteros',
  ],
  mediocampista: [
    'creacion',
    'defensa',
    'ataque',
    'participacion',
    'impacto',
    'esperado',
    'disciplina',
    'fisico',
    'porteros',
  ],
  delantero: [
    'ataque',
    'esperado',
    'creacion',
    'participacion',
    'impacto',
    'defensa',
    'disciplina',
    'fisico',
    'porteros',
  ],
};

/** Secciones en el orden de la línea del jugador principal. */
export function sectionsFor(line: string | null): Section[] {
  const order = SECTION_ORDER[line ?? ''];
  if (!order) return [...SECTIONS];
  return order.flatMap((id) => SECTIONS.filter((s) => s.id === id));
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
