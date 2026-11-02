import 'server-only';

import { getCatalog } from '@/lib/data/catalog';
import type { DataResult } from '@/lib/data/players';
import { getTeamMatches } from '@/lib/data/team';
import { matchGoals, neighbors, type Goal } from '@/lib/match/match';
import type { StatDef, TeamMatchRow } from '@/lib/stats/catalog';
import { createApiClient } from '@/lib/supabase/server';

const PAGE = 1000;

function fail(cause: unknown): { ok: false; code: 'PEL-DB-001'; detail: string } {
  return { ok: false, code: 'PEL-DB-001', detail: cause instanceof Error ? cause.message : String(cause) };
}

export interface LineupPlayer {
  playerId: number;
  name: string;
  position: string | null;
  shirt: number | null;
  started: boolean;
  minuteIn: number | null;
  minuteOut: number | null;
  /** Claves base del jugador en el partido (goals, passes, rating...). */
  keys: Record<string, number>;
}

export interface MatchShot {
  x: number;
  y: number;
  xg: number;
  goal: boolean;
  boca: boolean;
  minute: number | null;
  player: string | null;
}

export interface MatchPage {
  match: TeamMatchRow;
  round: string | null;
  kickoff: string | null;
  penalties: { for: number; against: number } | null;
  season: TeamMatchRow[];
  teamCatalog: StatDef[];
  playerCatalog: StatDef[];
  lineup: LineupPlayer[];
  goals: Goal[];
  shots: MatchShot[];
  momentum: { minute: number; value: number }[];
  formation: { boca: string | null; rival: string | null } | null;
  absences: { name: string; reason: string | null }[];
  weather: { temperature: number | null; rain: number | null; wind: number | null; place: string | null } | null;
  /** DT de cada equipo y capacidad del estadio (ELNINE). */
  context: { bocaCoach: string | null; rivalCoach: string | null; capacity: number | null } | null;
  situations: { cardId: string; title: string; param: string }[];
  prev: { id: number; label: string } | null;
  next: { id: number; label: string } | null;
}

