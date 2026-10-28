-- =============================================================================
-- Etapa 4: catálogo de estadísticas, conjuntos de columnas, valores base por partido y tablas
-- maestras de jugadores (Interfaz 3) y del equipo (Interfaz 2).
--
-- El catálogo (`data/stat_catalog.csv`) dice cómo se calcula cada estadística (regla y
-- argumentos). Las vistas de abajo aplican esas reglas sobre los valores por partido, así que
-- agregar una estadística calculable es agregar una fila al CSV, no tocar SQL. Las métricas
-- propias (secciones 5.7 y 6) las calcula el pipeline en Python y las carga ya resueltas en
-- `core.stat_value` (por ventana) y `core.stat_match_value` (por partido).
-- =============================================================================

create table core.stat_catalog (
  stat_id          text primary key check (stat_id ~ '^[a-z][a-z0-9_]*$'),
  entity           text not null check (entity in ('player', 'team')),
  name_es          text not null,
  short_name       text not null,
  description_es   text not null check (char_length(description_es) between 10 and 160),
  stat_group       text not null,
  category         text not null,
  unit             text not null,
  source           text not null,
  level            text not null check (level in ('A', 'B', 'C')),
  formula          text not null,
  higher_is_better boolean not null,
  available        boolean not null,
  estimated        boolean not null,
  per90            boolean not null,
  rule             text not null check (rule in ('suma', 'promedio', 'cociente', 'diferencia', 'adicion',
                                                 'perfil', 'metrica', 'especial', 'nd')),
  arg1             text not null default '',
  arg2             text not null default '',
  factor           numeric not null default 1,
  -- Nivel C = sin fuente gratuita: nunca disponible y sin regla de cálculo.
  check ((level = 'C') = (rule = 'nd')),
  check (level <> 'C' or not available)
);

create table core.stat_set (
  set_id         text primary key,
  entity         text not null check (entity in ('player', 'team')),
  name_es        text not null,
  description_es text not null,
  sort_order     smallint not null
);

create table core.stat_set_item (
  set_id     text not null references core.stat_set (set_id) on delete cascade,
  stat_id    text not null references core.stat_catalog (stat_id) on delete cascade,
  sort_order smallint not null,
  primary key (set_id, stat_id)
);
create index stat_set_item_stat_idx on core.stat_set_item (stat_id);

-- Valor de una métrica propia para una ventana (competición o 'todas'), con su rango y
-- cobertura cuando la métrica los tiene (Potencial α, índice de rendimiento).
create table core.stat_value (
  entity           text not null check (entity in ('player', 'team')),
  entity_id        integer not null,
  competition_code text not null,
  stat_id          text not null references core.stat_catalog (stat_id) on delete cascade,
  value            numeric,
  low              numeric,
  high             numeric,
  coverage         numeric check (coverage between 0 and 1),
  detail           jsonb,
  computed_at      timestamptz not null default now(),
  primary key (entity, entity_id, competition_code, stat_id)
);
create index stat_value_stat_idx on core.stat_value (stat_id);

-- Valor de una métrica propia en un partido, calculado solo con datos hasta ese partido.
create table core.stat_match_value (
  entity     text not null check (entity in ('player', 'team')),
  entity_id  integer not null,
  match_id   integer not null references core.match (match_id) on delete cascade,
  stat_id    text not null references core.stat_catalog (stat_id) on delete cascade,
  value      numeric,
  low        numeric,
  high       numeric,
  computed_at timestamptz not null default now(),
  primary key (entity, entity_id, match_id, stat_id)
);
create index stat_match_value_match_idx on core.stat_match_value (match_id);
create index stat_match_value_stat_idx on core.stat_match_value (stat_id);

alter table core.stat_catalog enable row level security;
alter table core.stat_set enable row level security;
alter table core.stat_set_item enable row level security;
alter table core.stat_value enable row level security;
alter table core.stat_match_value enable row level security;
create policy anon_read on core.stat_catalog for select to anon using (true);
create policy anon_read on core.stat_set for select to anon using (true);
create policy anon_read on core.stat_set_item for select to anon using (true);
create policy anon_read on core.stat_value for select to anon using (true);
create policy anon_read on core.stat_match_value for select to anon using (true);
grant select on core.stat_catalog, core.stat_set, core.stat_set_item, core.stat_value,
                core.stat_match_value to anon;

