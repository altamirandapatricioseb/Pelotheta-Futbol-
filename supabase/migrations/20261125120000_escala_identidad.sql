-- Etapa 2 de docs/plan-escala-conmebol.md: identidad estable, alias, linaje de clubes y cobertura por época.
-- Todo aditivo: no cambia columnas ni claves de conflicto que usa ingest.load_batch, así Boca sigue igual.

-- 1. Rangos que impedían el histórico (1891) y los próximos 100 años.
alter table core.season drop constraint if exists season_year_check;
alter table core.season add constraint season_year_check check (year between 1880 and 2200);
alter table core.player drop constraint if exists player_birth_date_check;
alter table core.player add constraint player_birth_date_check check (birth_date > date '1850-01-01');

-- 2. Países: código FIFA propio y equivalencias con los códigos de cada fuente.
create table core.country (
  code          text primary key check (code ~ '^[A-Z]{3}$'),
  name_es       text not null,
  confederation text not null check (confederation in ('CONMEBOL', 'UEFA', 'CONCACAF', 'CAF', 'AFC', 'OFC', 'FIFA'))
);
insert into core.country (code, name_es, confederation) values
  ('ARG', 'Argentina', 'CONMEBOL'), ('BRA', 'Brasil', 'CONMEBOL'), ('URU', 'Uruguay', 'CONMEBOL'),
  ('PAR', 'Paraguay', 'CONMEBOL'), ('CHI', 'Chile', 'CONMEBOL'), ('COL', 'Colombia', 'CONMEBOL'),
  ('ECU', 'Ecuador', 'CONMEBOL'), ('PER', 'Perú', 'CONMEBOL'), ('BOL', 'Bolivia', 'CONMEBOL'),
  ('VEN', 'Venezuela', 'CONMEBOL'),
  ('CSA', 'Conmebol (internacional)', 'CONMEBOL'), ('WLD', 'Internacional', 'FIFA');

create table core.country_source_map (
  source       text not null,
  source_code  text not null,
  country_code text not null references core.country (code),
  primary key (source, source_code)
);
-- Códigos de Promiedos leídos en la sonda de la etapa 1 (data/raw/phase0/conmebol.json).
insert into core.country_source_map (source, source_code, country_code) values
  ('promiedos', 'ba', 'ARG'), ('promiedos', 'cb', 'BRA'), ('promiedos', 'bbb', 'URU'),
  ('promiedos', 'bai', 'PAR'), ('promiedos', 'ci', 'CHI'), ('promiedos', 'baj', 'COL'),
  ('promiedos', 'fb', 'ECU'), ('promiedos', 'bbc', 'PER'), ('promiedos', 'bbd', 'BOL'),
  ('promiedos', 'bba', 'VEN'), ('promiedos', 'bh', 'CSA'), ('promiedos', 'fe', 'WLD');

-- 3. Normalización de nombres (sin la extensión unaccent).
create function core.slug(p text)
returns text
language sql
immutable
set search_path = ''
as $$
  select trim(both '-' from regexp_replace(
    lower(translate(coalesce(p, ''), 'ÁÀÂÄÃÉÈÊËÍÌÎÏÓÒÔÖÕÚÙÛÜÑÇáàâäãéèêëíìîïóòôöõúùûüñç',
                                     'AAAAAEEEEIIIIOOOOOUUUUNCaaaaaeeeeiiiiooooouuuunc')),
    '[^a-z0-9]+', '-', 'g'));
$$;

-- 4. Identificadores estables (texto, nunca se reutilizan ni cambian al renombrar).
--    El de jugador es solo el nombre: anon no puede ver la fecha de nacimiento (test_rls).
alter table core.team add column uid text unique;
alter table core.player add column uid text unique;
alter table core.competition add column uid text unique;
alter table core.team add column country_code text references core.country (code);
alter table core.competition add column country_code text references core.country (code);

create function core.country_of(p_source text, p_code text)
returns text
language sql
stable
set search_path = ''
as $$ select country_code from core.country_source_map where source = p_source and source_code = p_code $$;

-- Devuelve p_base o p_base-2, -3… el primero que no esté usado en la tabla.
create function core.free_uid(p_table text, p_base text)
returns text
language plpgsql
set search_path = ''
as $$
declare
  v_uid text := p_base;
  v_n integer := 1;
  v_taken boolean;
begin
  loop
    execute format('select exists (select 1 from core.%I where uid = $1)', p_table) into v_taken using v_uid;
    exit when not v_taken;
    v_n := v_n + 1;
    v_uid := p_base || '-' || v_n;
  end loop;
  return v_uid;
