-- Métricas de cada corrida del pipeline (16.5): duración, partidos, filas cargadas, avisos, errores y
-- tamaño de la base. Una fila por corrida; la escribe el pipeline al terminar con la clave secreta.
-- Se publica en api.pipeline_run_metrics para la página /estado y para Power BI.

create table core.pipeline_run_metrics (
  run_id uuid primary key,
  started_at timestamptz not null,
  finished_at timestamptz not null default now(),
  duration_s numeric(10, 1) not null check (duration_s >= 0),
  status text not null check (status in ('ok', 'parcial', 'error')),
  matches integer not null default 0 check (matches >= 0),
  rows_loaded bigint not null default 0 check (rows_loaded >= 0),
  warnings integer not null default 0 check (warnings >= 0),
  errors integer not null default 0 check (errors >= 0),
  db_size_bytes bigint,
  commit_sha text check (commit_sha is null or commit_sha ~ '^[0-9a-f]{7,40}$')
);
create index pipeline_run_metrics_finished_idx on core.pipeline_run_metrics (finished_at desc);

alter table core.pipeline_run_metrics enable row level security;
-- Lectura pública por columnas, como el resto de core (las vistas de api son security_invoker).
grant select (run_id, started_at, finished_at, duration_s, status, matches, rows_loaded, warnings, errors,
              db_size_bytes, commit_sha)
  on core.pipeline_run_metrics to anon, powerbi_reader;
create policy anon_read on core.pipeline_run_metrics for select to anon, powerbi_reader using (true);

create view api.pipeline_run_metrics
with (security_invoker = true) as
select run_id, started_at, finished_at, duration_s, status, matches, rows_loaded, warnings, errors,
       db_size_bytes, commit_sha
from core.pipeline_run_metrics;
comment on view api.pipeline_run_metrics is
  'Una fila por corrida del pipeline: duración, partidos, filas cargadas, avisos, errores y tamaño de la base.';
grant select on api.pipeline_run_metrics to anon, powerbi_reader, service_role;

-- La escribe el pipeline. El tamaño de la base se mide acá, del lado del servidor.
create function ingest.log_run(p_run jsonb)
returns void
language sql
set search_path = ''
as $$
  insert into core.pipeline_run_metrics (
    run_id, started_at, duration_s, status, matches, rows_loaded, warnings, errors, db_size_bytes, commit_sha
  )
  values (
    (p_run ->> 'run_id')::uuid,
    (p_run ->> 'started_at')::timestamptz,
    (p_run ->> 'duration_s')::numeric,
    p_run ->> 'status',
    coalesce((p_run ->> 'matches')::integer, 0),
    coalesce((p_run ->> 'rows_loaded')::bigint, 0),
    coalesce((p_run ->> 'warnings')::integer, 0),
    coalesce((p_run ->> 'errors')::integer, 0),
    pg_database_size(current_database()),
    nullif(p_run ->> 'commit_sha', '')
  )
  on conflict (run_id) do update set
    finished_at = now(), duration_s = excluded.duration_s, status = excluded.status,
    matches = excluded.matches, rows_loaded = excluded.rows_loaded, warnings = excluded.warnings,
    errors = excluded.errors, db_size_bytes = excluded.db_size_bytes, commit_sha = excluded.commit_sha;
$$;
revoke all on function ingest.log_run(jsonb) from public, anon, authenticated;
grant execute on function ingest.log_run(jsonb) to service_role;
