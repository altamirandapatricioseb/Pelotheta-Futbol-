-- Etapa 5: catálogo de gráficos de la Interfaz 1 (9.2.1) y mapa de origen de los datos (9.9).
-- La fuente única son `data/chart_catalog.csv` y `data/chart_source_map.csv`; el pipeline los
-- envía en cada corrida con `ingest.load_charts`, igual que el catálogo de estadísticas.

create table core.chart_catalog (
  chart_id      text primary key,
  category      text not null,
  title_es      text not null,
  chart_type    text not null,
  required_data text not null,
  origin_ref    text not null,
  powerbi       text not null check (powerbi in ('sí', 'alternativa', 'no')),
  excel         text not null check (excel in ('sí', 'alternativa', 'no')),
  available     boolean not null,
  reason_es     text not null default '',
  sort_order    smallint not null
);
alter table core.chart_catalog enable row level security;
create policy anon_read on core.chart_catalog for select to anon using (true);
grant select on core.chart_catalog to anon;

create table core.chart_source_map (
  chart_id    text not null references core.chart_catalog (chart_id) on delete cascade,
  target_type text not null check (target_type in ('tabla', 'tarjeta', 'desglosada', 'partido', 'comparar')),
  target_ref  text not null,
  params      text not null default '',
  label_es    text not null,
  primary key (chart_id, target_type, target_ref, params)
);
alter table core.chart_source_map enable row level security;
create policy anon_read on core.chart_source_map for select to anon using (true);
grant select on core.chart_source_map to anon;

create or replace function ingest.load_charts(p_charts jsonb, p_sources jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  n_charts integer;
  n_sources integer;
begin
  -- «where true» porque la Data API de Supabase (pg_safeupdate) rechaza un DELETE sin WHERE.
  delete from core.chart_source_map where true;
  delete from core.chart_catalog where true;

  insert into core.chart_catalog (chart_id, category, title_es, chart_type, required_data, origin_ref,
                                  powerbi, excel, available, reason_es, sort_order)
  select c ->> 'chart_id', c ->> 'category', c ->> 'title_es', c ->> 'chart_type', c ->> 'required_data',
         c ->> 'origin_ref', c ->> 'powerbi', c ->> 'excel', (c ->> 'available')::boolean,
         coalesce(c ->> 'reason_es', ''), (c ->> 'sort_order')::smallint
  from jsonb_array_elements(p_charts) c;
  get diagnostics n_charts = row_count;

  insert into core.chart_source_map (chart_id, target_type, target_ref, params, label_es)
  select s ->> 'chart_id', s ->> 'target_type', s ->> 'target_ref', coalesce(s ->> 'params', ''), s ->> 'label_es'
  from jsonb_array_elements(p_sources) s;
  get diagnostics n_sources = row_count;

  return jsonb_build_object('charts', n_charts, 'sources', n_sources);
end;
$$;
revoke all on function ingest.load_charts(jsonb, jsonb) from public;
grant execute on function ingest.load_charts(jsonb, jsonb) to service_role;

create view api.chart_catalog
with (security_invoker = true) as
select chart_id, category, title_es, chart_type, required_data, origin_ref, powerbi, excel, available,
       reason_es, sort_order
from core.chart_catalog;
grant select on api.chart_catalog to anon, service_role;

create view api.chart_source_map
with (security_invoker = true) as
select chart_id, target_type, target_ref, params, label_es
from core.chart_source_map;
grant select on api.chart_source_map to anon, service_role;
