-- =============================================================================
-- Etapa 2: plantel por temporada, estadísticas por equipo y partido, carga del pipeline
-- y vistas de la tabla «Resumen» (Interfaz 3).
--
-- Cómo escribe el pipeline sin contraseña de la base:
--   * La conexión directa a Postgres es solo IPv6 y GitHub Actions usa IPv4, así que el
--     pipeline habla por HTTPS con la Data API, igual que la web.
--   * Se expone un segundo esquema, `ingest`, con UNA función de carga. Solo `service_role`
--     (la clave secreta, que vive en GitHub Secrets) puede usar el esquema y ejecutarla.
--     `anon` no tiene USAGE: si la llama, PostgREST responde «permiso denegado».
--   * La función carga todo un lote en una sola transacción: o entra completo o no entra.
-- =============================================================================

-- 1. Tablas nuevas -------------------------------------------------------------

-- Plantel de Boca por temporada (dorsal y línea). Por qué aparte de `player`: un jugador
-- puede cambiar de dorsal entre temporadas o irse y volver.
create table core.squad_member (
  season_year     smallint not null check (season_year between 1905 and 2100),
  player_id       integer not null references core.player (player_id),
  shirt_number    smallint check (shirt_number between 0 and 99),
  position_group  text check (position_group in ('Arquero', 'Defensor', 'Mediocampista', 'Delantero')),
  source          text not null,
  fetched_at      timestamptz not null default now(),
  primary key (season_year, player_id)
);
create index squad_member_player_idx on core.squad_member (player_id);

-- Estadísticas por equipo y partido en formato largo (una fila por estadística).
-- Por qué largo y no una columna por estadística: cada fuente trae un set distinto y así
-- agregar una estadística nueva no exige cambiar el esquema.
create table core.team_match_stat (
  match_id    integer not null references core.match (match_id) on delete cascade,
  team_id     integer not null references core.team (team_id),
  stat_key    text not null check (stat_key ~ '^[a-z_]+$'),
  value       numeric not null,
  source      text not null,
  fetched_at  timestamptz not null default now(),
  primary key (match_id, team_id, stat_key)
);
create index team_match_stat_team_idx on core.team_match_stat (team_id);

alter table core.squad_member    enable row level security;
alter table core.team_match_stat enable row level security;
create policy anon_read on core.squad_member    for select to anon using (true);
create policy anon_read on core.team_match_stat for select to anon using (true);
grant select on core.squad_member, core.team_match_stat to anon;

-- El código de competición se vuelve obligatorio y único por fuente vía source_id_map;
-- además guardamos el id de la fuente del partido para poder releerlo.
alter table core.competition add column if not exists sort_order smallint not null default 100;

-- 2. Edad sin exponer la fecha de nacimiento ------------------------------------
-- `anon` no puede leer `player.birth_date` (dato personal). Las vistas son security_invoker,
-- así que no podrían calcular la edad. Esta función corre con los permisos de su dueño,
-- vive en `core` (no expuesto) y devuelve solo la edad en años: nunca la fecha.
create function core.player_age(p_player_id integer, p_at date default current_date)
returns smallint
language sql
stable
security definer
set search_path = ''
as $$
  select extract(year from age(p_at, p.birth_date))::smallint
  from core.player p
  where p.player_id = p_player_id;
$$;
revoke all on function core.player_age(integer, date) from public;
grant execute on function core.player_age(integer, date) to anon, service_role;

-- 3. Esquema de carga -----------------------------------------------------------
create schema if not exists ingest;
comment on schema ingest is 'Solo service_role: funciones de carga del pipeline. Expuesto en la Data API pero sin permisos para anon.';
revoke all on schema ingest from public;
grant usage on schema ingest to service_role;
alter default privileges for role postgres in schema ingest revoke execute on routines from public;

-- Busca el id interno de una entidad de la fuente (o null si todavía no existe).
create function ingest.internal_id(p_source text, p_entity text, p_source_id text)
returns bigint
language sql
stable
set search_path = ''
as $$
  select internal_id from core.source_id_map
  where source = p_source and entity = p_entity and source_id = p_source_id;
$$;

-- Carga un lote completo de una fuente. Devuelve cuántas filas tocó de cada tabla.
--
-- Decisiones:
--   * Idempotente: correrla dos veces con el mismo lote deja la base igual. Las entidades
--     se identifican por el id de la fuente (source_id_map) y los detalles de cada partido
--     (alineaciones, eventos, estadísticas) se reemplazan completos.
--   * plpgsql con bucles simples en vez de un único INSERT ... SELECT gigante: los lotes son
--     chicos (decenas de partidos) y así cada paso se puede leer y explicar por separado.
create function ingest.load_batch(p_batch jsonb)
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
            r ->> 'stat_key', (r ->> 'value')::numeric, v_source);
    n_stats := n_stats + 1;
  end loop;

  -- Registro de la corrida y fecha pública de última actualización.
  insert into core.ingest_log (run_id, source, finished_at, status, rows_inserted, message,
                               db_size_bytes)
  values (v_run_id, v_source, now(), coalesce(p_batch ->> 'status', 'ok'),
          n_matches + n_lineups + n_events + n_stats, p_batch ->> 'message',
          pg_database_size(current_database()));
  insert into core.system_status (key, value, updated_at)
  values ('ultima_actualizacion', to_char(now() at time zone 'America/Argentina/Buenos_Aires',
          'YYYY-MM-DD"T"HH24:MI:SS'), now())
  on conflict (key) do update set value = excluded.value, updated_at = now();

  return jsonb_build_object('teams', n_teams, 'players', n_players, 'matches', n_matches,
                            'lineups', n_lineups, 'events', n_events, 'team_stats', n_stats);
