-- Etapa 6: copia de sql/situational/i_forma.sql (fuente).
-- =============================================================================
-- I. Forma y rachas (tarjetas s096 a s105). Casi todas miden el partido SIGUIENTE a una
-- condición: la fila lleva `next_match_id`.
-- =============================================================================
create view core.situ_cards_i as
with v as (
  select b.*,
         -- Racha de victorias, de partidos sin ganar, de vallas invictas y sin marcar que trae cada
         -- partido (contando el propio): islas de partidos consecutivos con la misma condición.
         sum(case when result = 'G' then 0 else 1 end) over w as grp_win,
         sum(case when result <> 'G' then 0 else 1 end) over w as grp_nowin,
         sum(case when ga = 0 then 0 else 1 end) over w as grp_clean,
         sum(case when gf = 0 then 0 else 1 end) over w as grp_blank,
         sum(points) over (order by seq rows between 5 preceding and 1 preceding) as form5,
         count(*) over (order by seq rows between 5 preceding and 1 preceding) as form5_n,
         lag(ga = 0) over (order by seq) as prev_clean,
         lag(gf = 0) over (order by seq) as prev_blank
  from core.situ_base b
  window w as (order by seq)
),
streak as (
  select v.*,
         count(*) filter (where result = 'G') over (partition by grp_win order by seq) as win_run,
         count(*) filter (where result <> 'G') over (partition by grp_nowin order by seq) as nowin_run,
         count(*) filter (where ga = 0) over (partition by grp_clean order by seq) as clean_run,
         count(*) filter (where gf = 0) over (partition by grp_blank order by seq) as blank_run
  from v
),
red_boca as (
  select distinct match_id from core.situ_card where for_boca and type in ('roja', 'segunda_amarilla')
),
islands as (
  -- Rachas completas para s103: victorias, invicto y sin ganar.
  select kind, grp, min(seq) as first_seq, count(*) as len
  from (
    select 'Victorias seguidas' as kind, seq, seq - row_number() over (order by seq) as grp from v where result = 'G'
    union all
    select 'Invicto (sin perder)', seq, seq - row_number() over (order by seq) from v where result <> 'P'
    union all
    select 'Sin ganar', seq, seq - row_number() over (order by seq) from v where result <> 'G'
  ) x
  group by kind, grp
),
longest as (
  select distinct on (kind) kind, first_seq, len from islands order by kind, len desc, first_seq
)
-- s096: resultado siguiente según el anterior.
select 's096' as card_id, 'Después de ' || case result when 'G' then 'ganar' when 'E' then 'empatar' else 'perder' end as param_value,
       case result when 'G' then 1 when 'E' then 2 else 3 end as param_order, next_match_id as match_id
from v where next_match_id is not null
union all
-- s097: después de una goleada.
select 's097', case when gf - ga >= 3 then 'Después de golear' else 'Después de ser goleado' end,
       case when gf - ga >= 3 then 1 else 2 end, next_match_id
from v where next_match_id is not null and abs(gf - ga) >= 3
union all
-- s098 y s099: después de 3 o más victorias seguidas, o de 3 o más sin ganar.
select 's098', 'Después de 3 o más victorias seguidas', 1, next_match_id from streak where next_match_id is not null and win_run >= 3
union all
select 's099', 'Después de 3 o más sin ganar', 1, next_match_id from streak where next_match_id is not null and nowin_run >= 3
union all
-- s100: forma de los últimos 5 partidos (0 a 15 puntos) y el resultado de este.
select 's100', case when form5 <= 5 then '0 a 5 puntos' when form5 <= 9 then '6 a 9 puntos' else '10 a 15 puntos' end,
       case when form5 <= 5 then 1 when form5 <= 9 then 2 else 3 end, match_id
from v where form5_n = 5
union all
-- s101 y s102: venía de 2 o más vallas invictas o de 2 o más partidos sin marcar.
select 's101', 'Venía de 2 o más vallas invictas', 1, next_match_id from streak where next_match_id is not null and clean_run >= 2
union all
select 's102', 'Venía de 2 o más partidos sin marcar', 1, next_match_id from streak where next_match_id is not null and blank_run >= 2
union all
-- s103: las rachas más largas de la temporada (los partidos de cada una).
select 's103', l.kind || ' (' || l.len || ')', (dense_rank() over (order by l.kind))::int, v.match_id
from longest l join v on v.seq between l.first_seq and l.first_seq + l.len - 1
union all
-- s104: partido siguiente al último de cada copa (eliminación o fin del torneo).
select 's104', 'Después del último partido de una copa', 1, next_match_id
from v where next_match_id is not null and competition_kind like 'copa%' and comp_seq = comp_count
union all
-- s105: después de un partido con expulsión de Boca.
select 's105', 'Después de una expulsión de Boca', 1, v.next_match_id
from v join red_boca r on r.match_id = v.match_id where v.next_match_id is not null;
