-- =============================================================================
-- Tabla maestra de jugadores (Interfaz 3): una fila por jugador y ventana (cada competición y
-- 'todas') con todas las estadísticas del catálogo en un objeto JSON {stat_id: valor}.
-- Es el texto de la vista materializada `core.player_master_mv`.
--
-- Reglas del catálogo (`core.stat_catalog.rule`):
--   suma / promedio: sobre los valores por partido del jugador en la ventana. Si el jugador no
--     tiene ninguna fila de esa clave (por ejemplo, un dato solo de liga y él jugó solo copas),
--     queda n/d y no 0.
--   cociente / diferencia / adición: suma sobre suma, solo con los partidos que tienen los dos datos.
--   métrica / especial: ya calculadas en Python (`core.stat_value`).
-- =============================================================================
with window_match as (
  select match_id, competition_code as code from api.boca_match where status = 'jugado'
  union all
  select match_id, 'todas' from api.boca_match where status = 'jugado'
),
pmv as (
  select v.match_id, v.player_id, v.key, v.value, w.code
  from core.player_match_value_mv v
  join window_match w on w.match_id = v.match_id
),
player_window as (
  select player_id, code,
         sum(value) filter (where key = 'appearances') as matches,
         sum(value) filter (where key = 'minutes') as minutes
  from pmv
  group by player_id, code
  having sum(value) filter (where key = 'appearances') > 0
),
base as (
  select player_id, code, key, sum(value) as total, avg(value) as average
  from pmv
  group by player_id, code, key
),
cat as (
  select * from core.stat_catalog where entity = 'player'
),
simple_value as (
  select p.player_id, p.code, c.stat_id,
         case c.rule when 'suma' then b.total else b.average end as value
  from player_window p
  join cat c on c.rule in ('suma', 'promedio')
  join base b on b.player_id = p.player_id and b.code = p.code and b.key = c.arg1
),
composite_sum as (
  select v1.player_id, v1.code, c.stat_id, c.rule, c.factor,
         sum(v1.value) as s1, sum(v2.value) as s2
  from cat c
  join cat c1 on c1.stat_id = c.arg1
  join cat c2 on c2.stat_id = c.arg2
  join pmv v1 on v1.key = c1.arg1
  join pmv v2 on v2.key = c2.arg1 and v2.match_id = v1.match_id
             and v2.player_id = v1.player_id and v2.code = v1.code
  where c.rule in ('cociente', 'diferencia', 'adicion')
  group by v1.player_id, v1.code, c.stat_id, c.rule, c.factor
),
composite_value as (
  select player_id, code, stat_id,
         case rule
           when 'cociente' then case when s2 <> 0 then s1 / s2 * factor end
           when 'diferencia' then s1 - s2
           else s1 + s2
         end as value
  from composite_sum
),
stored_value as (
  select entity_id as player_id, competition_code as code, stat_id, value
  from core.stat_value
  where entity = 'player'
),
all_value as (
  select player_id, code, stat_id, value from simple_value
  union all select player_id, code, stat_id, value from composite_value
  union all select player_id, code, stat_id, value from stored_value
),
season as (
  select max(season_year) as year from api.boca_match
)
select p.player_id, p.code as competition_code, pl.full_name, pl.known_as,
       coalesce(sm.position_group, pl.position_raw) as position_group, sm.shirt_number,
       core.player_age(p.player_id) as age, pl.height_cm,
       coalesce(pp.weight_kg, pl.weight_kg) as weight_kg,
       coalesce(pp.preferred_foot, pl.preferred_foot) as preferred_foot,
       coalesce(pp.nationality, pl.nationality) as nationality,
       p.matches::integer as matches, p.minutes::integer as minutes,
       coalesce(jsonb_object_agg(av.stat_id, round(av.value, 4)) filter (where av.value is not null),
                '{}'::jsonb) as stats
from player_window p
join core.player pl on pl.player_id = p.player_id
cross join season
left join core.squad_member sm on sm.player_id = p.player_id and sm.season_year = season.year
left join core.player_profile pp on pp.player_id = p.player_id
left join all_value av on av.player_id = p.player_id and av.code = p.code
group by p.player_id, p.code, pl.full_name, pl.known_as, sm.position_group, pl.position_raw,
         sm.shirt_number, pl.height_cm, pp.weight_kg, pl.weight_kg, pp.preferred_foot,
         pl.preferred_foot, pp.nationality, pl.nationality, p.matches, p.minutes
