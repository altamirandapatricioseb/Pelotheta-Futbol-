-- Etapa 7: la serie partido a partido de los compuestos (cocientes, diferencias y adiciones)
-- usaba el id de la estadística como clave base y quedaba vacía. Ahora resuelve la clave base de
-- cada argumento en el catálogo, igual que core.player_master_mv. Arregla la desglosada (9.8) y
-- la línea partido a partido de Comparar (9.7) para esas estadísticas.

create or replace function api.stat_series(p_stat text, p_entity text, p_id integer default null)
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
