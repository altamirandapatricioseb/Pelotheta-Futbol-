-- Etapa 9 (11): rol de solo lectura para conectar Power BI a PostgreSQL por el pooler de sesión.
--
-- Lee exactamente lo mismo que la web pública (las vistas `api`), nada más: sin escritura, sin
-- `ingest`, sin storage ni realtime. Por eso no hereda de `anon` (que tiene permisos en storage y
-- realtime) sino que copia sus SELECT de `api` y `core` y se suma a sus políticas de lectura.
--
-- Nace sin login. La contraseña la pone el dueño en el SQL Editor de Supabase, nunca en el repo:
--   alter role powerbi_reader with login password '<contraseña larga generada>';
-- Usuario en Power BI: powerbi_reader.<ref del proyecto>, puerto 5432 del pooler de sesión.
-- Una migración que agregue tablas o políticas `anon_read` nuevas tiene que sumar este rol.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'powerbi_reader') then
    create role powerbi_reader nologin noinherit nocreatedb nocreaterole noreplication;
  end if;
end
$$;

alter role powerbi_reader set statement_timeout = '60s';
alter role powerbi_reader set default_transaction_read_only = on;
alter role powerbi_reader connection limit 5;

-- Las vistas de `api` son security_invoker: además de la vista, necesita leer las tablas de
-- `core` que hay debajo, con las mismas columnas que `anon`.
grant usage on schema api, core to powerbi_reader;
grant select on all tables in schema api to powerbi_reader;

do $$
declare
  r record;
begin
  for r in
    select table_schema, table_name from information_schema.role_table_grants
    where grantee = 'anon' and table_schema = 'core' and privilege_type = 'SELECT'
  loop
    execute format('grant select on %I.%I to powerbi_reader', r.table_schema, r.table_name);
  end loop;
  -- Permisos por columna (p. ej. core.ingest_log) sin permiso sobre la tabla entera.
  for r in
    select c.table_schema, c.table_name, string_agg(quote_ident(c.column_name), ', ') as cols
    from information_schema.column_privileges c
    where c.grantee = 'anon' and c.table_schema = 'core' and c.privilege_type = 'SELECT'
      and not exists (
        select 1 from information_schema.role_table_grants t
        where t.grantee = 'anon' and t.table_schema = c.table_schema
          and t.table_name = c.table_name and t.privilege_type = 'SELECT'
      )
    group by 1, 2
  loop
    execute format('grant select (%s) on %I.%I to powerbi_reader', r.cols, r.table_schema, r.table_name);
  end loop;
  -- Las políticas de lectura de `anon` valen también para este rol.
  for r in
    select schemaname, tablename, policyname, roles from pg_policies
    where schemaname = 'core' and cmd = 'SELECT' and 'anon' = any (roles)
      and not ('powerbi_reader' = any (roles))
  loop
    execute format(
      'alter policy %I on %I.%I to %s',
      r.policyname, r.schemaname, r.tablename,
      (select string_agg(quote_ident(x), ', ') from unnest(r.roles || array['powerbi_reader']::name[]) x)
    );
  end loop;
end
$$;
