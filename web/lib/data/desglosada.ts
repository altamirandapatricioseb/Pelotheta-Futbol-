import 'server-only';

import { getCatalog } from '@/lib/data/catalog';
import type { DataResult } from '@/lib/data/players';
import { getPlayerMaster } from '@/lib/data/players';
import { getLeagueClubs } from '@/lib/data/team';
import { playerValue, rankAndPercentile, type StatDef } from '@/lib/stats/catalog';
import { leagueComparison } from '@/lib/stats/league';
import { createApiClient } from '@/lib/supabase/server';

export type Entity = 'jugador' | 'equipo' | 'rival' | 'arbitro';

export interface SeriesPoint {
  matchId: number;
  date: string;
  competitionCode: string;
  competition: string;
  opponent: string;
  home: boolean;
  result: string;
  goalsFor: number;
  goalsAgainst: number;
  value: number | null;
}

export interface StatWindow {
  key: string;
  label: string;
  order: number;
  n: number;
  value: number | null;
  total: number | null;
  best: number | null;
  worst: number | null;
  delta: number | null;
}

export interface StatDetail {
  stat: StatDef;
  entity: Entity;
  entityName: string;
  series: SeriesPoint[];
  windows: StatWindow[];
  /** Puesto y percentil en el plantel (jugador) o entre los 30 clubes (equipo). */
  standing: { rank: number; of: number; percentile: number; group: string } | null;
  /** Referencias para las barras comparadas: plantel y posición, o promedio de la liga. */
  references: { label: string; value: number }[];
  related: StatDef[];
}

function fail(cause: unknown): { ok: false; code: 'PEL-DB-001'; detail: string } {
  return { ok: false, code: 'PEL-DB-001', detail: cause instanceof Error ? cause.message : String(cause) };
}

const average = (values: number[]) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : null);

/** Todo lo que muestra la página de una estadística desglosada (9.8). */
export async function getStatDetail(
  statId: string,
  entity: Entity,
  id: number | null,
): Promise<DataResult<StatDetail> | null> {
  try {
    const catalog = await getCatalog(entity === 'jugador' ? 'player' : 'team');
    if (!catalog.ok) return catalog;
    const stat = catalog.data.find((s) => s.id === statId);
    if (!stat) return null;
    const api = createApiClient();
    const args = { p_stat: statId, p_entity: entity, p_id: id };
    const [series, windows] = await Promise.all([api.rpc('stat_series', args), api.rpc('stat_windows', args)]);
    if (series.error) return fail(series.error.message);
    if (windows.error) return fail(windows.error.message);

    let entityName = 'Boca Juniors';
    let standing: StatDetail['standing'] = null;
    const references: StatDetail['references'] = [];
    if (entity === 'jugador') {
      const players = await getPlayerMaster('todas');
      if (players.ok) {
        const me = players.data.find((p) => p.playerId === id);
        entityName = me?.name ?? 'Jugador';
        const valueOf = (p: (typeof players.data)[number]) => {
          const v = playerValue(p, stat, stat.per90);
          return typeof v === 'number' ? v : null;
        };
        const all = players.data.map(valueOf).filter((v): v is number => v !== null);
        const mine = me ? valueOf(me) : null;
        if (mine !== null) {
          const r = rankAndPercentile(all, mine, stat.higherIsBetter);
          standing = { rank: r.rank, of: all.length, percentile: r.percentile, group: 'en el plantel' };
        }
        const squad = average(all);
        if (squad !== null) references.push({ label: 'Plantel', value: squad });
        const samePosition = players.data
          .filter((p) => p.position === me?.position)
          .map(valueOf)
          .filter((v): v is number => v !== null);
        const position = average(samePosition);
        if (position !== null && me?.position) references.push({ label: `${me.position}s`, value: position });
        if (mine !== null) references.unshift({ label: entityName, value: mine });
      }
    } else {
      if (entity === 'rival') entityName = `Boca contra ${series.data[0]?.opponent ?? 'el rival'}`;
      if (entity === 'arbitro') entityName = 'Boca con el árbitro elegido';
      const clubs = await getLeagueClubs();
      const cmp = clubs.ok ? leagueComparison(stat.id, stat.higherIsBetter, clubs.data) : null;
      if (cmp) {
        references.push({ label: 'Promedio de la liga', value: cmp.average });
        if (cmp.bocaPercentile !== null) {
          standing = { rank: 0, of: 30, percentile: cmp.bocaPercentile, group: 'entre los 30 clubes de la liga' };
        }
      }
      const season = windows.data.find((w) => w.window_key === 'temporada')?.value ?? null;
      if (season !== null) references.unshift({ label: 'Boca (todas las competiciones)', value: season });
    }

    return {
      ok: true,
      data: {
        stat,
        entity,
        entityName,
        series: series.data.map((r) => ({
          matchId: r.match_id,
          date: r.match_date,
          competitionCode: r.competition_code,
          competition: r.competition_name,
          opponent: r.opponent,
          home: r.home,
          result: r.result,
          goalsFor: r.goals_for,
          goalsAgainst: r.goals_against,
          value: r.value,
        })),
        windows: windows.data.map((w) => ({
          key: w.window_key,
          label: w.label,
          order: w.sort_order,
          n: w.n,
          value: w.value,
          total: w.total,
          best: w.best,
          worst: w.worst,
          delta: w.delta,
        })),
        standing,
        references,
        related: catalog.data.filter((s) => s.group === stat.group && s.id !== stat.id && s.available).slice(0, 12),
      },
    };
  } catch (cause) {
    return fail(cause);
  }
}
