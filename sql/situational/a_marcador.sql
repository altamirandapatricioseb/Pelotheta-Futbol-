-- =============================================================================
-- A. Marcador y remontadas (tarjetas s001 a s014).
-- Cada SELECT devuelve los partidos de una fila: (card_id, param_value, param_order, match_id).
-- =============================================================================
create view core.situ_cards_a as
with first_goal as (
  -- Primer gol de cada equipo en cada partido.
  select distinct on (match_id, for_boca) match_id, for_boca, minute, period
  from core.situ_goal
  order by match_id, for_boca, minute_order
),
at_minute as (
  -- Marcador de Boca a los 60, 75 y 85 minutos.
  select b.match_id, m.minute, sc.gf - sc.ga as diff
  from core.situ_base b
  cross join (values (60), (75), (85)) m (minute)
  cross join lateral core.situ_score_at(b.match_id, m.minute) sc
)
-- s001: minuto del primer gol de Boca.
select 's001' as card_id, core.situ_band_label(core.situ_band(minute, period)) as param_value,
       core.situ_band(minute, period) as param_order, match_id
from first_goal where for_boca
union all
-- s002: minuto del primer gol del rival (cuántos puntos rescata Boca).
select 's002', core.situ_band_label(core.situ_band(minute, period)), core.situ_band(minute, period), match_id
from first_goal where not for_boca
union all
-- s003 y s004: ventaja o desventaja al descanso.
select 's003', '+' || least(gf_ht - ga_ht, 3) || case when gf_ht - ga_ht >= 3 then ' o más' else '' end,
       least(gf_ht - ga_ht, 3), match_id
from core.situ_base where gf_ht > ga_ht
union all
select 's004', '−' || least(ga_ht - gf_ht, 3) || case when ga_ht - gf_ht >= 3 then ' o más' else '' end,
       least(ga_ht - gf_ht, 3), match_id
from core.situ_base where ga_ht > gf_ht
union all
-- s005: empate al descanso, sin goles o con goles.
select 's005', case when gf_ht = 0 then '0-0' else '1-1 o más' end, case when gf_ht = 0 then 1 else 2 end, match_id
from core.situ_base where gf_ht = ga_ht
union all
-- s006 a s010: ventaja o desventaja a los 60, 75 y 85 minutos.
select case minute when 60 then 's006' when 75 then 's007' else 's008' end,
       case when minute = 85 then '+1 o más' when diff >= 2 then '+2 o más' else '+1' end,
       case when minute = 85 then 1 else least(diff, 2) end, match_id
from at_minute where diff > 0
union all
select case minute when 60 then 's009' else 's010' end,
       case when diff <= -2 then '−2 o más' else '−1' end, least(-diff, 2), match_id
from at_minute where diff < 0 and minute in (60, 75)
union all
-- s011: empate a los 75 y a los 85.
select 's011', 'Empate al ' || minute, case minute when 75 then 1 else 2 end, match_id
from at_minute where diff = 0 and minute in (75, 85)
union all
-- s012: gol en los últimos 10 minutos (desde el 81, con descuento; sin prórroga).
select distinct 's012', case when for_boca then 'A favor' else 'En contra' end, case when for_boca then 1 else 2 end, match_id
from core.situ_goal where period = 2 and minute >= 81
union all
-- s013: gol en los primeros 10 minutos.
select distinct 's013', case when for_boca then 'A favor' else 'En contra' end, case when for_boca then 1 else 2 end, match_id
from core.situ_goal where period = 1 and minute <= 10
union all
-- s014: gol en tiempo agregado (descuento de cualquiera de los dos tiempos).
select distinct 's014', case when for_boca then 'A favor' else 'En contra' end, case when for_boca then 1 else 2 end, match_id
from core.situ_goal where added_time > 0 and period <= 2
union all
-- s132 (agregada): quién marca primero (o si no hubo goles).
select 's132',
       case when f.for_boca then 'Boca marca primero' when f.for_boca is not null then 'El rival marca primero' else 'Sin goles' end,
       case when f.for_boca then 1 when f.for_boca is not null then 2 else 3 end, b.match_id
from core.situ_base b
left join lateral (
  select g.for_boca from core.situ_goal g where g.match_id = b.match_id order by g.minute_order limit 1
) f on true;
