import 'server-only';

import type { DataResult } from '@/lib/data/players';
import type { SituationCard, SituationMatch, SituationRow } from '@/lib/situations/board';
import { createApiClient } from '@/lib/supabase/server';

const PAGE = 1000;

function fail(cause: unknown): { ok: false; code: 'PEL-DB-001'; detail: string } {
  return { ok: false, code: 'PEL-DB-001', detail: cause instanceof Error ? cause.message : String(cause) };
}

export interface SituationsData {
  cards: SituationCard[];
  matches: Record<number, SituationMatch>;
  /** % de victorias de Boca en toda la temporada (la base de cada tarjeta). */
  baseWinPct: number | null;
}

/** Catálogo, resultados y partidos de cada fila de las tarjetas de Situaciones (9.6). */
export async function getSituations(): Promise<DataResult<SituationsData>> {
  try {
    const api = createApiClient();
    const [catalog, results] = await Promise.all([
      api.from('situational_catalog').select('*').order('sort_order').limit(500),
      api.from('situational_result').select('*').limit(3000),
    ]);
    if (catalog.error) return fail(catalog.error.message);
    if (results.error) return fail(results.error.message);

    // Partidos de cada fila, de a 1000 (el tope de la Data API).
    const members: { card_id: string | null; param_value: string | null; match_id: number | null }[] = [];
    const matches: Record<number, SituationMatch> = {};
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await api
        .from('situational_match')
        .select(
          'card_id, param_value, match_id, match_date, competition_name, opponent, home, goals_for, goals_against, result',
        )
        .order('card_id')
        .order('param_value')
        .order('match_id')
        .range(from, from + PAGE - 1);
      if (error) return fail(error.message);
      for (const m of data) {
        members.push(m);
        if (m.match_id !== null && !(m.match_id in matches)) {
          matches[m.match_id] = {
            date: m.match_date ?? '',
            competition: m.competition_name ?? '',
            opponent: m.opponent ?? '',
            home: m.home ?? false,
            goalsFor: m.goals_for ?? 0,
            goalsAgainst: m.goals_against ?? 0,
            result: m.result ?? '',
          };
        }
      }
      if (data.length < PAGE) break;
    }
    const byRow = new Map<string, number[]>();
    for (const m of members) {
      if (m.card_id === null || m.param_value === null || m.match_id === null) continue;
      const key = `${m.card_id}|${m.param_value}`;
      byRow.set(key, [...(byRow.get(key) ?? []), m.match_id]);
    }

    const rowsByCard = new Map<string, SituationRow[]>();
    let baseWinPct: number | null = null;
    for (const r of results.data) {
      if (r.card_id === null || r.param_value === null) continue;
      baseWinPct ??= r.base_win_pct;
      const list = rowsByCard.get(r.card_id) ?? [];
      list.push({
        param: r.param_value,
        order: r.param_order ?? 0,
        n: r.n ?? 0,
        w: r.w ?? 0,
        d: r.d ?? 0,
        l: r.l ?? 0,
        winPct: r.win_pct ?? 0,
        ppg: r.ppg ?? 0,
        goalDiff: r.goal_diff ?? 0,
        base: r.base_win_pct ?? 0,
        delta: r.delta ?? 0,
        // Partidos de la fila, del más reciente al más viejo.
        matchIds: (byRow.get(`${r.card_id}|${r.param_value}`) ?? []).sort((a, b) =>
          (matches[b]?.date ?? '').localeCompare(matches[a]?.date ?? ''),
        ),
      });
      rowsByCard.set(r.card_id, list);
    }

    return {
      ok: true,
      data: {
        cards: catalog.data.flatMap((c): SituationCard[] =>
          c.card_id && c.category && c.title_es
            ? [
                {
                  id: c.card_id,
                  category: c.category,
                  title: c.title_es,
                  condition: c.condition_es ?? '',
                  params: c.params_es ?? '',
                  measured: c.measured_es ?? '',
                  required: c.required_data ?? '',
                  level: c.level ?? 'A',
                  available: c.available ?? false,
                  estimated: c.estimated ?? false,
                  reason: c.reason_es ?? '',
                  rows: (rowsByCard.get(c.card_id) ?? []).sort(
                    (a, b) => a.order - b.order || a.param.localeCompare(b.param),
                  ),
                },
              ]
            : [],
        ),
        matches,
        baseWinPct,
      },
    };
  } catch (cause) {
    return fail(cause);
  }
}
