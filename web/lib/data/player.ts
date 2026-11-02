import 'server-only';

import type { PlayerPosition } from '@/lib/compare/compare';
import { getCatalog } from '@/lib/data/catalog';
import { getPlayerPositions } from '@/lib/data/compare';
import { getPlayerMaster, type DataResult } from '@/lib/data/players';
import type { Conclusion } from '@/lib/data/situations';
import { getTeamMatches } from '@/lib/data/team';
import type { PlayerRow, StatDef } from '@/lib/stats/catalog';
import { createApiClient } from '@/lib/supabase/server';

function fail(cause: unknown): { ok: false; code: 'PEL-DB-001'; detail: string } {
  return { ok: false, code: 'PEL-DB-001', detail: cause instanceof Error ? cause.message : String(cause) };
}

export interface PlayerMatch {
  matchId: number;
  date: string;
  opponent: string;
  competition: string;
  home: boolean;
  goalsFor: number;
  goalsAgainst: number;
  started: boolean | null;
  minuteIn: number | null;
  minuteOut: number | null;
  minutes: number | null;
  rating: number | null;
  goals: number | null;
  assists: number | null;
}

export interface PlayerDetail {
  player: PlayerRow;
  /** Todo el plantel (temporada, todas las competiciones), para percentiles y puestos. */
  squad: PlayerRow[];
  positions: PlayerPosition[];
  catalog: StatDef[];
  conclusions: Conclusion[];
  matches: PlayerMatch[];
}

const SERIES = ['calificacion', 'goles', 'asistencias'] as const;

/** Todo lo de un jugador: ficha, estadísticas, conclusiones y partidos. null si no jugó. */
export async function getPlayerDetail(playerId: number): Promise<DataResult<PlayerDetail> | null> {
  try {
    const api = createApiClient();
    const [squad, catalog, positions, team, concl, lineup, ...series] = await Promise.all([
      getPlayerMaster('todas'),
      getCatalog('player'),
      getPlayerPositions(),
      getTeamMatches(),
      api
        .from('conclusion')
        .select(
          'rule_id, entity_id, player_name, player_position, area, title_es, kind, scope, unit, link, sort_order, band, value, reference, percentile, n, tone, text_es',
        )
        .eq('entity_id', playerId)
        .neq('text_es', '')
        .order('sort_order'),
      api.from('match_lineup').select('match_id, started, minute_in, minute_out').eq('player_id', playerId).limit(200),
      ...SERIES.map((s) =>
        api.rpc('stat_series', { p_stat: s, p_entity: 'jugador', p_id: playerId }).select('match_id, minutes, value'),
      ),
    ]);
    if (!squad.ok) return squad;
    if (!catalog.ok) return catalog;
    if (!positions.ok) return positions;
    if (!team.ok) return team;
    if (concl.error) return fail(concl.error.message);
    if (lineup.error) return fail(lineup.error.message);
    const player = squad.data.find((p) => p.playerId === playerId);
    if (!player) return null;

    const byMatch = new Map<number, { minutes: number | null; values: (number | null)[] }>();
    for (const [k, r] of series.entries()) {
      if (r.error) return fail(r.error.message);
      for (const m of r.data) {
        const entry = byMatch.get(m.match_id) ?? { minutes: m.minutes, values: SERIES.map(() => null) };
        entry.values[k] = m.value;
        byMatch.set(m.match_id, entry);
      }
    }
    const lineups = new Map(lineup.data.map((l) => [l.match_id, l]));
    const matches = team.data
      .filter((m) => byMatch.has(m.matchId) || lineups.has(m.matchId))
      .map((m): PlayerMatch => {
        const l = lineups.get(m.matchId);
        const s = byMatch.get(m.matchId);
        return {
          matchId: m.matchId,
          date: m.date,
          opponent: m.opponent,
          competition: m.competitionName,
          home: m.home,
          goalsFor: m.goalsFor,
          goalsAgainst: m.goalsAgainst,
          started: l?.started ?? null,
          minuteIn: l?.minute_in ?? null,
          minuteOut: l?.minute_out ?? null,
          minutes: s?.minutes ?? null,
          rating: s?.values[0] ?? null,
          goals: s?.values[1] ?? null,
          assists: s?.values[2] ?? null,
        };
      })
      .reverse();

    return {
      ok: true,
      data: {
        player,
        squad: squad.data,
        positions: positions.data,
        catalog: catalog.data,
        conclusions: concl.data.flatMap((c): Conclusion[] =>
          c.rule_id &&
          c.text_es &&
          (c.tone === 'positivo' || c.tone === 'negativo' || c.tone === 'neutral') &&
          c.value !== null
            ? [
                {
                  id: c.rule_id,
                  entityId: c.entity_id ?? 0,
                  playerName: c.player_name,
                  playerPosition: c.player_position,
                  area: c.area ?? '',
                  title: c.title_es ?? '',
                  kind: c.kind ?? '',
                  scope: c.scope ?? '',
                  unit: c.unit ?? '',
                  link: c.link ?? '',
                  band: c.band ?? '',
                  tone: c.tone,
                  text: c.text_es,
                  value: c.value,
                  reference: c.reference,
                  percentile: c.percentile,
                  n: c.n ?? 0,
                },
              ]
            : [],
        ),
        matches,
      },
    };
  } catch (cause) {
    return fail(cause);
  }
}
