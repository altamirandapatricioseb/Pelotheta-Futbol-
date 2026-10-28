-- Etapa 7 (9.7): posición de cada jugador con respaldo en la línea general.
--
-- La posición específica sale de las alineaciones (la más repetida). Si un jugador no tiene
-- posición en las alineaciones, se usa la línea del plantel (Arquero, Defensor, Mediocampista,
-- Delantero): en ese caso zona y posición coinciden y la interfaz lo avisa (`detail_level` =
-- 'linea'). El mapeo de las líneas también vive en `position_zone_map`, no en el código.

alter table core.position_zone_map alter column lane drop not null;
alter table core.position_zone_map drop constraint if exists position_zone_map_lane_check;
alter table core.position_zone_map
  add constraint position_zone_map_lane_check check (lane is null or lane in ('izquierda', 'centro', 'derecha'));

insert into core.position_zone_map (position_raw, zone, lane, role) values
  ('Defensor', 'Defensa', null, 'Defensor'),
  ('Mediocampista', 'Mediocampo', null, 'Mediocampista'),
  ('Delantero', 'Ataque', null, 'Delantero')
on conflict (position_raw) do nothing;

drop view api.player_position;
create view api.player_position
with (security_invoker = true) as
with counts as (
  select l.player_id, l.position, count(*) filter (where l.started) as starts, count(*) as games
  from core.lineup l
  join core.team t on t.team_id = l.team_id and t.is_boca
  where coalesce(l.position, '') <> ''
  group by l.player_id, l.position
),
best as (
  select distinct on (player_id) player_id, position, starts, games
  from counts
  order by player_id, starts desc, games desc, position
),
line as (
  select player_id, position_group
  from core.player_master_mv
  where competition_code = 'todas' and position_group is not null
)
select coalesce(b.player_id, l.player_id) as player_id,
       coalesce(b.position, l.position_group) as position_raw,
       m.zone, m.lane, m.role,
       coalesce(b.starts, 0) as starts, coalesce(b.games, 0) as games,
       case when b.player_id is not null then 'posicion' else 'linea' end as detail_level
from best b
full join line l on l.player_id = b.player_id
left join core.position_zone_map m on m.position_raw = coalesce(b.position, l.position_group);
grant select on api.player_position to anon, service_role;
