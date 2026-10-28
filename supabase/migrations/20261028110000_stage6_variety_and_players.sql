-- Etapa 6 (pedidos del dueño): más estadísticas por fila de Situaciones y conclusiones por jugador.

-- 1. Situaciones: promedios de estadísticas del partido en cada fila (remates, xG, posesión,
--    córners, tarjetas...) y los de la temporada para comparar. La tarjeta elige cuáles mostrar.
alter table core.situational_result
  add column if not exists stats jsonb not null default '{}',
  add column if not exists base_stats jsonb not null default '{}';
alter table core.situational_catalog add column if not exists extra_metrics text not null default '';

-- Promedios de las estadísticas que muestran las filas, para un grupo de partidos.
create or replace function core.situ_stat_avgs(p_matches integer[])
returns jsonb
language sql stable
set search_path = ''
as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'shots_total', round(avg((s ->> 'shots_total')::numeric), 2),
    'shots_on_target', round(avg((s ->> 'shots_on_target')::numeric), 2),
    'shots_total_against', round(avg((s ->> 'shots_total_against')::numeric), 2),
    'xg', round(avg((s ->> 'xg')::numeric), 2),
    'xg_against', round(avg((s ->> 'xg_against')::numeric), 2),
    'possession_pct', round(avg((s ->> 'possession_pct')::numeric), 1),
    'pass_accuracy_pct', round(avg((s ->> 'pass_accuracy_pct')::numeric), 1),
    'corners', round(avg((s ->> 'corners')::numeric), 2),
    'big_chances', round(avg((s ->> 'big_chances')::numeric), 2),
    'fouls', round(avg((s ->> 'fouls')::numeric), 2),
    'yellow_cards', round(avg((s ->> 'yellow_cards')::numeric), 2),
    'yellow_cards_against', round(avg((s ->> 'yellow_cards_against')::numeric), 2),
    'saves', round(avg((s ->> 'saves')::numeric), 2)
  ))
  from core.situ_base where match_id = any (p_matches)
$$;

create or replace function core.refresh_situations()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  season_stats jsonb;
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

  season_stats := core.situ_stat_avgs(array(select match_id from core.situ_base));

  delete from core.situational_result where true;
  insert into core.situational_result (card_id, param_value, param_order, n, w, d, l, win_pct, ppg, goal_diff,
                                       base_win_pct, delta, gf_avg, ga_avg, clean_pct, scored_pct, base_ppg, base_gf,
                                       base_ga, base_clean, stats, base_stats)
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
         round(max(base.ppg), 2), round(max(base.gf), 2), round(max(base.ga), 2), round(max(base.clean), 1),
         core.situ_stat_avgs(array_agg(m.match_id)), season_stats
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
                                        required_data, level, available, estimated, reason_es, main_metric,
                                        extra_metrics, sort_order)
  select c ->> 'card_id', c ->> 'category', c ->> 'title_es', c ->> 'condition_es', coalesce(c ->> 'params_es', ''),
         c ->> 'measured_es', c ->> 'required_data', c ->> 'level', (c ->> 'available')::boolean,
         (c ->> 'estimated')::boolean, coalesce(c ->> 'reason_es', ''), coalesce(c ->> 'main_metric', 'win_pct'),
         coalesce(c ->> 'extra_metrics', ''), (c ->> 'sort_order')::smallint
  from jsonb_array_elements(p_cards) c;
  get diagnostics n_cards = row_count;
  return jsonb_build_object('cards', n_cards);
end;
$$;

create or replace view api.situational_catalog
with (security_invoker = true) as
select card_id, category, title_es, condition_es, params_es, measured_es, required_data, level, available,
       estimated, reason_es, sort_order, main_metric, extra_metrics
from core.situational_catalog;

create or replace view api.situational_result
with (security_invoker = true) as
select card_id, param_value, param_order, n, w, d, l, win_pct, ppg, goal_diff, base_win_pct, delta, computed_at,
       gf_avg, ga_avg, clean_pct, scored_pct, base_ppg, base_gf, base_ga, base_clean, stats, base_stats
from core.situational_result;

-- 2. Conclusiones por jugador: regla de tipo «jugador» = estadística cada 90 minutos (o una
--    proporción) de cada jugador con 450 minutos o más, y su percentil entre los de su posición
--    (o entre todos los de campo). Una fila por regla y jugador.
drop view api.conclusion;
alter table core.conclusion_result drop constraint conclusion_result_pkey;
alter table core.conclusion_result add column if not exists entity_id integer not null default 0;
alter table core.conclusion_result add primary key (rule_id, entity_id);
alter table core.conclusion_rule drop constraint conclusion_rule_kind_check;
alter table core.conclusion_rule add constraint conclusion_rule_kind_check
  check (kind in ('liga', 'proporcion', 'cuota', 'jugador'));

