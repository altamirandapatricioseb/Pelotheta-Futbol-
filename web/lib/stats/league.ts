// Boca frente a la liga (9.5): filas «Promedio de la liga» y «Boca vs liga (percentil)».
// La fuente (StrikerAPI, `club_season_stat`) da promedios por partido de los 30 clubes de la Liga
// Profesional, salvo vallas invictas, partidos sin marcar y rojas, que vienen como totales y se
// pasan a porcentaje o a promedio con los partidos jugados.

import { rankAndPercentile } from './catalog';

export interface ClubRow {
  team: string;
  stats: Record<string, number>;
}

type Rule = { key: string } | { key: string; perGames: 'pct' | 'avg' };

// Estadística del equipo en el catálogo -> clave de la tabla de la liga.
const LEAGUE_KEYS: Record<string, Rule> = {
  eq_goles_favor: { key: 'goals_for' },
  eq_goles_contra: { key: 'goals_against' },
  eq_remates: { key: 'shots_for' },
  eq_remates_arco: { key: 'shots_on_target_for' },
  eq_remates_contra: { key: 'shots_against' },
  eq_remates_arco_contra: { key: 'shots_on_target_against' },
  eq_xg: { key: 'xg_for' },
  eq_xg_contra: { key: 'xg_against' },
  eq_posesion: { key: 'possession_pct' },
  eq_pases: { key: 'passes' },
  eq_pct_pases: { key: 'pass_accuracy_pct' },
  eq_corners: { key: 'corners' },
  eq_faltas: { key: 'fouls' },
  eq_amarillas: { key: 'yellow_cards' },
  eq_entradas: { key: 'tackles' },
  eq_intercepciones: { key: 'interceptions' },
  eq_pct_vallas: { key: 'clean_sheets', perGames: 'pct' },
  eq_pct_sin_marcar: { key: 'failed_to_score', perGames: 'pct' },
  eq_rojas: { key: 'red_cards_total', perGames: 'avg' },
};

const BOCA = 'boca juniors';

function value(row: ClubRow, rule: Rule): number | null {
  const raw = row.stats[rule.key];
  if (raw === undefined) return null;
  if (!('perGames' in rule)) return raw;
  const games = row.stats.games;
  if (!games) return null;
  return rule.perGames === 'pct' ? (raw / games) * 100 : raw / games;
}

/** Promedio por partido de la liga y percentil de Boca entre los clubes; null si no hay dato. */
export function leagueComparison(
  statId: string,
  higherIsBetter: boolean,
  clubs: readonly ClubRow[],
): { average: number; bocaPercentile: number | null } | null {
  const rule = LEAGUE_KEYS[statId];
  if (!rule) return null;
  const values = clubs.map((c) => value(c, rule)).filter((v): v is number => v !== null);
  if (values.length === 0) return null;
  const boca = clubs.find((c) => c.team.toLocaleLowerCase('es-AR') === BOCA);
  const bocaValue = boca ? value(boca, rule) : null;
  return {
    average: values.reduce((a, b) => a + b, 0) / values.length,
    bocaPercentile: bocaValue === null ? null : rankAndPercentile(values, bocaValue, higherIsBetter).percentile,
  };
}
