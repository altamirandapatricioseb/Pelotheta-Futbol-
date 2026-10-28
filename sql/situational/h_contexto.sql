-- =============================================================================
-- H. Local, visitante y contexto (tarjetas s081 a s095).
-- =============================================================================
create view core.situ_cards_h as
with v as (
  select b.*, (b.s ->> 'eq_elo_rival')::numeric as elo_rival
  from core.situ_base b
),
standing as (
  -- Puesto final de cada rival en la Tabla Anual de la liga (no el puesto a la fecha: estimado).
  select team_name, rank from api.league_standing where season = 2026 and table_name like 'Tabla Anual%'
),
conceded as (
  -- Goles recibidos por partido de cada club de la liga, en tercios.
  select team_name as team, ntile(3) over (order by value) as third
  from api.club_season_stat where season = 2026 and stat_key = 'goals_against' and value is not null
),
by_rival as (
  select opponent, count(*) as games, sum(3 - points) as points_lost from v group by opponent
)
-- s081: local y visitante.
select 's081' as card_id, case when home then 'Local' else 'Visitante' end as param_value,
       case when home then 1 else 2 end as param_order, match_id
from v
union all
-- s082: local y visitante en cada competición.
select 's082', competition_name || ' · ' || case when home then 'local' else 'visitante' end,
       (dense_rank() over (order by competition_name, home desc))::int, match_id
from v
union all
-- s083: días de descanso desde el partido anterior.
select 's083', case when rest_days <= 3 then '3 días o menos' when rest_days <= 6 then '4 a 6 días' else '7 días o más' end,
       case when rest_days <= 3 then 1 when rest_days <= 6 then 2 else 3 end, match_id
from v where rest_days is not null
union all
-- s084: partido siguiente a uno de copa o con alargue.
select 's084', case when extra_time then 'Después de un alargue' else 'Después de un partido de copa' end,
       case when extra_time then 2 else 1 end, next_match_id
from v where next_match_id is not null and (extra_time or competition_kind <> 'liga')
union all
-- s085: semanas con doble partido (este partido llega 4 días o menos después del anterior).
select 's085', case when rest_days <= 4 then 'Segundo partido en 4 días o menos' else 'Con más descanso' end,
       case when rest_days <= 4 then 1 else 2 end, match_id
from v where rest_days is not null
union all
-- s086: día de la semana.
select 's086', (array['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'])[dow], dow, match_id
from v
union all
-- s087: franja horaria (hora de Buenos Aires).
select 's087', case when hour_local < 18 then 'Tarde (antes de las 18)' else 'Noche (18 o más)' end,
       case when hour_local < 18 then 1 else 2 end, match_id
from v
union all
-- s088: mes del año.
select 's088', (array['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre',
                      'Octubre', 'Noviembre', 'Diciembre'])[month], month, match_id
from v
union all
-- s089: primeras y últimas 5 fechas de cada torneo de liga.
select 's089', case when comp_seq <= 5 then 'Primeras 5 fechas' else 'Últimas 5 fechas' end,
       case when comp_seq <= 5 then 1 else 2 end, match_id
from v where competition_kind = 'liga' and comp_count >= 10 and (comp_seq <= 5 or comp_count - comp_seq < 5)
union all
-- s090: clásico y otros grandes frente al resto.
select 's090',
       case when opponent = 'River Plate' then 'Superclásico'
            when opponent in ('Racing Club', 'Independiente', 'San Lorenzo') then 'Otros grandes'
            else 'Resto' end,
       case when opponent = 'River Plate' then 1 when opponent in ('Racing Club', 'Independiente', 'San Lorenzo') then 2 else 3 end,
       match_id
from v
union all
-- s091: rival por cuartil de Elo antes del partido.
select 's091', (array['Cuartil 1 (los más débiles)', 'Cuartil 2', 'Cuartil 3', 'Cuartil 4 (los más fuertes)'])[q], q, match_id
from (select match_id, ntile(4) over (order by elo_rival)::int as q from v where elo_rival is not null) x
union all
-- s092: rival según su puesto final en la Tabla Anual.
select 's092', case when st.rank <= 10 then 'Puestos 1 a 10' when st.rank <= 20 then 'Puestos 11 a 20' else 'Puestos 21 a 30' end,
       case when st.rank <= 10 then 1 when st.rank <= 20 then 2 else 3 end, v.match_id
from v join standing st on st.team_name = v.opponent
where v.competition_kind = 'liga'
union all
-- s093: rival que recibe pocos, algunos o muchos goles (tercios de la liga).
select 's093', (array['Rival que recibe pocos goles', 'Rival en el medio', 'Rival que recibe muchos goles'])[c.third],
       c.third::int, v.match_id
from v join conceded c on c.team = v.opponent
union all
-- s094: historial contra cada rival (2 o más partidos).
select 's094', v.opponent, (dense_rank() over (order by br.games desc, v.opponent))::int, v.match_id
from v join by_rival br on br.opponent = v.opponent where br.games >= 2
union all
-- s095: rivales que más puntos le sacaron a Boca.
select 's095', v.opponent, (dense_rank() over (order by br.points_lost desc, v.opponent))::int, v.match_id
from v join by_rival br on br.opponent = v.opponent where br.points_lost >= 2;