create or replace function core.refresh_conclusions()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from core.conclusion_result where true;

  insert into core.conclusion_result (rule_id, entity_id, band, value, reference, percentile, n)
  with rules as (
    select * from core.conclusion_rule
  ),
  club as (
    select c.team_name, c.stat_key,
           case when c.stat_key in ('clean_sheets', 'failed_to_score', 'red_cards_total')
                then c.value / nullif(g.value, 0) else c.value end as v
    from api.club_season_stat c
    join api.club_season_stat g on g.team_name = c.team_name and g.season = c.season and g.stat_key = 'games'
    where c.season = (select max(season) from api.club_season_stat)
  ),
  liga as (
    select r.rule_id, 0 as entity_id, b.v as value, avg(c.v) as reference,
           100.0 * count(*) filter (where c.v < b.v) / nullif(count(*) - 1, 0) as percentile,
           count(*)::numeric as n
    from rules r
    join club c on c.stat_key = r.num_key
    join club b on b.stat_key = r.num_key and lower(b.team_name) = 'boca juniors'
    where r.kind = 'liga'
    group by r.rule_id, b.v
  ),
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
  player as (
    -- Solo las claves que usan las reglas (la tabla de valores por jugador es grande).
    select v.player_id, v.match_id, v.key, v.value, pm.position_group as position
    from api.player_match_value v
    join api.player_master pm on pm.player_id = v.player_id and pm.competition_code = 'todas'
    where v.key in (select num_key from rules union select den_key from rules union select 'minutes')
  ),
  minutes as (
    select player_id, sum(value) as mins from player where key = 'minutes' group by player_id
  ),
  prop_player as (
    select r.rule_id, sum(nm.value) as num, sum(dn.value) as den
    from rules r
    join player nm on nm.key = r.num_key and nm.position = r.scope
    join player dn on dn.key = r.den_key and dn.player_id = nm.player_id and dn.match_id = nm.match_id
    where r.kind = 'proporcion' and r.scope not in ('equipo', 'todos')
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
  -- Jugadores: totales de la temporada (el denominador solo en los partidos con numerador).
  jug as (
    select r.rule_id, p.player_id, p.position,
           sum(p.value) filter (where p.key = r.num_key) as num,
           sum(d.value) as den,
           max(mn.mins) as mins
    from rules r
    join player p on p.key = r.num_key
    join player d on d.key = r.den_key and d.player_id = p.player_id and d.match_id = p.match_id
    join minutes mn on mn.player_id = p.player_id
    where r.kind = 'jugador'
      and ((r.scope = 'todos' and p.position <> 'Arquero') or p.position = r.scope)
    group by r.rule_id, p.player_id, p.position
  ),
  jug_value as (
    select j.rule_id, j.player_id, j.num / j.den * r.factor as value, j.den
    from jug j join rules r using (rule_id)
    where j.mins >= 450 and j.den > 0 and j.den >= r.min_n
  ),
  jug_rank as (
    select rule_id, player_id, value, den,
           100.0 * (rank() over (partition by rule_id order by value) - 1)
             / nullif(count(*) over (partition by rule_id) - 1, 0) as percentile,
           avg(value) over (partition by rule_id) as reference
    from jug_value
  ),
  measured as (
    select rule_id, entity_id, value, reference, percentile, n from liga
    union all
    select rule_id, 0, num / den * r.factor, null, null, den
    from (select * from prop_team union all select * from prop_player) p
    join rules r using (rule_id)
    where den > 0
    union all
    select rule_id, 0, (group_num / squad_num) / (group_min / squad_min), 100 * group_min / squad_min, null, squad_num
    from share
    where squad_num > 0 and squad_min > 0 and group_min > 0
    union all
    select rule_id, player_id, value, reference, percentile, den from jug_rank
  )
  select m.rule_id, m.entity_id,
         case when coalesce(m.percentile, m.value) >= r.high then 'alta'
              when coalesce(m.percentile, m.value) <= r.low then 'baja'
              else 'media' end,
         round(m.value, 4), round(m.reference, 4), round(m.percentile, 1), m.n
  from measured m
  join rules r using (rule_id)
  where m.value is not null and (r.kind = 'jugador' or m.n >= r.min_n);
end;
$$;

create view api.conclusion
with (security_invoker = true) as
select r.rule_id, c.entity_id, coalesce(nullif(p.known_as, ''), p.full_name) as player_name, r.area, r.title_es,
       r.kind, r.scope, r.unit, r.link, r.sort_order, c.band, c.value, c.reference, c.percentile, c.n, c.computed_at,
       case c.band when 'alta' then r.tone_high when 'baja' then r.tone_low else r.tone_mid end as tone,
       case c.band when 'alta' then r.text_high when 'baja' then r.text_low else r.text_mid end as text_es
from core.conclusion_rule r
join core.conclusion_result c using (rule_id)
left join core.player p on p.player_id = c.entity_id and c.entity_id > 0;
grant select on api.conclusion to anon, service_role;

select core.refresh_situations();
select core.refresh_conclusions();
