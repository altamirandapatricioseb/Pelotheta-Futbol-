-- =============================================================================
-- Situaciones (Interfaz 4, sección 9.6): bases comunes de todas las tarjetas.
--
-- Cada tarjeta responde «cuando pasa X, ¿qué le pasa a Boca?». Las consultas de las tarjetas
-- (archivos a_*.sql a k_*.sql) solo dicen qué partidos entran en cada fila: devuelven
-- (card_id, param_value, param_order, match_id). La función `core.refresh_situations`
-- (zz_refresh.sql) guarda esas filas en `core.situational_match` y calcula el resultado de
-- cada fila (G-E-P, % de victorias, puntos por partido, diferencia contra la base de Boca).
--
-- Las tarjetas «después de...» ponen en la fila el partido SIGUIENTE (`next_match_id`): lo que
-- se mide es lo que pasó después.
-- =============================================================================

-- Una fila por partido jugado de Boca con todo lo que usan las tarjetas. Materializada: se
-- recalcula al final de cada corrida del pipeline (son 50 filas, tarda milisegundos).
create materialized view core.situ_base as
with bm as (
  select b.match_id, b.match_date, b.kickoff_at, b.competition_code, b.competition_name, b.boca_home as home,
         b.opponent, b.goals_for as gf, b.goals_against as ga,
         case when b.boca_home then m.home_goals_ht else m.away_goals_ht end as gf_ht,
         case when b.boca_home then m.away_goals_ht else m.home_goals_ht end as ga_ht,
         case when b.boca_home then m.away_team_id else m.home_team_id end as opponent_id,
         m.extra_time, r.name as referee, c.kind as competition_kind,
         coalesce(tm.stats, '{}'::jsonb) as s
  from api.boca_match b
  join core.match m on m.match_id = b.match_id
  left join core.referee r on r.referee_id = m.referee_id
  left join core.season se on se.season_id = m.season_id
  left join core.competition c on c.competition_id = se.competition_id
  left join api.team_match_master tm on tm.match_id = b.match_id
  where b.status = 'jugado'
)
select bm.*,
       case when gf > ga then 'G' when gf = ga then 'E' else 'P' end as result,
       case when gf > ga then 3 when gf = ga then 1 else 0 end as points,
       extract(isodow from kickoff_at at time zone 'America/Argentina/Buenos_Aires')::int as dow,
       extract(hour from kickoff_at at time zone 'America/Argentina/Buenos_Aires')::int as hour_local,
       extract(month from match_date)::int as month,
       row_number() over (order by kickoff_at) as seq,
       lag(match_id) over (order by kickoff_at) as prev_match_id,
       lead(match_id) over (order by kickoff_at) as next_match_id,
       row_number() over (partition by competition_code order by kickoff_at) as comp_seq,
       count(*) over (partition by competition_code) as comp_count,
       match_date - lag(match_date) over (order by kickoff_at) as rest_days
from bm;
create unique index situ_base_match on core.situ_base (match_id);

-- Goles con minuto (sin la tanda de penales). `minute_order` ordena el descuento del primer
-- tiempo (45+2) antes que el minuto 46.
create view core.situ_goal as
select e.match_id, e.minute, coalesce(e.added_time, 0) as added_time, coalesce(e.period, 1) as period,
       e.minute + coalesce(e.added_time, 0) / 100.0 as minute_order,
       t.is_boca as for_boca, e.player_id, e.related_player_id, e.type
from core.event e
join core.team t on t.team_id = e.team_id
join core.situ_base b on b.match_id = e.match_id
where e.type in ('gol', 'penal_convertido') and coalesce(e.period, 1) < 5;

-- Expulsiones (roja directa o doble amarilla) y amarillas con minuto y equipo.
create view core.situ_card as
select e.match_id, e.minute, e.type, t.is_boca as for_boca, e.player_id
from core.event e
join core.team t on t.team_id = e.team_id
join core.situ_base b on b.match_id = e.match_id
where e.type in ('amarilla', 'segunda_amarilla', 'roja');

-- Cambios de Boca con minuto.
create view core.situ_sub as
select e.match_id, e.minute, e.player_id, e.related_player_id
from core.event e
join core.team t on t.team_id = e.team_id and t.is_boca
join core.situ_base b on b.match_id = e.match_id
where e.type = 'cambio';

-- Alineación de Boca: titular, minutos y posición.
create view core.situ_lineup as
select l.match_id, l.player_id, l.started, l.minute_in, l.minute_out, l.position,
       coalesce(nullif(p.known_as, ''), p.full_name) as player_name, p.birth_date
from core.lineup l
join core.team t on t.team_id = l.team_id and t.is_boca
join core.situ_base b on b.match_id = l.match_id
join core.player p on p.player_id = l.player_id;

-- Marcador de Boca en un minuto dado (goles hasta ese minuto inclusive).
create function core.situ_score_at(p_match integer, p_minute integer)
returns table (gf integer, ga integer)
language sql stable
set search_path = ''
as $$
  select count(*) filter (where for_boca)::int, count(*) filter (where not for_boca)::int
  from core.situ_goal
  where match_id = p_match and minute <= p_minute
$$;

-- Tramo del minuto (1 = 0-15 ... 6 = 76-90+, 7 = prórroga). El descuento del primer tiempo
-- (45+2) cae en el tramo 3 y el del segundo en el 6.
create function core.situ_band(p_minute integer, p_period integer)
returns integer
language sql immutable
set search_path = ''
as $$
  select case
    when p_period >= 3 then 7
    when p_minute <= 15 then 1
    when p_minute <= 30 then 2
    when p_period = 1 then 3
    when p_minute <= 60 then 4
    when p_minute <= 75 then 5
    else 6
  end
$$;

create function core.situ_band_label(p_band integer)
returns text
language sql immutable
set search_path = ''
as $$
  select (array['0-15', '16-30', '31-45+', '46-60', '61-75', '76-90+', 'Prórroga'])[p_band]
$$;
