-- Etapa 7 (Comparar, 9.7): ventanas de los últimos 5 y 10 partidos y del último mes en la tabla
-- maestra, mapa de puestos (`core.position_zone_map`) y puesto habitual de cada jugador.

drop view api.conclusion;
drop view api.player_master;
drop materialized view core.player_master_mv;

create materialized view core.player_master_mv as
-- =============================================================================
-- Tabla maestra de jugadores (Interfaz 3): una fila por jugador y ventana (cada competición,
-- 'todas', 'ultimos5', 'ultimos10' y 'ultimo_mes') con todas las estadísticas del catálogo en un objeto JSON {stat_id: valor}.
-- Es el texto de la vista materializada `core.player_master_mv`.
--
-- Reglas del catálogo (`core.stat_catalog.rule`):
--   suma / promedio: sobre los valores por partido del jugador en la ventana. Si el jugador no
--     tiene ninguna fila de esa clave (por ejemplo, un dato solo de liga y él jugó solo copas),
--     queda n/d y no 0.
--   cociente / diferencia / adición: suma sobre suma, solo con los partidos que tienen los dos datos.
--   métrica / especial: ya calculadas en Python (`core.stat_value`).
-- =============================================================================
with played as (
  select match_id, competition_code, match_date,
         row_number() over (order by kickoff_at desc) as recent,
         max(match_date) over () as last_date
  from api.boca_match where status = 'jugado'
),
-- Ventanas: cada competición, 'todas' y, para Comparar (9.7), los últimos 5 y 10 partidos de
-- Boca y el último mes (30 días hasta el último partido cargado).
window_match as (
  select match_id, competition_code as code from played
  union all select match_id, 'todas' from played
  union all select match_id, 'ultimos5' from played where recent <= 5
  union all select match_id, 'ultimos10' from played where recent <= 10
  union all select match_id, 'ultimo_mes' from played where match_date > last_date - 30
),
pmv as (
  select v.match_id, v.player_id, v.key, v.value, w.code
  from core.player_match_value_mv v
  join window_match w on w.match_id = v.match_id
),
player_window as (
  select player_id, code,
         sum(value) filter (where key = 'appearances') as matches,
         sum(value) filter (where key = 'minutes') as minutes
  from pmv
  group by player_id, code
  having sum(value) filter (where key = 'appearances') > 0
),
base as (
  select player_id, code, key, sum(value) as total, avg(value) as average
  from pmv
  group by player_id, code, key
),
cat as (
  select * from core.stat_catalog where entity = 'player'
),
simple_value as (
  select p.player_id, p.code, c.stat_id,
         case c.rule when 'suma' then b.total else b.average end as value
  from player_window p
  join cat c on c.rule in ('suma', 'promedio')
  join base b on b.player_id = p.player_id and b.code = p.code and b.key = c.arg1
),
composite_sum as (
  select v1.player_id, v1.code, c.stat_id, c.rule, c.factor,
         sum(v1.value) as s1, sum(v2.value) as s2
  from cat c
  join cat c1 on c1.stat_id = c.arg1
  join cat c2 on c2.stat_id = c.arg2
  join pmv v1 on v1.key = c1.arg1
  join pmv v2 on v2.key = c2.arg1 and v2.match_id = v1.match_id
             and v2.player_id = v1.player_id and v2.code = v1.code
  where c.rule in ('cociente', 'diferencia', 'adicion')
  group by v1.player_id, v1.code, c.stat_id, c.rule, c.factor
),
composite_value as (
  select player_id, code, stat_id,
         case rule
           when 'cociente' then case when s2 <> 0 then s1 / s2 * factor end
           when 'diferencia' then s1 - s2
           else s1 + s2
         end as value
  from composite_sum
),
stored_value as (
  select entity_id as player_id, competition_code as code, stat_id, value
  from core.stat_value
  where entity = 'player'
),
all_value as (
  select player_id, code, stat_id, value from simple_value
  union all select player_id, code, stat_id, value from composite_value
  union all select player_id, code, stat_id, value from stored_value
),
season as (
  select max(season_year) as year from api.boca_match
)
select p.player_id, p.code as competition_code, pl.full_name, pl.known_as,
       coalesce(sm.position_group, pl.position_raw) as position_group, sm.shirt_number,
       core.player_age(p.player_id) as age, pl.height_cm,
       coalesce(pp.weight_kg, pl.weight_kg) as weight_kg,
       coalesce(pp.preferred_foot, pl.preferred_foot) as preferred_foot,
       coalesce(pp.nationality, pl.nationality) as nationality,
       p.matches::integer as matches, p.minutes::integer as minutes,
       coalesce(jsonb_object_agg(av.stat_id, round(av.value, 4)) filter (where av.value is not null),
                '{}'::jsonb) as stats
