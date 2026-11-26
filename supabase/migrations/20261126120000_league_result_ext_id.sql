-- Etapa 5j-11: la ficha de partido de cualquier club (/club/<club>/partido/<id>) necesita el id del
-- partido en su fuente. La columna va al final: `create or replace view` no permite moverlas y
-- mantiene los permisos de la vista.
create or replace view api.league_result with (security_invoker = true) as
select source, season, stage, match_date, home_team, away_team, home_goals, away_goals, referee,
       yellow_home, yellow_away, red_home, red_away, fouls_home, fouls_away, injured_home,
       injured_away, suspended_home, suspended_away, ext_id
from core.league_result;
