-- Etapa 2 (ajuste): la línea del jugador sale del plantel actual y, si ya no está en el
-- plantel (se fue a mitad de año), de la línea con la que figuró en las alineaciones.
-- Además se borran los amistosos: no cuentan para las estadísticas oficiales y el
-- adaptador ya no los carga.
delete from core.match m
using core.season s, core.competition c
where s.season_id = m.season_id and c.competition_id = s.competition_id and c.kind = 'amistoso';
delete from core.source_id_map
where entity = 'match' and internal_id not in (select match_id from core.match);

create or replace view api.player_summary
with (security_invoker = true) as
with played as (
  -- Minutos por partido: los guarda el pipeline ya calculados (entrada y salida).
  select l.player_id, l.match_id, l.started,
         (l.minute_out - l.minute_in) as minutes
  from core.lineup l
  join core.team t on t.team_id = l.team_id and t.is_boca
  where l.minute_in is not null
),
player_events as (
  -- Goles (de jugada o de penal), asistencias y tarjetas por jugador y partido.
  select e.match_id, e.player_id,
         count(*) filter (where e.type in ('gol', 'penal_convertido')) as goals,
         0 as assists,
         count(*) filter (where e.type = 'amarilla') as yellow_cards,
         count(*) filter (where e.type in ('roja', 'segunda_amarilla')) as red_cards
  from core.event e
  where e.player_id is not null and coalesce(e.period, 1) < 5  -- la tanda de penales no cuenta
  group by e.match_id, e.player_id
  union all
  select e.match_id, e.related_player_id, 0, count(*), 0, 0
  from core.event e
  where e.type in ('gol', 'penal_convertido') and e.related_player_id is not null
  group by e.match_id, e.related_player_id
),
per_match as (
  select p.player_id, p.match_id, p.started, p.minutes,
         coalesce(sum(pe.goals), 0)        as goals,
         coalesce(sum(pe.assists), 0)      as assists,
         coalesce(sum(pe.yellow_cards), 0) as yellow_cards,
         coalesce(sum(pe.red_cards), 0)    as red_cards
  from played p
  left join player_events pe using (player_id, match_id)
  group by p.player_id, p.match_id, p.started, p.minutes
)
select pm.player_id,
       pl.full_name,
       pl.known_as,
       coalesce(sm.position_group, pl.position_raw) as position_group,
       sm.shirt_number,
       core.player_age(pm.player_id) as age,
       pl.height_cm,
       coalesce(bm.competition_code, 'todas') as competition_code,
       coalesce(bm.competition_name, 'Todas las competiciones') as competition_name,
       count(*)::integer                         as matches,
       count(*) filter (where pm.started)::integer as starts,
       sum(pm.minutes)::integer                  as minutes,
       sum(pm.goals)::integer                    as goals,
       sum(pm.assists)::integer                  as assists,
       sum(pm.goals + pm.assists)::integer       as goal_contributions,
       sum(pm.yellow_cards)::integer             as yellow_cards,
       sum(pm.red_cards)::integer                as red_cards
from per_match pm
join api.boca_match bm  on bm.match_id = pm.match_id
join core.player pl     on pl.player_id = pm.player_id
left join core.squad_member sm on sm.player_id = pm.player_id and sm.season_year = bm.season_year
group by grouping sets (
  (pm.player_id, pl.full_name, pl.known_as, sm.position_group, pl.position_raw, sm.shirt_number,
   pl.height_cm, bm.competition_code, bm.competition_name),
  (pm.player_id, pl.full_name, pl.known_as, sm.position_group, pl.position_raw, sm.shirt_number,
   pl.height_cm)
);
