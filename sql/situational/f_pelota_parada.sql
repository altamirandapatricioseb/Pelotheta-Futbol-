-- =============================================================================
-- F. Pelota parada (tarjetas s061 a s070). Goles de córner, tiro libre y pelota parada son solo
-- de la liga (relato de StrikerAPI). s068 (remates de pelota parada) queda n/d.
-- =============================================================================
create view core.situ_cards_f as
with v as (
  select match_id, (s ->> 'corners')::numeric as corners, (s ->> 'corners_against')::numeric as corners_against,
         (s ->> 'goals_corner')::numeric as corner_goals, (s ->> 'goals_corner_against')::numeric as corner_goals_against,
         (s ->> 'penalties_attempted')::numeric as pen, (s ->> 'penalties_scored')::numeric as pen_scored,
         (s ->> 'penalties_attempted_against')::numeric as pen_against,
         (s ->> 'goals_free_kick')::numeric as fk_goals, (s ->> 'goals_free_kick_against')::numeric as fk_goals_against,
         (s ->> 'goals_set_piece')::numeric as sp_goals, (s ->> 'goals_set_piece_against')::numeric as sp_goals_against,
         (s ->> 'offsides_against')::numeric as offsides_against, (s ->> 'fouls_against')::numeric as fouls_against
  from core.situ_base
)
-- s061 y s062: córners a favor y en contra.
select 's061' as card_id, t || ' o más córners' as param_value, o::int as param_order, match_id
from v cross join unnest(array[5, 8, 10]) with ordinality u (t, o) where corners >= t
union all
select 's062', t || ' o más córners en contra', o::int, match_id
from v cross join unnest(array[5, 8]) with ordinality u (t, o) where corners_against >= t
union all
-- s063: goles de córner.
select 's063', 'Gol de córner a favor', 1, match_id from v where corner_goals >= 1
union all
select 's063', 'Gol de córner en contra', 2, match_id from v where corner_goals_against >= 1
union all
-- s064: penal a favor, convertido o no.
select 's064', case when pen_scored >= pen then 'Penal convertido' else 'Con algún penal fallado' end,
       case when pen_scored >= pen then 1 else 2 end, match_id
from v where pen >= 1
union all
-- s065: penal en contra.
select 's065', 'Con penal en contra', 1, match_id from v where pen_against >= 1
union all
-- s066: penal fallado a favor (impacto en el resultado).
select 's066', 'Falló un penal', 1, match_id from v where pen > pen_scored
union all
-- s067: goles de tiro libre y de pelota parada.
select 's067', 'Gol de tiro libre a favor', 1, match_id from v where fk_goals >= 1
union all
select 's067', 'Gol de tiro libre en contra', 2, match_id from v where fk_goals_against >= 1
union all
select 's067', 'Gol de pelota parada a favor', 3, match_id from v where sp_goals >= 1
union all
select 's067', 'Gol de pelota parada en contra', 4, match_id from v where sp_goals_against >= 1
union all
-- s069: fueras de juego del rival.
select 's069', t || ' o más offsides del rival', o::int, match_id
from v cross join unnest(array[3, 5]) with ordinality u (t, o) where offsides_against >= t
union all
-- s070: faltas recibidas (cometidas por el rival).
select 's070', t || ' o más faltas recibidas', o::int, match_id
from v cross join unnest(array[15, 20]) with ordinality u (t, o) where fouls_against >= t;
