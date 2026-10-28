-- =============================================================================
-- D. Posesión y circulación (tarjetas s041 a s050). s043, s044, s046 y s048 quedan n/d: ninguna
-- fuente gratuita publica pases al último tercio, progresivos ni recuperaciones por zona.
-- =============================================================================
create view core.situ_cards_d as
with v as (
  select match_id, (s ->> 'possession_pct')::numeric as possession, (s ->> 'pass_accuracy_pct')::numeric as pass_pct,
         (s ->> 'possession_lost_players')::numeric as lost, (s ->> 'passes_against')::numeric as passes_against,
         (s ->> 'defensive_actions_ppda')::numeric as def_actions, (s ->> 'crosses')::numeric as crosses,
         (s ->> 'goals_header')::numeric as header_goals, (s ->> 'xg')::numeric as xg
  from core.situ_base
)
-- s041: posesión alta o baja.
select 's041' as card_id, case when possession >= 60 then '60 % o más' else '40 % o menos' end as param_value,
       case when possession >= 60 then 1 else 2 end as param_order, match_id
from v where possession >= 60 or possession <= 40
union all
-- s042: precisión de pase.
select 's042', case when pass_pct >= 85 then '85 % o más' else '75 % o menos' end, case when pass_pct >= 85 then 1 else 2 end, match_id
from v where pass_pct >= 85 or pass_pct <= 75
union all
-- s045: pérdidas de balón (suma de los jugadores).
select 's045', t || ' o más pérdidas', o::int, match_id
from v cross join unnest(array[130, 150]) with ordinality u (t, o) where lost >= t
union all
-- s047: PPDA (pases del rival por acción defensiva): bajo es presión alta.
select 's047', case when ppda < 8 then 'PPDA menor a 8 (presión alta)' else 'PPDA mayor a 12 (presión baja)' end,
       case when ppda < 8 then 1 else 2 end, match_id
from (select match_id, passes_against / def_actions as ppda from v where def_actions > 0) x where ppda < 8 or ppda > 12
union all
-- s049: centros y goles de cabeza.
select 's049', t || ' o más centros', o::int, match_id
from v cross join unnest(array[20, 30]) with ordinality u (t, o) where crosses >= t
union all
select 's049', 'Con gol de cabeza', 3, match_id from v where header_goals >= 1
union all
-- s050: posesión alta sin peligro (más de 55 % y xG menor a 1).
select 's050', 'Posesión > 55 % y xG < 1', 1, match_id from v where possession > 55 and xg < 1;
