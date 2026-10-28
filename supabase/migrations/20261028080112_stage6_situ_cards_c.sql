-- Etapa 6: copia de sql/situational/c_tiros.sql (fuente).
-- =============================================================================
-- C. Tiros y ataque (tarjetas s027 a s040). Los valores salen de las estadísticas por partido
-- (`stats` de api.team_match_master); el xG es solo de la liga (StrikerAPI).
-- =============================================================================
create view core.situ_cards_c as
with v as (
  select match_id, next_match_id, gf, ga, result,
         (s ->> 'shots_total')::numeric as shots, (s ->> 'shots_total_against')::numeric as shots_against,
         (s ->> 'shots_on_target')::numeric as on_target, (s ->> 'shots_on_target_against')::numeric as on_target_against,
         (s ->> 'xg')::numeric as xg, (s ->> 'xg_against')::numeric as xg_against,
         (s ->> 'shots_blocked')::numeric as blocked, (s ->> 'shots_inside_box')::numeric as inside,
         (s ->> 'key_passes')::numeric as key_passes
  from core.situ_base
)
-- s027: remates totales.
select 's027' as card_id, t || ' o más remates' as param_value, o::int as param_order, match_id
from v cross join unnest(array[10, 15, 20]) with ordinality u (t, o) where shots >= t
union all
-- s028: remates al arco.
select 's028', t || ' o más al arco', o::int, match_id
from v cross join unnest(array[4, 6, 8]) with ordinality u (t, o) where on_target >= t
union all
-- s029 y s030: más o menos remates que el rival.
select 's029', 'Más remates que el rival', 1, match_id from v where shots > shots_against
union all
select 's030', 'Menos remates que el rival', 1, match_id from v where shots < shots_against
union all
-- s031: diferencia de remates al arco.
select 's031',
       case when d >= 3 then '+3 o más' when d >= 1 then '+1 a +2' when d = 0 then 'Igual'
            when d >= -2 then '−1 a −2' else '−3 o menos' end,
       case when d >= 3 then 1 when d >= 1 then 2 when d = 0 then 3 when d >= -2 then 4 else 5 end, match_id
from (select match_id, on_target - on_target_against as d from v) x where d is not null
union all
-- s032 y s033: xG a favor y en contra.
select 's032', 'xG ' || replace(t::text, '.', ',') || ' o más', o::int, match_id
from v cross join unnest(array[1.5, 2.0]) with ordinality u (t, o) where xg >= t
union all
select 's033', 'xG en contra ' || replace(t::text, '.', ',') || ' o más', o::int, match_id
from v cross join unnest(array[1.0, 1.5]) with ordinality u (t, o) where xg_against >= t
union all
-- s034: injusticias (más xG y no ganó) y robos (menos xG y ganó).
select 's034', case when xg > xg_against then 'Más xG y no ganó' else 'Menos xG y ganó' end,
       case when xg > xg_against then 1 else 2 end, match_id
from v where (xg > xg_against and result <> 'G') or (xg < xg_against and result = 'G')
union all
-- s035: partido siguiente a convertir por encima o por debajo del xG.
select 's035', case when gf - xg >= 1 then 'Después de goles − xG ≥ 1' else 'Después de goles − xG ≤ −1' end,
       case when gf - xg >= 1 then 1 else 2 end, next_match_id
from v where next_match_id is not null and abs(gf - xg) >= 1
union all
-- s036: efectividad (goles por remate).
select 's036',
       case when e < 0.05 then 'Menos de 5 %' when e < 0.10 then '5 a 10 %' when e < 0.20 then '10 a 20 %' else '20 % o más' end,
       case when e < 0.05 then 1 when e < 0.10 then 2 when e < 0.20 then 3 else 4 end, match_id
from (select match_id, gf / shots as e from v where shots > 0) x
union all
-- s037: precisión (al arco sobre remates).
select 's037', case when on_target / shots >= 0.4 then '40 % o más al arco' else 'Menos de 40 %' end,
       case when on_target / shots >= 0.4 then 1 else 2 end, match_id
from v where shots > 0 and on_target is not null
union all
-- s038: remates bloqueados.
select 's038', t || ' o más bloqueados', o::int, match_id
from v cross join unnest(array[3, 5]) with ordinality u (t, o) where blocked >= t
union all
-- s039: proporción de remates desde dentro del área.
select 's039',
       case when inside / shots >= 0.7 then '70 % o más dentro del área' when inside / shots >= 0.5 then '50 a 70 %'
            else 'Menos de 50 %' end,
       case when inside / shots >= 0.7 then 1 when inside / shots >= 0.5 then 2 else 3 end, match_id
from v where shots > 0 and inside is not null
union all
-- s040: pases clave.
select 's040', t || ' o más pases clave', o::int, match_id
from v cross join unnest(array[6, 10]) with ordinality u (t, o) where key_passes >= t;
