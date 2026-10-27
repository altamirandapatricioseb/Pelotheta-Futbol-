-- =============================================================================
-- Línea base de seguridad (secciones 7 y 14.2)
--
-- Idea central: mínimo privilegio y defensa en profundidad.
--   * Las tablas reales viven en el esquema privado `core`, que la Data API NO expone.
--   * La web solo ve vistas y funciones del esquema `api`, que es el único expuesto.
--   * `anon` y `authenticated` no tienen permisos en `public` ni en nada nuevo por defecto.
--   * Escribe únicamente el pipeline, con la clave secreta (rol `service_role`).
-- =============================================================================

-- 1. Esquemas propios ---------------------------------------------------------
create schema if not exists core;
comment on schema core is 'Privado: tablas del modelo. No se expone en la Data API.';

create schema if not exists api;
comment on schema api is 'Público y de solo lectura: vistas y funciones que consume la web.';

-- 2. Cerrar el esquema public -------------------------------------------------
-- Supabase expone `public` y da todos los permisos a anon/authenticated por defecto.
-- Como no lo usamos, se lo cerramos a los roles de la API para que una tabla creada
-- ahí por error no quede publicada.
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke all on all routines in schema public from anon, authenticated;
revoke create on schema public from public, anon, authenticated;
revoke usage on schema public from public, anon, authenticated;

-- Privilegios por defecto: toda tabla, secuencia o función nueva en public nace
-- sin permisos para los roles de la API.
alter default privileges for role postgres in schema public
  revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema public
  revoke all on sequences from anon, authenticated;
alter default privileges for role postgres in schema public
  revoke all on routines from anon, authenticated;

-- 3. Permisos de los esquemas propios -----------------------------------------
-- Las funciones nuevas en Postgres son ejecutables por PUBLIC por defecto: lo quitamos
-- en los dos esquemas para que ninguna función quede invocable sin un GRANT explícito.
revoke all on schema core from public;
revoke all on schema api from public;
alter default privileges for role postgres in schema core revoke execute on routines from public;
alter default privileges for role postgres in schema api revoke execute on routines from public;

-- El pipeline (service_role) escribe en core. service_role saltea RLS por diseño.
grant usage on schema core to service_role;
alter default privileges for role postgres in schema core
  grant select, insert, update, delete on tables to service_role;
alter default privileges for role postgres in schema core
  grant usage, select on sequences to service_role;

-- anon necesita USAGE en core porque las vistas de `api` son security_invoker: se
-- ejecutan con los permisos de quien consulta. Igual NO puede llegar a core por la
-- Data API (el esquema no está expuesto) y solo lee las tablas y columnas que se le
-- otorgan una por una, filtradas además por RLS.
grant usage on schema core to anon;
grant usage on schema api to anon, service_role;

-- 4. Data API: exponer solo `api` ---------------------------------------------
-- Se fija por SQL (y no desde el panel) para que la configuración quede versionada.
-- Consecuencia documentada por Supabase: el panel deja de administrar esta opción.
alter role authenticator set pgrst.db_schemas = 'api';
notify pgrst, 'reload config';

-- 5. Límites contra el abuso --------------------------------------------------
-- Supabase ya trae 3 s para anon; lo dejamos explícito y versionado. Es más estricto
-- que el techo de 5 s del diseño, y alcanza porque ninguna consulta pública debe
-- recorrer tablas grandes enteras (índices y paginación obligatoria).
alter role anon set statement_timeout = '3s';
-- `authenticated` no se usa (no hay cuentas): lo dejamos igual de acotado.
alter role authenticated set statement_timeout = '3s';
