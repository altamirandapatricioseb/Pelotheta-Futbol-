-- Pruebas pgTAP de los controles de la base (14.2). Se corren con `npx supabase test db` contra
-- una base local, o pegadas en el SQL Editor / el MCP: todo va en una transacción que termina en
-- rollback, así que la extensión pgtap no queda instalada en producción.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;

select plan(10);

select is(
  (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'core' and c.relkind = 'r' and not c.relrowsecurity),
  0::bigint, 'RLS activo en todas las tablas de core');

select is(
  (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
   cross join (values ('anon'), ('authenticated'), ('powerbi_reader')) r(role)
   where n.nspname in ('core', 'api') and c.relkind in ('r', 'v', 'm')
     and (has_table_privilege(r.role, c.oid, 'INSERT') or has_table_privilege(r.role, c.oid, 'UPDATE')
          or has_table_privilege(r.role, c.oid, 'DELETE') or has_table_privilege(r.role, c.oid, 'TRUNCATE'))),
  0::bigint, 'anon, authenticated y powerbi_reader no pueden escribir en core ni en api');

select is(
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   cross join (values ('anon'), ('authenticated'), ('powerbi_reader')) r(role)
   where n.nspname = 'ingest' and has_function_privilege(r.role, p.oid, 'EXECUTE')),
  0::bigint, 'ninguna función de carga (ingest) se puede ejecutar sin la clave secreta');

select is(
  (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'api' and c.relkind = 'v'
     and not coalesce('security_invoker=true' = any(c.reloptions), false)),
  0::bigint, 'todas las vistas de api son security_invoker (respetan la RLS de quien consulta)');

select is(
  (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind in ('r', 'v', 'm') and has_table_privilege('anon', c.oid, 'SELECT')),
  0::bigint, 'el esquema public no expone tablas a anon');

select ok(
  exists (select 1 from pg_db_role_setting s join pg_roles r on r.oid = s.setrole
          where r.rolname = 'anon' and exists (select 1 from unnest(s.setconfig) c where c like 'statement_timeout=%')),
  'anon tiene statement_timeout propio');

select ok(
  (select not rolcanlogin or rolconnlimit between 1 and 5 from pg_roles where rolname = 'powerbi_reader'),
  'powerbi_reader sin login o con a lo sumo 5 conexiones');

select ok(
  exists (select 1 from pg_db_role_setting s join pg_roles r on r.oid = s.setrole
          where r.rolname = 'powerbi_reader'
            and 'default_transaction_read_only=on' = any(s.setconfig)),
  'powerbi_reader abre transacciones de solo lectura');

select ok(
  (select file_size_limit is not null and allowed_mime_types is not null from storage.buckets where id = 'exports'),
  'el bucket exports limita tamaño y tipos de archivo');

select is(
  (select count(*) from storage.objects o
   where o.bucket_id = 'exports' and o.name !~ '\.(xlsx|csv|png)$'),
  0::bigint, 'el bucket exports solo guarda xlsx, csv y png');

select * from finish();
rollback;
