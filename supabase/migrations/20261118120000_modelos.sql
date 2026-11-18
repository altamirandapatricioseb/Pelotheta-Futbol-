-- Modelos (interfaces Valor, Alternativas y Predictor): valor de mercado con regresión lineal,
-- perfiles con K-means y alternativas por jugador, y predictor de partidos con Poisson. Lo calcula Python
-- (pipeline/analytics.py) y lo carga `ingest.load_models` reemplazando todo lo del equipo.
-- Todas las tablas llevan team_slug (el slug del selector, web/config/teams.ts): listas para el
-- día que entre otro equipo, sin cambiar el esquema.

-- Valores de mercado reales: transfermarkt-datasets (CC0) y, si hay, data/manual/market_values.csv.
create table core.player_market_value (
  player_id   integer not null references core.player (player_id) on delete cascade,
  team_slug   text not null check (team_slug ~ '^[a-z0-9-]+$'),
  as_of       date not null,
  value_eur   bigint not null check (value_eur > 0 and value_eur <= 500000000),
  source      text not null check (source ~ '^[a-z_]+$'),
  source_url  text check (source_url ~ '^https://'),
  fetched_at  timestamptz not null default now(),
  primary key (player_id, as_of, source)
);
create index player_market_value_team_idx on core.player_market_value (team_slug, player_id);

-- Una fila por modelo y equipo: estado, tamaño de muestra, métricas y parámetros usados.
create table core.model_run (
  model       text not null check (model in ('valor_mercado', 'alternativas', 'predictor_partido')),
  team_slug   text not null check (team_slug ~ '^[a-z0-9-]+$'),
  status      text not null check (status in ('ok', 'sin_datos')),
  n           integer not null check (n >= 0),
  metrics     jsonb not null default '{}',
  params      jsonb not null default '{}',
  message     text,
  trained_at  timestamptz not null default now(),
  primary key (model, team_slug)
);

create table core.market_value_prediction (
  team_slug      text not null,
  player_id      integer not null references core.player (player_id) on delete cascade,
  actual_eur     bigint check (actual_eur > 0),
  predicted_eur  bigint check (predicted_eur > 0),
  low_eur        bigint check (low_eur > 0),
  high_eur       bigint check (high_eur > 0),
  residual_pct   numeric,
  features       jsonb not null,
  primary key (team_slug, player_id)
);

create table core.market_value_coef (
  team_slug  text not null,
  feature    text not null,
  coef       numeric not null,
  std_err    numeric not null,
  t_stat     numeric not null,
  p_value    numeric not null check (p_value between 0 and 1),
  ci_low     numeric not null,
  ci_high    numeric not null,
  primary key (team_slug, feature)
);

create table core.player_style (
  team_slug      text not null,
  player_id      integer not null references core.player (player_id) on delete cascade,
  cluster        smallint not null check (cluster >= 0),
  cluster_label  text not null,
  pc1            numeric not null,
  pc2            numeric not null,
  features       jsonb not null,
  z              jsonb not null,
  percentiles    jsonb not null,
  primary key (team_slug, player_id)
);

-- Jugadores de otros clubes: identidad, edad y valor (transfermarkt-datasets) y, cuando haya fuente,
-- sus estadísticas de temporada con las mismas claves del catálogo (stats = {stat_id: total}).
create table core.player_pool (
  pool_id         bigint generated always as identity primary key,
  source          text not null check (source ~ '^[a-z_]+$'),
  ext_id          text not null,
  player_name     text not null,
  team_name       text not null,
  club_ext_id     text not null,
  competition     text not null,
  position_group  text check (position_group in ('Arquero', 'Defensor', 'Mediocampista', 'Delantero')),
  age             smallint check (age between 14 and 50),
  minutes         integer check (minutes >= 0),
  stats           jsonb not null default '{}',
  value_eur       bigint check (value_eur > 0 and value_eur <= 500000000),
  value_as_of     date,
  source_url      text check (source_url ~ '^https://'),
  updated_at      timestamptz not null default now(),
  unique (source, ext_id)
);

