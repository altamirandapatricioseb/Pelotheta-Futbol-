-- Modelos, segunda versión (18-nov-2026):
-- * Valor: un detalle por jugador (variables, aporte de cada una al precio, comparables de la liga y su
--   rendimiento) para el análisis individual.
-- * Predictor: rivales de copas (Libertadores, Sudamericana, Copa Argentina) con su competición y la
--   sede (local, visitante o cancha neutral), y el valor del plantel de cada club (la variable que más
--   mejoró el backtest). Un rival sin datos se marca como estimado.

alter table core.market_value_prediction add column detail jsonb not null default '{}';

alter table core.match_prediction add column competition text;
alter table core.match_prediction add column neutral boolean not null default false;
alter table core.match_prediction
  drop constraint match_prediction_team_slug_kind_home_team_away_team_match_d_key;
alter table core.match_prediction
  add constraint match_prediction_unique unique nulls not distinct
  (team_slug, kind, home_team, away_team, match_date, neutral);

alter table core.team_strength add column squad_value_eur bigint check (squad_value_eur > 0);
alter table core.team_strength add column competition text not null default 'liga';
alter table core.team_strength add column estimated boolean not null default false;

create or replace view api.market_value_prediction with (security_invoker = true) as
select m.team_slug, m.player_id, coalesce(p.known_as, p.full_name) as player_name,
       coalesce(s.position_group, p.position_raw) as position_group,
       m.actual_eur, m.predicted_eur, m.low_eur, m.high_eur, m.residual_pct, m.features, m.detail
from core.market_value_prediction m
join core.player p using (player_id)
left join lateral (
  select sm.position_group from core.squad_member sm
  where sm.player_id = m.player_id and sm.position_group is not null
  order by sm.season_year desc limit 1
) s on true;

create or replace view api.match_prediction with (security_invoker = true) as
select team_slug, kind, match_date, home_team, away_team, lambda_home, lambda_away, p_home, p_draw, p_away,
       top_scores, score_matrix, sim, actual_home, actual_away, competition, neutral
from core.match_prediction;

create or replace view api.team_strength with (security_invoker = true) as
select team_slug, team_name, home_games, away_games, attack_home, defense_home, attack_away, defense_away,
       goals_for, goals_against, squad_value_eur, competition, estimated
from core.team_strength;

