-- Comparar (9.7): qué líneas usan cada estadística (arquero, defensor, mediocampista, delantero o
-- «todas»). Sale de la columna `lineas` de data/stat_catalog.csv; Comparar muestra por defecto las
-- estadísticas de las líneas que se comparan.
alter table core.stat_catalog add column lines text[] not null default '{todas}'
  check (lines <@ array['todas', 'arquero', 'defensor', 'mediocampista', 'delantero'] and cardinality(lines) > 0);

create or replace function ingest.load_catalog(p_stats jsonb, p_sets jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  n_stats integer;
  n_items integer;
begin
  delete from core.stat_catalog c
  where c.stat_id not in (select s ->> 'stat_id' from jsonb_array_elements(p_stats) s);

  insert into core.stat_catalog (stat_id, entity, name_es, short_name, description_es, reading_es,
                                 stat_group, category, unit, source, level, formula, higher_is_better,
                                 available, estimated, per90, rule, arg1, arg2, factor, lines)
  select s ->> 'stat_id', s ->> 'entity', s ->> 'name_es', s ->> 'short_name', s ->> 'description_es',
         coalesce(s ->> 'reading_es', ''), s ->> 'stat_group', s ->> 'category', s ->> 'unit',
         s ->> 'source', s ->> 'level', s ->> 'formula', (s ->> 'higher_is_better')::boolean,
         (s ->> 'available')::boolean, (s ->> 'estimated')::boolean, (s ->> 'per90')::boolean,
         s ->> 'rule', coalesce(s ->> 'arg1', ''), coalesce(s ->> 'arg2', ''), (s ->> 'factor')::numeric,
         coalesce(nullif(array(select jsonb_array_elements_text(s -> 'lines')), '{}'), '{todas}')
  from jsonb_array_elements(p_stats) s
  on conflict (stat_id) do update
    set entity = excluded.entity, name_es = excluded.name_es, short_name = excluded.short_name,
        description_es = excluded.description_es, reading_es = excluded.reading_es,
        stat_group = excluded.stat_group, category = excluded.category, unit = excluded.unit,
        source = excluded.source, level = excluded.level, formula = excluded.formula,
        higher_is_better = excluded.higher_is_better, available = excluded.available,
        estimated = excluded.estimated, per90 = excluded.per90, rule = excluded.rule,
        arg1 = excluded.arg1, arg2 = excluded.arg2, factor = excluded.factor, lines = excluded.lines;
  get diagnostics n_stats = row_count;

  -- «where true» porque la Data API de Supabase (pg_safeupdate) rechaza un DELETE sin WHERE.
  delete from core.stat_set where true;
  insert into core.stat_set (set_id, entity, name_es, description_es, sort_order)
  select s ->> 'set_id', s ->> 'entity', s ->> 'name_es', s ->> 'description_es', (s ->> 'sort_order')::smallint
  from jsonb_array_elements(p_sets) s;
  insert into core.stat_set_item (set_id, stat_id, sort_order)
  select s ->> 'set_id', i.stat_id, i.ord::smallint
  from jsonb_array_elements(p_sets) s
  cross join lateral jsonb_array_elements_text(s -> 'stats') with ordinality as i(stat_id, ord);
  get diagnostics n_items = row_count;

  return jsonb_build_object('stats', n_stats, 'set_items', n_items);
end;
$$;
revoke all on function ingest.load_catalog(jsonb, jsonb) from public;
grant execute on function ingest.load_catalog(jsonb, jsonb) to service_role;

create or replace view api.stat_catalog
with (security_invoker = true) as
select stat_id, entity, name_es, short_name, description_es, stat_group, category, unit, source,
       level, formula, higher_is_better, available, estimated, per90, rule, arg1, arg2, factor,
       reading_es, lines
from core.stat_catalog;
grant select on api.stat_catalog to anon, service_role;
