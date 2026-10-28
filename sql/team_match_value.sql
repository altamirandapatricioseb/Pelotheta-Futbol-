-- =============================================================================
-- Valores base por partido de Boca (formato largo: partido, clave, valor).
--
-- Igual que `player_match_value.sql`, pero para el equipo. Las claves de la fuente van con su
-- nombre para Boca y con el sufijo `_against` para el rival. La vista `api.team_match_value` es
-- exactamente esta consulta; la tabla del equipo (Interfaz 2) agrupa estas filas por partido,
-- rival, mes o competición con las reglas de `core.stat_catalog`.
-- =============================================================================
with bm as (
  select bm.match_id, bm.match_date, bm.kickoff_at, bm.boca_home, bm.goals_for, bm.goals_against,
         case when bm.boca_home then m.home_goals_ht else m.away_goals_ht end as goals_for_ht,
         case when bm.boca_home then m.away_goals_ht else m.home_goals_ht end as goals_against_ht,
         case when m.extra_time then 120 else 90 end as end_minute
  from api.boca_match bm
  join core.match m on m.match_id = bm.match_id
  where bm.status = 'jugado'
),
goal as (
  -- Goles del tiempo de juego, con el período para separar el descuento del primer tiempo.
  select e.event_id, e.match_id, e.minute, coalesce(e.period, 1) as period, t.is_boca
  from core.event e
  join core.team t on t.team_id = e.team_id
  join bm on bm.match_id = e.match_id
  where e.type in ('gol', 'penal_convertido') and coalesce(e.period, 1) < 5
),
result_values as (
  -- La tanda de penales no cambia el resultado: un partido definido por penales es empate.
  select b.match_id, v.key, v.value
  from bm b
  cross join lateral (values
    ('matches',          1),
    ('wins',             (b.goals_for > b.goals_against)::int),
    ('draws',            (b.goals_for = b.goals_against)::int),
    ('losses',           (b.goals_for < b.goals_against)::int),
    ('points',           case when b.goals_for > b.goals_against then 3
                              when b.goals_for = b.goals_against then 1 else 0 end),
    ('goals_for',        b.goals_for),
    ('goals_against',    b.goals_against),
    ('goal_difference',  b.goals_for - b.goals_against),
    ('goals_for_ht',     b.goals_for_ht),
    ('goals_against_ht', b.goals_against_ht),
    ('clean_sheets',     (b.goals_against = 0)::int),
    ('failed_to_score',  (b.goals_for = 0)::int)
  ) as v(key, value)
  where v.value is not null
),
band_values as (
  -- Tramos de 15 minutos. El descuento del primer tiempo va al tramo 31-45 y la prórroga al
  -- último tramo, para que la suma de los tramos sea igual a los goles del partido.
  select b.match_id, s.side || '_' || s.band as key, count(g.event_id) as value
  from bm b
  cross join (values ('goals_for', '00_15'), ('goals_for', '16_30'), ('goals_for', '31_45'),
                     ('goals_for', '46_60'), ('goals_for', '61_75'), ('goals_for', '76_90'),
                     ('goals_against', '00_15'), ('goals_against', '16_30'), ('goals_against', '31_45'),
                     ('goals_against', '46_60'), ('goals_against', '61_75'), ('goals_against', '76_90'))
    as s(side, band)
  left join goal g
    on g.match_id = b.match_id
   and g.is_boca = (s.side = 'goals_for')
   and s.band = case
         when g.period = 1 and g.minute <= 15 then '00_15'
         when g.period = 1 and g.minute <= 30 then '16_30'
         when g.period = 1 then '31_45'
         when g.period = 2 and g.minute <= 60 then '46_60'
         when g.period = 2 and g.minute <= 75 then '61_75'
         else '76_90'
       end
  group by b.match_id, s.side, s.band
),
event_values as (
  select b.match_id, v.key, v.value
  from bm b
  cross join lateral (
    select count(*) filter (where e.type = 'var' and t.is_boca) as var_for,
           count(*) filter (where e.type = 'var' and not t.is_boca) as var_against,
           count(*) filter (where e.type = 'gol_en_contra' and not t.is_boca) as own_goals_for
    from core.event e
    join core.team t on t.team_id = e.team_id
    where e.match_id = b.match_id
  ) c
  cross join lateral (values
    ('var_disallowed_for', c.var_for), ('var_disallowed_against', c.var_against),
    ('own_goals_for', c.own_goals_for)
  ) as v(key, value)
),
source_values as (
  select tms.match_id, case when t.is_boca then tms.stat_key else tms.stat_key || '_against' end as key,
         tms.value
  from core.team_match_stat tms
  join core.team t on t.team_id = tms.team_id
  join bm on bm.match_id = tms.match_id
),
player_sum_values as (
  -- Sumas de los jugadores de Boca para lo que la fuente no da por equipo.
  select s.match_id, s.stat_key || '_players' as key, sum(s.value) as value
  from core.player_match_stat s
  join core.lineup l on l.match_id = s.match_id and l.player_id = s.player_id
  join core.team t on t.team_id = l.team_id and t.is_boca
  join bm on bm.match_id = s.match_id
  where s.stat_key in ('aerials_won', 'recoveries', 'possession_lost', 'carries')
  group by s.match_id, s.stat_key
),
pivot as (
  -- Una fila por partido con las claves que se combinan abajo.
  select match_id,
         max(value) filter (where key = 'xg') as xg,
         max(value) filter (where key = 'xg_against') as xg_against,
         max(value) filter (where key = 'big_chances') as big_chances,
         max(value) filter (where key = 'big_chances_missed') as big_chances_missed,
         max(value) filter (where key = 'dangerous_attacks') as dangerous_attacks,
         max(value) filter (where key = 'dangerous_attacks_against') as dangerous_attacks_against,
         max(value) filter (where key = 'tackles') as tackles,
         max(value) filter (where key = 'interceptions') as interceptions,
         max(value) filter (where key = 'fouls') as fouls
  from source_values
  group by match_id
),
combined_values as (
  -- Combinaciones solo con todos los datos del partido (si falta uno, no hay fila).
  select p.match_id, v.key, v.value
  from pivot p
  cross join lateral (values
    ('xg_difference',           p.xg - p.xg_against),
    ('big_chances_scored',      p.big_chances - p.big_chances_missed),
    ('dangerous_attacks_total', p.dangerous_attacks + p.dangerous_attacks_against),
    ('defensive_actions',       p.tackles + p.interceptions),
    ('defensive_actions_ppda',  p.tackles + p.interceptions + p.fouls)
  ) as v(key, value)
  where v.value is not null
),
timeline as (
  -- Marcador después de cada gol (diferencia a favor de Boca), más el 0 a 0 del inicio.
  select b.match_id, 0 as minute, 0 as seq, 0::bigint as diff, b.end_minute
  from bm b
  union all
  select g.match_id, least(g.minute, b.end_minute),
         row_number() over (partition by g.match_id order by g.minute, g.event_id)::int,
         sum(case when g.is_boca then 1 else -1 end)
           over (partition by g.match_id order by g.minute, g.event_id),
         b.end_minute
  from goal g
  join bm b on b.match_id = g.match_id
),
segment as (
  -- Cada tramo entre dos goles (o entre un gol y el final) con el marcador vigente.
  -- Por qué LEAD: da el minuto del gol siguiente en la misma fila, sin una autounión.
  select match_id, diff,
         lead(minute, 1, end_minute) over (partition by match_id order by seq) - minute as length
  from timeline
),
score_values as (
  select s.match_id, v.key, v.value
  from (
    select seg.match_id,
           sum(seg.length) filter (where seg.diff > 0) as leading,
           sum(seg.length) filter (where seg.diff = 0) as level,
           sum(seg.length) filter (where seg.diff < 0) as trailing,
           min(seg.diff) as worst, max(seg.diff) as best
    from segment seg
    group by seg.match_id
  ) s
  join result_values r on r.match_id = s.match_id and r.key = 'points'
  cross join lateral (values
    ('minutes_leading',            coalesce(s.leading, 0)),
    ('minutes_level',              coalesce(s.level, 0)),
    ('minutes_trailing',           coalesce(s.trailing, 0)),
    -- Puntos sumados en partidos en los que estuvo abajo, y perdidos en los que estuvo arriba.
    ('points_from_behind',         case when s.worst < 0 then r.value else 0 end),
    ('points_dropped_from_ahead',  case when s.best > 0 then 3 - r.value else 0 end)
  ) as v(key, value)
),
context_values as (
  -- Días desde el partido oficial anterior (LAG sobre la fecha), clima y bajas del rival.
  select match_id, 'rest_days' as key, (match_date - lag(match_date) over (order by kickoff_at))::numeric as value
  from bm
  union all
  select w.match_id, 'temperature_c', w.temperature_c from core.match_weather w join bm using (match_id)
  union all
  select w.match_id, 'precipitation_mm', w.precipitation_mm from core.match_weather w join bm using (match_id)
  union all
  select b.match_id, 'opponent_absences',
         (select count(*) from core.match_absence ab join core.team t on t.team_id = ab.team_id
          where ab.match_id = b.match_id and not t.is_boca)
  from bm b
)
select match_id, key, value::numeric as value from result_values
union all select match_id, key, value::numeric from band_values
union all select match_id, key, value::numeric from event_values
union all select match_id, key, value from source_values
union all select match_id, key, value from player_sum_values
union all select match_id, key, value from combined_values
union all select match_id, key, value::numeric from score_values
union all select match_id, key, value from context_values where value is not null
