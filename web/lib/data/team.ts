import 'server-only';

import { numericStats } from '@/lib/data/catalog';
import type { DataResult } from '@/lib/data/players';
import type { TeamMatchRow } from '@/lib/stats/catalog';
import type { ClubRow } from '@/lib/stats/league';
import { createApiClient } from '@/lib/supabase/server';

function fail(cause: unknown): { ok: false; code: 'PEL-DB-001'; detail: string } {
  return { ok: false, code: 'PEL-DB-001', detail: cause instanceof Error ? cause.message : String(cause) };
}

/** Partidos de Boca con sus valores base y métricas por partido (Interfaz 2), por fecha. */
export async function getTeamMatches(): Promise<DataResult<TeamMatchRow[]>> {
  try {
    const { data, error } = await createApiClient()
      .from('team_match_master')
      .select(
        'match_id, match_date, competition_code, competition_name, opponent, boca_home, goals_for, goals_against, referee, venue, stats',
      )
      .order('kickoff_at')
      .limit(500);
    if (error) return fail(error.message);
    return {
      ok: true,
      data: data.flatMap((r): TeamMatchRow[] =>
        r.match_id === null || r.match_date === null || r.competition_code === null
          ? []
          : [
              {
                matchId: r.match_id,
                date: r.match_date,
                competitionCode: r.competition_code,
                competitionName: r.competition_name ?? r.competition_code,
                opponent: r.opponent ?? 'Rival',
                home: r.boca_home ?? false,
                goalsFor: r.goals_for ?? 0,
                goalsAgainst: r.goals_against ?? 0,
                referee: r.referee,
                venue: r.venue,
                stats: numericStats(r.stats),
              },
            ],
      ),
    };
  } catch (cause) {
    return fail(cause);
  }
}

/** Métricas del equipo que solo existen por ventana: {competición: {stat_id: valor}}. */
export async function getTeamWindowValues(): Promise<DataResult<Record<string, Record<string, number>>>> {
  try {
    const { data, error } = await createApiClient()
      .from('team_window_value')
      .select('competition_code, stat_id, value')
      .limit(2000);
    if (error) return fail(error.message);
    const out: Record<string, Record<string, number>> = {};
    for (const r of data) {
      if (r.competition_code && r.stat_id && r.value !== null) {
        out[r.competition_code] = { ...out[r.competition_code], [r.stat_id]: r.value };
      }
    }
    return { ok: true, data: out };
  } catch (cause) {
    return fail(cause);
  }
}

/** Promedios por partido de los 30 clubes de la liga (StrikerAPI), para comparar a Boca (9.5). */
export async function getLeagueClubs(season = 2026): Promise<DataResult<ClubRow[]>> {
  try {
    const { data, error } = await createApiClient()
      .from('club_season_stat')
      .select('team_name, stat_key, value')
      .eq('season', season)
      .limit(2000);
    if (error) return fail(error.message);
    const byTeam = new Map<string, Record<string, number>>();
    for (const r of data) {
      if (r.team_name && r.stat_key && r.value !== null) {
        byTeam.set(r.team_name, { ...byTeam.get(r.team_name), [r.stat_key]: r.value });
      }
    }
    return { ok: true, data: [...byTeam.entries()].map(([team, stats]) => ({ team, stats })) };
  } catch (cause) {
    return fail(cause);
  }
}
