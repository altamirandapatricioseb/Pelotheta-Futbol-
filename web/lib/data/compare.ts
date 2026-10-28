import 'server-only';

import { periodMatchIds, type Period, type PlayerPosition, type WindowMatch } from '@/lib/compare/compare';
import type { DataResult } from '@/lib/data/players';
import { createApiClient } from '@/lib/supabase/server';

function fail(cause: unknown): { ok: false; code: 'PEL-DB-001'; detail: string } {
  return { ok: false, code: 'PEL-DB-001', detail: cause instanceof Error ? cause.message : String(cause) };
}

/** Posición más repetida de cada jugador, con su zona, carril y rol según `position_zone_map`. */
export async function getPlayerPositions(): Promise<DataResult<PlayerPosition[]>> {
  try {
    const { data, error } = await createApiClient()
      .from('player_position')
      .select('player_id, position_raw, zone, lane, role, detail_level')
      .limit(500);
    if (error) return fail(error.message);
    return {
      ok: true,
      data: data.flatMap((r): PlayerPosition[] =>
        r.player_id === null || r.position_raw === null
          ? []
          : [
              {
                playerId: r.player_id,
                positionRaw: r.position_raw,
                zone: r.zone,
                lane: r.lane,
                role: r.role,
                level: r.detail_level === 'linea' ? 'linea' : 'posicion',
              },
            ],
      ),
    };
  } catch (cause) {
    return fail(cause);
  }
}

export interface ComparePoint {
  matchId: number;
  date: string;
  opponent: string;
  competition: string;
  value: number | null;
}

/** Valor partido a partido de una estadística del jugador, solo con los partidos del período. */
export async function getCompareSeries(
  statId: string,
  playerId: number,
  period: Period,
  competition: string,
): Promise<DataResult<ComparePoint[]>> {
  try {
    const api = createApiClient();
    const [series, matches] = await Promise.all([
      api
        .rpc('stat_series', { p_stat: statId, p_entity: 'jugador', p_id: playerId })
        .select('match_id, match_date, competition_name, opponent, value'),
      api
        .from('boca_match')
        .select('match_id, match_date, kickoff_at, competition_code')
        .eq('status', 'jugado')
        .limit(500),
    ]);
    if (series.error) return fail(series.error.message);
    if (matches.error) return fail(matches.error.message);
    const played = matches.data.flatMap((m): WindowMatch[] =>
      m.match_id === null || m.match_date === null
        ? []
        : [
            {
              matchId: m.match_id,
              date: m.match_date,
              kickoff: m.kickoff_at ?? m.match_date,
              competitionCode: m.competition_code ?? '',
            },
          ],
    );
    const ids = periodMatchIds(played, period, competition);
    return {
      ok: true,
      data: series.data
        .filter((r) => ids.has(r.match_id))
        .map((r) => ({
          matchId: r.match_id,
          date: r.match_date,
          opponent: r.opponent,
          competition: r.competition_name,
          value: r.value,
        })),
    };
  } catch (cause) {
    return fail(cause);
  }
}
