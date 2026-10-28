-- Etapa 4: las métricas del equipo se cargan sin el id de Boca (no está expuesto en la API);
-- la función lo completa con el equipo marcado como Boca.
create or replace function ingest.load_stat_values(p_stat_ids text[], p_values jsonb, p_match_values jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  n_values integer;
  n_match integer;
  v_boca integer := (select team_id from core.team where is_boca limit 1);
begin
  delete from core.stat_value where stat_id = any (p_stat_ids);
  delete from core.stat_match_value where stat_id = any (p_stat_ids);

  insert into core.stat_value (entity, entity_id, competition_code, stat_id, value, low, high,
                               coverage, detail)
  select v ->> 'entity', coalesce((v ->> 'entity_id')::integer, v_boca), v ->> 'competition_code',
         v ->> 'stat_id', (v ->> 'value')::numeric, (v ->> 'low')::numeric, (v ->> 'high')::numeric,
         (v ->> 'coverage')::numeric, v -> 'detail'
  from jsonb_array_elements(coalesce(p_values, '[]')) v
  where v ->> 'stat_id' = any (p_stat_ids);
  get diagnostics n_values = row_count;

  insert into core.stat_match_value (entity, entity_id, match_id, stat_id, value, low, high)
  select v ->> 'entity', coalesce((v ->> 'entity_id')::integer, v_boca), (v ->> 'match_id')::integer,
         v ->> 'stat_id', (v ->> 'value')::numeric, (v ->> 'low')::numeric, (v ->> 'high')::numeric
  from jsonb_array_elements(coalesce(p_match_values, '[]')) v
  where v ->> 'stat_id' = any (p_stat_ids);
  get diagnostics n_match = row_count;

  insert into core.ingest_log (run_id, source, finished_at, status, rows_inserted)
  values (gen_random_uuid(), 'metricas_propias', now(), 'ok', n_values + n_match);
  return jsonb_build_object('values', n_values, 'match_values', n_match);
end;
$$;
revoke all on function ingest.load_stat_values(text[], jsonb, jsonb) from public;
grant execute on function ingest.load_stat_values(text[], jsonb, jsonb) to service_role;