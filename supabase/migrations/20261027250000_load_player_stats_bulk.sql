-- Las estadísticas por jugador ya son decenas de miles de filas: cargarlas fila por fila dentro
-- de load_batch superaba el tiempo máximo de la Data API. Esta función las inserta de una sola
-- vez (por bloques que manda el pipeline), resolviendo los ids con un join.

create function ingest.load_player_stats(p_rows jsonb)
returns integer
language sql
set search_path = ''
as $$
  with rows as (
    select x.match_source_id, x.player_source_id, x.stat_key, x.value, x.source
    from jsonb_to_recordset(coalesce(p_rows, '[]'))
      as x(match_source_id text, player_source_id text, stat_key text, value numeric, source text)
  ), resolved as (
    select m.internal_id::integer as match_id, p.internal_id::integer as player_id, r.stat_key,
           r.value, r.source
    from rows r
    join core.source_id_map m on m.source = 'promiedos' and m.entity = 'match' and m.source_id = r.match_source_id
    join core.source_id_map p on p.source = 'promiedos' and p.entity = 'player' and p.source_id = r.player_source_id
  ), inserted as (
    insert into core.player_match_stat (match_id, player_id, stat_key, value, source)
    select distinct on (match_id, player_id, stat_key) match_id, player_id, stat_key, value, source
    from resolved
    on conflict (match_id, player_id, stat_key) do update
      set value = excluded.value, source = excluded.source, fetched_at = now()
    returning 1
  )
  select count(*)::integer from inserted;
$$;
revoke all on function ingest.load_player_stats(jsonb) from public;
grant execute on function ingest.load_player_stats(jsonb) to service_role;
