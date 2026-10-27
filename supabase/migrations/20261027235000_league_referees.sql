-- Etapa 3 (fuentes): partidos de toda la liga con árbitro, tarjetas, faltas y bajas (Promiedos).
-- De los equipos que no son Boca se guardan solo conteos por motivo, nunca nombres.

alter table core.league_result
  add column if not exists referee        text,
  add column if not exists yellow_home    smallint check (yellow_home >= 0),
  add column if not exists yellow_away    smallint check (yellow_away >= 0),
  add column if not exists red_home       smallint check (red_home >= 0),
  add column if not exists red_away       smallint check (red_away >= 0),
  add column if not exists fouls_home     smallint check (fouls_home >= 0),
  add column if not exists fouls_away     smallint check (fouls_away >= 0),
  add column if not exists injured_home   smallint check (injured_home >= 0),
  add column if not exists injured_away   smallint check (injured_away >= 0),
  add column if not exists suspended_home smallint check (suspended_home >= 0),
  add column if not exists suspended_away smallint check (suspended_away >= 0);

-- Misma función que 20261027220000 con las columnas nuevas de league_result.
create or replace function ingest.load_extras(p_extras jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  r jsonb;
  v_match_ids integer[];
  n_absences integer := 0;
  n_momentum integer := 0;
  n_results integer := 0;
  n_ratings integer := 0;
  n_club_stats integer := 0;
  n_leaders integer := 0;
  n_standings integer := 0;
  n_profiles integer := 0;
begin
  select coalesce(array_agg(ingest.internal_id('promiedos', 'match', x)::integer), '{}')
  into v_match_ids
  from jsonb_array_elements_text(coalesce(p_extras -> 'match_ids', '[]')) as x;
  delete from core.match_absence where match_id = any (v_match_ids);
  delete from core.match_momentum where match_id = any (v_match_ids);

  for r in select * from jsonb_array_elements(coalesce(p_extras -> 'absences', '[]')) loop
    insert into core.match_absence (match_id, team_id, player_id, reason, source)
    values (ingest.internal_id('promiedos', 'match', r ->> 'match_source_id'),
            ingest.internal_id('promiedos', 'team', r ->> 'team_source_id'),
            ingest.internal_id('promiedos', 'player', r ->> 'player_source_id'),
            r ->> 'reason', r ->> 'source');
    n_absences := n_absences + 1;
  end loop;

  for r in select * from jsonb_array_elements(coalesce(p_extras -> 'momentum', '[]')) loop
    insert into core.match_momentum (match_id, minute, side, value, source)
    values (ingest.internal_id('promiedos', 'match', r ->> 'match_source_id'),
            (r ->> 'minute')::smallint, r ->> 'side', (r ->> 'value')::numeric, r ->> 'source')
    on conflict (match_id, minute, side) do update set value = excluded.value;
    n_momentum := n_momentum + 1;
  end loop;

  for r in select * from jsonb_array_elements(coalesce(p_extras -> 'league_results', '[]')) loop
    insert into core.league_result (source, ext_id, season, stage, match_date, home_team, away_team,
                                    home_goals, away_goals, referee, yellow_home, yellow_away,
                                    red_home, red_away, fouls_home, fouls_away, injured_home,
                                    injured_away, suspended_home, suspended_away)
    values (r ->> 'source', r ->> 'ext_id', (r ->> 'season')::smallint, r ->> 'stage',
            (r ->> 'match_date')::date, r ->> 'home_team', r ->> 'away_team',
            (r ->> 'home_goals')::smallint, (r ->> 'away_goals')::smallint, r ->> 'referee',
            (r ->> 'yellow_home')::smallint, (r ->> 'yellow_away')::smallint,
            (r ->> 'red_home')::smallint, (r ->> 'red_away')::smallint,
            (r ->> 'fouls_home')::smallint, (r ->> 'fouls_away')::smallint,
            (r ->> 'injured_home')::smallint, (r ->> 'injured_away')::smallint,
            (r ->> 'suspended_home')::smallint, (r ->> 'suspended_away')::smallint)
    on conflict (source, ext_id) do update
      set stage = excluded.stage, match_date = excluded.match_date,
          home_goals = excluded.home_goals, away_goals = excluded.away_goals,
          referee = excluded.referee, yellow_home = excluded.yellow_home,
          yellow_away = excluded.yellow_away, red_home = excluded.red_home,
          red_away = excluded.red_away, fouls_home = excluded.fouls_home,
          fouls_away = excluded.fouls_away, injured_home = excluded.injured_home,
          injured_away = excluded.injured_away, suspended_home = excluded.suspended_home,
          suspended_away = excluded.suspended_away, fetched_at = now();
    n_results := n_results + 1;
  end loop;

  for r in select * from jsonb_array_elements(coalesce(p_extras -> 'ratings', '[]')) loop
    insert into core.club_rating (source, as_of, team_name, rank, elo)
    values (r ->> 'source', (r ->> 'as_of')::date, r ->> 'team_name', (r ->> 'rank')::smallint,
            (r ->> 'elo')::numeric)
    on conflict (source, as_of, team_name) do update set rank = excluded.rank, elo = excluded.elo;
    n_ratings := n_ratings + 1;
  end loop;

  delete from core.club_season_stat c
  using (select distinct x ->> 'source' as source, (x ->> 'season')::smallint as season
         from jsonb_array_elements(coalesce(p_extras -> 'club_stats', '[]')) as x) k
  where c.source = k.source and c.season = k.season;
  for r in select * from jsonb_array_elements(coalesce(p_extras -> 'club_stats', '[]')) loop
    insert into core.club_season_stat (source, season, team_name, stat_key, value)
    values (r ->> 'source', (r ->> 'season')::smallint, r ->> 'team_name', r ->> 'stat_key',
            (r ->> 'value')::numeric)
    on conflict (source, season, team_name, stat_key) do update set value = excluded.value;
    n_club_stats := n_club_stats + 1;
  end loop;

  delete from core.league_leader l
  using (select distinct x ->> 'source' as source, (x ->> 'season')::smallint as season,
                x ->> 'stat' as stat
         from jsonb_array_elements(coalesce(p_extras -> 'leaders', '[]')) as x) k
  where l.source = k.source and l.season = k.season and l.stat = k.stat;
  for r in select * from jsonb_array_elements(coalesce(p_extras -> 'leaders', '[]')) loop
    insert into core.league_leader (source, season, stat, rank, player_name, team_name, games,
                                    minutes, value, per90)
    values (r ->> 'source', (r ->> 'season')::smallint, r ->> 'stat', (r ->> 'rank')::smallint,
            r ->> 'player_name', r ->> 'team_name', (r ->> 'games')::smallint,
            (r ->> 'minutes')::integer, (r ->> 'value')::numeric, (r ->> 'per90')::numeric)
    on conflict (source, season, stat, rank, player_name) do update
      set value = excluded.value, team_name = excluded.team_name;
    n_leaders := n_leaders + 1;
  end loop;

  delete from core.league_standing s
  using (select distinct x ->> 'source' as source, (x ->> 'season')::smallint as season
         from jsonb_array_elements(coalesce(p_extras -> 'standings', '[]')) as x) k
  where s.source = k.source and s.season = k.season;
  for r in select * from jsonb_array_elements(coalesce(p_extras -> 'standings', '[]')) loop
    insert into core.league_standing (source, season, table_name, rank, team_name, played, won,
                                      drawn, lost, goals_for, goals_against, points, average)
    values (r ->> 'source', (r ->> 'season')::smallint, r ->> 'table_name', (r ->> 'rank')::smallint,
            r ->> 'team_name', (r ->> 'played')::smallint, (r ->> 'won')::smallint,
            (r ->> 'drawn')::smallint, (r ->> 'lost')::smallint, (r ->> 'goals_for')::smallint,
            (r ->> 'goals_against')::smallint, (r ->> 'points')::smallint, (r ->> 'average')::numeric)
    on conflict (source, season, table_name, team_name) do update
      set rank = excluded.rank, points = excluded.points, average = excluded.average;
    n_standings := n_standings + 1;
  end loop;

  for r in select * from jsonb_array_elements(coalesce(p_extras -> 'profiles', '[]')) loop
    insert into core.player_profile (player_id, nationality, weight_kg, youth_club, academy,
                                     national_team, source)
    select ingest.internal_id('promiedos', 'player', r ->> 'player_source_id'), r ->> 'nationality',
           (r ->> 'weight_kg')::numeric, r ->> 'youth_club',
           coalesce((r ->> 'academy')::boolean, false), r ->> 'national_team', r ->> 'source'
    where ingest.internal_id('promiedos', 'player', r ->> 'player_source_id') is not null
    on conflict (player_id) do update
      set nationality = excluded.nationality, weight_kg = excluded.weight_kg,
          youth_club = excluded.youth_club, academy = excluded.academy,
          national_team = excluded.national_team, fetched_at = now();
    n_profiles := n_profiles + 1;
  end loop;

  -- Una fila de registro por fuente que aportó datos (estado visible en la web).
  insert into core.ingest_log (run_id, source, finished_at, status, rows_inserted)
  select gen_random_uuid(), s.source, now(), 'ok', count(*)
  from (
    select x ->> 'source' as source from jsonb_array_elements(coalesce(p_extras -> 'momentum', '[]')) x
    union all select x ->> 'source' from jsonb_array_elements(coalesce(p_extras -> 'league_results', '[]')) x
    union all select x ->> 'source' from jsonb_array_elements(coalesce(p_extras -> 'leaders', '[]')) x
    union all select x ->> 'source' from jsonb_array_elements(coalesce(p_extras -> 'standings', '[]')) x
    union all select x ->> 'source' from jsonb_array_elements(coalesce(p_extras -> 'profiles', '[]')) x
  ) s
  where s.source ~ '^[a-z_]+$' and s.source <> 'promiedos'
  group by s.source;

  return jsonb_build_object('absences', n_absences, 'momentum', n_momentum, 'league_results', n_results,
                            'ratings', n_ratings, 'club_stats', n_club_stats, 'leaders', n_leaders,
                            'standings', n_standings, 'profiles', n_profiles);
end;
$$;
revoke all on function ingest.load_extras(jsonb) from public;
grant execute on function ingest.load_extras(jsonb) to service_role;

create or replace view api.league_result with (security_invoker = true) as
select source, season, stage, match_date, home_team, away_team, home_goals, away_goals, referee,
       yellow_home, yellow_away, red_home, red_away, fouls_home, fouls_away, injured_home,
       injured_away, suspended_home, suspended_away
from core.league_result;

-- Árbitros de la liga: partidos, tarjetas y faltas por partido, y reparto local/visitante.
create view api.referee_stats with (security_invoker = true) as
select referee,
       season,
       count(*)::integer                                                   as games,
       round(avg(yellow_home + yellow_away), 2)                            as yellow_per_game,
       round(avg(red_home + red_away), 2)                                  as red_per_game,
       round(avg(fouls_home + fouls_away), 1)                              as fouls_per_game,
       round(100.0 * avg(case when home_goals > away_goals then 1 else 0 end), 1) as home_win_pct,
       round(avg(yellow_home) - avg(yellow_away), 2)                       as yellow_home_minus_away
from core.league_result
where source = 'promiedos' and referee is not null
group by referee, season;
comment on view api.referee_stats is 'Árbitros de la Liga Profesional: tarjetas, faltas y resultados de los partidos que dirigieron.';

-- Bajas por equipo en toda la liga (lesiones y suspensiones), sumando local y visitante.
create view api.league_absences with (security_invoker = true) as
select team, season, sum(injured)::integer as injured, sum(suspended)::integer as suspended,
       count(*)::integer as games
from (
  select home_team as team, season, injured_home as injured, suspended_home as suspended
  from core.league_result where source = 'promiedos'
  union all
  select away_team, season, injured_away, suspended_away
  from core.league_result where source = 'promiedos'
) t
group by team, season;
comment on view api.league_absences is 'Lesionados y suspendidos por equipo en la Liga Profesional (conteos, sin nombres).';

grant select on api.league_result, api.referee_stats, api.league_absences to anon, service_role;
