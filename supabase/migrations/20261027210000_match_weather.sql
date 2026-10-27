-- Etapa 3 (fuentes): clima a la hora del inicio de cada partido (Open-Meteo, CC BY 4.0, uso no
-- comercial). Se carga con una función aparte para no tocar `load_batch`.

create table core.match_weather (
  match_id          integer primary key references core.match (match_id) on delete cascade,
  temperature_c     numeric check (temperature_c between -30 and 50),
  precipitation_mm  numeric check (precipitation_mm between 0 and 200),
  wind_kmh          numeric check (wind_kmh between 0 and 200),
  humidity_pct      numeric check (humidity_pct between 0 and 100),
  latitude          numeric not null check (latitude between -90 and 90),
  longitude         numeric not null check (longitude between -180 and 180),
  place             text not null,
  source            text not null,
  fetched_at        timestamptz not null default now()
);

alter table core.match_weather enable row level security;
create policy anon_read on core.match_weather for select to anon using (true);
grant select on core.match_weather to anon;

-- Upsert por partido. Los partidos se identifican por su id de Promiedos (la fuente principal).
create function ingest.load_weather(p_rows jsonb)
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
    insert into core.match_weather (match_id, temperature_c, precipitation_mm, wind_kmh,
                                    humidity_pct, latitude, longitude, place, source)
    values (v_match_id, (r ->> 'temperature_c')::numeric, (r ->> 'precipitation_mm')::numeric,
            (r ->> 'wind_kmh')::numeric, (r ->> 'humidity_pct')::numeric,
            (r ->> 'latitude')::numeric, (r ->> 'longitude')::numeric, r ->> 'place', r ->> 'source')
    on conflict (match_id) do update
      set temperature_c = excluded.temperature_c, precipitation_mm = excluded.precipitation_mm,
          wind_kmh = excluded.wind_kmh, humidity_pct = excluded.humidity_pct,
          latitude = excluded.latitude, longitude = excluded.longitude, place = excluded.place,
          source = excluded.source, fetched_at = now();
    n := n + 1;
  end loop;
  if n > 0 then
    insert into core.ingest_log (run_id, source, finished_at, status, rows_inserted)
    values (gen_random_uuid(), 'openmeteo', now(), 'ok', n);
  end if;
  return n;
end;
$$;
revoke all on function ingest.load_weather(jsonb) from public;
grant execute on function ingest.load_weather(jsonb) to service_role;

-- Clima y resultado de cada partido de Boca.
create view api.boca_weather
with (security_invoker = true) as
select bm.match_id, bm.match_date, bm.competition_code, bm.opponent, bm.boca_home,
       bm.goals_for, bm.goals_against,
       case when bm.goals_for > bm.goals_against then 3
            when bm.goals_for = bm.goals_against then 1 else 0 end as points,
       w.temperature_c, w.precipitation_mm, w.wind_kmh, w.humidity_pct, w.place, w.source
from api.boca_match bm
join core.match_weather w on w.match_id = bm.match_id;
comment on view api.boca_weather is 'Clima a la hora del partido (Open-Meteo) junto al resultado de Boca.';
grant select on api.boca_weather to anon, service_role;
