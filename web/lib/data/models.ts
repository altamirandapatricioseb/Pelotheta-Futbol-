import 'server-only';

import type { Json } from '@/lib/database.types';
import type { DataResult } from '@/lib/data/players';
import { createApiClient } from '@/lib/supabase/server';

// Lecturas de los modelos (interfaces Valor, Alternativas y Predictor y el panel Probabilidad de Equipo).
// Todo se filtra por el slug del equipo elegido: las tablas ya están listas para más equipos.

function fail(cause: unknown): { ok: false; code: 'PEL-DB-001'; detail: string } {
  return { ok: false, code: 'PEL-DB-001', detail: cause instanceof Error ? cause.message : String(cause) };
}

const obj = (v: Json | null): Record<string, Json> =>
  v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, Json>) : {};
const nums = (v: Json | null): Record<string, number> =>
  Object.fromEntries(Object.entries(obj(v)).filter((e): e is [string, number] => typeof e[1] === 'number'));

export type ModelName = 'valor_mercado' | 'alternativas' | 'predictor_partido';

export interface ModelRun {
  model: ModelName;
  status: 'ok' | 'sin_datos';
  n: number;
  metrics: Record<string, Json>;
  params: Record<string, Json>;
  message: string | null;
  trainedAt: string | null;
}

export async function getModelRun(team: string, model: ModelName): Promise<DataResult<ModelRun | null>> {
  try {
    const { data, error } = await createApiClient()
      .from('model_run')
      .select('model, status, n, metrics, params, message, trained_at')
      .eq('team_slug', team)
      .eq('model', model)
      .limit(1);
    if (error) return fail(error.message);
    const r = data[0];
    return {
      ok: true,
      data: r
        ? {
            model,
            status: r.status === 'ok' ? 'ok' : 'sin_datos',
            n: r.n ?? 0,
            metrics: obj(r.metrics),
            params: obj(r.params),
            message: r.message,
            trainedAt: r.trained_at,
          }
        : null,
    };
  } catch (cause) {
    return fail(cause);
  }
}

export interface ValueRow {
  playerId: number;
  name: string;
  position: string | null;
  actual: number | null;
  predicted: number | null;
  low: number | null;
  high: number | null;
  residualPct: number | null;
  features: Record<string, number>;
  detail: ValueDetail;
}

export interface Comparable {
  name: string;
  team: string;
  age: number | null;
  value: number | null;
}

/** Análisis de un jugador: aporte de cada variable al precio, comparables de la liga y rendimiento. */
export interface ValueDetail {
  average: number | null;
  market: number | null;
  effects: Record<string, number>;
  age: number | null;
  contractYears: number | null;
  foreign: boolean | null;
  clubRest: number | null;
  performance: Record<string, number | null>;
  comparables: Comparable[];
  /** Historial del valor de mercado (transfermarkt-datasets), en orden de fecha. */
  history: { date: string; value: number }[];
}

const numOrNull = (v: Json | undefined): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

function valueDetail(v: Json | null): ValueDetail {
  const o = obj(v);
  const perf = obj(o.performance ?? null);
  return {
    average: numOrNull(o.average_eur),
    market: numOrNull(o.market_eur),
    effects: nums(o.effects ?? null),
    age: numOrNull(o.age),
    contractYears: numOrNull(o.contract_years),
    foreign: typeof o.foreign === 'boolean' ? o.foreign : null,
    clubRest: numOrNull(o.club_rest_eur),
    performance: Object.fromEntries(Object.entries(perf).map(([k, x]) => [k, numOrNull(x)])),
    comparables: (Array.isArray(o.comparables) ? o.comparables : []).map((c) => {
      const q = obj(c);
      return {
        name: typeof q.name === 'string' ? q.name : 'Jugador',
        team: typeof q.team === 'string' ? q.team : '',
        age: numOrNull(q.age),
        value: numOrNull(q.value_eur),
      };
    }),
    history: (Array.isArray(o.history) ? o.history : []).flatMap((h) => {
      const q = obj(h);
      const value = numOrNull(q.value);
      return typeof q.date === 'string' && value !== null ? [{ date: q.date, value }] : [];
    }),
  };
}

