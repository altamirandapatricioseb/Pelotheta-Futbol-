import 'server-only';

import type { BreakdownPoint } from '@/lib/compare/breakdown';
import type { PlayerPosition } from '@/lib/compare/compare';
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

/**
 * Serie partido a partido de una estadística para uno o dos jugadores (desglose de Comparar), con
 * la titularidad de cada partido y la fecha del último partido cargado de Boca.
 */
export async function getBreakdown(
  statId: string,
  playerIds: readonly number[],
): Promise<DataResult<{ lastDate: string; series: Record<number, BreakdownPoint[]> }>> {
  try {
    const api = createApiClient();
    const [last, lineup, ...series] = await Promise.all([
      api
        .from('boca_match')
        .select('match_date')
        .eq('status', 'jugado')
        .order('match_date', { ascending: false })
        .limit(1),
      api
        .from('match_lineup')
        .select('match_id, player_id, started')
        .in('player_id', [...playerIds])
        .limit(500),
      ...playerIds.map((id) =>
        api
          .rpc('stat_series', { p_stat: statId, p_entity: 'jugador', p_id: id })
          .select(
            'match_id, match_date, competition_code, competition_name, opponent, home, result, minutes, num, den, value',
          ),
      ),
    ]);
    if (last.error) return fail(last.error.message);
    if (lineup.error) return fail(lineup.error.message);
    const started = new Map(
      lineup.data.map((l) => [`${String(l.player_id)}-${String(l.match_id)}`, l.started ?? null]),
    );
    const out: Record<number, BreakdownPoint[]> = {};
    for (const [k, id] of playerIds.entries()) {
      const r = series[k];
      if (!r || r.error) return fail(r?.error.message ?? 'sin serie');
      out[id] = r.data.map((m) => ({
        matchId: m.match_id,
        date: m.match_date,
        competitionCode: m.competition_code,
        competition: m.competition_name,
        opponent: m.opponent,
        home: m.home,
        result: m.result,
        minutes: m.minutes,
        started: started.get(`${String(id)}-${String(m.match_id)}`) ?? null,
        num: m.num,
        den: m.den,
        value: m.value,
      }));
    }
    return { ok: true, data: { lastDate: last.data[0]?.match_date ?? '', series: out } };
  } catch (cause) {
    return fail(cause);
  }
}
