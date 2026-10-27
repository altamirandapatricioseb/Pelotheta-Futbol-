-- Etapa 3 (fuentes): datos de toda la liga, perfiles de jugadores, bajas y momentum.
--   * Bajas por partido (Promiedos): de Boca con el jugador; de los rivales, solo el motivo.
--   * Momentum por minuto (ScoutingStats).
--   * Resultados de toda la liga, Elo, promedios por club y rankings (StrikerAPI, Promiedos).
--   * Tablas de posiciones, anual y de promedios (Promiedos).
--   * Perfil público del jugador: nacionalidad, peso, club formador y selección (Wikipedia).
-- Todo se carga con `ingest.load_extras`, aparte de `load_batch`, después del lote.

create table core.match_absence (
  absence_id  bigint generated always as identity primary key,
  match_id    integer not null references core.match (match_id) on delete cascade,
  team_id     integer not null references core.team (team_id),
  player_id   integer references core.player (player_id),
  reason      text not null check (reason in ('lesion', 'suspension_roja', 'suspension_amarillas',
                                              'seleccion', 'personal', 'otro')),
  source      text not null,
  fetched_at  timestamptz not null default now()
);
create index match_absence_match_idx on core.match_absence (match_id);
create index match_absence_team_idx on core.match_absence (team_id);
create index match_absence_player_idx on core.match_absence (player_id);

create table core.match_momentum (
  match_id    integer not null references core.match (match_id) on delete cascade,
  minute      smallint not null check (minute between 1 and 130),
  side        text not null check (side in ('home', 'away')),
  value       numeric not null check (value between 0 and 1),
  source      text not null,
  primary key (match_id, minute, side)
);

create table core.league_result (
  source      text not null,
  ext_id      text not null,
  season      smallint not null,
  stage       text,
  match_date  date not null,
  home_team   text not null,
  away_team   text not null,
  home_goals  smallint not null check (home_goals >= 0),
  away_goals  smallint not null check (away_goals >= 0),
  fetched_at  timestamptz not null default now(),
  primary key (source, ext_id)
);

create table core.club_rating (
  source      text not null,
  as_of       date not null,
  team_name   text not null,
  rank        smallint not null check (rank >= 1),
  elo         numeric not null,
  primary key (source, as_of, team_name)
);

create table core.club_season_stat (
  source      text not null,
  season      smallint not null,
  team_name   text not null,
  stat_key    text not null check (stat_key ~ '^[a-z_0-9]+$'),
  value       numeric not null,
  primary key (source, season, team_name, stat_key)
);

-- Rankings públicos de la liga (goleadores, asistidores, tarjetas). Guardan el nombre del
-- jugador porque el ranking no tiene sentido sin él; no se guarda ningún otro dato personal.
create table core.league_leader (
  source       text not null,
  season       smallint not null,
  stat         text not null check (stat ~ '^[a-z_]+$'),
  rank         smallint not null check (rank >= 1),
  player_name  text not null,
  team_name    text,
  games        smallint,
  minutes      integer,
  value        numeric not null,
  per90        numeric,
  primary key (source, season, stat, rank, player_name)
);

create table core.league_standing (
  source         text not null,
  season         smallint not null,
  table_name     text not null,
  rank           smallint not null check (rank >= 1),
  team_name      text not null,
  played         smallint,
  won            smallint,
  drawn          smallint,
  lost           smallint,
  goals_for      smallint,
  goals_against  smallint,
  points         smallint,
  average        numeric,
  primary key (source, season, table_name, team_name)
);

create table core.player_profile (
  player_id      integer primary key references core.player (player_id) on delete cascade,
  nationality    text check (nationality ~ '^[A-Z]{3}$'),
  weight_kg      numeric check (weight_kg between 40 and 130),
  youth_club     text,
  academy        boolean not null default false,
  national_team  text,
  source         text not null,
  fetched_at     timestamptz not null default now()
);

