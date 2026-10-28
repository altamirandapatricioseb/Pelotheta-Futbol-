import 'server-only';

import { getCatalog } from '@/lib/data/catalog';
import { getFreshness } from '@/lib/data/freshness';
import { getPlayerMaster } from '@/lib/data/players';
import { getLeagueClubs, getTeamMatches, getTeamWindowValues } from '@/lib/data/team';
import type { PlayerRow, StatDef, TeamMatchRow } from '@/lib/stats/catalog';
import type { ClubRow } from '@/lib/stats/league';
import { createApiClient } from '@/lib/supabase/server';

export interface Shot {
  matchId: number;
  boca: boolean;
  player: string | null;
  minute: number | null;
  outcome: string;
  bodyPart: string | null;
  zone: string | null;
  xg: number;
  x: number;
  y: number;
}

export interface LandingData {
  matches: TeamMatchRow[];
  players: PlayerRow[];
  playerCatalog: StatDef[];
  teamCatalog: StatDef[];
  windowValues: Record<string, Record<string, number>>;
  clubs: ClubRow[];
  shots: Shot[];
  formations: Record<number, { boca: string | null; rival: string | null }>;
  momentum: { minute: number; value: number }[];
  /** Valores por partido de cada jugador: {jugador: {partido: {clave: valor}}}. */
  playerMatches: Record<number, Record<number, Record<string, number>>>;
  leaders: { name: string; team: string; value: number }[];
  referees: { name: string; games: number; yellow: number; red: number; fouls: number }[];
  previousSeason: { date: string; points: number }[];
  /** Puntos por partido promedio de la Tabla Anual de la liga. */
  leaguePpg: number | null;
  /** Parámetros vigentes de los modelos propios (`api.projection_param`). */
  params: Record<string, number>;
  /** Filas de algunas tarjetas de Situaciones (gráficos 14 y 66): {tarjeta: filas}. */
  situations: Record<
    string,
    { param: string; order: number; n: number; w: number; d: number; l: number; ppg: number }[]
  >;
  /** Mejoría α y β de cada jugador partido a partido (gráfico 80): {jugador: {partido: {métrica: valor}}}. */
  metricSeries: Record<number, Record<number, Record<string, number>>>;
  updated: string | null;
}

const PAGE = 1000;

/** Todas las filas de una consulta, de a 1000 (el tope de la Data API). */
async function all<T>(query: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>) {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await query(from, from + PAGE - 1);
    if (error || !data) break;
    rows.push(...data);
    if (data.length < PAGE) break;
  }
  return rows;
}

