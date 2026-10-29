import 'server-only';

import {
  referenceLabel,
  referenceMembers,
  referencePerMatch,
  referenceValue,
  refProblem,
  type AverageMode,
  type RefSpec,
} from '@/lib/compare/compare';
import { getCatalog } from '@/lib/data/catalog';
import { getPlayerPositions } from '@/lib/data/compare';
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
  /** Referencias elegidas en Comparar (9.7), como media por partido sobre las barras de cada partido. */
  matchReferences: { label: string; value: number }[];
  related: StatDef[];
}

function fail(cause: unknown): { ok: false; code: 'PEL-DB-001'; detail: string } {
  return { ok: false, code: 'PEL-DB-001', detail: cause instanceof Error ? cause.message : String(cause) };
}

const average = (values: number[]) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : null);

/** Referencias elegidas en Comparar: cuáles, mínimo de minutos y tipo de promedio. */
export interface DetailReferences {
  refs: RefSpec[];
  minMinutes: number;
  mode: AverageMode;
}

/** Todo lo que muestra la página de una estadística desglosada (9.8). */
export async function getStatDetail(
  statId: string,
  entity: Entity,
  id: number | null,
  chosen: DetailReferences | null = null,
): Promise<DataResult<StatDetail> | null> {
  try {
    const catalog = await getCatalog(entity === 'jugador' ? 'player' : 'team');
    if (!catalog.ok) return catalog;
    const stat = catalog.data.find((s) => s.id === statId);
    if (!stat) return null;
    const api = createApiClient();
    const args = { p_stat: statId, p_entity: entity, p_id: id };
    // Columnas explícitas: piden la versión nueva de las funciones sin esperar la caché.
    const [series, windows] = await Promise.all([
      api
        .rpc('stat_series', args)
        .select(
          'match_id, match_date, competition_code, competition_name, opponent, home, result, goals_for, goals_against, minutes, num, den, value',
        ),
      api
        .rpc('stat_windows', args)
        .select('window_key, label, sort_order, n, value, total, best, worst, season, delta'),
    ]);
    if (series.error) return fail(series.error.message);
    if (windows.error) return fail(windows.error.message);

    let entityName = 'Boca Juniors';
    let standing: StatDetail['standing'] = null;
    const references: StatDetail['references'] = [];
    const matchReferences: StatDetail['matchReferences'] = [];
    if (entity === 'jugador') {
      const [players, positions] = await Promise.all([
        getPlayerMaster('todas'),
        chosen ? getPlayerPositions() : Promise.resolve(null),
      ]);
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
        if (chosen && me && positions?.ok) {
          // Las mismas referencias que en Comparar, sin el jugador en ninguna media.
          const byId = new Map(positions.data.map((p) => [p.playerId, p]));
          for (const ref of chosen.refs) {
            if (refProblem(ref, me, byId, players.data)) continue;
            const members = referenceMembers(ref, me, players.data, byId, chosen.minMinutes);
            const label = referenceLabel(ref, byId.get(me.playerId), players.data).long;
            const value = referenceValue(members, stat, stat.per90, chosen.mode).value;
            if (value !== null) references.push({ label, value });
            const perMatch = referencePerMatch(members, stat, chosen.mode);
            if (perMatch !== null) matchReferences.push({ label, value: perMatch });
          }
        } else {
          const squad = average(all);
          if (squad !== null) references.push({ label: 'Plantel', value: squad });
          const samePosition = players.data
            .filter((p) => p.position === me?.position)
            .map(valueOf)
            .filter((v): v is number => v !== null);
          const position = average(samePosition);
          if (position !== null && me?.position) references.push({ label: `${me.position}s`, value: position });
        }
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
        matchReferences,
        related: catalog.data.filter((s) => s.group === stat.group && s.id !== stat.id && s.available).slice(0, 12),
      },
    };
  } catch (cause) {
    return fail(cause);
  }
}
