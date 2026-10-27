-- Robustez: una fuente secundaria que falla en una corrida (sin créditos, caída) ya no borra
-- sus datos anteriores. load_batch reemplaza estadísticas, formaciones y tiros solo de las fuentes
-- presentes en el lote; las estadísticas por jugador se limpian con ingest.clear_player_stats por
-- (partido, fuente) antes de cargarlas en bloques; el momentum solo de los partidos que lo traen.

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
    -- Solo se reemplazan las filas de las fuentes que vienen en el lote para este partido: si una
    -- fuente secundaria falló en esta corrida, sus datos anteriores se conservan.
    delete from core.team_match_stat
    where match_id = v_match_id
      and source in (select coalesce(b ->> 'source', v_source)
                     from jsonb_array_elements(coalesce(p_batch -> 'team_stats', '[]')) b
                     where b ->> 'match_source_id' = r ->> 'source_id');
    delete from core.team_match_formation
    where match_id = v_match_id
      and source in (select coalesce(b ->> 'source', v_source)
                     from jsonb_array_elements(coalesce(p_batch -> 'formations', '[]')) b
                     where b ->> 'match_source_id' = r ->> 'source_id');
    delete from core.shot
    where match_id = v_match_id
      and source in (select coalesce(b ->> 'source', v_source)
                     from jsonb_array_elements(coalesce(p_batch -> 'shots', '[]')) b
                     where b ->> 'match_source_id' = r ->> 'source_id');
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
            r ->> 'stat_key', (r ->> 'value')::numeric, coalesce(r ->> 'source', v_source))
    on conflict (match_id, team_id, stat_key) do update
      set value = excluded.value, source = excluded.source, fetched_at = now();
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

create function ingest.clear_player_stats(p_pairs jsonb)
returns integer
language sql
set search_path = ''
as $$
  with pairs as (
    select distinct m.internal_id::integer as match_id, x.source
    from jsonb_to_recordset(coalesce(p_pairs, '[]')) as x(match_source_id text, source text)
    join core.source_id_map m on m.source = 'promiedos' and m.entity = 'match' and m.source_id = x.match_source_id
  ), deleted as (
    delete from core.player_match_stat s using pairs p
    where s.match_id = p.match_id and s.source = p.source
    returning 1
  )
  select count(*)::integer from deleted;
$$;
revoke all on function ingest.clear_player_stats(jsonb) from public;
grant execute on function ingest.clear_player_stats(jsonb) to service_role;

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
  -- Momentum: solo los partidos que lo traen en este lote (si ScoutingStats falla, se conserva).
  delete from core.match_momentum
  where match_id in (select ingest.internal_id('promiedos', 'match', x ->> 'match_source_id')::integer
                     from jsonb_array_elements(coalesce(p_extras -> 'momentum', '[]')) x);

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