-- Alternativas de cada jugador propio, de mejor a peor: otro club 1 a 1, dupla de otro club y compañero.
create table core.player_alternative (
  team_slug        text not null,
  player_id        integer not null references core.player (player_id) on delete cascade,
  section          text not null check (section in ('externo', 'dupla', 'club')),
  rank             smallint not null check (rank >= 1),
  members          jsonb not null,
  similarity       numeric not null check (similarity between 0 and 100),
  total_value_eur  bigint,
  savings_eur      bigint,
  primary key (team_slug, player_id, section, rank)
);

create table core.match_prediction (
  prediction_id  bigint generated always as identity primary key,
  team_slug      text not null,
  kind           text not null check (kind in ('escenario', 'backtest')),
  match_date     date,
  home_team      text not null,
  away_team      text not null,
  lambda_home    numeric not null check (lambda_home >= 0),
  lambda_away    numeric not null check (lambda_away >= 0),
  p_home         numeric not null check (p_home between 0 and 1),
  p_draw         numeric not null check (p_draw between 0 and 1),
  p_away         numeric not null check (p_away between 0 and 1),
  top_scores     jsonb not null,
  score_matrix   jsonb not null,
  sim            jsonb,
  actual_home    smallint check (actual_home >= 0),
  actual_away    smallint check (actual_away >= 0),
  unique nulls not distinct (team_slug, kind, home_team, away_team, match_date)
);

create table core.team_strength (
  team_slug      text not null,
  team_name      text not null,
  home_games     integer not null check (home_games >= 0),
  away_games     integer not null check (away_games >= 0),
  attack_home    numeric not null,
  defense_home   numeric not null,
  attack_away    numeric not null,
  defense_away   numeric not null,
  goals_for      integer not null check (goals_for >= 0),
  goals_against  integer not null check (goals_against >= 0),
  primary key (team_slug, team_name)
);

-- Pruebas e intervalos del panel «Probabilidad».
create table core.stat_test (
  team_slug    text not null,
  test_id      text not null check (test_id ~ '^[a-z_0-9]+$'),
  title_es     text not null,
  statistic    numeric not null,
  df           integer,
  p_value      numeric check (p_value between 0 and 1),
  decision_es  text not null,
  detail       jsonb not null default '{}',
  primary key (team_slug, test_id)
);

