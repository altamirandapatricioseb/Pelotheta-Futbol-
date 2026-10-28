-- Etapa 6: conclusiones con los partidos de Boca en todas las competiciones (la liga es la vara)
-- y reglas de copas contra liga. Copia de sql/conclusions.sql (fuente).
alter table core.conclusion_rule drop constraint conclusion_rule_kind_check;
alter table core.conclusion_rule add constraint conclusion_rule_kind_check
  check (kind in ('liga', 'proporcion', 'cuota', 'jugador', 'competencia'));

create or replace function core.refresh_conclusions()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from core.conclusion_result where true;

  insert into core.conclusion_result (rule_id, entity_id, band, value, reference, percentile, n)
  with rules as (
    select * from core.conclusion_rule
  ),
  club as (
    select c.team_name, c.stat_key,
           case when c.stat_key in ('clean_sheets', 'failed_to_score', 'red_cards_total')
                then c.value / nullif(g.value, 0) else c.value end as v
    from api.club_season_stat c
    join api.club_season_stat g on g.team_name = c.team_name and g.season = c.season and g.stat_key = 'games'
    where c.season = (select max(season) from api.club_season_stat)
  ),
  -- Boca: promedio por partido en TODOS sus partidos (liga y copas). La liga es solo la vara: el
  -- percentil dice dónde quedaría ese promedio entre los 30 clubes.
  boca_all as (
    select v.key, avg(v.value) as v, count(*)::numeric as n
    from api.team_match_value v
    group by v.key
  ),
  liga as (
    select r.rule_id, 0 as entity_id, ba.v as value, avg(c.v) as reference,
           100.0 * count(*) filter (where c.v < ba.v) / nullif(count(*), 0) as percentile,
           ba.n as n
    from rules r
    join club c on c.stat_key = r.num_key
    join boca_all ba on ba.key = r.den_key
    where r.kind = 'liga'
    group by r.rule_id, ba.v, ba.n
  ),
  -- Copas contra liga: promedio por partido de Boca en las copas dividido por el de la liga.
  competencia as (
    select r.rule_id, 0 as entity_id,
           avg(v.value) filter (where b.competition_kind <> 'liga')
             / nullif(avg(v.value) filter (where b.competition_kind = 'liga'), 0) as value,
           avg(v.value) filter (where b.competition_kind = 'liga') as reference,
           null::numeric as percentile,
           count(*) filter (where b.competition_kind <> 'liga')::numeric as n
    from rules r
    join api.team_match_value v on v.key = r.num_key
    join core.situ_base b on b.match_id = v.match_id
    where r.kind = 'competencia'
    group by r.rule_id
  ),
  team as (
    select v.match_id, v.key, v.value from api.team_match_value v
  ),
  prop_team as (
    select r.rule_id, sum(nm.value) as num, sum(dn.value) as den
    from rules r
    join team nm on nm.key = r.num_key
    join team dn on dn.key = r.den_key and dn.match_id = nm.match_id
    where r.kind = 'proporcion' and r.scope = 'equipo'
    group by r.rule_id
  ),
  player as (
    -- Solo las claves que usan las reglas (la tabla de valores por jugador es grande).
    select v.player_id, v.match_id, v.key, v.value, pm.position_group as position
    from api.player_match_value v
    join api.player_master pm on pm.player_id = v.player_id and pm.competition_code = 'todas'
    where v.key in (select num_key from rules union select den_key from rules union select 'minutes')
  ),
  minutes as (
    select player_id, sum(value) as mins from player where key = 'minutes' group by player_id
  ),
  prop_player as (
    select r.rule_id, sum(nm.value) as num, sum(dn.value) as den
    from rules r
    join player nm on nm.key = r.num_key and nm.position = r.scope
    join player dn on dn.key = r.den_key and dn.player_id = nm.player_id and dn.match_id = nm.match_id
    where r.kind = 'proporcion' and r.scope not in ('equipo', 'todos')
    group by r.rule_id
  ),
  share as (
    select r.rule_id,
           sum(p.value) filter (where p.key = r.num_key and p.position = r.scope) as group_num,
           sum(p.value) filter (where p.key = r.num_key) as squad_num,
           sum(p.value) filter (where p.key = 'minutes' and p.position = r.scope) as group_min,
           sum(p.value) filter (where p.key = 'minutes') as squad_min
    from rules r
    join player p on p.key in (r.num_key, 'minutes')
    where r.kind = 'cuota'
    group by r.rule_id
  ),
  -- Jugadores: totales de la temporada (el denominador solo en los partidos con numerador).
  jug as (
    select r.rule_id, p.player_id, p.position,
           sum(p.value) filter (where p.key = r.num_key) as num,
           sum(d.value) as den,
           max(mn.mins) as mins
    from rules r
    join player p on p.key = r.num_key
    join player d on d.key = r.den_key and d.player_id = p.player_id and d.match_id = p.match_id
    join minutes mn on mn.player_id = p.player_id
    where r.kind = 'jugador'
      and ((r.scope = 'todos' and p.position <> 'Arquero') or p.position = r.scope)
    group by r.rule_id, p.player_id, p.position
  ),
  jug_value as (
    select j.rule_id, j.player_id, j.num / j.den * r.factor as value, j.den
    from jug j join rules r using (rule_id)
    where j.mins >= 450 and j.den > 0 and j.den >= r.min_n
  ),
  jug_rank as (
    select rule_id, player_id, value, den,
           100.0 * (rank() over (partition by rule_id order by value) - 1)
             / nullif(count(*) over (partition by rule_id) - 1, 0) as percentile,
           avg(value) over (partition by rule_id) as reference
    from jug_value
  ),
  measured as (
    select rule_id, entity_id, value, reference, percentile, n from liga
    union all
    select rule_id, entity_id, value, reference, percentile, n from competencia
    union all
    select rule_id, 0, num / den * r.factor, null, null, den
    from (select * from prop_team union all select * from prop_player) p
    join rules r using (rule_id)
    where den > 0
    union all
    select rule_id, 0, (group_num / squad_num) / (group_min / squad_min), 100 * group_min / squad_min, null, squad_num
    from share
    where squad_num > 0 and squad_min > 0 and group_min > 0
    union all
    select rule_id, player_id, value, reference, percentile, den from jug_rank
  )
  select m.rule_id, m.entity_id,
         case when coalesce(m.percentile, m.value) >= r.high then 'alta'
              when coalesce(m.percentile, m.value) <= r.low then 'baja'
              else 'media' end,
         round(m.value, 4), round(m.reference, 4), round(m.percentile, 1), m.n
  from measured m
  join rules r using (rule_id)
  where m.value is not null and (r.kind = 'jugador' or m.n >= r.min_n);
end;
$$;
