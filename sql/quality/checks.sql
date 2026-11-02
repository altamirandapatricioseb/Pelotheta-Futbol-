-- Chequeos de calidad de datos (16.1), escritos a mano: unicidad, no nulos, rangos, integridad
-- referencial, frescura y conciliación. Cada fila tiene un id estable que nombran los contratos de
-- data/contracts.yml. La migración 20261102180000_data_quality.sql crea esta misma vista;
-- ingest.run_quality_checks() la copia a core.data_quality_result al final de cada corrida y
-- /estado muestra el semáforo.
create or replace view core.v_quality_checks as
with boca as (select team_id from core.team where is_boca),
goals as (
  -- Sin la definición por penales (período 5): no suma al resultado.
  select e.match_id,
         count(*) filter (where e.team_id = (select team_id from boca)) as boca,
         count(*) filter (where e.team_id <> (select team_id from boca)) as rival
  from core.event e
  where e.type in ('gol', 'penal_convertido') and coalesce(e.period, 1) < 5
  group by e.match_id
),
own as (
  -- Un gol en contra suma al otro equipo.
  select e.match_id,
         count(*) filter (where e.team_id <> (select team_id from boca)) as boca,
         count(*) filter (where e.team_id = (select team_id from boca)) as rival
  from core.event e
  where e.type = 'gol_en_contra' and coalesce(e.period, 1) < 5
  group by e.match_id
)
select * from (values
  ('match_unico', 'match', 'unicidad', 'Un solo partido por fecha y par de equipos',
   (select count(*) from (select 1 from core.match group by match_date, home_team_id, away_team_id
                          having count(*) > 1) d),
   (select count(*) from core.match)),
  ('match_no_nulos', 'match', 'no_nulos', 'Fecha, equipos y goles presentes',
   (select count(*) from core.match where match_date is null or home_team_id is null or away_team_id is null
                                      or home_goals is null or away_goals is null),
   (select count(*) from core.match)),
  ('match_rango', 'match', 'rango', 'Goles entre 0 y 15 y equipos distintos',
   (select count(*) from core.match where home_goals not between 0 and 15 or away_goals not between 0 and 15
                                      or home_team_id = away_team_id),
   (select count(*) from core.match)),
  ('match_frescura', 'match', 'frescura', 'Último partido cargado hace 35 días o menos (SLO de frescura)',
   (select case when max(match_date) >= current_date - 35 then 0 else 1 end from core.match),
   1::bigint),
  ('match_conciliacion_goles', 'match', 'conciliacion', 'Los goles del resultado coinciden con los eventos de gol',
   (select count(*) from core.match m
      left join goals g using (match_id) left join own o using (match_id)
    where (case when m.home_team_id = (select team_id from boca) then m.home_goals else m.away_goals end)
            <> coalesce(g.boca, 0) + coalesce(o.boca, 0)
       or (case when m.home_team_id = (select team_id from boca) then m.away_goals else m.home_goals end)
            <> coalesce(g.rival, 0) + coalesce(o.rival, 0)),
   (select count(*) from core.match)),
  ('lineup_unico', 'lineup', 'unicidad', 'Un jugador aparece una sola vez por partido',
   (select count(*) from (select 1 from core.lineup group by match_id, player_id having count(*) > 1) d),
   (select count(*) from core.lineup)),
  ('lineup_referencial', 'lineup', 'referencial', 'Cada alineación apunta a un partido y un jugador existentes',
   (select count(*) from core.lineup l
    where not exists (select 1 from core.match m where m.match_id = l.match_id)
       or not exists (select 1 from core.player p where p.player_id = l.player_id)),
   (select count(*) from core.lineup)),
  ('lineup_minutos', 'lineup', 'rango', 'Entrada y salida entre los minutos 0 y 130, la salida después de la entrada',
   (select count(*) from core.lineup where minute_in not between 0 and 130 or minute_out not between 0 and 130
                                        or minute_out < minute_in),
   (select count(*) from core.lineup)),
  ('event_referencial', 'event', 'referencial', 'Cada evento apunta a un partido existente',
   (select count(*) from core.event e where not exists (select 1 from core.match m where m.match_id = e.match_id)),
   (select count(*) from core.event)),
  ('event_minuto', 'event', 'rango', 'Minuto entre 0 y 130',
   (select count(*) from core.event where minute not between 0 and 130),
   (select count(*) from core.event)),
  ('team_stat_porcentaje', 'team_match_stat', 'rango', 'Porcentajes (posesión, precisión de pase) entre 0 y 100',
   (select count(*) from core.team_match_stat where stat_key like '%pct%' and value not between 0 and 100),
   (select count(*) from core.team_match_stat where stat_key like '%pct%')),
  ('team_stat_posesion_suma', 'team_match_stat', 'conciliacion', 'La posesión de los dos equipos suma 100 (±2)',
   (select count(*) from (select match_id from core.team_match_stat where stat_key = 'possession_pct'
                          group by match_id having count(*) = 2 and abs(sum(value) - 100) > 2) d),
   (select count(distinct match_id) from core.team_match_stat where stat_key = 'possession_pct')),
  ('player_stat_calificacion', 'player_match_stat', 'rango', 'Calificación entre 0 y 10',
   (select count(*) from core.player_match_stat where stat_key = 'rating' and value not between 0 and 10),
   (select count(*) from core.player_match_stat where stat_key = 'rating')),
  ('player_stat_referencial', 'player_match_stat', 'referencial', 'Cada valor apunta a un partido y un jugador existentes',
   (select count(*) from core.player_match_stat s
    where not exists (select 1 from core.match m where m.match_id = s.match_id)
       or not exists (select 1 from core.player p where p.player_id = s.player_id)),
   (select count(*) from core.player_match_stat)),
  ('shot_xg', 'shot', 'rango', 'xG entre 0 y 1 y coordenadas dentro de la cancha (0 a 1,05)',
   (select count(*) from core.shot where xg not between 0 and 1 or x not between 0 and 1.05 or y not between 0 and 1.05),
   (select count(*) from core.shot)),
  ('player_no_nulos', 'player', 'no_nulos', 'Cada jugador tiene nombre',
   (select count(*) from core.player where coalesce(full_name, known_as) is null),
   (select count(*) from core.player))
) as c(check_id, table_name, check_type, description_es, failing, total);