create or replace function ingest.load_models(p_payload jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_team text := p_payload ->> 'team_slug';
  v_counts jsonb := '{}';
  n integer;
begin
  if v_team is null or v_team !~ '^[a-z0-9-]+$' then
    raise exception 'team_slug inválido';
  end if;
  delete from core.model_run where team_slug = v_team;
  delete from core.market_value_prediction where team_slug = v_team;
  delete from core.market_value_coef where team_slug = v_team;
  delete from core.player_style where team_slug = v_team;
  delete from core.player_alternative where team_slug = v_team;
  delete from core.match_prediction where team_slug = v_team;
  delete from core.team_strength where team_slug = v_team;
  delete from core.stat_test where team_slug = v_team;

  insert into core.model_run (model, team_slug, status, n, metrics, params, message)
  select r.model, v_team, r.status, r.n, coalesce(r.metrics, '{}'), coalesce(r.params, '{}'), r.message
  from jsonb_to_recordset(coalesce(p_payload -> 'runs', '[]'))
       as r(model text, status text, n integer, metrics jsonb, params jsonb, message text);

  insert into core.market_value_prediction (team_slug, player_id, actual_eur, predicted_eur, low_eur, high_eur,
                                            residual_pct, features, detail)
  select v_team, r.player_id, r.actual_eur, r.predicted_eur, r.low_eur, r.high_eur, r.residual_pct, r.features,
         coalesce(r.detail, '{}')
  from jsonb_to_recordset(coalesce(p_payload -> 'market_predictions', '[]'))
       as r(player_id integer, actual_eur bigint, predicted_eur bigint, low_eur bigint, high_eur bigint,
            residual_pct numeric, features jsonb, detail jsonb);
  get diagnostics n = row_count;
  v_counts := v_counts || jsonb_build_object('market_predictions', n);

  insert into core.market_value_coef (team_slug, feature, coef, std_err, t_stat, p_value, ci_low, ci_high)
  select v_team, r.feature, r.coef, r.std_err, r.t_stat, r.p_value, r.ci_low, r.ci_high
  from jsonb_to_recordset(coalesce(p_payload -> 'market_coefs', '[]'))
       as r(feature text, coef numeric, std_err numeric, t_stat numeric, p_value numeric, ci_low numeric,
            ci_high numeric);

  insert into core.player_style (team_slug, player_id, cluster, cluster_label, pc1, pc2, features, z, percentiles)
  select v_team, r.player_id, r.cluster, r.cluster_label, r.pc1, r.pc2, r.features, r.z, r.percentiles
  from jsonb_to_recordset(coalesce(p_payload -> 'styles', '[]'))
       as r(player_id integer, cluster smallint, cluster_label text, pc1 numeric, pc2 numeric, features jsonb,
            z jsonb, percentiles jsonb);
  get diagnostics n = row_count;
  v_counts := v_counts || jsonb_build_object('styles', n);

  insert into core.player_alternative (team_slug, player_id, section, rank, members, similarity, total_value_eur,
                                       savings_eur)
  select v_team, r.player_id, r.section, r.rank, r.members, r.similarity, r.total_value_eur, r.savings_eur
  from jsonb_to_recordset(coalesce(p_payload -> 'alternatives', '[]'))
       as r(player_id integer, section text, rank smallint, members jsonb, similarity numeric,
            total_value_eur bigint, savings_eur bigint);
  get diagnostics n = row_count;
  v_counts := v_counts || jsonb_build_object('alternatives', n);

  insert into core.match_prediction (team_slug, kind, match_date, home_team, away_team, lambda_home, lambda_away,
                                     p_home, p_draw, p_away, top_scores, score_matrix, sim, actual_home,
                                     actual_away, competition, neutral)
  select v_team, r.kind, r.match_date, r.home_team, r.away_team, r.lambda_home, r.lambda_away, r.p_home,
         r.p_draw, r.p_away, r.top_scores, r.score_matrix, r.sim, r.actual_home, r.actual_away, r.competition,
         coalesce(r.neutral, false)
  from jsonb_to_recordset(coalesce(p_payload -> 'match_predictions', '[]'))
       as r(kind text, match_date date, home_team text, away_team text, lambda_home numeric,
            lambda_away numeric, p_home numeric, p_draw numeric, p_away numeric, top_scores jsonb,
            score_matrix jsonb, sim jsonb, actual_home smallint, actual_away smallint, competition text,
            neutral boolean);
  get diagnostics n = row_count;
  v_counts := v_counts || jsonb_build_object('match_predictions', n);

  insert into core.team_strength (team_slug, team_name, home_games, away_games, attack_home, defense_home,
                                  attack_away, defense_away, goals_for, goals_against, squad_value_eur,
                                  competition, estimated)
  select v_team, r.team_name, r.home_games, r.away_games, r.attack_home, r.defense_home, r.attack_away,
         r.defense_away, r.goals_for, r.goals_against, r.squad_value_eur, coalesce(r.competition, 'liga'),
         coalesce(r.estimated, false)
  from jsonb_to_recordset(coalesce(p_payload -> 'strengths', '[]'))
       as r(team_name text, home_games integer, away_games integer, attack_home numeric, defense_home numeric,
            attack_away numeric, defense_away numeric, goals_for integer, goals_against integer,
            squad_value_eur bigint, competition text, estimated boolean);

  insert into core.stat_test (team_slug, test_id, title_es, statistic, df, p_value, decision_es, detail)
  select v_team, r.test_id, r.title_es, r.statistic, r.df, r.p_value, r.decision_es,
         coalesce(r.detail, '{}')
  from jsonb_to_recordset(coalesce(p_payload -> 'tests', '[]'))
       as r(test_id text, title_es text, statistic numeric, df integer, p_value numeric,
            decision_es text, detail jsonb);
  get diagnostics n = row_count;
  v_counts := v_counts || jsonb_build_object('tests', n);
  return v_counts;
end;
$$;
revoke all on function ingest.load_models(jsonb) from public, anon, authenticated;
grant execute on function ingest.load_models(jsonb) to service_role;
