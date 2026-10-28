-- =============================================================================
-- B. Resultados y goles (tarjetas s015 a s026).
-- =============================================================================
create view core.situ_cards_b as
with goal_pair as (
  -- Para cada gol, el primer gol del otro equipo que llega después (para las reacciones).
  select g.match_id, g.for_boca, g.minute_order,
         (select min(h.minute_order) from core.situ_goal h
          where h.match_id = g.match_id and h.for_boca <> g.for_boca and h.minute_order > g.minute_order) as answer
  from core.situ_goal g
)
-- s015: goleadas (3 o más goles de diferencia).
select 's015' as card_id, case when gf - ga >= 3 then 'A favor (+3 o más)' else 'En contra (−3 o más)' end as param_value,
       case when gf - ga >= 3 then 1 else 2 end as param_order, match_id
from core.situ_base where abs(gf - ga) >= 3
union all
-- s016: partidos decididos por un gol.
select 's016', case when gf > ga then 'Ganados por 1' else 'Perdidos por 1' end, case when gf > ga then 1 else 2 end, match_id
from core.situ_base where abs(gf - ga) = 1
union all
-- s017: marcadores exactos (de Boca primero), del más repetido al menos.
select 's017', gf || '-' || ga, (dense_rank() over (order by times desc, gf desc, ga))::int, match_id
from (select match_id, gf, ga, count(*) over (partition by gf, ga) as times from core.situ_base) x
union all
-- s018: 3 o más goles en el partido.
select 's018', case when gf + ga >= 3 then '3 o más goles' else '2 o menos' end, case when gf + ga >= 3 then 1 else 2 end, match_id
from core.situ_base
union all
-- s019: ambos equipos marcan.
select 's019', case when gf > 0 and ga > 0 then 'Ambos marcan' else 'No marcan los dos' end,
       case when gf > 0 and ga > 0 then 1 else 2 end, match_id
from core.situ_base
union all
-- s020: valla invicta.
select 's020', case when ga = 0 then 'Valla invicta' else 'Recibió gol' end, case when ga = 0 then 1 else 2 end, match_id
from core.situ_base
union all
-- s021: partido siguiente a no marcar (y a marcar, para comparar).
select 's021', case when gf = 0 then 'Después de no marcar' else 'Después de marcar' end,
       case when gf = 0 then 1 else 2 end, next_match_id
from core.situ_base where next_match_id is not null
union all
-- s022 y s023: marcar 2 o más, o exactamente 1.
select 's022', 'Marca 2 o más', 1, match_id from core.situ_base where gf >= 2
union all
select 's023', 'Marca exactamente 1', 1, match_id from core.situ_base where gf = 1
union all
-- s024: recibir gol en los primeros 10 minutos.
select 's024', case when exists (select 1 from core.situ_goal g where g.match_id = b.match_id and not g.for_boca
                                   and g.period = 1 and g.minute <= 10)
                    then 'Recibe antes del 10''' else 'No recibe antes del 10''' end,
       case when exists (select 1 from core.situ_goal g where g.match_id = b.match_id and not g.for_boca
                           and g.period = 1 and g.minute <= 10) then 1 else 2 end, match_id
from core.situ_base b
union all
-- s025: reacción, Boca marca dentro de los 10 minutos tras recibir un gol.
select distinct on (match_id) 's025',
       case when bool_or(answer - minute_order <= 10) over (partition by match_id) then 'Respondió en 10 minutos'
            else 'No respondió en 10 minutos' end,
       case when bool_or(answer - minute_order <= 10) over (partition by match_id) then 1 else 2 end, match_id
from goal_pair where not for_boca
union all
-- s026: Boca recibe dentro de los 10 minutos tras marcar.
select distinct on (match_id) 's026',
       case when bool_or(answer - minute_order <= 10) over (partition by match_id) then 'Recibió en 10 minutos'
            else 'No recibió en 10 minutos' end,
       case when bool_or(answer - minute_order <= 10) over (partition by match_id) then 1 else 2 end, match_id
from goal_pair where for_boca;
