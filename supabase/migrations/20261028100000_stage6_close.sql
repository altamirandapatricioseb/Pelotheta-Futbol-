-- Etapa 6 (cierre): más métricas por fila de Situaciones, métrica principal por tarjeta,
-- detalle de 6.1 para los gráficos 81 y 82 y conclusiones (sql/conclusions.sql).
alter table core.situational_catalog add column if not exists main_metric text not null default 'win_pct';
alter table core.situational_result
  add column if not exists gf_avg numeric not null default 0,
  add column if not exists ga_avg numeric not null default 0,
  add column if not exists clean_pct numeric not null default 0,
  add column if not exists scored_pct numeric not null default 0,
  add column if not exists base_ppg numeric not null default 0,
  add column if not exists base_gf numeric not null default 0,
  add column if not exists base_ga numeric not null default 0,
  add column if not exists base_clean numeric not null default 0;

create or replace function core.refresh_situations()
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
                                       base_win_pct, delta, gf_avg, ga_avg, clean_pct, scored_pct, base_ppg, base_gf,
                                       base_ga, base_clean)
  with base as (
    select avg(case when result = 'G' then 100.0 else 0 end) as win_pct, avg(points) as ppg, avg(gf) as gf,
           avg(ga) as ga, avg(case when ga = 0 then 100.0 else 0 end) as clean
    from core.situ_base
  )
  select m.card_id, m.param_value, min(m.param_order), count(*),
         count(*) filter (where b.result = 'G'), count(*) filter (where b.result = 'E'),
         count(*) filter (where b.result = 'P'),
         round(avg(case when b.result = 'G' then 100.0 else 0 end), 1),
         round(avg(b.points), 2), round(avg(b.gf - b.ga), 2),
         round(max(base.win_pct), 1),
         round(avg(case when b.result = 'G' then 100.0 else 0 end) - max(base.win_pct), 1),
         round(avg(b.gf), 2), round(avg(b.ga), 2),
         round(avg(case when b.ga = 0 then 100.0 else 0 end), 1),
         round(avg(case when b.gf > 0 then 100.0 else 0 end), 1),
         round(max(base.ppg), 2), round(max(base.gf), 2), round(max(base.ga), 2), round(max(base.clean), 1)
  from core.situational_match m
  join core.situ_base b on b.match_id = m.match_id
  cross join base
  group by m.card_id, m.param_value;
end;
$$;