export interface CoefRow {
  feature: string;
  coef: number;
  stdErr: number;
  t: number;
  p: number;
  low: number;
  high: number;
}

export async function getMarketValues(team: string): Promise<DataResult<{ rows: ValueRow[]; coefs: CoefRow[] }>> {
  try {
    const client = createApiClient();
    const [pred, coef] = await Promise.all([
      client
        .from('market_value_prediction')
        .select(
          'player_id, player_name, position_group, actual_eur, predicted_eur, low_eur, high_eur, residual_pct, features, detail',
        )
        .eq('team_slug', team)
        .limit(500),
      client
        .from('market_value_coef')
        .select('feature, coef, std_err, t_stat, p_value, ci_low, ci_high')
        .eq('team_slug', team)
        .limit(50),
    ]);
    if (pred.error) return fail(pred.error.message);
    if (coef.error) return fail(coef.error.message);
    return {
      ok: true,
      data: {
        rows: pred.data.flatMap((r) =>
          r.player_id === null
            ? []
            : [
                {
                  playerId: r.player_id,
                  name: r.player_name ?? 'Jugador',
                  position: r.position_group,
                  actual: r.actual_eur,
                  predicted: r.predicted_eur,
                  low: r.low_eur,
                  high: r.high_eur,
                  residualPct: r.residual_pct,
                  features: nums(r.features),
                  detail: valueDetail(r.detail),
                },
              ],
        ),
        coefs: coef.data.flatMap((c) =>
          c.feature === null
            ? []
            : [
                {
                  feature: c.feature,
                  coef: c.coef ?? 0,
                  stdErr: c.std_err ?? 0,
                  t: c.t_stat ?? 0,
                  p: c.p_value ?? 1,
                  low: c.ci_low ?? 0,
                  high: c.ci_high ?? 0,
                },
              ],
        ),
      },
    };
  } catch (cause) {
    return fail(cause);
  }
}

export interface PoolPlayer {
  name: string;
  team: string;
  age: number | null;
  position: string | null;
  value: number | null;
}

/** Jugadores de la liga (otros clubes) con edad y valor: la nube de referencia de Valor. */
export async function getLeaguePool(): Promise<DataResult<PoolPlayer[]>> {
  try {
    const { data, error } = await createApiClient()
      .from('player_pool')
      .select('player_name, team_name, age, position_group, value_eur')
      .not('value_eur', 'is', null)
      .limit(3000);
    if (error) return fail(error.message);
    return {
      ok: true,
      data: data.map((r) => ({
        name: r.player_name ?? 'Jugador',
        team: r.team_name ?? '',
        age: r.age,
        position: r.position_group,
        value: r.value_eur,
      })),
    };
  } catch (cause) {
    return fail(cause);
  }
}

export interface StyleRow {
  playerId: number;
  name: string;
  position: string | null;
  cluster: number;
  label: string;
  pc1: number;
  pc2: number;
  features: Record<string, number>;
  percentiles: Record<string, number>;
}

export interface AlternativeMember {
  name: string;
  team: string;
  playerId: number | null;
  position: string | null;
  profile: string;
  value: number | null;
  age: number | null;
  minutes: number | null;
  /** Estadísticas cada 90 (null donde la fuente no la tiene) y su valor en escala z. */
  features: Record<string, number | null>;
  z: Record<string, number>;
}

export type AlternativeSection = 'externo' | 'dupla' | 'club';

export interface AlternativeRow {
  playerId: number;
  section: AlternativeSection;
  rank: number;
  members: AlternativeMember[];
  similarity: number;
  total: number | null;
  savings: number | null;
}

