import 'server-only';

import { createApiClient } from '@/lib/supabase/server';

export interface PlayerSummary {
  playerId: number;
  name: string;
  shortName: string | null;
  position: string | null;
  shirtNumber: number | null;
  age: number | null;
  heightCm: number | null;
  matches: number;
  starts: number;
  minutes: number;
  goals: number;
  assists: number;
  goalContributions: number;
  yellowCards: number;
  redCards: number;
}

export interface CompetitionOption {
  code: string;
  name: string;
  matches: number;
}

export type DataResult<T> = { ok: true; data: T } | { ok: false; code: 'PEL-DB-001'; detail: string };

const SUMMARY_COLUMNS =
  'player_id, full_name, known_as, position_group, shirt_number, age, height_cm, matches, starts, minutes, goals, assists, goal_contributions, yellow_cards, red_cards';

function fail(cause: unknown): { ok: false; code: 'PEL-DB-001'; detail: string } {
  return { ok: false, code: 'PEL-DB-001', detail: cause instanceof Error ? cause.message : String(cause) };
}

/** Tabla «Resumen» del plantel para una competición (o 'todas'). */
export async function getPlayerSummary(competitionCode: string): Promise<DataResult<PlayerSummary[]>> {
  try {
    const { data, error } = await createApiClient()
      .from('player_summary')
      .select(SUMMARY_COLUMNS)
      .eq('competition_code', competitionCode)
      .order('minutes', { ascending: false })
      .limit(200);
    if (error) return fail(error.message);
    const rows = data.flatMap((r) =>
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
              matches: r.matches ?? 0,
              starts: r.starts ?? 0,
              minutes: r.minutes ?? 0,
              goals: r.goals ?? 0,
              assists: r.assists ?? 0,
              goalContributions: r.goal_contributions ?? 0,
              yellowCards: r.yellow_cards ?? 0,
              redCards: r.red_cards ?? 0,
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
