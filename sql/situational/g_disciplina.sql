-- =============================================================================
-- G. Disciplina y árbitros (tarjetas s071 a s080). s078 (titulares ausentes por suspensión) y
-- s079 (jugadores al borde de la suspensión) quedan n/d: las fuentes no publican las bajas de
-- Boca por suspensión ni el reglamento de acumulación de cada torneo.
-- =============================================================================
create view core.situ_cards_g as
with v as (
  select match_id, referee, (s ->> 'yellow_cards')::numeric as yellows, (s ->> 'yellow_cards_against')::numeric as yellows_against,
         (s ->> 'fouls')::numeric as fouls, (s ->> 'penalties_attempted')::numeric as pen,
         (s ->> 'penalties_attempted_against')::numeric as pen_against
  from core.situ_base
),
red as (
  -- Primera expulsión de cada equipo en cada partido (roja directa o doble amarilla).
  select distinct on (match_id, for_boca) match_id, for_boca, minute
  from core.situ_card where type in ('roja', 'segunda_amarilla')
  order by match_id, for_boca, minute
),
referee_matches as (
  select referee, count(*) as games from core.situ_base where referee is not null group by referee
)
-- s071 y s072: expulsión del rival o de Boca, según el minuto.
select case when for_boca then 's072' else 's071' end as card_id,
       case when minute <= 45 then 'Hasta el 45''' when minute <= 70 then 'Del 46'' al 70''' else 'Desde el 71''' end as param_value,
       case when minute <= 45 then 1 when minute <= 70 then 2 else 3 end as param_order, match_id
from red
union all
-- s073: amarillas de Boca.
select 's073', t || ' o más amarillas', o::int, match_id
from v cross join unnest(array[3, 5]) with ordinality u (t, o) where yellows >= t
union all
-- s074: faltas cometidas.
select 's074', t || ' o más faltas', o::int, match_id
from v cross join unnest(array[15, 20]) with ordinality u (t, o) where fouls >= t
union all
-- s075: partidos con penal señalado.
select 's075', 'Penal a favor', 1, match_id from v where pen >= 1
union all
select 's075', 'Penal en contra', 2, match_id from v where pen_against >= 1
union all
-- s076: resultado por árbitro (los que dirigieron 2 o más partidos de Boca).
select 's076', v.referee, (dense_rank() over (order by rm.games desc, v.referee))::int, v.match_id
from v join referee_matches rm on rm.referee = v.referee where rm.games >= 2
union all
-- s077: árbitro según cuántas amarillas saca por partido en toda la liga.
select 's077',
       case when rs.yellow_per_game >= 5 then '5 o más amarillas por partido' when rs.yellow_per_game >= 4 then '4 a 5'
            else 'Menos de 4' end,
       case when rs.yellow_per_game >= 5 then 1 when rs.yellow_per_game >= 4 then 2 else 3 end, v.match_id
from v join api.referee_stats rs on rs.referee = v.referee and rs.season = 2026
union all
-- s080: amarillas del rival.
select 's080', t || ' o más amarillas del rival', o::int, match_id
from v cross join unnest(array[3, 5]) with ordinality u (t, o) where yellows_against >= t;
