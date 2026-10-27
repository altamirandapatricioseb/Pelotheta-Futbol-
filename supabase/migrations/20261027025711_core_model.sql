-- =============================================================================
-- Modelo base (sección 7): entidades del fútbol y registros de operación.
--
-- Decisiones:
--   * Claves internas propias (identity) y una tabla de mapeo de ids por fuente,
--     porque cada fuente numera distinto y ninguna es "la verdad".
--   * Cada fila guarda `source` y `fetched_at`: trazabilidad de dónde salió el dato.
--   * Las estadísticas por partido (box scores) y el catálogo llegan en las etapas 3 y 4,
--     cuando la Fase 0 confirma qué campos trae cada fuente.
--   * RLS activado en TODAS las tablas. Sin políticas de escritura para nadie: escribe
--     solo service_role, que saltea RLS.
-- =============================================================================

-- Estado del sistema: también es la "fila de prueba" de la etapa 1.
create table core.system_status (
  key         text primary key,
  value       text not null,
  updated_at  timestamptz not null default now()
);
comment on table core.system_status is 'Pares clave/valor de estado público del sistema (etapa, última actualización).';

create table core.competition (
  competition_id  smallint generated always as identity primary key,
  code            text not null unique,
  name_es         text not null,
  kind            text not null check (kind in ('liga', 'copa_nacional', 'copa_internacional', 'amistoso')),
  country         text,
  source          text not null,
  fetched_at      timestamptz not null default now()
);

create table core.season (
  season_id       integer generated always as identity primary key,
  competition_id  smallint not null references core.competition (competition_id),
  year            smallint not null check (year between 1905 and 2100),
  name_es         text not null,
  start_date      date,
  end_date        date,
  source          text not null,
  fetched_at      timestamptz not null default now(),
  unique (competition_id, name_es),
  check (end_date is null or start_date is null or end_date >= start_date)
);

create table core.team (
  team_id      integer generated always as identity primary key,
  name         text not null unique,
  short_name   text,
  country      text,
  stadium      text,
  stadium_lat  numeric(9, 6) check (stadium_lat between -90 and 90),
  stadium_lon  numeric(9, 6) check (stadium_lon between -180 and 180),
  is_boca      boolean not null default false,
  source       text not null,
  fetched_at   timestamptz not null default now()
);
-- Solo puede haber un equipo marcado como Boca.
create unique index team_only_one_boca on core.team (is_boca) where is_boca;

create table core.player (
  player_id       integer generated always as identity primary key,
  full_name       text not null,
  known_as        text,
  -- Dato personal (Ley 25.326): se guarda solo para calcular la edad. No se publica.
  birth_date      date check (birth_date > date '1950-01-01'),
  position_raw    text,
  nationality     text,
  height_cm       smallint check (height_cm between 140 and 220),
  weight_kg       smallint check (weight_kg between 40 and 130),
  preferred_foot  text check (preferred_foot in ('derecho', 'izquierdo', 'ambos')),
  source          text not null,
  fetched_at      timestamptz not null default now()
);
comment on column core.player.birth_date is 'Dato personal: no se expone en la API pública; solo se usa para calcular la edad.';

create table core.referee (
  referee_id  integer generated always as identity primary key,
  name        text not null unique,
  source      text not null,
  fetched_at  timestamptz not null default now()
);

create table core.match (
  match_id        integer generated always as identity primary key,
  season_id       integer not null references core.season (season_id),
  match_date      date not null,
  kickoff_at      timestamptz,
  round_label     text,
  home_team_id    integer not null references core.team (team_id),
  away_team_id    integer not null references core.team (team_id),
  home_goals      smallint check (home_goals >= 0),
  away_goals      smallint check (away_goals >= 0),
  home_goals_ht   smallint check (home_goals_ht >= 0),
  away_goals_ht   smallint check (away_goals_ht >= 0),
  status          text not null check (status in ('programado', 'jugado', 'suspendido', 'postergado', 'cancelado')),
  venue           text,
  referee_id      integer references core.referee (referee_id),
  extra_time      boolean not null default false,
  penalties_home  smallint check (penalties_home >= 0),
  penalties_away  smallint check (penalties_away >= 0),
  source          text not null,
  fetched_at      timestamptz not null default now(),
  check (home_team_id <> away_team_id),
  -- Un partido jugado tiene que tener resultado.
  check (status <> 'jugado' or (home_goals is not null and away_goals is not null))
);
create index match_season_date_idx on core.match (season_id, match_date);
create index match_home_idx on core.match (home_team_id);
create index match_away_idx on core.match (away_team_id);

-- Alineaciones: base para reconstruir los minutos en cancha (NR, EWA, ELA).
create table core.lineup (
  match_id      integer not null references core.match (match_id) on delete cascade,
  player_id     integer not null references core.player (player_id),
  team_id       integer not null references core.team (team_id),
  started       boolean not null,
  minute_in     smallint check (minute_in between 0 and 130),
  minute_out    smallint check (minute_out between 0 and 130),
  position      text,
  shirt_number  smallint check (shirt_number between 0 and 99),
  source        text not null,
  fetched_at    timestamptz not null default now(),
  primary key (match_id, player_id),
  check (minute_out is null or minute_in is null or minute_out >= minute_in)
);
create index lineup_player_idx on core.lineup (player_id);