end;
$$;

create function core.set_uid()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_table_name = 'team' then
    new.country_code := coalesce(new.country_code, core.country_of('promiedos', new.country));
    new.uid := coalesce(new.uid, core.free_uid('team',
      lower(coalesce(new.country_code, 'xxx')) || '-' || core.slug(new.name)));
  elsif tg_table_name = 'competition' then
    new.country_code := coalesce(new.country_code, core.country_of('promiedos', new.country));
    new.uid := coalesce(new.uid, core.free_uid('competition',
      lower(coalesce(new.country_code, 'xxx')) || '-' || core.slug(new.code)));
  else
    new.uid := coalesce(new.uid, core.free_uid('player',
      'p-' || core.slug(new.full_name)));
  end if;
  return new;
end;
$$;
create trigger team_uid before insert on core.team for each row execute function core.set_uid();
create trigger player_uid before insert on core.player for each row execute function core.set_uid();
create trigger competition_uid before insert on core.competition for each row execute function core.set_uid();

-- Relleno de lo que ya existe, en orden de id para que el resultado sea reproducible.
do $$
declare r record;
begin
  update core.team set country_code = core.country_of('promiedos', country) where country_code is null;
  update core.competition set country_code = core.country_of('promiedos', country) where country_code is null;
  for r in select team_id, country_code, name from core.team where uid is null order by team_id loop
    update core.team set uid = core.free_uid('team', lower(coalesce(r.country_code, 'xxx')) || '-' || core.slug(r.name))
    where team_id = r.team_id;
  end loop;
  for r in select competition_id, country_code, code from core.competition where uid is null order by competition_id loop
    update core.competition
    set uid = core.free_uid('competition', lower(coalesce(r.country_code, 'xxx')) || '-' || core.slug(r.code))
    where competition_id = r.competition_id;
  end loop;
  for r in select player_id, full_name from core.player where uid is null order by player_id loop
    update core.player
    set uid = core.free_uid('player', 'p-' || core.slug(r.full_name))
    where player_id = r.player_id;
  end loop;
end;
$$;
alter table core.team alter column uid set not null;
alter table core.player alter column uid set not null;
alter table core.competition alter column uid set not null;

-- 5. Alias: todos los nombres con que aparece cada entidad (por fuente y por época).
create table core.alias (
  entity      text not null check (entity in ('team', 'player', 'competition')),
  internal_id bigint not null,
  alias       text not null,
  alias_norm  text generated always as (core.slug(alias)) stored,
  source      text not null,
  valid_from  date,
  valid_to    date check (valid_to is null or valid_from is null or valid_to >= valid_from),
  primary key (entity, internal_id, alias_norm, source)
);
create index alias_lookup_idx on core.alias (entity, alias_norm);

-- Cada alta o cambio de nombre deja el nombre como alias: los renombres no pierden el nombre viejo.
create function core.keep_alias()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_table_name = 'team' then
    insert into core.alias (entity, internal_id, alias, source)
    select 'team', new.team_id, a, new.source from unnest(array[new.name, new.short_name]) a where a is not null
    on conflict do nothing;
  elsif tg_table_name = 'competition' then
    insert into core.alias (entity, internal_id, alias, source) values ('competition', new.competition_id, new.name_es, new.source)
    on conflict do nothing;
  else
    insert into core.alias (entity, internal_id, alias, source)
    select 'player', new.player_id, a, new.source from unnest(array[new.full_name, new.known_as]) a where a is not null
    on conflict do nothing;
  end if;
  return null;
end;
$$;
create trigger team_alias after insert or update of name, short_name on core.team
  for each row execute function core.keep_alias();
create trigger player_alias after insert or update of full_name, known_as on core.player
  for each row execute function core.keep_alias();
create trigger competition_alias after insert or update of name_es on core.competition
  for each row execute function core.keep_alias();

insert into core.alias (entity, internal_id, alias, source)
select 'team', team_id, a, source from core.team, unnest(array[name, short_name]) a where a is not null
union all
select 'player', player_id, a, source from core.player, unnest(array[full_name, known_as]) a where a is not null
union all
select 'competition', competition_id, name_es, source from core.competition
on conflict do nothing;