-- Lectura pública (solo SELECT) como el resto de las tablas del modelo; la escritura es del pipeline.
do $$
declare t text;
begin
  foreach t in array array['player_market_value', 'model_run', 'market_value_prediction', 'market_value_coef',
                           'player_style', 'player_pool', 'player_alternative', 'match_prediction',
                           'team_strength', 'stat_test'] loop
    execute format('alter table core.%I enable row level security', t);
    execute format('create policy anon_read on core.%I for select to anon, powerbi_reader using (true)', t);
    execute format('grant select on core.%I to anon, powerbi_reader', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------------------------
-- Vistas públicas (esquema api). El nombre del jugador sale de core.player; la fecha de nacimiento no.
-- ---------------------------------------------------------------------------------------------
create view api.player_market_value with (security_invoker = true) as
select v.player_id, coalesce(p.known_as, p.full_name) as player_name, v.team_slug, v.as_of, v.value_eur,
       v.source, v.source_url
from core.player_market_value v
join core.player p using (player_id);
comment on view api.player_market_value is 'Valores de mercado reales por jugador y fecha, con su fuente.';

create view api.model_run with (security_invoker = true) as
select model, team_slug, status, n, metrics, params, message, trained_at from core.model_run;
comment on view api.model_run is 'Estado, muestra, métricas y parámetros de cada modelo por equipo.';

create view api.market_value_prediction with (security_invoker = true) as
select m.team_slug, m.player_id, coalesce(p.known_as, p.full_name) as player_name, s.position_group,
       m.actual_eur, m.predicted_eur, m.low_eur, m.high_eur, m.residual_pct, m.features
from core.market_value_prediction m
join core.player p using (player_id)
left join core.squad_member s
  on s.player_id = m.player_id and s.season_year = (select max(season_year) from core.squad_member);
comment on view api.market_value_prediction is 'Valor de mercado real contra el que predice la regresión (ln valor).';

create view api.market_value_coef with (security_invoker = true) as
select team_slug, feature, coef, std_err, t_stat, p_value, ci_low, ci_high from core.market_value_coef;
comment on view api.market_value_coef is 'Coeficientes de la regresión con error estándar, t, p e intervalo del 95 %.';

create view api.player_style with (security_invoker = true) as
select st.team_slug, st.player_id, coalesce(p.known_as, p.full_name) as player_name, s.position_group,
       st.cluster, st.cluster_label, st.pc1, st.pc2, st.features, st.z, st.percentiles
from core.player_style st
join core.player p using (player_id)
left join core.squad_member s
  on s.player_id = st.player_id and s.season_year = (select max(season_year) from core.squad_member);
comment on view api.player_style is 'Perfil de juego (grupo de K-means) y proyección en 2 componentes principales.';

create view api.player_pool with (security_invoker = true) as
select source, ext_id, player_name, team_name, club_ext_id, competition, position_group, age, minutes, stats,
       value_eur, value_as_of, source_url
from core.player_pool;
comment on view api.player_pool is 'Jugadores de otros clubes: valor de mercado y, cuando haya, estadísticas de temporada.';

create view api.player_alternative with (security_invoker = true) as
select team_slug, player_id, section, rank, members, similarity, total_value_eur, savings_eur
from core.player_alternative;
comment on view api.player_alternative is 'Alternativas de cada jugador de mejor a peor: otro club, dupla y compañero.';

create view api.match_prediction with (security_invoker = true) as
select team_slug, kind, match_date, home_team, away_team, lambda_home, lambda_away, p_home, p_draw, p_away,
       top_scores, score_matrix, sim, actual_home, actual_away
from core.match_prediction;
comment on view api.match_prediction is 'Predicción Poisson por partido: escenarios contra cada rival y backtest sin mirar el futuro.';

create view api.team_strength with (security_invoker = true) as
select team_slug, team_name, home_games, away_games, attack_home, defense_home, attack_away, defense_away,
       goals_for, goals_against
from core.team_strength;
comment on view api.team_strength is 'Fuerza de ataque y defensa de cada club (1 = promedio de la liga).';

create view api.stat_test with (security_invoker = true) as
select team_slug, test_id, title_es, statistic, df, p_value, decision_es, detail from core.stat_test;
comment on view api.stat_test is 'Pruebas de hipótesis e intervalos de confianza del equipo (panel Probabilidad).';

grant select on api.player_market_value, api.model_run, api.market_value_prediction, api.market_value_coef,
  api.player_style, api.player_pool, api.player_alternative, api.match_prediction, api.team_strength,
  api.stat_test
  to anon, powerbi_reader, service_role;

-- ---------------------------------------------------------------------------------------------
-- Carga
-- ---------------------------------------------------------------------------------------------
create function ingest.load_market_values(p_rows jsonb)
returns integer
language sql
set search_path = ''
as $$
  with ins as (
    insert into core.player_market_value (player_id, team_slug, as_of, value_eur, source, source_url)
    select r.player_id, r.team_slug, r.as_of, r.value_eur, r.source, r.source_url
    from jsonb_to_recordset(coalesce(p_rows, '[]')) as r(player_id integer, team_slug text, as_of date,
                                                         value_eur bigint, source text, source_url text)
    on conflict (player_id, as_of, source) do update
      set team_slug = excluded.team_slug, value_eur = excluded.value_eur, source_url = excluded.source_url,
          fetched_at = now()
    returning 1
  )
  select count(*)::integer from ins;
$$;
revoke all on function ingest.load_market_values(jsonb) from public, anon, authenticated;
grant execute on function ingest.load_market_values(jsonb) to service_role;

-- Reemplaza todo lo del equipo en una transacción (la función entera lo es): nunca queda mezclado
-- un run nuevo con filas del anterior.
create function ingest.load_models(p_payload jsonb)
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
                                            residual_pct, features)
  select v_team, r.player_id, r.actual_eur, r.predicted_eur, r.low_eur, r.high_eur, r.residual_pct, r.features
  from jsonb_to_recordset(coalesce(p_payload -> 'market_predictions', '[]'))
       as r(player_id integer, actual_eur bigint, predicted_eur bigint, low_eur bigint, high_eur bigint,
            residual_pct numeric, features jsonb);
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
                                     actual_away)
  select v_team, r.kind, r.match_date, r.home_team, r.away_team, r.lambda_home, r.lambda_away, r.p_home,
         r.p_draw, r.p_away, r.top_scores, r.score_matrix, r.sim, r.actual_home, r.actual_away
  from jsonb_to_recordset(coalesce(p_payload -> 'match_predictions', '[]'))
       as r(kind text, match_date date, home_team text, away_team text, lambda_home numeric,
            lambda_away numeric, p_home numeric, p_draw numeric, p_away numeric, top_scores jsonb,
            score_matrix jsonb, sim jsonb, actual_home smallint, actual_away smallint);
  get diagnostics n = row_count;
  v_counts := v_counts || jsonb_build_object('match_predictions', n);

  insert into core.team_strength (team_slug, team_name, home_games, away_games, attack_home, defense_home,
                                  attack_away, defense_away, goals_for, goals_against)
  select v_team, r.team_name, r.home_games, r.away_games, r.attack_home, r.defense_home, r.attack_away,
         r.defense_away, r.goals_for, r.goals_against
  from jsonb_to_recordset(coalesce(p_payload -> 'strengths', '[]'))
       as r(team_name text, home_games integer, away_games integer, attack_home numeric, defense_home numeric,
            attack_away numeric, defense_away numeric, goals_for integer, goals_against integer);

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

