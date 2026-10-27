-- =============================================================================
-- Esquema público `api`: lo único que ve la web y la Data API.
--
-- Todas las vistas son security_invoker = true: se ejecutan con los permisos de quien
-- consulta (anon), así que respetan RLS y los permisos de columna de core. Una vista
-- "security definer" (el comportamiento por defecto de Postgres) saltearía RLS, y el
-- Security Advisor de Supabase la marca como ERROR.
-- =============================================================================

create view api.system_status
with (security_invoker = true) as
select key, value, updated_at
from core.system_status;
comment on view api.system_status is 'Estado público del sistema. Fila de prueba de la etapa 1.';

-- Estado de cada fuente: la última corrida por fuente y la última exitosa.
-- Por qué una CTE con DISTINCT ON: es la forma más directa en Postgres de quedarse con
-- la fila más reciente de cada grupo (más simple que una función de ventana acá).
create view api.source_status
with (security_invoker = true) as
with last_run as (
  select distinct on (source) source, status, started_at, finished_at
  from core.ingest_log
  order by source, started_at desc
),
last_ok as (
  select source, max(finished_at) as last_success_at
  from core.ingest_log
  where status in ('ok', 'parcial')
  group by source
)
select r.source,
       r.status        as last_status,
       r.started_at    as last_run_at,
       o.last_success_at
from last_run r
left join last_ok o using (source);
comment on view api.source_status is 'Estado de la última carga de cada fuente y fecha de la última carga exitosa.';

-- Solo lectura para anon; el pipeline (service_role) también lee para verificar.
grant select on api.system_status, api.source_status to anon, service_role;

-- Fila de prueba de la etapa 1. La sobrescribe el pipeline en cada corrida.
insert into core.system_status (key, value) values
  ('etapa', '1 - Preparación'),
  ('ultima_actualizacion', 'sin cargas todavía')
on conflict (key) do update set value = excluded.value, updated_at = now();
