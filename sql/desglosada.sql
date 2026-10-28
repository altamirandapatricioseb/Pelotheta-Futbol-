-- =============================================================================
-- Estadística desglosada (sección 9.8): serie partido a partido y ventanas de tiempo.
--
-- `api.stat_series(stat, entidad, id)` aplica la regla del catálogo partido por partido:
--   suma y promedio  -> el valor base `arg1` del partido;
--   cociente         -> arg1 / arg2 × factor (y devuelve numerador y denominador por separado);
--   diferencia/adición -> arg1 − arg2 o arg1 + arg2;
--   métrica/especial -> el valor guardado en core.stat_match_value (cálculo propio por partido).
-- Entidades: jugador (id = player_id), equipo (Boca), rival (id = team_id del rival: Boca contra
-- ese rival) y árbitro (id = referee_id: Boca con ese árbitro).
--
-- `api.stat_windows` resuelve las ventanas en SQL sobre esa serie, sin precalcular: las de días
-- se miden hacia atrás desde el último partido con dato, no desde hoy. Los compuestos se agregan
-- con suma sobre suma (nunca promedio de porcentajes).
-- =============================================================================
create function api.stat_series(p_stat text, p_entity text, p_id integer default null)
returns table (
  match_id integer, match_date date, competition_code text, competition_name text, opponent text,
  home boolean, result text, goals_for integer, goals_against integer, minutes numeric,
  num numeric, den numeric, value numeric
)
language sql
stable
security invoker
set search_path = ''
as $$
  with cat as (
    -- En los compuestos, arg1 y arg2 son estadísticas del catálogo: se usa su clave base (como en
    -- core.player_master_mv), no el id de la estadística.
    select c.rule, c.factor,
           case when c.rule in ('cociente', 'diferencia', 'adicion') then coalesce(k1.arg1, c.arg1) else c.arg1 end
             as arg1,
           case when c.rule in ('cociente', 'diferencia', 'adicion') then coalesce(k2.arg1, c.arg2) else c.arg2 end
             as arg2
    from api.stat_catalog c
    left join api.stat_catalog k1 on k1.entity = c.entity and k1.stat_id = c.arg1 and k1.rule in ('suma', 'promedio')
    left join api.stat_catalog k2 on k2.entity = c.entity and k2.stat_id = c.arg2 and k2.rule in ('suma', 'promedio')
    where c.stat_id = p_stat and c.entity = case when p_entity = 'jugador' then 'player' else 'team' end
  ),
  games as (
    select b.match_id, b.match_date, b.competition_code, b.competition_name, b.opponent, b.home, b.result,
           b.gf, b.ga, m.referee_id, b.opponent_id
    from core.situ_base b
    join core.match m on m.match_id = b.match_id
    where (p_entity <> 'rival' or b.opponent_id = p_id)
      and (p_entity <> 'arbitro' or m.referee_id = p_id)
  ),
  base as (
    -- Valores base del partido: del jugador o del equipo.
    select v.match_id,
           sum(v.value) filter (where v.key = cat.arg1) as a1,
           sum(v.value) filter (where v.key = cat.arg2) as a2,
           sum(v.value) filter (where v.key = 'minutes') as minutes
    from api.player_match_value v, cat
    where p_entity = 'jugador' and v.player_id = p_id and v.key in (cat.arg1, cat.arg2, 'minutes')
    group by v.match_id
    union all
    select v.match_id,
           sum(v.value) filter (where v.key = cat.arg1),
           sum(v.value) filter (where v.key = cat.arg2),
           null
    from api.team_match_value v, cat
    where p_entity <> 'jugador' and v.key in (cat.arg1, cat.arg2)
    group by v.match_id
  ),
  metric as (
    select s.match_id, s.value from core.stat_match_value s
    where s.stat_id = p_stat
      and s.entity = case when p_entity = 'jugador' then 'player' else 'team' end
      and (p_entity <> 'jugador' or s.entity_id = p_id)
  )
  select g.match_id, g.match_date, g.competition_code, g.competition_name, g.opponent, g.home, g.result,
         g.gf::int, g.ga::int, b.minutes,
         case when cat.rule = 'cociente' then b.a1 end,
         case when cat.rule = 'cociente' then b.a2 end,
         case cat.rule
           when 'suma' then b.a1
           when 'promedio' then b.a1
           when 'cociente' then case when b.a2 > 0 then b.a1 / b.a2 * cat.factor end
           when 'diferencia' then b.a1 - b.a2
           when 'adicion' then b.a1 + b.a2
           when 'metrica' then mt.value
           when 'especial' then mt.value
         end
  from games g
  cross join cat
  left join base b on b.match_id = g.match_id
  left join metric mt on mt.match_id = g.match_id
  where p_entity <> 'jugador' or b.match_id is not null
  order by g.match_date
