-- Etapa 6: copia de sql/situational/e_defensa.sql (fuente).
-- =============================================================================
-- E. Defensa (tarjetas s051 a s060). s058 (duelos aéreos ganados en %) y s059 (presiones) quedan
-- n/d: las fuentes dan los aéreos ganados pero no los disputados, y no publican presiones.
-- =============================================================================
create view core.situ_cards_e as
with v as (
  select match_id, ga, (s ->> 'shots_total_against')::numeric as shots_against,
         (s ->> 'shots_on_target_against')::numeric as on_target_against, (s ->> 'xg_against')::numeric as xg_against,
         (s ->> 'saves')::numeric as saves, (s ->> 'tackles')::numeric as tackles,
         (s ->> 'interceptions')::numeric as interceptions, (s ->> 'clearances')::numeric as clearances
  from core.situ_base
)
-- s051: remates recibidos.
select 's051' as card_id, case when shots_against <= 8 then '8 o menos recibidos' else '15 o más recibidos' end as param_value,
       case when shots_against <= 8 then 1 else 2 end as param_order, match_id
from v where shots_against <= 8 or shots_against >= 15
union all
-- s052: remates al arco recibidos.
select 's052', case when on_target_against <= 3 then '3 o menos al arco' else '6 o más al arco' end,
       case when on_target_against <= 3 then 1 else 2 end, match_id
from v where on_target_against <= 3 or on_target_against >= 6
union all
-- s053: xG concedido.
select 's053', case when xg_against <= 0.8 then 'xG en contra 0,8 o menos' else 'xG en contra 2 o más' end,
       case when xg_against <= 0.8 then 1 else 2 end, match_id
from v where xg_against <= 0.8 or xg_against >= 2
union all
-- s054: recibió más de un gol por encima de lo esperado.
select 's054', 'Goles recibidos − xG > 1', 1, match_id from v where ga - xg_against > 1
union all
-- s055: atajadas del arquero.
select 's055', t || ' o más atajadas', o::int, match_id
from v cross join unnest(array[4, 6]) with ordinality u (t, o) where saves >= t
union all
-- s056: entradas e intercepciones.
select 's056', '20 o más entradas', 1, match_id from v where tackles >= 20
union all
select 's056', '10 o más intercepciones', 2, match_id from v where interceptions >= 10
union all
-- s057: despejes (equipo encerrado).
select 's057', t || ' o más despejes', o::int, match_id
from v cross join unnest(array[25, 35]) with ordinality u (t, o) where clearances >= t
union all
-- s060: tramos en que más goles recibe (una fila por tramo con gol en contra).
select distinct 's060', core.situ_band_label(core.situ_band(minute, period)), core.situ_band(minute, period), match_id
from core.situ_goal where not for_boca;