function members(v: Json | null): AlternativeMember[] {
  return (Array.isArray(v) ? v : []).map((m) => {
    const o = obj(m);
    return {
      name: typeof o.name === 'string' ? o.name : 'Jugador',
      team: typeof o.team === 'string' ? o.team : '',
      playerId: typeof o.player_id === 'number' ? o.player_id : null,
      position: typeof o.position === 'string' ? o.position : null,
      profile: typeof o.profile === 'string' ? o.profile : '',
      value: typeof o.value_eur === 'number' ? o.value_eur : null,
      age: numOrNull(o.age),
      minutes: numOrNull(o.minutes),
      features: Object.fromEntries(Object.entries(obj(o.features ?? null)).map(([k, x]) => [k, numOrNull(x)])),
      z: nums(o.z ?? null),
    };
  });
}

export async function getAlternatives(
  team: string,
): Promise<DataResult<{ styles: StyleRow[]; alternatives: AlternativeRow[] }>> {
  try {
    const client = createApiClient();
    const [st, alt] = await Promise.all([
      client
        .from('player_style')
        .select('player_id, player_name, position_group, cluster, cluster_label, pc1, pc2, features, percentiles')
        .eq('team_slug', team)
        .limit(1000),
      client
        .from('player_alternative')
        .select('player_id, section, rank, members, similarity, total_value_eur, savings_eur')
        .eq('team_slug', team)
        .order('rank')
        .limit(5000),
    ]);
    if (st.error) return fail(st.error.message);
    if (alt.error) return fail(alt.error.message);
    return {
      ok: true,
      data: {
        styles: st.data.flatMap((r) =>
          r.player_id === null
            ? []
            : [
                {
                  playerId: r.player_id,
                  name: r.player_name ?? 'Jugador',
                  position: r.position_group,
                  cluster: r.cluster ?? 0,
                  label: r.cluster_label ?? '',
                  pc1: r.pc1 ?? 0,
                  pc2: r.pc2 ?? 0,
                  features: nums(r.features),
                  percentiles: nums(r.percentiles),
                },
              ],
        ),
        alternatives: alt.data.flatMap((r): AlternativeRow[] =>
          r.player_id === null || (r.section !== 'externo' && r.section !== 'dupla' && r.section !== 'club')
            ? []
            : [
                {
                  playerId: r.player_id,
                  section: r.section,
                  rank: r.rank ?? 1,
                  members: members(r.members),
                  similarity: r.similarity ?? 0,
                  total: r.total_value_eur,
                  savings: r.savings_eur,
                },
              ],
        ),
      },
    };
  } catch (cause) {
    return fail(cause);
  }
}

export interface Simulation {
  n: number;
  p_home: number;
  p_draw: number;
  p_away: number;
  mean_home: number;
  mean_away: number;
}

export interface Prediction {
  kind: 'escenario' | 'backtest';
  date: string | null;
  home: string;
  away: string;
  lambdaHome: number;
  lambdaAway: number;
  pHome: number;
  pDraw: number;
  pAway: number;
  topScores: { home: number; away: number; p: number }[];
  matrix: number[][];
  sim: Simulation | null;
  actualHome: number | null;
  actualAway: number | null;
  /** 'liga' o el código de la copa; neutral: cancha neutral (Copa Argentina). */
  competition: string;
  neutral: boolean;
}

export interface Strength {
  team: string;
  attack: number;
  defense: number;
  goalsFor: number;
  goalsAgainst: number;
  value: number | null;
  competition: string;
  estimated: boolean;
  country: string | null;
  league: string | null;
  /** Variables del modelo para calcular cualquier cruce en la web. */
  attackHome: number;
  attackAway: number;
  defenseHome: number;
  defenseAway: number;
  elo: number | null;
  form: number | null;
}