$$;

create function api.stat_windows(p_stat text, p_entity text, p_id integer default null)
returns table (
  window_key text, label text, sort_order integer, n integer, value numeric, total numeric,
  best numeric, worst numeric, season numeric, delta numeric
)
language sql
stable
security invoker
set search_path = ''
as $$
  with cat as (
    select rule, factor, higher_is_better from api.stat_catalog
    where stat_id = p_stat and entity = case when p_entity = 'jugador' then 'player' else 'team' end
  ),
  s as (
    select x.*, row_number() over (order by x.match_date desc) as rn
    from api.stat_series(p_stat, p_entity, p_id) x
    where x.value is not null
  ),
  last as (select max(match_date) as d from s),
  w as (
    -- Una fila por (ventana, partido). El orden fija cómo se muestran.
    select 'u1' as window_key, 'Último partido' as label, 1 as sort_order, s.* from s where rn = 1
    union all select 'u3', 'Últimos 3 partidos', 2, s.* from s where rn <= 3
    union all select 'u5', 'Últimos 5 partidos', 3, s.* from s where rn <= 5
    union all select 'u10', 'Últimos 10 partidos', 4, s.* from s where rn <= 10
    union all select 'd' || d.days, 'Últimos ' || d.days || ' días', 4 + d.o::int, s.*
      from s, last, unnest(array[7, 14, 30, 60, 90]) with ordinality d (days, o)
      where s.match_date > last.d - d.days
    union all select 'mes', 'Mes en curso', 10, s.* from s, last
      where date_trunc('month', s.match_date) = date_trunc('month', last.d)
    union all select 'mes_anterior', 'Mes anterior', 11, s.* from s, last
      where date_trunc('month', s.match_date) = date_trunc('month', last.d) - interval '1 month'
    union all select 'temporada', 'Temporada', 12, s.* from s
    union all select 'comp:' || s.competition_code, s.competition_name, 20, s.* from s
    union all select case when s.home then 'local' else 'visitante' end,
                     case when s.home then 'Local' else 'Visitante' end, case when s.home then 30 else 31 end, s.* from s
    union all select 'res:' || s.result,
                     case s.result when 'G' then 'En victorias' when 'E' then 'En empates' else 'En derrotas' end,
                     case s.result when 'G' then 40 when 'E' then 41 else 42 end, s.* from s
    union all select 'rival:' || s.opponent, s.opponent, 50, s.* from s
  ),
  agg as (
    select w.window_key, w.label, w.sort_order, count(*)::int as n,
           case when cat.rule = 'cociente' then sum(w.num) / nullif(sum(w.den), 0) * cat.factor
                else avg(w.value) end as value,
           case when cat.rule in ('suma', 'diferencia', 'adicion') then sum(w.value) end as total,
           case when cat.higher_is_better then max(w.value) else min(w.value) end as best,
           case when cat.higher_is_better then min(w.value) else max(w.value) end as worst
    from w cross join cat
    group by w.window_key, w.label, w.sort_order, cat.rule, cat.factor, cat.higher_is_better
  )
  select a.window_key, a.label, a.sort_order, a.n, a.value, a.total, a.best, a.worst, t.value,
         a.value - t.value
  from agg a
  cross join (select value from agg where window_key = 'temporada') t
  -- Por rival solo con 2 o más partidos contra el mismo.
  where not (a.window_key like 'rival:%' and a.n < 2)
  order by a.sort_order, a.label
$$;

grant execute on function api.stat_series(text, text, integer) to anon, service_role;
grant execute on function api.stat_windows(text, text, integer) to anon, service_role;
