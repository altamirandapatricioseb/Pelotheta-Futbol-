// Página de partido: goles, vecinos y estadísticas del partido contra el promedio de la temporada.
// Usa las mismas reglas del catálogo que la Interfaz 2 (`aggregateTeam`): suma, promedio y
// compuestos con suma sobre suma; para un jugador, sus claves base del partido.

import { aggregateTeam, type StatDef, type TeamMatchRow } from '@/lib/stats/catalog';

export interface ShotEvent {
  minute: number | null;
  outcome: string | null;
  playerName: string | null;
  boca: boolean;
  penalty: boolean;
}

export interface Goal {
  minute: number | null;
  player: string;
  boca: boolean;
  penalty: boolean;
}

/** Goles a partir de los remates (los en contra sin nombre quedan como «Rival»). */
export function matchGoals(shots: readonly ShotEvent[]): Goal[] {
  return shots
    .filter((s) => s.outcome === 'goal')
    .map((s) => ({
      minute: s.minute,
      player: s.playerName ?? (s.boca ? 'Boca' : 'Rival'),
      boca: s.boca,
      penalty: s.penalty,
    }))
    .sort((a, b) => (a.minute ?? 0) - (b.minute ?? 0));
}

/** Partido anterior y siguiente de Boca por fecha y hora. */
export function neighbors(
  matches: readonly { matchId: number; kickoff: string }[],
  matchId: number,
): { prev: number | null; next: number | null } {
  const sorted = matches.toSorted((a, b) => a.kickoff.localeCompare(b.kickoff));
  const i = sorted.findIndex((m) => m.matchId === matchId);
  if (i < 0) return { prev: null, next: null };
  return { prev: sorted[i - 1]?.matchId ?? null, next: sorted[i + 1]?.matchId ?? null };
}

export interface TeamStatLine {
  stat: StatDef;
  value: number | null;
  /** Promedio por partido de la temporada (los porcentajes, suma sobre suma). */
  season: number | null;
  verdict: 'mejor' | 'peor' | 'igual' | null;
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

export function teamVsSeason(
  match: TeamMatchRow,
  all: readonly TeamMatchRow[],
  stats: readonly StatDef[],
  byId: ReadonlyMap<string, StatDef>,
): TeamStatLine[] {
  return stats.map((stat) => {
    const value = num(aggregateTeam([match], stat, byId));
    const season = num(aggregateTeam(all, stat, byId, { perMatch: true }));
    if (value === null || season === null) return { stat, value, season, verdict: null };
    const diff = value - season;
    const verdict =
      Math.abs(diff) <= 1e-9 * Math.max(1, Math.abs(season))
        ? 'igual'
        : (stat.higherIsBetter ? diff > 0 : diff < 0)
          ? 'mejor'
          : 'peor';
    return { stat, value, season, verdict };
  });
}

/** Valor de una estadística del jugador en un partido, con sus claves base. null = n/d. */
export function playerMatchValue(
  keys: Readonly<Record<string, number>>,
  stat: StatDef,
  byId: ReadonlyMap<string, StatDef>,
): number | null {
  const row: TeamMatchRow = {
    matchId: 0,
    date: '',
    competitionCode: '',
    competitionName: '',
    opponent: '',
    home: false,
    goalsFor: 0,
    goalsAgainst: 0,
    referee: null,
    venue: null,
    stats: { ...keys },
  };
  return num(aggregateTeam([row], stat, byId));
}
