-- =============================================================================
-- Valores base por partido de cada jugador de Boca (formato largo: partido, jugador, clave, valor).
--
-- Es el piso de la pirámide de la sección 5.6: todo lo que muestra la tabla maestra se calcula
-- sumando o combinando estas filas según la regla de `core.stat_catalog`. La vista
-- `api.player_match_value` es exactamente esta consulta.
--
-- Cuatro bloques:
--   1. Alineaciones: partidos, titularidades, banco, minutos (sin descuento).
--   2. Eventos con minuto: goles, asistencias, penales, tarjetas, goles con el jugador en cancha.
--   3. Arqueros y tiros ubicados: lo que pasó con el arquero en cancha y los tiros de StrikerAPI.
--   4. Claves de las fuentes, con ceros donde la fuente cubrió el partido pero omitió al jugador.
-- =============================================================================
with played as (
  -- Una fila por jugador convocado en un partido jugado (titular o suplente).
  select l.match_id, l.player_id, l.started, l.minute_in, l.minute_out, l.position,
         case when m.extra_time then 120 else 90 end as end_minute
  from core.lineup l
  join core.team t on t.team_id = l.team_id and t.is_boca
  join core.match m on m.match_id = l.match_id
  join api.boca_match bm on bm.match_id = l.match_id and bm.status = 'jugado'
),
appear as (
  select * from played where minute_in is not null
),
goal as (
  -- Goles del tiempo de juego (los períodos 5 en adelante son la tanda de penales).
  select e.match_id, e.minute, e.type, e.player_id, e.related_player_id, t.is_boca
  from core.event e
  join core.team t on t.team_id = e.team_id
  where e.type in ('gol', 'penal_convertido') and coalesce(e.period, 1) < 5
),
penalty_shot as (
  -- Penales del tiempo de juego con resultado (StrikerAPI, solo liga).
  select match_id, player_id, minute, outcome, boca_shot from api.boca_penalty
),
-- Por qué LATERAL: cada alineación genera varias claves con una sola lectura de la fila.
lineup_values as (
  select p.match_id, p.player_id, v.key, v.value
  from played p
  cross join lateral (values
    ('appearances',      (p.minute_in is not null)::int),
    ('starts',           p.started::int),
    ('benched',          (not p.started)::int),
    ('sub_ins',          (not p.started and p.minute_in is not null)::int),
    ('complete_matches', (p.started and p.minute_out >= p.end_minute)::int),
    ('minutes',          coalesce(p.minute_out - p.minute_in, 0)),
    ('minutes_sub',      case when not p.started and p.minute_in is not null
                              then p.minute_out - p.minute_in else 0 end),
    ('captain',          coalesce((select s.value::int from core.player_match_stat s
                                   where s.match_id = p.match_id and s.player_id = p.player_id
                                     and s.stat_key = 'captain'), 0))
  ) as v(key, value)
),
event_counts as (
  -- Conteos por aparición. Un jugador expulsado no cuenta como sustituido.
  select a.match_id, a.player_id, a.started, a.minute_in, a.minute_out, a.end_minute,
         (select count(*) from goal g where g.match_id = a.match_id and g.player_id = a.player_id) as goals,
         (select count(*) from goal g where g.match_id = a.match_id and g.player_id = a.player_id
                                        and g.type = 'penal_convertido') as penalty_goals,
         (select count(*) from goal g where g.match_id = a.match_id
                                        and g.related_player_id = a.player_id) as assists,
         (select count(*) from core.event e where e.match_id = a.match_id and e.player_id = a.player_id
                                              and e.type = 'penal_fallado'
                                              and coalesce(e.period, 1) < 5) as missed_event,
         (select count(*) from penalty_shot s where s.match_id = a.match_id and s.player_id = a.player_id
                                               and s.boca_shot and s.outcome <> 'goal') as missed_shot,
         (select count(*) from core.event e where e.match_id = a.match_id and e.player_id = a.player_id
                                              and e.type = 'gol_en_contra') as own_goals,
         (select count(*) from core.event e where e.match_id = a.match_id and e.player_id = a.player_id
                                              and e.type = 'amarilla') as yellow_cards,
         (select count(*) from core.event e where e.match_id = a.match_id and e.player_id = a.player_id
                                              and e.type in ('roja', 'segunda_amarilla')) as red_cards,
         (select count(*) from core.event e where e.match_id = a.match_id and e.player_id = a.player_id
                                              and e.type = 'var') as var_disallowed,
         -- En cancha: desde el minuto de entrada hasta antes del de salida; quien termina el
         -- partido cuenta también los goles del descuento (registrados con el minuto 90 o 120).
         (select count(*) from goal g where g.match_id = a.match_id and g.is_boca
                                        and g.minute >= a.minute_in
                                        and (g.minute < a.minute_out or a.minute_out >= a.end_minute)) as goals_on,
         (select count(*) from goal g where g.match_id = a.match_id and not g.is_boca
                                        and g.minute >= a.minute_in
                                        and (g.minute < a.minute_out or a.minute_out >= a.end_minute)) as against_on,
         (select count(*) from goal g where g.match_id = a.match_id and not g.is_boca) as against_total
  from appear a
),
event_values as (
  select c.match_id, c.player_id, v.key, v.value
  from event_counts c
  cross join lateral (values
    ('goals',                  c.goals),
    ('assists',                c.assists),
    ('goal_contributions',     c.goals + c.assists),
    ('goal_contributions_sub', case when c.started then 0 else c.goals + c.assists end),
    ('penalty_goals',          c.penalty_goals),
    ('penalties_taken',        c.penalty_goals + greatest(c.missed_event, c.missed_shot)),
    ('npg',                    c.goals - c.penalty_goals),
    ('own_goals',              c.own_goals),
    ('yellow_cards',           c.yellow_cards),
    ('red_cards',              c.red_cards),
    ('var_disallowed',         c.var_disallowed),
    ('subbed_off',             (c.started and c.minute_out < c.end_minute and c.red_cards = 0)::int),
    ('team_goals_on',          c.goals_on),
    ('team_goals_against_on',  c.against_on),
    ('goals_conceded',         c.against_on),
    ('clean_sheets',           (c.started and c.minute_out >= c.end_minute and c.against_total = 0)::int)
  ) as v(key, value)
),
keeper as (
  -- Arquero que jugó el partido completo: se le asignan los remates y el xGOT del rival y,
  -- si la fuente no trae sus atajadas, las del equipo.
  select a.match_id, a.player_id, a.minute_in, a.minute_out, a.end_minute,
         (a.started and a.minute_out >= a.end_minute) as complete
  from appear a
  where a.position = 'Arquero'
),
team_stat as (
  select tms.match_id, t.is_boca, tms.stat_key, tms.value
  from core.team_match_stat tms
  join core.team t on t.team_id = tms.team_id
),
keeper_values as (
  select k.match_id, k.player_id, 'shots_on_target_faced' as key, ts.value
  from keeper k join team_stat ts on ts.match_id = k.match_id and not ts.is_boca
                                 and ts.stat_key = 'shots_on_target'
  where k.complete
  union all
  select k.match_id, k.player_id, 'xgot_faced', ts.value
  from keeper k join team_stat ts on ts.match_id = k.match_id and not ts.is_boca and ts.stat_key = 'xgot'
  where k.complete
  union all
  select k.match_id, k.player_id, 'saves',
         coalesce((select s.value from core.player_match_stat s
                   where s.match_id = k.match_id and s.player_id = k.player_id and s.stat_key = 'saves'),
                  case when k.complete then ts.value end)
  from keeper k
  left join team_stat ts on ts.match_id = k.match_id and ts.is_boca and ts.stat_key = 'saves'
  union all
  -- Penales del rival con el arquero en cancha, solo en partidos con tiros de StrikerAPI.
  select k.match_id, k.player_id, v.key, v.value
  from keeper k
  cross join lateral (
    select count(*) filter (where not s.boca_shot) as faced,
           count(*) filter (where not s.boca_shot and s.outcome = 'saved') as saved
    from penalty_shot s
    where s.match_id = k.match_id and s.minute >= k.minute_in
      and (s.minute < k.minute_out or k.minute_out >= k.end_minute)
  ) p
  cross join lateral (values ('penalties_faced', p.faced), ('penalties_saved', p.saved)) as v(key, value)
  where exists (select 1 from core.shot sh where sh.match_id = k.match_id)
),
shot_values as (
  -- Tiros ubicados de StrikerAPI (solo liga): ceros para quien jugó un partido cubierto.
  select a.match_id, a.player_id, v.key, v.value
  from appear a
  cross join lateral (
    select count(*) filter (where sh.body_part = 'header') as headers,
           count(*) filter (where sh.body_part = 'header' and sh.outcome = 'goal') as header_goals,
           count(*) filter (where sh.zone = 'outside_box') as shots_outside_box,
           count(*) filter (where sh.zone = 'outside_box' and sh.outcome = 'goal') as goals_outside_box
    from core.shot sh
    where sh.match_id = a.match_id and sh.player_id = a.player_id
  ) s
  cross join lateral (values
    ('headers', s.headers), ('header_goals', s.header_goals),
    ('shots_outside_box', s.shots_outside_box), ('goals_outside_box', s.goals_outside_box)
  ) as v(key, value)
  where exists (select 1 from core.shot sh join core.team t on t.team_id = sh.team_id and t.is_boca
                where sh.match_id = a.match_id)
),
source_key as (
  -- Claves que una fuente publicó en un partido para algún jugador: en ese partido, quien jugó
  -- y no figura tiene 0 (las fuentes omiten los ceros). No se rellenan valores que no son
  -- conteos (calificación, porcentaje) ni las claves que se calculan arriba.
  select distinct s.match_id, s.stat_key
  from core.player_match_stat s
  where s.stat_key not in ('rating', 'pass_accuracy_pct', 'goals_prevented', 'captain', 'saves')
),
source_values as (
  select a.match_id, a.player_id, k.stat_key as key, coalesce(s.value, 0) as value
  from appear a
  join source_key k on k.match_id = a.match_id
  left join core.player_match_stat s
    on s.match_id = a.match_id and s.player_id = a.player_id and s.stat_key = k.stat_key
  union all
  -- La calificación solo existe si la fuente la publicó (un 0 sería falso).
  select s.match_id, s.player_id, s.stat_key, s.value
  from core.player_match_stat s
  join appear a on a.match_id = s.match_id and a.player_id = s.player_id
  where s.stat_key in ('rating', 'pass_accuracy_pct', 'goals_prevented')
),
source_pivot as (
  -- Una fila por aparición con las claves que se combinan. Por qué un pivot con FILTER y no
  -- autouniones: una sola pasada sobre las 37 000 filas en vez de cruzarlas entre sí.
  select match_id, player_id,
         max(value) filter (where key = 'duels_won') as duels_won,
         max(value) filter (where key = 'duels_lost') as duels_lost,
         max(value) filter (where key = 'aerials_won') as aerials_won,
         max(value) filter (where key = 'aerials_lost') as aerials_lost,
         max(value) filter (where key = 'xg') as xg
  from source_values
  group by match_id, player_id
),
combined_values as (
  -- Sumas de dos claves y npxG estimado, solo en partidos que tienen todos los datos.
  -- npxG = xG − 0,76 × penales pateados (valor convencional de un penal, tabla 5.6; estimado).
  select p.match_id, p.player_id, v.key, v.value
  from source_pivot p
  join event_counts c using (match_id, player_id)
  cross join lateral (values
    ('duels_total',   p.duels_won + p.duels_lost),
    ('aerials_total', p.aerials_won + p.aerials_lost),
    ('npxg',          p.xg - 0.76 * (c.penalty_goals + greatest(c.missed_event, c.missed_shot)))
  ) as v(key, value)
  where v.value is not null
),
suspension_values as (
  -- Partidos que se perdió por suspensión (no tiene fila de alineación).
  select ab.match_id, ab.player_id, 'suspensions' as key, 1 as value
  from core.match_absence ab
  join core.team t on t.team_id = ab.team_id and t.is_boca
  join api.boca_match bm on bm.match_id = ab.match_id and bm.status = 'jugado'
  where ab.reason like 'suspension%' and ab.player_id is not null
)
select match_id, player_id, key, value::numeric as value from lineup_values
union all select match_id, player_id, key, value::numeric from event_values
union all select match_id, player_id, key, value::numeric from keeper_values where value is not null
union all select match_id, player_id, key, value::numeric from shot_values
union all select match_id, player_id, key, value from source_values
union all select match_id, player_id, key, value from combined_values
union all select match_id, player_id, key, value::numeric from suspension_values
