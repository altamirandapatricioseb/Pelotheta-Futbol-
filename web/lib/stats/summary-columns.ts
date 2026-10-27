// Columnas del conjunto «Resumen» de la Interfaz 3 (9.1) con su descripción.
// Etapa 2: viven acá. En la etapa 4 pasan a las tablas stat_catalog, stat_set y stat_set_item
// de la base, como pide la sección 9.1, y este archivo se borra.

import type { PlayerSummary } from '@/lib/data/players';

/** Nivel A: viene directo de una fuente. B: se calcula. C: no disponible en fuentes gratuitas. */
export type StatLevel = 'A' | 'B' | 'C';

export interface SummaryColumn {
  key: keyof PlayerSummary | 'rating';
  short: string;
  name: string;
  unit: string;
  description: string;
  formula?: string;
  level: StatLevel;
  /** Si tiene sentido expresarla cada 90 minutos. */
  per90: boolean;
}

const MATCHES: SummaryColumn = {
  key: 'matches',
  short: 'PJ',
  name: 'Partidos jugados',
  unit: 'partidos',
  description: 'Partidos oficiales en los que el jugador estuvo en cancha, como titular o entrando desde el banco.',
  formula: 'Partidos con minuto de entrada registrado',
  level: 'B',
  per90: false,
};

export const SUMMARY_COLUMNS: readonly SummaryColumn[] = [
  MATCHES,
  {
    key: 'starts',
    short: 'Tit.',
    name: 'Titularidades',
    unit: 'partidos',
    description: 'Partidos que empezó desde el arranque.',
    level: 'B',
    per90: false,
  },
  {
    key: 'minutes',
    short: 'Min.',
    name: 'Minutos jugados',
    unit: 'minutos',
    description: 'Minutos en cancha sin contar el descuento: de la entrada a la salida por cambio, expulsión o final.',
    formula: 'Σ (minuto de salida − minuto de entrada)',
    level: 'B',
    per90: false,
  },
  {
    key: 'goals',
    short: 'Goles',
    name: 'Goles',
    unit: 'goles',
    description: 'Goles convertidos, de jugada o de penal. La tanda de penales no cuenta.',
    level: 'B',
    per90: true,
  },
  {
    key: 'assists',
    short: 'Asist.',
    name: 'Asistencias',
    unit: 'asistencias',
    description: 'Último pase antes de un gol de Boca, según el registro de la fuente.',
    level: 'B',
    per90: true,
  },
  {
    key: 'goalContributions',
    short: 'G+A',
    name: 'Goles más asistencias',
    unit: 'participaciones',
    description: 'Participación directa en goles: los que hizo más los que asistió.',
    formula: 'Goles + Asistencias',
    level: 'B',
    per90: true,
  },
  {
    key: 'yellowCards',
    short: 'Amar.',
    name: 'Tarjetas amarillas',
    unit: 'tarjetas',
    description: 'Amonestaciones recibidas. La segunda amarilla de un mismo partido cuenta como expulsión.',
    level: 'B',
    per90: true,
  },
  {
    key: 'redCards',
    short: 'Rojas',
    name: 'Expulsiones',
    unit: 'expulsiones',
    description: 'Rojas directas y dobles amarillas.',
    level: 'B',
    per90: true,
  },
  {
    key: 'rating',
    short: 'Calif.',
    name: 'Calificación media',
    unit: 'puntos',
    description:
      'Nota promedio por partido. Ninguna fuente gratuita que permita uso automatizado la publica para la Liga Profesional 2026.',
    level: 'C',
    per90: false,
  },
];

/** Columna por clave; si la clave no existe, la primera (Partidos jugados). */
export function getColumn(key: string | null | undefined): SummaryColumn {
  return SUMMARY_COLUMNS.find((c) => c.key === key) ?? MATCHES;
}

/** Valor de una columna para un jugador, en totales o cada 90 minutos. null = no disponible. */
export function columnValue(player: PlayerSummary, column: SummaryColumn, per90: boolean): number | null {
  if (column.key === 'rating') return null;
  const raw = player[column.key];
  if (typeof raw !== 'number') return null;
  if (!per90 || !column.per90) return raw;
  return player.minutes > 0 ? (raw * 90) / player.minutes : null;
}

/** Puesto en el plantel (1 = el más alto) y percentil (0 a 100) de un valor. */
export function rankAndPercentile(values: readonly number[], value: number): { rank: number; percentile: number } {
  const higher = values.filter((v) => v > value).length;
  const lower = values.filter((v) => v < value).length;
  const percentile = values.length > 1 ? Math.round((lower / (values.length - 1)) * 100) : 100;
  return { rank: higher + 1, percentile };
}
