-- Pie hábil de los jugadores de Boca (Bzzoiro: ficha del jugador, R/L/B).

alter table core.player_profile
  add column if not exists preferred_foot text check (preferred_foot in ('derecho', 'izquierdo', 'ambidiestro'));
alter table core.player_profile alter column source drop not null;

create function ingest.load_player_foot(p_rows jsonb)
returns integer
language plpgsql
set search_path = ''
as $$
declare
  r jsonb;
  v_player bigint;
  n integer := 0;
begin
  for r in select * from jsonb_array_elements(coalesce(p_rows, '[]')) loop
    v_player := ingest.internal_id('promiedos', 'player', r ->> 'player_source_id');
    if v_player is null then
      continue;
    end if;
    insert into core.player_profile (player_id, preferred_foot, source)
    values (v_player, r ->> 'foot', r ->> 'source')
    on conflict (player_id) do update set preferred_foot = excluded.preferred_foot, fetched_at = now();
    n := n + 1;
  end loop;
  return n;
end;
$$;
revoke all on function ingest.load_player_foot(jsonb) from public;
grant execute on function ingest.load_player_foot(jsonb) to service_role;

create or replace view api.player_profile with (security_invoker = true) as
select pp.player_id, p.full_name, pp.nationality, pp.weight_kg, pp.youth_club, pp.academy,
       pp.national_team, pp.source, pp.preferred_foot
from core.player_profile pp
join core.player p on p.player_id = pp.player_id;