-- Eventos con minuto: goles, tarjetas, cambios y penales.
create table core.event (
  event_id           bigint generated always as identity primary key,
  match_id           integer not null references core.match (match_id) on delete cascade,
  minute             smallint not null check (minute between 0 and 130),
  added_time         smallint check (added_time between 0 and 30),
  period             smallint check (period between 1 and 5),  -- 1T, 2T, 1TE, 2TE, penales
  type               text not null check (type in (
                       'gol', 'gol_en_contra', 'penal_convertido', 'penal_fallado',
                       'amarilla', 'segunda_amarilla', 'roja', 'cambio', 'var', 'otro')),
  team_id            integer not null references core.team (team_id),
  player_id          integer references core.player (player_id),
  -- Asistente en un gol, o el jugador que sale en un cambio.
  related_player_id  integer references core.player (player_id),
  detail             text,
  source             text not null,
  fetched_at         timestamptz not null default now()
);
create index event_match_idx on core.event (match_id, minute);
create index event_player_idx on core.event (player_id);

-- Mapeo de ids: (fuente, entidad, id en la fuente) -> id interno.
create table core.source_id_map (
  source       text not null,
  entity       text not null check (entity in ('competition', 'season', 'team', 'player', 'referee', 'match')),
  source_id    text not null,
  internal_id  bigint not null,
  fetched_at   timestamptz not null default now(),
  primary key (source, entity, source_id)
);

-- Registro de cargas: el estado por fuente es público (la web lo muestra).
create table core.ingest_log (
  ingest_id      bigint generated always as identity primary key,
  run_id         uuid not null,
  source         text not null,
  started_at     timestamptz not null default now(),
  finished_at    timestamptz,
  status         text not null check (status in ('ok', 'parcial', 'error', 'omitido')),
  rows_inserted  integer not null default 0 check (rows_inserted >= 0),
  rows_updated   integer not null default 0 check (rows_updated >= 0),
  message        text,
  db_size_bytes  bigint
);
create index ingest_log_source_idx on core.ingest_log (source, started_at desc);

-- Auditoría de cada corrida (14.6). NO es pública.
create table core.audit_log (
  audit_id        bigint generated always as identity primary key,
  run_id          uuid not null,
  workflow        text not null,
  commit_sha      text,
  tables_touched  text[] not null default '{}',
  rows_inserted   integer not null default 0,
  rows_updated    integer not null default 0,
  input_hashes    text[] not null default '{}',
  duration_ms     integer,
  result          text not null check (result in ('ok', 'parcial', 'error')),
  created_at      timestamptz not null default now()
);
comment on table core.audit_log is 'Auditoría de cargas. Solo la escribe y lee el pipeline. Retención: 12 meses.';

-- -----------------------------------------------------------------------------
-- RLS en todas las tablas del esquema core.
-- -----------------------------------------------------------------------------
alter table core.system_status  enable row level security;
alter table core.competition    enable row level security;
alter table core.season         enable row level security;
alter table core.team           enable row level security;
alter table core.player         enable row level security;
alter table core.referee        enable row level security;
alter table core.match          enable row level security;
alter table core.lineup         enable row level security;
alter table core.event          enable row level security;
alter table core.source_id_map  enable row level security;
alter table core.ingest_log     enable row level security;
alter table core.audit_log      enable row level security;

-- Políticas de SOLO LECTURA para anon sobre lo público. Ninguna política de
-- insert/update/delete existe para anon ni authenticated: sin política, RLS niega.
create policy anon_read on core.system_status for select to anon using (true);
create policy anon_read on core.competition   for select to anon using (true);
create policy anon_read on core.season        for select to anon using (true);
create policy anon_read on core.team          for select to anon using (true);
create policy anon_read on core.player        for select to anon using (true);
create policy anon_read on core.referee       for select to anon using (true);
create policy anon_read on core.match         for select to anon using (true);
create policy anon_read on core.lineup        for select to anon using (true);
create policy anon_read on core.event         for select to anon using (true);
create policy anon_read on core.ingest_log    for select to anon using (true);
-- source_id_map y audit_log: sin política para anon, así que no ve ninguna fila.

-- Permisos de columna para anon: solo lo que alguna vista pública necesita.
-- player.birth_date queda afuera a propósito (minimización de datos personales).
grant select on core.system_status, core.competition, core.season, core.team,
                core.referee, core.match, core.lineup, core.event to anon;
grant select (player_id, full_name, known_as, position_raw, nationality, height_cm,
              weight_kg, preferred_foot, source, fetched_at) on core.player to anon;
grant select (source, started_at, finished_at, status) on core.ingest_log to anon;