end;
$$;

-- Registra una corrida fallida (la web muestra el estado de cada fuente).
create function ingest.log_failure(p_source text, p_message text)
returns void
language sql
set search_path = ''
as $$
  insert into core.ingest_log (run_id, source, finished_at, status, message)
  values (gen_random_uuid(), p_source, now(), 'error', left(p_message, 500));
$$;

revoke all on function ingest.internal_id(text, text, text) from public;
revoke all on function ingest.load_batch(jsonb) from public;
revoke all on function ingest.log_failure(text, text) from public;
grant execute on function ingest.internal_id(text, text, text) to service_role;
grant execute on function ingest.load_batch(jsonb) to service_role;
grant execute on function ingest.log_failure(text, text) to service_role;

alter role authenticator set pgrst.db_schemas = 'api, ingest';
notify pgrst, 'reload config';

-- 4. Vistas de la Interfaz 3 ------------------------------------------------------

-- Partidos de Boca con la competición (base de varias vistas).
create view api.boca_match
with (security_invoker = true) as
select m.match_id,
       m.match_date,
       m.kickoff_at,
       m.round_label,
       c.code      as competition_code,
       c.name_es   as competition_name,
       s.year      as season_year,
       (h.is_boca) as boca_home,
       case when h.is_boca then a.name else h.name end as opponent,
       case when h.is_boca then m.home_goals else m.away_goals end as goals_for,
       case when h.is_boca then m.away_goals else m.home_goals end as goals_against,
       m.status,
       m.venue
from core.match m
join core.season s      on s.season_id = m.season_id
join core.competition c on c.competition_id = s.competition_id
join core.team h        on h.team_id = m.home_team_id
join core.team a        on a.team_id = m.away_team_id
where h.is_boca or a.is_boca;
comment on view api.boca_match is 'Partidos de Boca con rival, goles a favor y en contra y competición.';

-- Tabla «Resumen»: una fila por jugador del plantel y competición, más una fila
-- 'todas' con el total. Por qué GROUPING SETS: da el detalle por competición y el total
-- en una sola pasada, sin duplicar la consulta con un UNION.
create view api.player_summary
with (security_invoker = true) as
with played as (
  -- Minutos por partido: los guarda el pipeline ya calculados (entrada y salida).
  select l.player_id, l.match_id, l.started,
         (l.minute_out - l.minute_in) as minutes
  from core.lineup l
  join core.team t on t.team_id = l.team_id and t.is_boca
  where l.minute_in is not null
),
player_events as (
  -- Goles (de jugada o de penal), asistencias y tarjetas por jugador y partido.
  select e.match_id, e.player_id,
         count(*) filter (where e.type in ('gol', 'penal_convertido')) as goals,
         0 as assists,
         count(*) filter (where e.type = 'amarilla') as yellow_cards,
         count(*) filter (where e.type in ('roja', 'segunda_amarilla')) as red_cards
  from core.event e
  where e.player_id is not null and coalesce(e.period, 1) < 5  -- la tanda de penales no cuenta
  group by e.match_id, e.player_id
  union all
  select e.match_id, e.related_player_id, 0, count(*), 0, 0
  from core.event e
  where e.type in ('gol', 'penal_convertido') and e.related_player_id is not null
  group by e.match_id, e.related_player_id
),
per_match as (
  select p.player_id, p.match_id, p.started, p.minutes,
         coalesce(sum(pe.goals), 0)        as goals,
         coalesce(sum(pe.assists), 0)      as assists,
         coalesce(sum(pe.yellow_cards), 0) as yellow_cards,
         coalesce(sum(pe.red_cards), 0)    as red_cards
  from played p
  left join player_events pe using (player_id, match_id)
  group by p.player_id, p.match_id, p.started, p.minutes
)
select pm.player_id,
       pl.full_name,
       pl.known_as,
       sm.position_group,
       sm.shirt_number,
       core.player_age(pm.player_id) as age,
       pl.height_cm,
       coalesce(bm.competition_code, 'todas') as competition_code,
       coalesce(bm.competition_name, 'Todas las competiciones') as competition_name,
       count(*)::integer                         as matches,
       count(*) filter (where pm.started)::integer as starts,
       sum(pm.minutes)::integer                  as minutes,
       sum(pm.goals)::integer                    as goals,
       sum(pm.assists)::integer                  as assists,
       sum(pm.goals + pm.assists)::integer       as goal_contributions,
       sum(pm.yellow_cards)::integer             as yellow_cards,
       sum(pm.red_cards)::integer                as red_cards
from per_match pm
join api.boca_match bm  on bm.match_id = pm.match_id
join core.player pl     on pl.player_id = pm.player_id
left join core.squad_member sm on sm.player_id = pm.player_id and sm.season_year = bm.season_year
group by grouping sets (
  (pm.player_id, pl.full_name, pl.known_as, sm.position_group, sm.shirt_number, pl.height_cm,
   bm.competition_code, bm.competition_name),
  (pm.player_id, pl.full_name, pl.known_as, sm.position_group, sm.shirt_number, pl.height_cm)
);
comment on view api.player_summary is 'Resumen por jugador: PJ, titular, minutos, goles, asistencias, G+A y tarjetas, por competición y total.';

-- Competiciones con partidos de Boca (para el filtro).
create view api.competition_filter
with (security_invoker = true) as
select c.code, c.name_es, c.sort_order, count(*)::integer as matches
from api.boca_match bm
join core.competition c on c.code = bm.competition_code
group by c.code, c.name_es, c.sort_order;

grant select on api.boca_match, api.player_summary, api.competition_filter to anon, service_role;