do $$
declare t text;
begin
  foreach t in array array['match_absence', 'match_momentum', 'league_result', 'club_rating',
                           'club_season_stat', 'league_leader', 'league_standing', 'player_profile']
  loop
    execute format('alter table core.%I enable row level security', t);
    execute format('create policy anon_read on core.%I for select to anon using (true)', t);
    execute format('grant select on core.%I to anon', t);
  end loop;
end;
$$;

-- Carga de todo lo anterior. Las bajas y el momentum se reemplazan completos para los
-- partidos del lote (`match_ids`); los datos de liga se reemplazan por fuente y temporada.
create function ingest.load_extras(p_extras jsonb)
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
                                    home_goals, away_goals)
    values (r ->> 'source', r ->> 'ext_id', (r ->> 'season')::smallint, r ->> 'stage',
            (r ->> 'match_date')::date, r ->> 'home_team', r ->> 'away_team',
            (r ->> 'home_goals')::smallint, (r ->> 'away_goals')::smallint)
    on conflict (source, ext_id) do update
      set stage = excluded.stage, match_date = excluded.match_date,
          home_goals = excluded.home_goals, away_goals = excluded.away_goals, fetched_at = now();
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

-- Vistas para la web ----------------------------------------------------------------------

create view api.boca_absence
with (security_invoker = true) as
select bm.match_id, bm.match_date, bm.competition_code, bm.opponent,
       t.is_boca as boca_absence, a.player_id, p.full_name as player_name, a.reason, a.source
from core.match_absence a
join api.boca_match bm on bm.match_id = a.match_id
join core.team t on t.team_id = a.team_id
left join core.player p on p.player_id = a.player_id;
comment on view api.boca_absence is 'Bajas por partido: de Boca con el jugador, de los rivales solo el motivo.';

-- Momentum desde el punto de vista de Boca: positivo si dominó Boca, negativo si el rival.
create view api.boca_momentum
with (security_invoker = true) as
select bm.match_id, bm.match_date, bm.competition_code, bm.opponent, mm.minute,
       case when (mm.side = 'home') = bm.boca_home then mm.value else -mm.value end as boca_value,
       mm.source
from core.match_momentum mm
join api.boca_match bm on bm.match_id = mm.match_id;
comment on view api.boca_momentum is 'Dominio por minuto: positivo cuando domina Boca, negativo cuando domina el rival.';

-- Penales en la liga (a favor y en contra) con el resultado del tiro.
create view api.boca_penalty
with (security_invoker = true) as
select bs.match_id, bs.match_date, bs.competition_code, bs.opponent, bs.boca_shot,
       bs.player_id, bs.player_name, bs.minute, bs.outcome, bs.source
from api.boca_shot bs
where bs.penalty;
comment on view api.boca_penalty is 'Penales de los partidos de Boca: convertidos, atajados o errados (StrikerAPI, liga).';

create view api.league_result with (security_invoker = true) as
select source, season, stage, match_date, home_team, away_team, home_goals, away_goals from core.league_result;
create view api.club_rating with (security_invoker = true) as
select source, as_of, team_name, rank, elo from core.club_rating;
create view api.club_season_stat with (security_invoker = true) as
select source, season, team_name, stat_key, value from core.club_season_stat;
create view api.league_leader with (security_invoker = true) as
select source, season, stat, rank, player_name, team_name, games, minutes, value, per90 from core.league_leader;
create view api.league_standing with (security_invoker = true) as
select source, season, table_name, rank, team_name, played, won, drawn, lost, goals_for,
       goals_against, points, average
from core.league_standing;
create view api.player_profile with (security_invoker = true) as
select pp.player_id, p.full_name, pp.nationality, pp.weight_kg, pp.youth_club, pp.academy,
       pp.national_team, pp.source
from core.player_profile pp
join core.player p on p.player_id = pp.player_id;

grant select on api.boca_absence, api.boca_momentum, api.boca_penalty, api.league_result,
  api.club_rating, api.club_season_stat, api.league_leader, api.league_standing, api.player_profile
  to anon, service_role;
