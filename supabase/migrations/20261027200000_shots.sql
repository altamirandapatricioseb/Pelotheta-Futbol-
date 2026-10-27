-- Etapa 3 (fuentes): tiros ubicados en la cancha (StrikerAPI, solo Liga Profesional).
-- x = distancia a la línea de gol como fracción de media cancha (el punto penal es 0,23),
-- y = ancho de la cancha (0,5 es el centro). end_x/end_y = dónde terminó el tiro.

create table core.shot (
  shot_id     bigint generated always as identity primary key,
  match_id    integer not null references core.match (match_id) on delete cascade,
  team_id     integer not null references core.team (team_id),
  player_id   integer references core.player (player_id),
  minute      smallint check (minute between 0 and 130),
  outcome     text not null check (outcome ~ '^[a-z_]+$'),
  body_part   text check (body_part ~ '^[a-z_]+$'),
  penalty     boolean not null default false,
  zone        text check (zone ~ '^[a-z_]+$'),
  xg          numeric not null check (xg between 0 and 1),
  x           numeric check (x between 0 and 2),  -- más de 1 = tiro desde campo propio
  y           numeric check (y between 0 and 1),
  end_x       numeric check (end_x between 0 and 2),
  end_y       numeric check (end_y between 0 and 1),
  source      text not null,
  fetched_at  timestamptz not null default now()
);
create index shot_match_idx on core.shot (match_id);
create index shot_team_idx on core.shot (team_id);
create index shot_player_idx on core.shot (player_id);

alter table core.shot enable row level security;
create policy anon_read on core.shot for select to anon using (true);
grant select on core.shot to anon;

