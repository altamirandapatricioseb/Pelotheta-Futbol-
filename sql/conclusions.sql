-- =============================================================================
-- Conclusiones (Interfaz 4): frases sobre el equipo que salen de reglas, no de texto fijo.
--
-- Cada regla de `core.conclusion_rule` (data/conclusion_catalog.csv) dice qué medir, contra qué
-- compararlo y qué decir en cada banda. `core.refresh_conclusions()` calcula el valor con los
-- datos de la temporada en curso y elige la banda (alta, media o baja): si la temporada que viene
-- cambian los números, cambia la conclusión y su color sin tocar el código.
--
-- Tipos de regla:
--   liga        promedio por partido de Boca en todos sus partidos (liga y copas, `clave_den` es la
--               clave del equipo) y dónde quedaría entre los 30 clubes de la liga
--               (`api.club_season_stat`, `clave_num`).
--   competencia promedio por partido de Boca en las copas dividido por el de la liga.
--   proporcion  suma de `clave_num` sobre suma de `clave_den` (× factor) del equipo o de una
--               posición; el denominador solo cuenta los partidos que tienen el numerador.
--   jugador     cada jugador con 450 minutos o más: su valor (cada 90 o proporción) y su percentil
--               entre los de su posición o entre todos los de campo («todos»).
--   cuota       parte de la posición en el total del plantel de `clave_num`, dividida por su parte
--               de los minutos: 1 es lo esperable para los minutos que juega.
-- =============================================================================
create table core.conclusion_rule (
  rule_id      text primary key,
  area         text not null,
  title_es     text not null,
  kind         text not null check (kind in ('liga', 'proporcion', 'cuota', 'jugador', 'competencia')),
  num_key      text not null,
  den_key      text not null default '',
  scope        text not null default 'equipo',
  factor       numeric not null default 1,
  unit         text not null default '',
  high         numeric not null,
  low          numeric not null,
  min_n        numeric not null default 0,
  tone_high    text not null check (tone_high in ('positivo', 'negativo', 'neutral', '')),
  tone_mid     text not null check (tone_mid in ('positivo', 'negativo', 'neutral', '')),
  tone_low     text not null check (tone_low in ('positivo', 'negativo', 'neutral', '')),
  text_high    text not null default '',
  text_mid     text not null default '',
  text_low     text not null default '',
  link         text not null default '',
  sort_order   smallint not null
);

create table core.conclusion_result (
  rule_id     text not null references core.conclusion_rule (rule_id) on delete cascade,
  -- 0 para el equipo; el player_id para las reglas de tipo «jugador».
  entity_id   integer not null default 0,
  band        text not null check (band in ('alta', 'media', 'baja')),
  value       numeric not null,
  reference   numeric,
  percentile  numeric,
  n           numeric not null,
  computed_at timestamptz not null default now(),
  primary key (rule_id, entity_id)
);

alter table core.conclusion_rule enable row level security;
alter table core.conclusion_result enable row level security;
create policy anon_read on core.conclusion_rule for select to anon using (true);
create policy anon_read on core.conclusion_result for select to anon using (true);
grant select on core.conclusion_rule, core.conclusion_result to anon;

create function core.refresh_conclusions()
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
revoke all on function core.refresh_conclusions() from public;
grant execute on function core.refresh_conclusions() to service_role;

create function ingest.load_conclusions(p_rules jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  n_rules integer;
begin
  delete from core.conclusion_rule where true;
  insert into core.conclusion_rule (rule_id, area, title_es, kind, num_key, den_key, scope, factor, unit, high, low,
                                    min_n, tone_high, tone_mid, tone_low, text_high, text_mid, text_low, link,
                                    sort_order)
  select r ->> 'rule_id', r ->> 'area', r ->> 'title_es', r ->> 'kind', r ->> 'num_key', coalesce(r ->> 'den_key', ''),
         coalesce(r ->> 'scope', 'equipo'), coalesce((r ->> 'factor')::numeric, 1), coalesce(r ->> 'unit', ''),
         (r ->> 'high')::numeric, (r ->> 'low')::numeric, coalesce((r ->> 'min_n')::numeric, 0),
         coalesce(r ->> 'tone_high', ''), coalesce(r ->> 'tone_mid', ''), coalesce(r ->> 'tone_low', ''),
         coalesce(r ->> 'text_high', ''), coalesce(r ->> 'text_mid', ''), coalesce(r ->> 'text_low', ''),
         coalesce(r ->> 'link', ''), (r ->> 'sort_order')::smallint
  from jsonb_array_elements(p_rules) r;
  get diagnostics n_rules = row_count;
  perform core.refresh_conclusions();
  return jsonb_build_object('rules', n_rules);
end;
$$;
revoke all on function ingest.load_conclusions(jsonb) from public;
grant execute on function ingest.load_conclusions(jsonb) to service_role;

-- Conclusión vigente de cada regla, con la frase y el tono de su banda (la web reemplaza
-- {valor}, {referencia}, {percentil} y {n} con los números formateados).
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

-- El refresco de cada corrida también recalcula las conclusiones.
create or replace function core.refresh_stats()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  refresh materialized view core.player_match_value_mv;
  refresh materialized view core.player_master_mv;
  perform core.refresh_situations();
  perform core.refresh_conclusions();
end;
$$;