/** Todo lo que necesita la landing en una sola carga (con la caché de datos de 6 horas). */
export async function getLandingData(): Promise<LandingData | null> {
  const api = createApiClient();
  const [matches, players, playerCatalog, teamCatalog, windowValues, clubs, freshness] = await Promise.all([
    getTeamMatches(),
    getPlayerMaster('todas'),
    getCatalog('player'),
    getCatalog('team'),
    getTeamWindowValues(),
    getLeagueClubs(),
    getFreshness(),
  ]);
  if (!matches.ok || !players.ok || !playerCatalog.ok || !teamCatalog.ok) return null;

  const [shots, formations, momentum, series, leaders, referees, previous, table, params, situ, metric] =
    await Promise.all([
      api
        .from('boca_shot')
        .select('match_id, boca_shot, player_name, minute, outcome, body_part, zone, xg, x, y')
        .limit(2000),
      api.from('boca_formation').select('match_id, boca_formation, opponent_formation').limit(500),
      all((a, b) =>
        api.from('boca_momentum').select('match_id, minute, boca_value').order('match_id').order('minute').range(a, b),
      ),
      all((a, b) =>
        api
          .from('player_match_value')
          .select('player_id, match_id, key, value')
          .in('key', ['minutes', 'starts', 'rating', 'goals', 'assists'])
          .order('match_id')
          .order('player_id')
          .order('key')
          .range(a, b),
      ),
      api
        .from('league_leader')
        .select('player_name, team_name, value, rank')
        .eq('season', 2026)
        .eq('stat', 'goals')
        .order('rank')
        .limit(15),
      api
        .from('referee_stats')
        .select('referee, games, yellow_per_game, red_per_game, fouls_per_game')
        .eq('season', 2026)
        .gte('games', 5)
        .limit(100),
      api
        .from('league_result')
        .select('match_date, home_team, away_team, home_goals, away_goals, source')
        .eq('season', 2025)
        .or('home_team.eq.Boca Juniors,away_team.eq.Boca Juniors')
        .order('match_date')
        .limit(100),
      api
        .from('league_standing')
        .select('table_name, played, points')
        .eq('season', 2026)
        .like('table_name', 'Tabla Anual%')
        .limit(60),
      api.from('projection_param').select('param, value').limit(100),
      api
        .from('situational_result')
        .select('card_id, param_value, param_order, n, w, d, l, ppg')
        .in('card_id', ['s132', 's006', 's007', 's008', 's009', 's010', 's011'])
        .limit(100),
      all((a, b) =>
        api
          .from('stat_match_value')
          .select('entity_id, match_id, stat_id, value')
          .eq('entity', 'player')
          .in('stat_id', ['mejoria_alpha', 'mejoria_beta'])
          .order('entity_id')
          .order('match_id')
          .order('stat_id')
          .range(a, b),
      ),
    ]);

  const momentumByMinute = new Map<number, number[]>();
  for (const r of momentum) {
    if (r.minute !== null && r.boca_value !== null) {
      momentumByMinute.set(r.minute, [...(momentumByMinute.get(r.minute) ?? []), r.boca_value]);
    }
  }
  const playerMatches: LandingData['playerMatches'] = {};
  for (const r of series) {
    if (r.player_id === null || r.match_id === null || r.key === null || r.value === null) continue;
    const byMatch = (playerMatches[r.player_id] ??= {});
    (byMatch[r.match_id] ??= {})[r.key] = r.value;
  }
  // Temporada anterior (liga 2025): un partido por fecha aunque lo traigan dos fuentes.
  const seen = new Set<string>();
  const previousSeason = (previous.data ?? []).flatMap((r) => {
    if (!r.match_date || r.home_goals === null || r.away_goals === null || seen.has(r.match_date)) return [];
    seen.add(r.match_date);
    const home = r.home_team === 'Boca Juniors';
    const gf = home ? r.home_goals : r.away_goals;
    const ga = home ? r.away_goals : r.home_goals;
    return [{ date: r.match_date, points: gf > ga ? 3 : gf === ga ? 1 : 0 }];
  });

  return {
    matches: matches.data,
    players: players.data,
    playerCatalog: playerCatalog.data,
    teamCatalog: teamCatalog.data,
    windowValues: windowValues.ok ? windowValues.data : {},
    clubs: clubs.ok ? clubs.data : [],
    shots: (shots.data ?? []).flatMap((s) =>
      s.match_id === null || s.x === null || s.y === null || s.xg === null
        ? []
        : [
            {
              matchId: s.match_id,
              boca: s.boca_shot ?? false,
              player: s.player_name,
              minute: s.minute,
              outcome: s.outcome ?? '',
              bodyPart: s.body_part,
              zone: s.zone,
              xg: s.xg,
              x: s.x,
              y: s.y,
            },
          ],
    ),
    formations: Object.fromEntries(
      (formations.data ?? []).flatMap((f) =>
        f.match_id === null ? [] : [[f.match_id, { boca: f.boca_formation, rival: f.opponent_formation }]],
      ),
    ),
    momentum: [...momentumByMinute.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([minute, values]) => ({ minute, value: values.reduce((a, b) => a + b, 0) / values.length })),
    playerMatches,
    leaders: (leaders.data ?? []).flatMap((l) =>
      l.player_name && l.value !== null ? [{ name: l.player_name, team: l.team_name ?? '', value: l.value }] : [],
    ),
    referees: (referees.data ?? []).flatMap((r) =>
      r.referee && r.games !== null
        ? [
            {
              name: r.referee,
              games: r.games,
              yellow: r.yellow_per_game ?? 0,
              red: r.red_per_game ?? 0,
              fouls: r.fouls_per_game ?? 0,
            },
          ]
        : [],
    ),
    previousSeason,
    leaguePpg: (() => {
      const rows = (table.data ?? []).filter((r) => r.played && r.points !== null);
      const played = rows.reduce((a, r) => a + (r.played ?? 0), 0);
      return played ? rows.reduce((a, r) => a + (r.points ?? 0), 0) / played : null;
    })(),
    params: Object.fromEntries(
      (params.data ?? []).flatMap((r) =>
        r.param && r.value !== null && Number.isFinite(r.value) ? [[r.param, r.value]] : [],
      ),
    ),
    situations: (situ.data ?? []).reduce<LandingData['situations']>((acc, r) => {
      if (r.card_id && r.param_value) {
        (acc[r.card_id] ??= []).push({
          param: r.param_value,
          order: r.param_order ?? 0,
          n: r.n ?? 0,
          w: r.w ?? 0,
          d: r.d ?? 0,
          l: r.l ?? 0,
          ppg: r.ppg ?? 0,
        });
      }
      return acc;
    }, {}),
    metricSeries: metric.reduce<LandingData['metricSeries']>((acc, r) => {
      if (r.entity_id !== null && r.match_id !== null && r.stat_id && r.value !== null) {
        ((acc[r.entity_id] ??= {})[r.match_id] ??= {})[r.stat_id] = r.value;
      }
      return acc;
    }, {}),
    updated: freshness.lastUpdate,
  };
}