from player_window p
join core.player pl on pl.player_id = p.player_id
cross join season
left join core.squad_member sm on sm.player_id = p.player_id and sm.season_year = season.year
left join core.player_profile pp on pp.player_id = p.player_id
left join all_value av on av.player_id = p.player_id and av.code = p.code
group by p.player_id, p.code, pl.full_name, pl.known_as, sm.position_group, pl.position_raw,
         sm.shirt_number, pl.height_cm, pp.weight_kg, pl.weight_kg, pp.preferred_foot,
         pl.preferred_foot, pp.nationality, pl.nationality, p.matches, p.minutes;
create unique index player_master_mv_pk on core.player_master_mv (player_id, competition_code);
grant select on core.player_master_mv to anon, service_role;

create view api.player_master
with (security_invoker = true) as
select * from core.player_master_mv;
grant select on api.player_master to anon, service_role;

-- Conclusiones (igual que antes; dependía de la vista materializada).
create view api.conclusion
with (security_invoker = true) as
select r.rule_id, c.entity_id, coalesce(nullif(p.known_as, ''), p.full_name) as player_name, r.area, r.title_es,
       r.kind, r.scope, r.unit, r.link, r.sort_order, c.band, c.value, c.reference, c.percentile, c.n, c.computed_at,
       case c.band when 'alta' then r.tone_high when 'baja' then r.tone_low else r.tone_mid end as tone,
       case c.band when 'alta' then r.text_high when 'baja' then r.text_low else r.text_mid end as text_es,
       pm.position_group as player_position
from core.conclusion_rule r
join core.conclusion_result c using (rule_id)
left join core.player p on p.player_id = c.entity_id and c.entity_id > 0
left join core.player_master_mv pm on pm.player_id = c.entity_id and c.entity_id > 0 and pm.competition_code = 'todas';
grant select on api.conclusion to anon, service_role;

-- Puesto que informa la fuente en la alineación -> zona (defensa, mediocampo, ataque), carril
-- (izquierda, centro, derecha) y puesto de la comparación. El mapeo vive acá, no en el código.
create table core.position_zone_map (
  position_raw text primary key,
  zone         text not null check (zone in ('Arco', 'Defensa', 'Mediocampo', 'Ataque')),
  lane         text not null check (lane in ('izquierda', 'centro', 'derecha')),
  role         text not null
);
alter table core.position_zone_map enable row level security;
create policy anon_read on core.position_zone_map for select to anon using (true);
grant select on core.position_zone_map to anon;
insert into core.position_zone_map (position_raw, zone, lane, role) values
  ('Arquero', 'Arco', 'centro', 'Arquero'),
  ('Defensa Central', 'Defensa', 'centro', 'Central'),
  ('Defensa Lateral Derecho', 'Defensa', 'derecha', 'Lateral derecho'),
  ('Defensa Lateral Izquierdo', 'Defensa', 'izquierda', 'Lateral izquierdo'),
  ('Centrocampista defensivo', 'Mediocampo', 'centro', 'Mediocampista defensivo'),
  ('Mediocampista Central', 'Mediocampo', 'centro', 'Mediocampista central'),
  ('Mediocampista Ofensivo', 'Mediocampo', 'centro', 'Mediocampista ofensivo'),
  ('Volante Izquierdo', 'Mediocampo', 'izquierda', 'Volante por izquierda'),
  ('Volante Derecho', 'Mediocampo', 'derecha', 'Volante por derecha'),
  ('Delantero Derecho', 'Ataque', 'derecha', 'Extremo'),
  ('Delantero Izquierdo', 'Ataque', 'izquierda', 'Extremo'),
  ('Centro Delantero', 'Ataque', 'centro', 'Delantero centro');

-- Puesto habitual de cada jugador: el que más repitió en la alineación (de titular, o de
-- suplente si nunca fue titular), con su zona, carril y puesto.
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
)
select b.player_id, b.position as position_raw, m.zone, m.lane, m.role, b.starts, b.games
from best b
left join core.position_zone_map m on m.position_raw = b.position;
grant select on api.player_position to anon, service_role;
