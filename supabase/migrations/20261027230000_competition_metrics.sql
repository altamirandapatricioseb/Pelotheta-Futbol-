-- Etapa 3 (fuentes): métricas de Boca por competición con el promedio de la competición y el
-- puesto entre todos los equipos (ScoutingStats, páginas de rendimiento del club). Incluye el
-- PPDA y el Field Tilt que calcula la fuente, goles evitados y xG de pelota parada en contra.

create table core.club_competition_metric (
  source        text not null,
  season        smallint not null,
  competition   text not null check (competition ~ '^[a-z0-9_]+$'),
  metric        text not null check (metric ~ '^[a-z0-9_]+$'),
  value         numeric not null,
  comp_average  numeric,
  rank          smallint check (rank >= 1),
  n_teams       smallint check (n_teams >= 1),
  fetched_at    timestamptz not null default now(),
  primary key (source, season, competition, metric)
);
alter table core.club_competition_metric enable row level security;
create policy anon_read on core.club_competition_metric for select to anon using (true);
grant select on core.club_competition_metric to anon;

create function ingest.load_competition_metrics(p_rows jsonb)
returns integer
language plpgsql
set search_path = ''
as $$
declare
  r jsonb;
  n integer := 0;
begin
  for r in select * from jsonb_array_elements(coalesce(p_rows, '[]')) loop
    insert into core.club_competition_metric (source, season, competition, metric, value,
                                              comp_average, rank, n_teams)
    values (r ->> 'source', (r ->> 'season')::smallint, r ->> 'competition', r ->> 'metric',
            (r ->> 'value')::numeric, (r ->> 'comp_average')::numeric, (r ->> 'rank')::smallint,
            (r ->> 'n_teams')::smallint)
    on conflict (source, season, competition, metric) do update
      set value = excluded.value, comp_average = excluded.comp_average, rank = excluded.rank,
          n_teams = excluded.n_teams, fetched_at = now();
    n := n + 1;
  end loop;
  return n;
end;
$$;
revoke all on function ingest.load_competition_metrics(jsonb) from public;
grant execute on function ingest.load_competition_metrics(jsonb) to service_role;

create view api.boca_competition_metric with (security_invoker = true) as
select source, season, competition, metric, value, comp_average, rank, n_teams
from core.club_competition_metric;
comment on view api.boca_competition_metric is 'Métricas de Boca por competición con el promedio y el puesto (ScoutingStats): PPDA, Field Tilt, goles evitados y más.';
grant select on api.boca_competition_metric to anon, service_role;