/** Todo lo de un partido de Boca. null si el partido no existe o no se jugó. */
export async function getMatchPage(matchId: number): Promise<DataResult<MatchPage> | null> {
  try {
    const api = createApiClient();
    const [teams, teamCatalog, playerCatalog, head, lineup, shots, momentum, formation, absences, weather, situ, ctx] =
      await Promise.all([
        getTeamMatches(),
        getCatalog('team'),
        getCatalog('player'),
        api
          .from('team_match_master')
          .select('match_id, round_label, kickoff_at, penalties_for, penalties_against')
          .eq('match_id', matchId)
          .maybeSingle(),
        api
          .from('match_lineup')
          .select('player_id, player_name, position, shirt_number, started, minute_in, minute_out')
          .eq('match_id', matchId),
        api
          .from('boca_shot')
          .select('minute, outcome, player_name, boca_shot, penalty, x, y, xg')
          .eq('match_id', matchId)
          .order('minute'),
        api.from('boca_momentum').select('minute, boca_value').eq('match_id', matchId).order('minute'),
        api.from('boca_formation').select('boca_formation, opponent_formation').eq('match_id', matchId).limit(1),
        api.from('boca_absence').select('player_name, reason, boca_absence').eq('match_id', matchId),
        api
          .from('boca_weather')
          .select('temperature_c, precipitation_mm, wind_kmh, place')
          .eq('match_id', matchId)
          .limit(1),
        api.from('situational_match').select('card_id, param_value').eq('match_id', matchId).limit(500),
        api.from('match_context').select('boca_coach, rival_coach, stadium_capacity').eq('match_id', matchId).limit(1),
      ]);
    if (!teams.ok) return teams;
    if (!teamCatalog.ok) return teamCatalog;
    if (!playerCatalog.ok) return playerCatalog;
    for (const r of [head, lineup, shots, momentum, formation, absences, weather, situ, ctx]) {
      if (r.error) return fail(r.error.message);
    }
    const match = teams.data.find((m) => m.matchId === matchId);
    if (!match || !head.data) return null;

    // Valores base de los jugadores en el partido, de a 1000 filas (el tope de la Data API).
    const keys = new Map<number, Record<string, number>>();
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await api
        .from('player_match_value')
        .select('player_id, key, value')
        .eq('match_id', matchId)
        .order('player_id')
        .order('key')
        .range(from, from + PAGE - 1);
      if (error) return fail(error.message);
      for (const r of data) {
        if (r.player_id === null || r.key === null || r.value === null) continue;
        const own = keys.get(r.player_id) ?? {};
        own[r.key] = r.value;
        keys.set(r.player_id, own);
      }
      if (data.length < PAGE) break;
    }

    // Títulos de las tarjetas de Situaciones donde aparece el partido.
    const cardIds = [...new Set((situ.data ?? []).flatMap((s) => (s.card_id ? [s.card_id] : [])))];
    const titles = cardIds.length
      ? await api.from('situational_catalog').select('card_id, title_es, sort_order').in('card_id', cardIds)
      : null;
    if (titles?.error) return fail(titles.error.message);
    const titleOf = new Map((titles?.data ?? []).map((t) => [t.card_id ?? '', [t.title_es ?? '', t.sort_order ?? 0]]));

    const order = teams.data.map((m, i) => ({ matchId: m.matchId, kickoff: String(i).padStart(4, '0') }));
    const around = neighbors(order, matchId);
    const label = (id: number | null) => {
      const m = teams.data.find((x) => x.matchId === id);
      return m ? { id: m.matchId, label: `${m.home ? 'vs' : 'en'} ${m.opponent}` } : null;
    };
    const f = (formation.data ?? [])[0];
    const w = (weather.data ?? [])[0];
    const c = (ctx.data ?? [])[0];
    const shotRows = shots.data ?? [];

    return {
      ok: true,
      data: {
        match,
        round: head.data.round_label,
        kickoff: head.data.kickoff_at,
        penalties:
          head.data.penalties_for !== null && head.data.penalties_against !== null
            ? { for: head.data.penalties_for, against: head.data.penalties_against }
            : null,
        season: teams.data,
        teamCatalog: teamCatalog.data,
        playerCatalog: playerCatalog.data,
        lineup: (lineup.data ?? []).flatMap((l): LineupPlayer[] =>
          l.player_id === null
            ? []
            : [
                {
                  playerId: l.player_id,
                  name: l.player_name ?? 'Jugador',
                  position: l.position,
                  shirt: l.shirt_number,
                  started: l.started ?? false,
                  minuteIn: l.minute_in,
                  minuteOut: l.minute_out,
                  keys: keys.get(l.player_id) ?? {},
                },
              ],
        ),
        goals: matchGoals(
          shotRows.map((s) => ({
            minute: s.minute,
            outcome: s.outcome,
            playerName: s.player_name,
            boca: s.boca_shot ?? false,
            penalty: s.penalty ?? false,
          })),
        ),
        shots: shotRows.flatMap((s): MatchShot[] =>
          s.x === null || s.y === null
            ? []
            : [
                {
                  x: s.x,
                  y: s.y,
                  xg: s.xg ?? 0,
                  goal: s.outcome === 'goal',
                  boca: s.boca_shot ?? false,
                  minute: s.minute,
                  player: s.player_name,
                },
              ],
        ),
        momentum: (momentum.data ?? []).flatMap((m) =>
          m.minute === null || m.boca_value === null ? [] : [{ minute: m.minute, value: m.boca_value }],
        ),
        formation: f ? { boca: f.boca_formation, rival: f.opponent_formation } : null,
        absences: (absences.data ?? []).flatMap((a) =>
          a.boca_absence && a.player_name ? [{ name: a.player_name, reason: a.reason }] : [],
        ),
        context: c ? { bocaCoach: c.boca_coach, rivalCoach: c.rival_coach, capacity: c.stadium_capacity } : null,
        weather: w
          ? { temperature: w.temperature_c, rain: w.precipitation_mm, wind: w.wind_kmh, place: w.place }
          : null,
        situations: (situ.data ?? [])
          .flatMap((s) =>
            s.card_id && s.param_value
              ? [{ cardId: s.card_id, title: String(titleOf.get(s.card_id)?.[0] ?? s.card_id), param: s.param_value }]
              : [],
          )
          .sort(
            (a, b) =>
              Number(titleOf.get(a.cardId)?.[1] ?? 0) - Number(titleOf.get(b.cardId)?.[1] ?? 0) ||
              a.param.localeCompare(b.param),
          ),
        prev: label(around.prev),
        next: label(around.next),
      },
    };
  } catch (cause) {
    return fail(cause);
  }
}