export async function getPredictions(
  team: string,
): Promise<DataResult<{ predictions: Prediction[]; strengths: Strength[] }>> {
  try {
    const client = createApiClient();
    const [pr, st] = await Promise.all([
      client
        .from('match_prediction')
        .select(
          'kind, match_date, home_team, away_team, lambda_home, lambda_away, p_home, p_draw, p_away, top_scores, score_matrix, sim, actual_home, actual_away, competition, neutral',
        )
        .eq('team_slug', team)
        .order('match_date')
        .limit(1000),
      client
        .from('team_strength')
        .select(
          'team_name, attack_home, attack_away, defense_home, defense_away, goals_for, goals_against, squad_value_eur, competition, estimated, country, league, elo, form',
        )
        .eq('team_slug', team)
        .limit(1000),
    ]);
    if (pr.error) return fail(pr.error.message);
    if (st.error) return fail(st.error.message);
    return {
      ok: true,
      data: {
        predictions: pr.data.flatMap((r): Prediction[] =>
          r.home_team === null || r.away_team === null
            ? []
            : [
                {
                  kind: r.kind === 'backtest' ? 'backtest' : 'escenario',
                  date: r.match_date,
                  home: r.home_team,
                  away: r.away_team,
                  lambdaHome: r.lambda_home ?? 0,
                  lambdaAway: r.lambda_away ?? 0,
                  pHome: r.p_home ?? 0,
                  pDraw: r.p_draw ?? 0,
                  pAway: r.p_away ?? 0,
                  topScores: (Array.isArray(r.top_scores) ? r.top_scores : []) as unknown as Prediction['topScores'],
                  matrix: (Array.isArray(r.score_matrix) ? r.score_matrix : []) as unknown as number[][],
                  sim: (r.sim ?? null) as unknown as Simulation | null,
                  actualHome: r.actual_home,
                  actualAway: r.actual_away,
                  competition: r.competition ?? 'liga',
                  neutral: r.neutral ?? false,
                },
              ],
        ),
        // Fuerza general: promedio de local y visitante (1 = promedio de la liga).
        strengths: st.data.flatMap((s) =>
          s.team_name === null
            ? []
            : [
                {
                  team: s.team_name,
                  attack: ((s.attack_home ?? 1) + (s.attack_away ?? 1)) / 2,
                  defense: ((s.defense_home ?? 1) + (s.defense_away ?? 1)) / 2,
                  goalsFor: s.goals_for ?? 0,
                  goalsAgainst: s.goals_against ?? 0,
                  value: s.squad_value_eur,
                  competition: s.competition ?? 'liga',
                  estimated: s.estimated ?? false,
                  country: s.country,
                  league: s.league,
                  attackHome: s.attack_home ?? 1,
                  attackAway: s.attack_away ?? 1,
                  defenseHome: s.defense_home ?? 1,
                  defenseAway: s.defense_away ?? 1,
                  elo: s.elo,
                  form: s.form,
                },
              ],
        ),
      },
    };
  } catch (cause) {
    return fail(cause);
  }
}

export interface StatTest {
  id: string;
  title: string;
  statistic: number;
  df: number | null;
  p: number | null;
  decision: string;
  detail: Record<string, Json>;
}

export async function getStatTests(team: string): Promise<DataResult<StatTest[]>> {
  try {
    const { data, error } = await createApiClient()
      .from('stat_test')
      .select('test_id, title_es, statistic, df, p_value, decision_es, detail')
      .eq('team_slug', team)
      .order('test_id')
      .limit(50);
    if (error) return fail(error.message);
    return {
      ok: true,
      data: data.flatMap((t) =>
        t.test_id === null
          ? []
          : [
              {
                id: t.test_id,
                title: t.title_es ?? t.test_id,
                statistic: t.statistic ?? 0,
                df: t.df,
                p: t.p_value,
                decision: t.decision_es ?? '',
                detail: obj(t.detail),
              },
            ],
      ),
    };
  } catch (cause) {
    return fail(cause);
  }
}