-- Misma función que 20261027190000 más el bloque de tiros (se reescribe completa).
create or replace function ingest.load_batch(p_batch jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_source       text := p_batch ->> 'source';
  v_year         smallint := (p_batch ->> 'season_year')::smallint;
  v_run_id       uuid := coalesce((p_batch ->> 'run_id')::uuid, gen_random_uuid());
  r              jsonb;
  v_id           bigint;
  v_comp_id      bigint;
  v_season_id    bigint;
  v_match_id     bigint;
  v_home_id      bigint;
  v_away_id      bigint;
  v_referee_id   bigint;
  n_teams        integer := 0;
  n_players      integer := 0;
  n_matches      integer := 0;
  n_lineups      integer := 0;
  n_events       integer := 0;
  n_stats        integer := 0;
  n_player_stats integer := 0;
  n_formations   integer := 0;
  n_shots        integer := 0;
begin
  if v_source is null or v_source !~ '^[a-z_]+$' then
    raise exception 'Lote sin fuente válida';
  end if;

  -- Competiciones y su temporada del año del lote.
  for r in select * from jsonb_array_elements(coalesce(p_batch -> 'competitions', '[]')) loop
    v_id := ingest.internal_id(v_source, 'competition', r ->> 'source_id');
    if v_id is null then
      insert into core.competition (code, name_es, kind, country, source, sort_order)
      values (r ->> 'code', r ->> 'name_es', r ->> 'kind', r ->> 'country', v_source,
              coalesce((r ->> 'sort_order')::smallint, 100))
      on conflict (code) do update set name_es = excluded.name_es
      returning competition_id into v_id;
      insert into core.source_id_map (source, entity, source_id, internal_id)
      values (v_source, 'competition', r ->> 'source_id', v_id);
    else
      update core.competition
      set name_es = r ->> 'name_es', kind = r ->> 'kind',
          sort_order = coalesce((r ->> 'sort_order')::smallint, sort_order), fetched_at = now()
      where competition_id = v_id;
    end if;
    insert into core.season (competition_id, year, name_es, source)
    values (v_id, v_year, v_year::text, v_source)
    on conflict (competition_id, name_es) do nothing;
  end loop;

  -- Equipos.
  for r in select * from jsonb_array_elements(coalesce(p_batch -> 'teams', '[]')) loop
    v_id := ingest.internal_id(v_source, 'team', r ->> 'source_id');
    if v_id is null then
      insert into core.team (name, short_name, country, stadium, is_boca, source)
      values (r ->> 'name', r ->> 'short_name', r ->> 'country', r ->> 'stadium',
              coalesce((r ->> 'is_boca')::boolean, false), v_source)
      on conflict (name) do update set short_name = excluded.short_name
      returning team_id into v_id;
      insert into core.source_id_map (source, entity, source_id, internal_id)
      values (v_source, 'team', r ->> 'source_id', v_id);
    else
      update core.team
      set short_name = r ->> 'short_name',
          stadium = coalesce(r ->> 'stadium', stadium), fetched_at = now()
      where team_id = v_id;
    end if;
    n_teams := n_teams + 1;
  end loop;

  -- Jugadores (solo los de Boca: de los rivales no se guardan datos personales).
  for r in select * from jsonb_array_elements(coalesce(p_batch -> 'players', '[]')) loop
    v_id := ingest.internal_id(v_source, 'player', r ->> 'source_id');
    if v_id is null then
      insert into core.player (full_name, known_as, birth_date, position_raw, height_cm, source)
      values (r ->> 'full_name', r ->> 'known_as', (r ->> 'birth_date')::date,
              r ->> 'position_raw', (r ->> 'height_cm')::smallint, v_source)
      returning player_id into v_id;
      insert into core.source_id_map (source, entity, source_id, internal_id)
      values (v_source, 'player', r ->> 'source_id', v_id);
    else
      update core.player
      set known_as = coalesce(r ->> 'known_as', known_as),
          birth_date = coalesce((r ->> 'birth_date')::date, birth_date),
          position_raw = coalesce(r ->> 'position_raw', position_raw),
          height_cm = coalesce((r ->> 'height_cm')::smallint, height_cm),
          fetched_at = now()
      where player_id = v_id;
    end if;
    n_players := n_players + 1;
  end loop;

  -- Plantel de la temporada.
  for r in select * from jsonb_array_elements(coalesce(p_batch -> 'squad', '[]')) loop
    insert into core.squad_member (season_year, player_id, shirt_number, position_group, source)
    values (v_year, ingest.internal_id(v_source, 'player', r ->> 'player_source_id'),
            (r ->> 'shirt_number')::smallint, r ->> 'position_group', v_source)
    on conflict (season_year, player_id) do update
      set shirt_number = excluded.shirt_number, position_group = excluded.position_group,
          fetched_at = now();
  end loop;

  -- Partidos. Los detalles de cada partido se borran y se vuelven a insertar.
  for r in select * from jsonb_array_elements(coalesce(p_batch -> 'matches', '[]')) loop
    v_comp_id := ingest.internal_id(v_source, 'competition', r ->> 'competition_source_id');
    select season_id into v_season_id from core.season
    where competition_id = v_comp_id and name_es = v_year::text;
    v_home_id := ingest.internal_id(v_source, 'team', r ->> 'home_source_id');
    v_away_id := ingest.internal_id(v_source, 'team', r ->> 'away_source_id');
    if v_season_id is null or v_home_id is null or v_away_id is null then
      raise exception 'Partido % con competición o equipos desconocidos', r ->> 'source_id';
    end if;

    v_referee_id := null;
    if nullif(r ->> 'referee', '') is not null then
      insert into core.referee (name, source) values (r ->> 'referee', v_source)
      on conflict (name) do update set fetched_at = now()
      returning referee_id into v_referee_id;
    end if;

    v_match_id := ingest.internal_id(v_source, 'match', r ->> 'source_id');
    if v_match_id is null then
      insert into core.match (season_id, match_date, kickoff_at, round_label, home_team_id,
                              away_team_id, home_goals, away_goals, home_goals_ht, away_goals_ht,
                              status, venue, referee_id, extra_time, penalties_home,
                              penalties_away, source)
      values (v_season_id, (r ->> 'match_date')::date, (r ->> 'kickoff_at')::timestamptz,
              r ->> 'round_label', v_home_id, v_away_id, (r ->> 'home_goals')::smallint,
              (r ->> 'away_goals')::smallint, (r ->> 'home_goals_ht')::smallint,
              (r ->> 'away_goals_ht')::smallint, r ->> 'status', r ->> 'venue', v_referee_id,
              coalesce((r ->> 'extra_time')::boolean, false), (r ->> 'penalties_home')::smallint,
              (r ->> 'penalties_away')::smallint, v_source)
      returning match_id into v_match_id;
      insert into core.source_id_map (source, entity, source_id, internal_id)
      values (v_source, 'match', r ->> 'source_id', v_match_id);
    else
      update core.match
      set season_id = v_season_id, match_date = (r ->> 'match_date')::date,
          kickoff_at = (r ->> 'kickoff_at')::timestamptz, round_label = r ->> 'round_label',
          home_goals = (r ->> 'home_goals')::smallint, away_goals = (r ->> 'away_goals')::smallint,
          home_goals_ht = (r ->> 'home_goals_ht')::smallint,
          away_goals_ht = (r ->> 'away_goals_ht')::smallint, status = r ->> 'status',
          venue = r ->> 'venue', referee_id = v_referee_id,
          extra_time = coalesce((r ->> 'extra_time')::boolean, false),
          penalties_home = (r ->> 'penalties_home')::smallint,
          penalties_away = (r ->> 'penalties_away')::smallint, fetched_at = now()
      where match_id = v_match_id;
    end if;
    delete from core.lineup where match_id = v_match_id;
    delete from core.event where match_id = v_match_id;
    delete from core.team_match_stat where match_id = v_match_id;
    delete from core.player_match_stat where match_id = v_match_id;
    delete from core.team_match_formation where match_id = v_match_id;
    delete from core.shot where match_id = v_match_id;
    n_matches := n_matches + 1;
  end loop;

  for r in select * from jsonb_array_elements(coalesce(p_batch -> 'lineups', '[]')) loop
    insert into core.lineup (match_id, player_id, team_id, started, minute_in, minute_out,
                             position, shirt_number, source)
    values (ingest.internal_id(v_source, 'match', r ->> 'match_source_id'),
            ingest.internal_id(v_source, 'player', r ->> 'player_source_id'),
            ingest.internal_id(v_source, 'team', r ->> 'team_source_id'),
            (r ->> 'started')::boolean, (r ->> 'minute_in')::smallint,
            (r ->> 'minute_out')::smallint, r ->> 'position', (r ->> 'shirt_number')::smallint,
            v_source);
    n_lineups := n_lineups + 1;
  end loop;

  for r in select * from jsonb_array_elements(coalesce(p_batch -> 'events', '[]')) loop
    insert into core.event (match_id, minute, added_time, period, type, team_id, player_id,
                            related_player_id, detail, source)
    values (ingest.internal_id(v_source, 'match', r ->> 'match_source_id'),
            (r ->> 'minute')::smallint, (r ->> 'added_time')::smallint,
            (r ->> 'period')::smallint, r ->> 'type',
            ingest.internal_id(v_source, 'team', r ->> 'team_source_id'),
            ingest.internal_id(v_source, 'player', r ->> 'player_source_id'),
            ingest.internal_id(v_source, 'player', r ->> 'related_player_source_id'),
            r ->> 'detail', v_source);
    n_events := n_events + 1;
  end loop;

  for r in select * from jsonb_array_elements(coalesce(p_batch -> 'team_stats', '[]')) loop
    insert into core.team_match_stat (match_id, team_id, stat_key, value, source)
    values (ingest.internal_id(v_source, 'match', r ->> 'match_source_id'),
            ingest.internal_id(v_source, 'team', r ->> 'team_source_id'),
            r ->> 'stat_key', (r ->> 'value')::numeric, coalesce(r ->> 'source', v_source));
    n_stats := n_stats + 1;
  end loop;

  -- Estadísticas por jugador: el jugador ya existe porque está en la alineación del partido.
  for r in select * from jsonb_array_elements(coalesce(p_batch -> 'player_stats', '[]')) loop
    v_id := ingest.internal_id(v_source, 'player', r ->> 'player_source_id');
    if v_id is null then
      raise exception 'Estadística de un jugador desconocido: %', r ->> 'player_source_id';
    end if;
    insert into core.player_match_stat (match_id, player_id, stat_key, value, source)
    values (ingest.internal_id(v_source, 'match', r ->> 'match_source_id'), v_id,
            r ->> 'stat_key', (r ->> 'value')::numeric, coalesce(r ->> 'source', v_source))
    on conflict (match_id, player_id, stat_key) do update
      set value = excluded.value, source = excluded.source, fetched_at = now();
    n_player_stats := n_player_stats + 1;
  end loop;

  for r in select * from jsonb_array_elements(coalesce(p_batch -> 'formations', '[]')) loop
    insert into core.team_match_formation (match_id, team_id, formation, source)
    values (ingest.internal_id(v_source, 'match', r ->> 'match_source_id'),
            ingest.internal_id(v_source, 'team', r ->> 'team_source_id'),
            r ->> 'formation', coalesce(r ->> 'source', v_source))
    on conflict (match_id, team_id) do update
      set formation = excluded.formation, source = excluded.source, fetched_at = now();
    n_formations := n_formations + 1;
  end loop;

  -- Tiros ubicados. De los rivales llegan sin jugador (no se guardan jugadores rivales).
  for r in select * from jsonb_array_elements(coalesce(p_batch -> 'shots', '[]')) loop
    insert into core.shot (match_id, team_id, player_id, minute, outcome, body_part, penalty,
                           zone, xg, x, y, end_x, end_y, source)
    values (ingest.internal_id(v_source, 'match', r ->> 'match_source_id'),
            ingest.internal_id(v_source, 'team', r ->> 'team_source_id'),
            ingest.internal_id(v_source, 'player', r ->> 'player_source_id'),
            (r ->> 'minute')::smallint, r ->> 'outcome', r ->> 'body_part',
            coalesce((r ->> 'penalty')::boolean, false), r ->> 'zone', (r ->> 'xg')::numeric,
            (r ->> 'x')::numeric, (r ->> 'y')::numeric, (r ->> 'end_x')::numeric,
            (r ->> 'end_y')::numeric, coalesce(r ->> 'source', v_source));
    n_shots := n_shots + 1;
  end loop;

  -- Registro de la corrida y fecha pública de última actualización.
  insert into core.ingest_log (run_id, source, finished_at, status, rows_inserted, message,
                               db_size_bytes)
  values (v_run_id, v_source, now(), coalesce(p_batch ->> 'status', 'ok'),
          n_matches + n_lineups + n_events + n_stats, p_batch ->> 'message',
          pg_database_size(current_database()));
  -- Cada fuente secundaria que aportó filas (xG de NoFluffPicks, estadísticas de
  -- ScoutingStats) también queda registrada, así la web muestra su estado y su última carga.
  insert into core.ingest_log (run_id, source, finished_at, status, rows_inserted)
  select v_run_id, s.source, now(), 'ok', count(*)
  from (
    select x.source from jsonb_to_recordset(coalesce(p_batch -> 'team_stats', '[]')) as x(source text)
    union all
    select x.source from jsonb_to_recordset(coalesce(p_batch -> 'player_stats', '[]')) as x(source text)
    union all
    select x.source from jsonb_to_recordset(coalesce(p_batch -> 'formations', '[]')) as x(source text)
    union all
    select x.source from jsonb_to_recordset(coalesce(p_batch -> 'shots', '[]')) as x(source text)
  ) s
  where s.source is not null and s.source <> v_source and s.source ~ '^[a-z_]+$'
  group by s.source;

  insert into core.system_status (key, value, updated_at)
  values ('ultima_actualizacion', to_char(now() at time zone 'America/Argentina/Buenos_Aires',
          'YYYY-MM-DD"T"HH24:MI:SS'), now())
  on conflict (key) do update set value = excluded.value, updated_at = now();

  return jsonb_build_object('teams', n_teams, 'players', n_players, 'matches', n_matches,
                            'lineups', n_lineups, 'events', n_events, 'team_stats', n_stats,
                            'player_stats', n_player_stats, 'formations', n_formations,
                            'shots', n_shots);
end;
$$;

revoke all on function ingest.load_batch(jsonb) from public;
grant execute on function ingest.load_batch(jsonb) to service_role;

-- Tiros de los partidos de Boca, a favor y en contra, con el jugador solo si es de Boca.
create view api.boca_shot
with (security_invoker = true) as
select s.shot_id, bm.match_id, bm.match_date, bm.competition_code, bm.opponent,
       t.is_boca as boca_shot, s.player_id, p.full_name as player_name,
       s.minute, s.outcome, s.body_part, s.penalty, s.zone, s.xg,
       s.x, s.y, s.end_x, s.end_y, s.source
from core.shot s
join api.boca_match bm on bm.match_id = s.match_id
join core.team t on t.team_id = s.team_id
left join core.player p on p.player_id = s.player_id;
comment on view api.boca_shot is 'Tiros ubicados de los partidos de Boca (a favor y en contra) para el mapa de tiros.';

-- xG, goles, tiros de cabeza y de afuera por jugador de Boca, por competición y total.
create view api.player_shot_totals
with (security_invoker = true) as
select bs.player_id,
       coalesce(bs.competition_code, 'todas') as competition_code,
       count(*)::integer                                           as shots,
       round(sum(bs.xg), 2)                                        as xg,
       round(sum(bs.xg) filter (where not bs.penalty), 2)          as npxg,
       count(*) filter (where bs.outcome = 'goal')::integer        as goals,
       count(*) filter (where bs.body_part = 'header')::integer    as headers,
       count(*) filter (where bs.body_part = 'header' and bs.outcome = 'goal')::integer as header_goals,
       count(*) filter (where bs.zone = 'outside_box')::integer    as shots_outside_box,
       count(*) filter (where bs.zone = 'outside_box' and bs.outcome = 'goal')::integer as goals_outside_box,
       count(*) filter (where bs.outcome = 'blocked')::integer     as shots_blocked,
       min(bs.source)                                              as source
from api.boca_shot bs
where bs.boca_shot and bs.player_id is not null
group by grouping sets ((bs.player_id, bs.competition_code), (bs.player_id));
comment on view api.player_shot_totals is 'Tiros, xG, npxG y goles por tipo de cada jugador de Boca (StrikerAPI).';

grant select on api.boca_shot, api.player_shot_totals to anon, service_role;
