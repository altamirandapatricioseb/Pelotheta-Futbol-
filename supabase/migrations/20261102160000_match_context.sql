-- Fuente ELNINE (2-nov-2026): DT de cada equipo y estadio con su capacidad, por partido.
-- Se carga con una función aparte, como el clima, para no tocar `load_batch`.

create table core.match_context (
  match_id          integer primary key references core.match (match_id) on delete cascade,
  boca_coach        text check (length(boca_coach) <= 80),
  rival_coach       text check (length(rival_coach) <= 80),
  stadium           text check (length(stadium) <= 120),
  stadium_capacity  integer check (stadium_capacity between 1 and 200000),
  source            text not null,
  fetched_at        timestamptz not null default now()
);

alter table core.match_context enable row level security;
grant select (match_id, boca_coach, rival_coach, stadium, stadium_capacity, source, fetched_at)
  on core.match_context to anon, powerbi_reader;
create policy anon_read on core.match_context for select to anon, powerbi_reader using (true);

-- Upsert por partido; los partidos se identifican por su id de Promiedos (la fuente principal).
create function ingest.load_match_context(p_rows jsonb)
returns integer
language plpgsql
set search_path = ''
as $$
declare
  r jsonb;
  v_match_id bigint;
  n integer := 0;
begin
  for r in select * from jsonb_array_elements(coalesce(p_rows, '[]')) loop
    v_match_id := ingest.internal_id('promiedos', 'match', r ->> 'match_source_id');
    if v_match_id is null then
      continue;
    end if;
    insert into core.match_context (match_id, boca_coach, rival_coach, stadium, stadium_capacity, source)
    values (v_match_id, r ->> 'boca_coach', r ->> 'rival_coach', r ->> 'stadium',
            (r ->> 'stadium_capacity')::integer, r ->> 'source')
    on conflict (match_id) do update
      set boca_coach = excluded.boca_coach, rival_coach = excluded.rival_coach,
          stadium = excluded.stadium, stadium_capacity = excluded.stadium_capacity,
          source = excluded.source, fetched_at = now();
    n := n + 1;
  end loop;
  if n > 0 then
    insert into core.ingest_log (run_id, source, finished_at, status, rows_inserted)
    values (gen_random_uuid(), 'elnine', now(), 'ok', n);
  end if;
  return n;
end;
$$;
revoke all on function ingest.load_match_context(jsonb) from public, anon, authenticated;
grant execute on function ingest.load_match_context(jsonb) to service_role;

create view api.match_context
with (security_invoker = true) as
select match_id, boca_coach, rival_coach, stadium, stadium_capacity, source
from core.match_context;
comment on view api.match_context is 'DT de Boca y del rival y estadio con su capacidad, por partido (ELNINE).';
grant select on api.match_context to anon, powerbi_reader, service_role;