-- Jugadores de otros clubes: upsert por fuente e id externo. Las estadísticas que ya tenga una fila
-- (cargadas por otra fuente) no se pisan con un objeto vacío.
create function ingest.load_player_pool(p_rows jsonb)
returns integer
language sql
set search_path = ''
as $$
  with ins as (
    insert into core.player_pool (source, ext_id, player_name, team_name, club_ext_id, competition, position_group,
                                  age, minutes, stats, value_eur, value_as_of, source_url)
    select r.source, r.ext_id, r.player_name, r.team_name, r.club_ext_id, r.competition, r.position_group, r.age,
           r.minutes, coalesce(r.stats, '{}'), r.value_eur, r.value_as_of, r.source_url
    from jsonb_to_recordset(coalesce(p_rows, '[]'))
         as r(source text, ext_id text, player_name text, team_name text, club_ext_id text, competition text,
              position_group text, age smallint, minutes integer, stats jsonb, value_eur bigint,
              value_as_of date, source_url text)
    on conflict (source, ext_id) do update
      set player_name = excluded.player_name, team_name = excluded.team_name,
          club_ext_id = excluded.club_ext_id, competition = excluded.competition,
          position_group = excluded.position_group, age = excluded.age,
          minutes = coalesce(excluded.minutes, core.player_pool.minutes),
          stats = core.player_pool.stats || excluded.stats,
          value_eur = excluded.value_eur, value_as_of = excluded.value_as_of,
          source_url = excluded.source_url, updated_at = now()
    returning 1
  )
  select count(*)::integer from ins;
$$;
revoke all on function ingest.load_player_pool(jsonb) from public, anon, authenticated;
grant execute on function ingest.load_player_pool(jsonb) to service_role;