-- -----------------------------------------------------------------------------
-- Carga del catálogo: reemplaza todo con lo que trae el CSV (es la fuente de verdad). Una
-- estadística que se saca del CSV se borra con sus valores (ON DELETE CASCADE).
-- -----------------------------------------------------------------------------
create function ingest.load_catalog(p_stats jsonb, p_sets jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  n_stats integer;
  n_items integer;
begin
  delete from core.stat_catalog c
  where c.stat_id not in (select s ->> 'stat_id' from jsonb_array_elements(p_stats) s);

  insert into core.stat_catalog (stat_id, entity, name_es, short_name, description_es, stat_group,
                                 category, unit, source, level, formula, higher_is_better,
                                 available, estimated, per90, rule, arg1, arg2, factor)
  select s ->> 'stat_id', s ->> 'entity', s ->> 'name_es', s ->> 'short_name', s ->> 'description_es',
         s ->> 'stat_group', s ->> 'category', s ->> 'unit', s ->> 'source', s ->> 'level',
         s ->> 'formula', (s ->> 'higher_is_better')::boolean, (s ->> 'available')::boolean,
         (s ->> 'estimated')::boolean, (s ->> 'per90')::boolean, s ->> 'rule',
         coalesce(s ->> 'arg1', ''), coalesce(s ->> 'arg2', ''), (s ->> 'factor')::numeric
  from jsonb_array_elements(p_stats) s
  on conflict (stat_id) do update
    set entity = excluded.entity, name_es = excluded.name_es, short_name = excluded.short_name,
        description_es = excluded.description_es, stat_group = excluded.stat_group,
        category = excluded.category, unit = excluded.unit, source = excluded.source,
        level = excluded.level, formula = excluded.formula,
        higher_is_better = excluded.higher_is_better, available = excluded.available,
        estimated = excluded.estimated, per90 = excluded.per90, rule = excluded.rule,
        arg1 = excluded.arg1, arg2 = excluded.arg2, factor = excluded.factor;
  get diagnostics n_stats = row_count;

  -- Los conjuntos son pocos: se reescriben enteros. «where true» porque la Data API de Supabase
  -- (pg_safeupdate) rechaza un DELETE sin WHERE.
  delete from core.stat_set where true;
  insert into core.stat_set (set_id, entity, name_es, description_es, sort_order)
  select s ->> 'set_id', s ->> 'entity', s ->> 'name_es', s ->> 'description_es', (s ->> 'sort_order')::smallint
  from jsonb_array_elements(p_sets) s;
  insert into core.stat_set_item (set_id, stat_id, sort_order)
  select s ->> 'set_id', i.stat_id, i.ord::smallint
  from jsonb_array_elements(p_sets) s
  cross join lateral jsonb_array_elements_text(s -> 'stats') with ordinality as i(stat_id, ord);
  get diagnostics n_items = row_count;

  return jsonb_build_object('stats', n_stats, 'set_items', n_items);
end;
$$;
revoke all on function ingest.load_catalog(jsonb, jsonb) from public;
grant execute on function ingest.load_catalog(jsonb, jsonb) to service_role;

-- Carga de métricas propias: borra los valores anteriores de esas métricas y escribe los nuevos
-- (se recalculan enteras en cada corrida, así que no hay que reconciliar filas viejas).
create function ingest.load_stat_values(p_stat_ids text[], p_values jsonb, p_match_values jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  n_values integer;
  n_match integer;
begin
  delete from core.stat_value where stat_id = any (p_stat_ids);
  delete from core.stat_match_value where stat_id = any (p_stat_ids);

  insert into core.stat_value (entity, entity_id, competition_code, stat_id, value, low, high,
                               coverage, detail)
  select v ->> 'entity', (v ->> 'entity_id')::integer, v ->> 'competition_code', v ->> 'stat_id',
         (v ->> 'value')::numeric, (v ->> 'low')::numeric, (v ->> 'high')::numeric,
         (v ->> 'coverage')::numeric, v -> 'detail'
  from jsonb_array_elements(coalesce(p_values, '[]')) v
  where v ->> 'stat_id' = any (p_stat_ids);
  get diagnostics n_values = row_count;

  insert into core.stat_match_value (entity, entity_id, match_id, stat_id, value, low, high)
  select v ->> 'entity', (v ->> 'entity_id')::integer, (v ->> 'match_id')::integer, v ->> 'stat_id',
         (v ->> 'value')::numeric, (v ->> 'low')::numeric, (v ->> 'high')::numeric
  from jsonb_array_elements(coalesce(p_match_values, '[]')) v
  where v ->> 'stat_id' = any (p_stat_ids);
  get diagnostics n_match = row_count;

  insert into core.ingest_log (run_id, source, finished_at, status, rows_inserted)
  values (gen_random_uuid(), 'metricas_propias', now(), 'ok', n_values + n_match);
  return jsonb_build_object('values', n_values, 'match_values', n_match);
end;
$$;
revoke all on function ingest.load_stat_values(text[], jsonb, jsonb) from public;
grant execute on function ingest.load_stat_values(text[], jsonb, jsonb) to service_role;

-- -----------------------------------------------------------------------------
-- Vistas públicas del catálogo.
-- -----------------------------------------------------------------------------
create view api.stat_catalog
with (security_invoker = true) as
select stat_id, entity, name_es, short_name, description_es, stat_group, category, unit, source,
       level, formula, higher_is_better, available, estimated, per90, rule, arg1, arg2, factor
from core.stat_catalog;
comment on view api.stat_catalog is 'Catálogo de estadísticas (sección 5): descripción, nivel A/B/C y regla de cálculo.';

-- Los ids de cada conjunto en orden, en un arreglo: la web arma las columnas de una sola lectura.
create view api.stat_set
with (security_invoker = true) as
select s.set_id, s.entity, s.name_es, s.description_es, s.sort_order,
       array_agg(i.stat_id order by i.sort_order) as stat_ids
from core.stat_set s
join core.stat_set_item i on i.set_id = s.set_id
group by s.set_id, s.entity, s.name_es, s.description_es, s.sort_order;
comment on view api.stat_set is 'Conjuntos de columnas del desplegable de las Interfaces 2 y 3.';

grant select on api.stat_catalog, api.stat_set to anon, service_role;

-- -----------------------------------------------------------------------------
-- Valores base por partido: el texto de sql/player_match_value.sql y sql/team_match_value.sql.
-- -----------------------------------------------------------------------------
create view api.player_match_value
with (security_invoker = true) as
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
combined_values as (
  -- Sumas de dos claves y npxG estimado, solo en partidos que tienen todos los datos.
  select x.match_id, x.player_id, 'duels_total' as key, x.value + y.value as value
  from source_values x join source_values y using (match_id, player_id)
  where x.key = 'duels_won' and y.key = 'duels_lost'
  union all
  select x.match_id, x.player_id, 'aerials_total', x.value + y.value
  from source_values x join source_values y using (match_id, player_id)
  where x.key = 'aerials_won' and y.key = 'aerials_lost'
  union all
  -- npxG = xG − 0,76 × penales pateados (valor convencional de un penal, tabla 5.6; estimado).
  select x.match_id, x.player_id, 'npxg', x.value - 0.76 * e.value
  from source_values x join event_values e using (match_id, player_id)
  where x.key = 'xg' and e.key = 'penalties_taken'
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
union all select match_id, player_id, key, value::numeric from suspension_values;
comment on view api.player_match_value is 'Valores base por partido de cada jugador de Boca (sección 5.6).';

create view api.team_match_value
with (security_invoker = true) as
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
union all select match_id, key, value from context_values where value is not null;
comment on view api.team_match_value is 'Valores base por partido de Boca y del rival (sufijo _against).';

-- -----------------------------------------------------------------------------
-- Tabla maestra de jugadores (Interfaz 3): una fila por jugador y ventana (cada competición
-- y 'todas'), con todas las estadísticas del catálogo en un objeto JSON {stat_id: valor}.
-- La web elige las columnas del conjunto activo. Por qué JSON y no una columna por
-- estadística: el catálogo cambia sin tocar la vista y la respuesta sigue siendo una fila.
-- -----------------------------------------------------------------------------
create view api.player_master
with (security_invoker = true) as
with window_match as (
  select match_id, competition_code as code from api.boca_match where status = 'jugado'
  union all
  select match_id, 'todas' from api.boca_match where status = 'jugado'
),
pmv as (
  select v.match_id, v.player_id, v.key, v.value, w.code
  from api.player_match_value v
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
covered as (
  -- Claves que alguna fuente publicó en la ventana: sin fila del jugador, su suma es 0.
  select distinct code, key from pmv
),
cat as (
  select * from core.stat_catalog where entity = 'player'
),
simple_value as (
  select p.player_id, p.code, c.stat_id,
         case c.rule when 'suma' then coalesce(b.total, 0) else b.average end as value
  from player_window p
  join cat c on c.rule in ('suma', 'promedio')
  join covered cv on cv.code = p.code and cv.key = c.arg1
  left join base b on b.player_id = p.player_id and b.code = p.code and b.key = c.arg1
),
composite_sum as (
  -- Suma sobre suma solo en los partidos que tienen los dos datos.
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
comment on view api.player_master is 'Tabla maestra de jugadores (9.1): ficha y todas las estadísticas del catálogo por ventana.';

-- -----------------------------------------------------------------------------
-- Tabla del equipo (Interfaz 2): una fila por partido con sus valores base y las métricas
-- propias del partido. La web agrupa por partido, rival, mes, competición o acumulado con las
-- mismas reglas del catálogo (son 48 filas: agrupar en el navegador es simple y rápido).
-- -----------------------------------------------------------------------------
create view api.team_match_master
with (security_invoker = true) as
with boca as (
  select team_id from core.team where is_boca limit 1
),
base as (
  select match_id, jsonb_object_agg(key, round(value, 4)) as stats
  from api.team_match_value
  group by match_id
),
metric as (
  select v.match_id, jsonb_object_agg(v.stat_id, round(v.value, 4)) as stats
  from core.stat_match_value v
  join boca on boca.team_id = v.entity_id
  where v.entity = 'team' and v.value is not null
  group by v.match_id
)
select bm.match_id, bm.match_date, bm.kickoff_at, bm.round_label, bm.competition_code,
       bm.competition_name, bm.opponent, bm.boca_home, bm.goals_for, bm.goals_against,
       case when bm.boca_home then m.penalties_home else m.penalties_away end as penalties_for,
       case when bm.boca_home then m.penalties_away else m.penalties_home end as penalties_against,
       r.name as referee, bm.venue,
       coalesce(base.stats, '{}'::jsonb) || coalesce(metric.stats, '{}'::jsonb) as stats
from api.boca_match bm
join core.match m on m.match_id = bm.match_id
left join core.referee r on r.referee_id = m.referee_id
left join base on base.match_id = bm.match_id
left join metric on metric.match_id = bm.match_id
where bm.status = 'jugado';
comment on view api.team_match_master is 'Partidos de Boca con valores base y métricas propias por partido (Interfaz 2).';

-- Métricas del equipo que solo existen por ventana (rachas, forma, Elo final, exponente).
create view api.team_window_value
with (security_invoker = true) as
select v.competition_code, v.stat_id, v.value, v.low, v.high, v.coverage
from core.stat_value v
join core.team t on t.team_id = v.entity_id and t.is_boca
where v.entity = 'team';
comment on view api.team_window_value is 'Métricas del equipo calculadas por ventana (competición o todas).';

grant select on api.player_match_value, api.team_match_value, api.player_master,
                api.team_match_master, api.team_window_value to anon, service_role;
