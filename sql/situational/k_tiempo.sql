-- =============================================================================
-- K. Tiempo y ritmo (tarjetas s126 a s131).
-- =============================================================================
create view core.situ_cards_k as
with v as (
  select match_id, gf, ga, gf_ht, ga_ht,
         (s ->> 'minutes_leading')::numeric as lead_min, (s ->> 'minutes_trailing')::numeric as trail_min,
         (s ->> 'points_from_behind')::numeric as from_behind, (s ->> 'points_dropped_from_ahead')::numeric as dropped
  from core.situ_base
),
comeback as (
  -- Primer gol de Boca después de estar perdiendo, en partidos en que sumó desde atrás.
  select g.match_id, min(g.minute) as minute
  from core.situ_goal g
  join v on v.match_id = g.match_id and v.from_behind > 0
  where g.for_boca
    and (select count(*) filter (where not h.for_boca) - count(*) filter (where h.for_boca)
         from core.situ_goal h where h.match_id = g.match_id and h.minute_order < g.minute_order) > 0
  group by g.match_id
)
-- s126: cuánto tiempo estuvo arriba o abajo en el marcador.
select 's126' as card_id,
       case when lead_min >= 45 then '45 minutos o más ganando' when trail_min >= 30 then '30 minutos o más perdiendo'
            else 'Ni lo uno ni lo otro' end as param_value,
       case when lead_min >= 45 then 1 when trail_min >= 30 then 2 else 3 end as param_order, match_id
from v where lead_min is not null
union all
-- s127: tramos en que más goles marca (una fila por tramo con gol a favor).
select distinct 's127', core.situ_band_label(core.situ_band(minute, period)), core.situ_band(minute, period), match_id
from core.situ_goal where for_boca
union all
-- s128: quién ganó cada tiempo.
select 's128', 'Ganó el primer tiempo', 1, match_id from v where gf_ht > ga_ht
union all
select 's128', 'Ganó el segundo tiempo', 2, match_id from v where gf - gf_ht > ga - ga_ht
union all
-- s129: resultado al descanso y resultado final (la tabla de la tarjeta forma la matriz 3 × 3).
select 's129', case when gf_ht > ga_ht then 'Ganando al descanso' when gf_ht = ga_ht then 'Empatando al descanso'
                    else 'Perdiendo al descanso' end,
       case when gf_ht > ga_ht then 1 when gf_ht = ga_ht then 2 else 3 end, match_id
from v
union all
-- s130: puntos ganados desde atrás y perdidos desde ventaja.
select 's130', 'Sumó estando abajo', 1, match_id from v where from_behind > 0
union all
select 's130', 'Perdió puntos estando arriba', 2, match_id from v where dropped > 0
union all
-- s131: minuto del primer gol de la remontada.
select 's131', case when minute <= 60 then 'Hasta el 60''' when minute <= 75 then 'Del 61'' al 75''' else 'Desde el 76''' end,
       case when minute <= 60 then 1 when minute <= 75 then 2 else 3 end, match_id
from comeback;
