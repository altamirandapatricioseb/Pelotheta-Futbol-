-- Etapa 6: copia de sql/situational/j_jugadores.sql (fuente).
-- =============================================================================
-- J. Jugadores y plantel (tarjetas s106 a s125). Una fila por jugador cuando la tarjeta es «con
-- X» o «cuando X...»; solo jugadores con muestra mínima para que la fila diga algo.
-- =============================================================================
create view core.situ_cards_j as
with lu as (
  select l.*, b.seq, b.match_date from core.situ_lineup l join core.situ_base b using (match_id)
),
starts as (
  select player_id, player_name, count(*) filter (where started) as n_starts from lu group by player_id, player_name
),
scorer as (
  select g.match_id, g.player_id, g.related_player_id, g.minute, g.period, g.minute_order
  from core.situ_goal g where g.for_boca
),
named as (
  select distinct player_id, player_name from lu
),
first_sub as (
  select match_id, min(minute) as minute from core.situ_sub group by match_id
),
cb_pair as (
  -- Dupla de centrales titulares de cada partido (si fueron exactamente dos).
  select match_id, string_agg(player_name, ' y ' order by player_name) as pair
  from lu where started and position = 'Defensa Central'
  group by match_id having count(*) = 2
),
usual_pair as (
  select pair from cb_pair group by pair order by count(*) desc limit 1
),
xi_age as (
  -- Edad promedio del once (solo los titulares con fecha de nacimiento; estimado).
  select match_id, avg(extract(year from age(match_date, birth_date))) as age, count(birth_date) as known
  from lu where started group by match_id
),
three_in_seven as (
  select b.match_id,
         (select count(*) from core.situ_base o where o.match_date between b.match_date - 6 and b.match_date) as games_7d
  from core.situ_base b
),
full_run as (
  -- Titulares que jugaron completos (sin salir antes del 90) los 3 partidos anteriores.
  select b.match_id, count(distinct l.player_id) as players
  from core.situ_base b
  join lu l on l.started and l.seq = b.seq
  where (select count(*) from lu p
         where p.player_id = l.player_id and p.seq between b.seq - 3 and b.seq - 1
           and p.started and coalesce(p.minute_out, 90) >= 90) = 3
  group by b.match_id
)
-- s106: con X de titular (jugadores con 5 o más titularidades).
select 's106' as card_id, 'Con ' || s.player_name as param_value,
       (dense_rank() over (order by s.n_starts desc, s.player_name))::int as param_order, lu.match_id
from lu join starts s using (player_id) where lu.started and s.n_starts >= 5
union all
-- s107: cuando X marca (2 o más partidos con gol).
select 's107', n.player_name, (dense_rank() over (order by c.games desc, n.player_name))::int, x.match_id
from (select distinct match_id, player_id from scorer) x
join (select player_id, count(distinct match_id) as games from scorer group by player_id) c using (player_id)
join named n using (player_id)
where c.games >= 2
union all
-- s108: cuando X asiste (2 o más partidos con asistencia).
select 's108', n.player_name, (dense_rank() over (order by c.games desc, n.player_name))::int, x.match_id
from (select distinct match_id, related_player_id as player_id from scorer where related_player_id is not null) x
join (select related_player_id as player_id, count(distinct match_id) as games from scorer
      where related_player_id is not null group by related_player_id) c using (player_id)
join named n using (player_id)
where c.games >= 2
union all
-- s109: cuando X recibe tarjeta (3 o más partidos amonestado o expulsado).
select 's109', n.player_name, (dense_rank() over (order by c.games desc, n.player_name))::int, x.match_id
from (select distinct match_id, player_id from core.situ_card where for_boca) x
join (select player_id, count(distinct match_id) as games from core.situ_card where for_boca group by player_id) c using (player_id)
join named n using (player_id)
where c.games >= 3
union all
-- s110: cuando X sale antes del minuto 60 (3 o más veces).
select 's110', s.player_name, (dense_rank() over (order by c.games desc, s.player_name))::int, lu.match_id
from lu join starts s using (player_id)
join (select player_id, count(*) as games from lu where started and minute_out < 60 group by player_id) c using (player_id)
where lu.started and lu.minute_out < 60 and c.games >= 3
union all
-- s111: cuando X entra desde el banco (3 o más veces).
select 's111', s.player_name, (dense_rank() over (order by c.games desc, s.player_name))::int, lu.match_id
from lu join starts s using (player_id)
join (select player_id, count(*) as games from lu where not started and minute_in is not null group by player_id) c using (player_id)
where not lu.started and lu.minute_in is not null and c.games >= 3
union all
-- s112: partidos en que marca un suplente (entre los partidos con gol de Boca).
select 's112', case when bool_or(not l.started) then 'Marcó un suplente' else 'Solo marcaron titulares' end,
       case when bool_or(not l.started) then 1 else 2 end, s.match_id
