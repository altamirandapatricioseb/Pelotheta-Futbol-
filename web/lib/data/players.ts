import 'server-only';

import { numericStats } from '@/lib/data/catalog';
import type { PlayerRow } from '@/lib/stats/catalog';
import { createApiClient } from '@/lib/supabase/server';

export interface CompetitionOption {
  code: string;
  name: string;
  matches: number;
}

export type DataResult<T> = { ok: true; data: T } | { ok: false; code: 'PEL-DB-001'; detail: string };

const MASTER_COLUMNS =
  'player_id, full_name, known_as, position_group, shirt_number, age, height_cm, weight_kg, preferred_foot, nationality, matches, minutes, stats';

function fail(cause: unknown): { ok: false; code: 'PEL-DB-001'; detail: string } {
  return { ok: false, code: 'PEL-DB-001', detail: cause instanceof Error ? cause.message : String(cause) };
}

/** Tabla maestra del plantel (9.1) para una competición (o 'todas'), de más a menos minutos. */
export async function getPlayerMaster(competitionCode: string): Promise<DataResult<PlayerRow[]>> {
  try {
    const { data, error } = await createApiClient()
      .from('player_master')
      .select(MASTER_COLUMNS)
      .eq('competition_code', competitionCode)
      .order('minutes', { ascending: false })
      .limit(200);
    if (error) return fail(error.message);
    const rows = data.flatMap((r): PlayerRow[] =>
      r.player_id === null || r.full_name === null
        ? []
        : [
            {
              playerId: r.player_id,
              name: r.full_name,
              shortName: r.known_as,
              position: r.position_group,
              shirtNumber: r.shirt_number,
              age: r.age,
              heightCm: r.height_cm,
              weightKg: r.weight_kg,
              foot: r.preferred_foot,
              nationality: r.nationality,
              matches: r.matches ?? 0,
              minutes: r.minutes ?? 0,
              stats: numericStats(r.stats),
            },
          ],
    );
    return { ok: true, data: rows };
  } catch (cause) {
    return fail(cause);
  }
}

/** Competiciones con partidos de Boca, para el filtro. */
export async function getCompetitions(): Promise<DataResult<CompetitionOption[]>> {
  try {
    const { data, error } = await createApiClient()
      .from('competition_filter')
      .select('code, name_es, matches, sort_order')
      .order('sort_order')
      .order('name_es');
    if (error) return fail(error.message);
    return {
      ok: true,
      data: data.flatMap((r) =>
        r.code === null || r.name_es === null ? [] : [{ code: r.code, name: r.name_es, matches: r.matches ?? 0 }],
      ),
    };
  } catch (cause) {
    return fail(cause);
  }
}
