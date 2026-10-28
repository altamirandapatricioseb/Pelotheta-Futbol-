-- Etapa 6: tablas, refresco y vistas de Situaciones. Copia de sql/situational/zz_refresh.sql (fuente).
-- =============================================================================
-- Situaciones: tablas, carga del catálogo y refresco.
--
-- `core.situational_catalog` viene de data/situational_catalog.csv (lo envía el pipeline con
-- `ingest.load_situations`). `core.refresh_situations()` junta las filas de todas las vistas
-- core.situ_cards_* en `core.situational_match` y calcula `core.situational_result`.
-- =============================================================================
create table core.situational_catalog (
  card_id        text primary key,
  category       text not null,
  title_es       text not null,
  condition_es   text not null,
  params_es      text not null default '',
  measured_es    text not null,
  required_data  text not null,
  level          text not null check (level in ('A', 'B', 'C')),
  available      boolean not null,
  estimated      boolean not null default false,
  reason_es      text not null default '',
  sort_order     smallint not null
);

create table core.situational_match (
  card_id     text not null,
  param_value text not null,
  param_order integer not null,
  match_id    integer not null references core.match (match_id) on delete cascade,
  primary key (card_id, param_value, match_id)
);

create table core.situational_result (
  card_id      text not null,
  param_value  text not null,
  param_order  integer not null,
  n            integer not null,
  w            integer not null,
  d            integer not null,
  l            integer not null,
  win_pct      numeric not null,
  ppg          numeric not null,
  goal_diff    numeric not null,
  base_win_pct numeric not null,
  delta        numeric not null,
  computed_at  timestamptz not null default now(),
  primary key (card_id, param_value)
);

alter table core.situational_catalog enable row level security;
alter table core.situational_match enable row level security;
alter table core.situational_result enable row level security;
create policy anon_read on core.situational_catalog for select to anon using (true);
create policy anon_read on core.situational_match for select to anon using (true);
create policy anon_read on core.situational_result for select to anon using (true);
grant select on core.situational_catalog, core.situational_match, core.situational_result to anon;
grant select on core.situ_base to anon;

-- Refresco: SECURITY DEFINER por el REFRESH MATERIALIZED VIEW (mismo criterio que
-- core.refresh_stats: vive en core, sin parámetros, search_path vacío y solo service_role).
create function core.refresh_situations()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  refresh materialized view core.situ_base;

  delete from core.situational_match where true;
  insert into core.situational_match (card_id, param_value, param_order, match_id)
  select distinct on (card_id, param_value, match_id) card_id, param_value, param_order, match_id
  from (
    select * from core.situ_cards_a union all select * from core.situ_cards_b
    union all select * from core.situ_cards_c union all select * from core.situ_cards_d
    union all select * from core.situ_cards_e union all select * from core.situ_cards_f
    union all select * from core.situ_cards_g union all select * from core.situ_cards_h
    union all select * from core.situ_cards_i union all select * from core.situ_cards_j
    union all select * from core.situ_cards_k
  ) cards
  where match_id is not null and param_value is not null
  order by card_id, param_value, match_id, param_order;

  delete from core.situational_result where true;
  insert into core.situational_result (card_id, param_value, param_order, n, w, d, l, win_pct, ppg, goal_diff,
                                       base_win_pct, delta)
  with base as (
    select avg(case when result = 'G' then 100.0 else 0 end) as win_pct from core.situ_base
  )
  select m.card_id, m.param_value, min(m.param_order), count(*),
         count(*) filter (where b.result = 'G'), count(*) filter (where b.result = 'E'),
         count(*) filter (where b.result = 'P'),
         round(avg(case when b.result = 'G' then 100.0 else 0 end), 1),
         round(avg(b.points), 2), round(avg(b.gf - b.ga), 2),
         round(max(base.win_pct), 1),
         round(avg(case when b.result = 'G' then 100.0 else 0 end) - max(base.win_pct), 1)
  from core.situational_match m
  join core.situ_base b on b.match_id = m.match_id
  cross join base
  group by m.card_id, m.param_value;
end;
$$;
revoke all on function core.refresh_situations() from public;
grant execute on function core.refresh_situations() to service_role;

-- El refresco de estadísticas (al final de cada corrida) también rearma las situaciones.
create or replace function core.refresh_stats()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  refresh materialized view core.player_match_value_mv;
  refresh materialized view core.player_master_mv;
  perform core.refresh_situations();
end;
$$;

-- Carga del catálogo (lo llama el pipeline en cada corrida con data/situational_catalog.csv).
create function ingest.load_situations(p_cards jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  n_cards integer;
begin
  delete from core.situational_catalog where true;
  insert into core.situational_catalog (card_id, category, title_es, condition_es, params_es, measured_es,
                                        required_data, level, available, estimated, reason_es, sort_order)
  select c ->> 'card_id', c ->> 'category', c ->> 'title_es', c ->> 'condition_es', coalesce(c ->> 'params_es', ''),
         c ->> 'measured_es', c ->> 'required_data', c ->> 'level', (c ->> 'available')::boolean,
         (c ->> 'estimated')::boolean, coalesce(c ->> 'reason_es', ''), (c ->> 'sort_order')::smallint
  from jsonb_array_elements(p_cards) c;
  get diagnostics n_cards = row_count;
  return jsonb_build_object('cards', n_cards);
end;
$$;
revoke all on function ingest.load_situations(jsonb) from public;
grant execute on function ingest.load_situations(jsonb) to service_role;

-- Vistas de la web.
create view api.situational_catalog
with (security_invoker = true) as
select card_id, category, title_es, condition_es, params_es, measured_es, required_data, level, available,
       estimated, reason_es, sort_order
from core.situational_catalog;

create view api.situational_result
with (security_invoker = true) as
select card_id, param_value, param_order, n, w, d, l, win_pct, ppg, goal_diff, base_win_pct, delta, computed_at
from core.situational_result;

-- Partidos de cada fila («Ver los partidos»), con lo necesario para verificarlos a mano.
create view api.situational_match
with (security_invoker = true) as
select m.card_id, m.param_value, m.match_id, b.match_date, b.competition_name, b.opponent, b.home,
       b.gf as goals_for, b.ga as goals_against, b.result
from core.situational_match m
join core.situ_base b on b.match_id = m.match_id;

grant select on api.situational_catalog, api.situational_result, api.situational_match to anon, service_role;

select core.refresh_situations();