create or replace function ingest.load_situations(p_cards jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  n_cards integer;
begin
  delete from core.situational_catalog where true;
  insert into core.situational_catalog (card_id, category, title_es, condition_es, params_es, measured_es,
                                        required_data, level, available, estimated, reason_es, main_metric, sort_order)
  select c ->> 'card_id', c ->> 'category', c ->> 'title_es', c ->> 'condition_es', coalesce(c ->> 'params_es', ''),
         c ->> 'measured_es', c ->> 'required_data', c ->> 'level', (c ->> 'available')::boolean,
         (c ->> 'estimated')::boolean, coalesce(c ->> 'reason_es', ''), coalesce(c ->> 'main_metric', 'win_pct'),
         (c ->> 'sort_order')::smallint
  from jsonb_array_elements(p_cards) c;
  get diagnostics n_cards = row_count;
  return jsonb_build_object('cards', n_cards);
end;
$$;

create or replace view api.situational_catalog
with (security_invoker = true) as
select card_id, category, title_es, condition_es, params_es, measured_es, required_data, level, available,
       estimated, reason_es, sort_order, main_metric
from core.situational_catalog;

create or replace view api.situational_result
with (security_invoker = true) as
select card_id, param_value, param_order, n, w, d, l, win_pct, ppg, goal_diff, base_win_pct, delta, computed_at,
       gf_avg, ga_avg, clean_pct, scored_pct, base_ppg, base_gf, base_ga, base_clean
from core.situational_result;

-- Detalle de las métricas de 6.1 por jugador (componentes del índice y partes del Potencial β).
create view api.stat_value_detail
with (security_invoker = true) as
select entity_id as player_id, stat_id, value, detail
from core.stat_value
where entity = 'player' and competition_code = 'todas' and detail is not null;
grant select on api.stat_value_detail to anon, service_role;

-- =============================================================================
-- Conclusiones (Interfaz 4): frases sobre el equipo que salen de reglas, no de texto fijo.
--
-- Cada regla de `core.conclusion_rule` (data/conclusion_catalog.csv) dice qué medir, contra qué
-- compararlo y qué decir en cada banda. `core.refresh_conclusions()` calcula el valor con los
-- datos de la temporada en curso y elige la banda (alta, media o baja): si la temporada que viene
-- cambian los números, cambia la conclusión y su color sin tocar el código.
--
-- Tipos de regla:
--   liga        promedio por partido de Boca en una estadística de los 30 clubes de la liga
--               (`api.club_season_stat`) y su percentil entre ellos.
--   proporcion  suma de `clave_num` sobre suma de `clave_den` (× factor) del equipo o de una
--               posición; el denominador solo cuenta los partidos que tienen el numerador.
--   cuota       parte de la posición en el total del plantel de `clave_num`, dividida por su parte
--               de los minutos: 1 es lo esperable para los minutos que juega.
-- =============================================================================
create table core.conclusion_rule (
  rule_id      text primary key,
  area         text not null,
  title_es     text not null,
  kind         text not null check (kind in ('liga', 'proporcion', 'cuota')),
  num_key      text not null,
  den_key      text not null default '',
  scope        text not null default 'equipo',
  factor       numeric not null default 1,
  unit         text not null default '',
  high         numeric not null,
  low          numeric not null,
  min_n        numeric not null default 0,
  tone_high    text not null check (tone_high in ('positivo', 'negativo', 'neutral', '')),
  tone_mid     text not null check (tone_mid in ('positivo', 'negativo', 'neutral', '')),
  tone_low     text not null check (tone_low in ('positivo', 'negativo', 'neutral', '')),
  text_high    text not null default '',
  text_mid     text not null default '',
  text_low     text not null default '',
  link         text not null default '',
  sort_order   smallint not null
);

create table core.conclusion_result (
  rule_id     text primary key references core.conclusion_rule (rule_id) on delete cascade,
  band        text not null check (band in ('alta', 'media', 'baja')),
  value       numeric not null,
  reference   numeric,
  percentile  numeric,
  n           numeric not null,
  computed_at timestamptz not null default now()
);

alter table core.conclusion_rule enable row level security;
alter table core.conclusion_result enable row level security;
create policy anon_read on core.conclusion_rule for select to anon using (true);
create policy anon_read on core.conclusion_result for select to anon using (true);
grant select on core.conclusion_rule, core.conclusion_result to anon;

create function core.refresh_conclusions()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from core.conclusion_result where true;

  insert into core.conclusion_result (rule_id, band, value, reference, percentile, n)
  with rules as (
    select * from core.conclusion_rule
  ),
  -- Promedio por partido de cada club (los totales se pasan a promedio con los partidos jugados).
  club as (
    select c.team_name, c.stat_key,
           case when c.stat_key in ('clean_sheets', 'failed_to_score', 'red_cards_total')
                then c.value / nullif(g.value, 0) else c.value end as v
    from api.club_season_stat c
    join api.club_season_stat g on g.team_name = c.team_name and g.season = c.season and g.stat_key = 'games'
    where c.season = (select max(season) from api.club_season_stat)
  ),
  liga as (
    select r.rule_id, b.v as value, avg(c.v) as reference,
           100.0 * count(*) filter (where c.v < b.v) / nullif(count(*) - 1, 0) as percentile,
           count(*)::numeric as n
    from rules r
    join club c on c.stat_key = r.num_key
    join club b on b.stat_key = r.num_key and lower(b.team_name) = 'boca juniors'
    where r.kind = 'liga'
    group by r.rule_id, b.v
  ),
  -- Partidos de Boca con los valores base del equipo (formato largo).
  team as (
    select v.match_id, v.key, v.value from api.team_match_value v
  ),
  prop_team as (
    select r.rule_id, sum(nm.value) as num, sum(dn.value) as den
    from rules r
    join team nm on nm.key = r.num_key
    join team dn on dn.key = r.den_key and dn.match_id = nm.match_id
    where r.kind = 'proporcion' and r.scope = 'equipo'
    group by r.rule_id
  ),
  -- Valores por partido de cada jugador con su posición en la temporada.
  player as (
    select v.player_id, v.match_id, v.key, v.value, pm.position_group as position
    from api.player_match_value v
    join api.player_master pm on pm.player_id = v.player_id and pm.competition_code = 'todas'
  ),
  prop_player as (
    select r.rule_id, sum(nm.value) as num, sum(dn.value) as den
    from rules r
    join player nm on nm.key = r.num_key and nm.position = r.scope
    join player dn on dn.key = r.den_key and dn.player_id = nm.player_id and dn.match_id = nm.match_id
    where r.kind = 'proporcion' and r.scope <> 'equipo'
    group by r.rule_id
  ),
  share as (
    select r.rule_id,
           sum(p.value) filter (where p.key = r.num_key and p.position = r.scope) as group_num,
           sum(p.value) filter (where p.key = r.num_key) as squad_num,
           sum(p.value) filter (where p.key = 'minutes' and p.position = r.scope) as group_min,
           sum(p.value) filter (where p.key = 'minutes') as squad_min
    from rules r
    join player p on p.key in (r.num_key, 'minutes')
    where r.kind = 'cuota'
    group by r.rule_id
  ),
  measured as (
    select rule_id, value, reference, percentile, n from liga
    union all
    select rule_id, num / den * r.factor, null, null, den
    from (select * from prop_team union all select * from prop_player) p
    join rules r using (rule_id)
    where den > 0
    union all
    -- Cuota: la referencia es la parte de los minutos (en %) y n es el total del plantel.
    select rule_id, (group_num / squad_num) / (group_min / squad_min), 100 * group_min / squad_min, null, squad_num
    from share
    where squad_num > 0 and squad_min > 0 and group_min > 0
  )
  select m.rule_id,
         case when coalesce(m.percentile, m.value) >= r.high then 'alta'
              when coalesce(m.percentile, m.value) <= r.low then 'baja'
              else 'media' end,
         round(m.value, 4), round(m.reference, 4), round(m.percentile, 1), m.n
  from measured m
  join rules r using (rule_id)
  where m.value is not null and m.n >= r.min_n;
end;
$$;
revoke all on function core.refresh_conclusions() from public;
grant execute on function core.refresh_conclusions() to service_role;

create function ingest.load_conclusions(p_rules jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  n_rules integer;
begin
  delete from core.conclusion_rule where true;
  insert into core.conclusion_rule (rule_id, area, title_es, kind, num_key, den_key, scope, factor, unit, high, low,
                                    min_n, tone_high, tone_mid, tone_low, text_high, text_mid, text_low, link,
                                    sort_order)
  select r ->> 'rule_id', r ->> 'area', r ->> 'title_es', r ->> 'kind', r ->> 'num_key', coalesce(r ->> 'den_key', ''),
         coalesce(r ->> 'scope', 'equipo'), coalesce((r ->> 'factor')::numeric, 1), coalesce(r ->> 'unit', ''),
         (r ->> 'high')::numeric, (r ->> 'low')::numeric, coalesce((r ->> 'min_n')::numeric, 0),
         coalesce(r ->> 'tone_high', ''), coalesce(r ->> 'tone_mid', ''), coalesce(r ->> 'tone_low', ''),
         coalesce(r ->> 'text_high', ''), coalesce(r ->> 'text_mid', ''), coalesce(r ->> 'text_low', ''),
         coalesce(r ->> 'link', ''), (r ->> 'sort_order')::smallint
  from jsonb_array_elements(p_rules) r;
  get diagnostics n_rules = row_count;
  perform core.refresh_conclusions();
  return jsonb_build_object('rules', n_rules);
end;
$$;
revoke all on function ingest.load_conclusions(jsonb) from public;
grant execute on function ingest.load_conclusions(jsonb) to service_role;

-- Conclusión vigente de cada regla, con la frase y el tono de su banda (la web reemplaza
-- {valor}, {referencia}, {percentil} y {n} con los números formateados).
create view api.conclusion
with (security_invoker = true) as
select r.rule_id, r.area, r.title_es, r.kind, r.scope, r.unit, r.link, r.sort_order, c.band, c.value, c.reference,
       c.percentile, c.n, c.computed_at,
       case c.band when 'alta' then r.tone_high when 'baja' then r.tone_low else r.tone_mid end as tone,
       case c.band when 'alta' then r.text_high when 'baja' then r.text_low else r.text_mid end as text_es
from core.conclusion_rule r
join core.conclusion_result c using (rule_id);
grant select on api.conclusion to anon, service_role;

-- El refresco de cada corrida también recalcula las conclusiones.
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
  perform core.refresh_conclusions();
end;
$$;


select core.refresh_situations();
