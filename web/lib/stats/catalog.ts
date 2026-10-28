// Reglas del catálogo de estadísticas en la web (secciones 5, 9.1 y 9.5).
//
// Los jugadores llegan ya calculados desde la vista materializada `api.player_master`: acá solo
// se elige el valor y se pasa a 90 minutos. El equipo llega por partido (`api.team_match_master`)
// y se agrupa en el navegador por rival, mes, competición o acumulado con las mismas reglas que
// usa SQL para los jugadores: suma, promedio y compuestos con «suma sobre suma» solo en los
// partidos que tienen los dos datos.

import { NOT_AVAILABLE } from '@/lib/format';

export type StatLevel = 'A' | 'B' | 'C';
export type StatRule =
  'suma' | 'promedio' | 'cociente' | 'diferencia' | 'adicion' | 'perfil' | 'metrica' | 'especial' | 'nd';

export interface StatDef {
  id: string;
  entity: 'player' | 'team';
  name: string;
  short: string;
  description: string;
  group: string;
  category: string;
  unit: string;
  source: string;
  level: StatLevel;
  formula: string;
  higherIsBetter: boolean;
  available: boolean;
  estimated: boolean;
  /** Jugadores: se puede ver cada 90 minutos. Equipo: se puede ver como promedio por partido. */
  per90: boolean;
  rule: StatRule;
  arg1: string;
  arg2: string;
  factor: number;
}

export interface StatSet {
  id: string;
  entity: 'player' | 'team';
  name: string;
  description: string;
  statIds: string[];
}

export interface PlayerRow {
  playerId: number;
  name: string;
  shortName: string | null;
  position: string | null;
  shirtNumber: number | null;
  age: number | null;
  heightCm: number | null;
  weightKg: number | null;
  foot: string | null;
  nationality: string | null;
  matches: number;
  minutes: number;
  stats: Record<string, number>;
}

export interface TeamMatchRow {
  matchId: number;
  date: string;
  competitionCode: string;
  competitionName: string;
  opponent: string;
  home: boolean;
  goalsFor: number;
  goalsAgainst: number;
  referee: string | null;
  venue: string | null;
  stats: Record<string, number>;
}

export type StatValue = number | string | null;

const FOOT: Record<string, string> = { R: 'Derecho', L: 'Izquierdo', B: 'Ambos' };

function profileValue(row: PlayerRow, field: string): StatValue {
  switch (field) {
    case 'edad':
      return row.age;
    case 'altura':
      return row.heightCm;
    case 'peso':
      return row.weightKg;
    case 'pie':
      return row.foot ? (FOOT[row.foot] ?? row.foot) : null;
    case 'nacionalidad':
      return row.nationality;
    case 'posicion':
      return row.position;
    default:
      return null;
  }
}

/** Valor de una estadística para un jugador, en totales o cada 90 minutos. null = n/d. */
export function playerValue(row: PlayerRow, stat: StatDef, per90: boolean): StatValue {
  if (stat.rule === 'nd') return null;
  if (stat.rule === 'perfil') return profileValue(row, stat.arg1);
  const raw = row.stats[stat.id];
  if (raw === undefined) return null;
  if (!per90 || !stat.per90) return raw;
  return row.minutes > 0 ? (raw * 90) / row.minutes : null;
}

function present(rows: readonly TeamMatchRow[], key: string): number[] {
  return rows.flatMap((r) => {
    const v = r.stats[key];
    return v === undefined ? [] : [v];
  });
}

const sum = (values: readonly number[]) => values.reduce((a, b) => a + b, 0);

interface AggregateOptions {
  /** Promedio por partido en vez de total (solo para las que lo admiten). */
  perMatch?: boolean;
  /** Valor ya calculado para la ventana (competición o todas), para las métricas de ventana. */
  windowValue?: number | null;
}

/** Valor de una estadística del equipo para un grupo de partidos. null = n/d. */
export function aggregateTeam(
  rows: readonly TeamMatchRow[],
  stat: StatDef,
  byId: ReadonlyMap<string, StatDef>,
  options: AggregateOptions = {},
): StatValue {
  const perMatch = options.perMatch === true && stat.per90;
  switch (stat.rule) {
    case 'nd':
      return null;
    case 'perfil': {
      // Árbitro y estadio son datos de un partido: en un grupo de partidos no tienen un valor.
      const only = rows.length === 1 ? rows[0] : undefined;
      if (!only) return null;
      return stat.arg1 === 'arbitro' ? only.referee : stat.arg1 === 'estadio' ? only.venue : null;
    }
    case 'metrica':
    case 'especial': {
      if (stat.arg2 === 'ventana') return options.windowValue ?? null;
      const values = present(rows, stat.id);
      if (values.length === 0) return null;
      return stat.arg2 === 'suma' && !perMatch ? sum(values) : sum(values) / values.length;
    }
    case 'suma':
    case 'promedio': {
      const values = present(rows, stat.arg1);
      if (values.length === 0) return null;
      return stat.rule === 'suma' && !perMatch ? sum(values) : sum(values) / values.length;
    }
    case 'cociente':
    case 'diferencia':
    case 'adicion': {
      const a = byId.get(stat.arg1)?.arg1;
      const b = byId.get(stat.arg2)?.arg1;
      if (!a || !b) return null;
      // Suma sobre suma, solo con los partidos que tienen los dos datos.
      const both = rows.filter((r) => r.stats[a] !== undefined && r.stats[b] !== undefined);
      if (both.length === 0) return null;
      const s1 = sum(both.map((r) => r.stats[a] ?? 0));
      const s2 = sum(both.map((r) => r.stats[b] ?? 0));
      if (stat.rule === 'cociente') return s2 !== 0 ? (s1 / s2) * stat.factor : null;
      const total = stat.rule === 'diferencia' ? s1 - s2 : s1 + s2;
      return perMatch ? total / both.length : total;
    }
  }
}

const formatters = {
  0: new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 }),
  1: new Intl.NumberFormat('es-AR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }),
  2: new Intl.NumberFormat('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
} as const;

/** Texto de una celda: porcentajes con un decimal, conteos enteros, el resto con dos decimales. */
export function formatStat(value: StatValue, stat: StatDef, per90: boolean): string {
  if (value === null || (typeof value === 'number' && Number.isNaN(value))) return NOT_AVAILABLE;
  if (typeof value === 'string') return value;
  if (stat.unit === '%') return `${formatters[1].format(value)} %`;
  if (per90 && stat.per90) return formatters[2].format(value);
  if (Number.isInteger(value)) return formatters[0].format(value);
  if (stat.unit === 'minutos' || stat.unit === 'metros') return formatters[0].format(value);
  return formatters[2].format(value);
}

/**
 * Puesto (1 = el mejor) y percentil (0 a 100) de un valor en un grupo. Si más bajo es mejor
 * (`higher_is_better = false`), el orden se invierte: el que menos tiene es el primero.
 */
export function rankAndPercentile(
  values: readonly number[],
  value: number,
  higherIsBetter: boolean,
): { rank: number; percentile: number } {
  const better = values.filter((v) => (higherIsBetter ? v > value : v < value)).length;
  const worse = values.filter((v) => (higherIsBetter ? v < value : v > value)).length;
  const percentile = values.length > 1 ? Math.round((worse / (values.length - 1)) * 100) : 100;
  return { rank: better + 1, percentile };
}