from scorer s join lu l on l.match_id = s.match_id and l.player_id = s.player_id
group by s.match_id
union all
-- s113: cantidad de goleadores distintos.
select 's113', case when n >= 3 then '3 o más goleadores' when n = 0 then 'Sin goles' else n || ' goleador' || case when n > 1 then 'es' else '' end end,
       least(n, 3)::int + 1, match_id
from (select b.match_id, count(distinct s.player_id) as n from core.situ_base b left join scorer s using (match_id) group by b.match_id) x
union all
-- s114: arquero titular.
select 's114', player_name, (dense_rank() over (order by player_name))::int, match_id
from lu where started and position = 'Arquero'
union all
-- s115: dupla de centrales habitual u otra.
select 's115', case when c.pair = u.pair then 'Con la dupla habitual (' || u.pair || ')' else 'Con otra dupla' end,
       case when c.pair = u.pair then 1 else 2 end, c.match_id
from cb_pair c cross join usual_pair u
union all
-- s116: edad promedio del once (con al menos 8 titulares de edad conocida).
select 's116', case when age < 25 then 'Menos de 25 años' when age < 28 then '25 a 28 años' else '28 años o más' end,
       case when age < 25 then 1 when age < 28 then 2 else 3 end, match_id
from xi_age where known >= 8
union all
-- s117: cambios en el once respecto del partido anterior.
select 's117', case when r <= 1 then '0 o 1 cambio' when r <= 3 then '2 o 3 cambios' else '4 o más cambios' end,
       case when r <= 1 then 1 when r <= 3 then 2 else 3 end, match_id
from (select match_id, (s ->> 'eq_rotacion')::numeric as r from core.situ_base) x where r is not null
union all
-- s118: formación de Boca (según ScoutingStats).
select 's118', f.boca_formation, (dense_rank() over (order by f.boca_formation))::int, f.match_id
from api.boca_formation f join core.situ_base b using (match_id) where f.boca_formation is not null
union all
-- s119: tercer partido (o más) en 7 días.
select 's119', case when games_7d >= 3 then 'Tercer partido en 7 días' else 'Con menos carga' end,
       case when games_7d >= 3 then 1 else 2 end, match_id
from three_in_seven
union all
-- s120: minuto del primer cambio.
select 's120', case when minute < 55 then 'Antes del 55''' when minute <= 70 then 'Del 55'' al 70''' else 'Después del 70''' end,
       case when minute < 55 then 1 when minute <= 70 then 2 else 3 end, match_id
from first_sub
union all
-- s121: cómo iba el partido en el primer cambio.
select 's121', case when sc.gf > sc.ga then 'Primer cambio ganando' when sc.gf = sc.ga then 'Primer cambio empatando'
                    else 'Primer cambio perdiendo' end,
       case when sc.gf > sc.ga then 1 when sc.gf = sc.ga then 2 else 3 end, f.match_id
from first_sub f cross join lateral core.situ_score_at(f.match_id, f.minute) sc
union all
-- s122: gol de Boca en los 15 minutos posteriores a un cambio.
select 's122', case when exists (select 1 from core.situ_sub su join scorer s on s.match_id = su.match_id
                                  and s.minute > su.minute and s.minute <= su.minute + 15 where su.match_id = f.match_id)
                    then 'Gol en los 15 minutos tras un cambio' else 'Sin gol tras los cambios' end,
       case when exists (select 1 from core.situ_sub su join scorer s on s.match_id = su.match_id
                           and s.minute > su.minute and s.minute <= su.minute + 15 where su.match_id = f.match_id)
            then 1 else 2 end, f.match_id
from first_sub f
union all
-- s123: cuando X marca o asiste (3 o más partidos con G+A).
select 's123', n.player_name, (dense_rank() over (order by c.games desc, n.player_name))::int, x.match_id
from (select distinct match_id, player_id from scorer
      union select distinct match_id, related_player_id from scorer where related_player_id is not null) x
join (select player_id, count(distinct match_id) as games from (
        select match_id, player_id from scorer
        union select match_id, related_player_id from scorer where related_player_id is not null) y
      group by player_id) c using (player_id)
join named n using (player_id)
where c.games >= 3
union all
-- s124: sin X (jugadores con 10 o más titularidades): partidos que no jugó.
select 's124', 'Sin ' || s.player_name, (dense_rank() over (order by s.n_starts desc, s.player_name))::int, b.match_id
from starts s cross join core.situ_base b
where s.n_starts >= 10
  and not exists (select 1 from lu where lu.player_id = s.player_id and lu.match_id = b.match_id)
union all
-- s125: titulares que vienen de 3 partidos completos seguidos.
select 's125', case when p.n <= 3 then '0 a 3 titulares' when p.n <= 6 then '4 a 6 titulares' else '7 o más titulares' end,
       case when p.n <= 3 then 1 when p.n <= 6 then 2 else 3 end, b.match_id
from core.situ_base b left join full_run f using (match_id)
cross join lateral (select coalesce(f.players, 0) as n) p
where b.seq > 3;