-- 6. Linaje: fusiones, refundaciones y cambios de nombre (se siembra desde Wikidata, CC0).
create table core.team_lineage (
  team_id        integer not null references core.team (team_id),
  predecessor_id integer not null references core.team (team_id),
  kind           text not null check (kind in ('fusion', 'refundacion', 'cambio_de_nombre', 'escision')),
  event_date     date,
  source         text not null,
  note           text,
  primary key (team_id, predecessor_id, kind),
  check (team_id <> predecessor_id)
);

-- 7. Cobertura por competición, temporada y tabla: la UI no muestra «0» donde no hay dato.
create table core.coverage (
  competition_id smallint not null references core.competition (competition_id),
  season_year    smallint not null check (season_year between 1880 and 2200),
  table_name     text not null,
  level          text not null check (level in ('completo', 'parcial', 'sin_datos')),
  scope          text not null check (scope in ('liga', 'equipo')),
  matches_with   integer not null check (matches_with >= 0),
  matches_total  integer not null check (matches_total >= 0),
  checked_at     timestamptz not null default now(),
  primary key (competition_id, season_year, table_name)
);

-- Recalcula la cobertura con lo cargado. Hoy solo hay partidos de Boca: el alcance es 'equipo'.
create function ingest.refresh_coverage()
returns integer
language plpgsql
set search_path = ''
as $$
declare v_rows integer;
begin
  delete from core.coverage where true;
  with m as (
    select s.competition_id, s.year, mt.match_id
    from core.match mt join core.season s using (season_id)
    where mt.status = 'jugado'
  ),
  t(table_name, match_id) as (
    select 'lineup', match_id from core.lineup
    union select 'event', match_id from core.event
    union select 'shot', match_id from core.shot
    union select 'team_match_stat', match_id from core.team_match_stat
    union select 'player_match_stat', match_id from core.player_match_stat
    union select 'team_match_formation', match_id from core.team_match_formation
    union select 'match_momentum', match_id from core.match_momentum
  ),
  names(table_name) as (select distinct table_name from t),
  grid as (
    select m.competition_id, m.year, n.table_name,
           count(distinct t.match_id) as with_data, count(distinct m.match_id) as total
    from m cross join names n
    left join t on t.match_id = m.match_id and t.table_name = n.table_name
    group by m.competition_id, m.year, n.table_name
  )
  insert into core.coverage (competition_id, season_year, table_name, level, scope, matches_with, matches_total)
  select competition_id, year, table_name,
         case when with_data = 0 then 'sin_datos' when with_data < total then 'parcial' else 'completo' end,
         'equipo', with_data, total
  from grid;
  get diagnostics v_rows = row_count;
  return v_rows;
end;
$$;
revoke all on function ingest.refresh_coverage() from public, anon, authenticated;
grant execute on function ingest.refresh_coverage() to service_role;

-- 8. Permisos (mismo patrón que el resto: RLS en core, lectura por api).
alter table core.country enable row level security;
alter table core.country_source_map enable row level security;
alter table core.alias enable row level security;
alter table core.team_lineage enable row level security;
alter table core.coverage enable row level security;
grant select on core.country, core.alias, core.team_lineage, core.coverage to anon, powerbi_reader;
create policy anon_read on core.country for select to anon, powerbi_reader using (true);
create policy anon_read on core.alias for select to anon, powerbi_reader using (true);
create policy anon_read on core.team_lineage for select to anon, powerbi_reader using (true);
create policy anon_read on core.coverage for select to anon, powerbi_reader using (true);
grant select (uid, country_code) on core.team, core.competition to anon, powerbi_reader;
grant select (uid) on core.player to anon, powerbi_reader;

create view api.coverage with (security_invoker = true) as
select c.uid as competition_uid, c.name_es as competition, c.country_code, v.season_year, v.table_name,
       v.level, v.scope, v.matches_with, v.matches_total, v.checked_at
from core.coverage v join core.competition c using (competition_id);
comment on view api.coverage is 'Cobertura por competición, temporada y tabla: completo, parcial o sin_datos (la UI dice «sin datos para esta época» en vez de 0).';
grant select on api.coverage to anon, powerbi_reader, service_role;

create view api.team_identity with (security_invoker = true) as
select t.uid, t.name, t.short_name, t.country_code, k.name_es as country,
       coalesce(array_agg(a.alias order by a.alias) filter (where a.alias is not null), '{}') as aliases
from core.team t
left join core.country k on k.code = t.country_code
left join core.alias a on a.entity = 'team' and a.internal_id = t.team_id
group by t.team_id, k.name_es;
comment on view api.team_identity is 'Id estable, país y alias de cada club.';
grant select on api.team_identity to anon, powerbi_reader, service_role;

select ingest.refresh_coverage();
