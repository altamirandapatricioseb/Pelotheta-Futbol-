-- Posición en las vistas de modelos con la misma regla que player_master: la última del plantel
-- y, si no está en ningún plantel, la que trajo la fuente (`position_raw`).
-- Antes, un jugador que dejó el club (Ander Herrera) quedaba sin posición y el selector de
-- Alternativas mostraba «Herrera (n/d)». Mismas columnas y en el mismo orden: `create or replace` alcanza.

create or replace view api.market_value_prediction with (security_invoker = true) as
select m.team_slug, m.player_id, coalesce(p.known_as, p.full_name) as player_name, coalesce(s.position_group, p.position_raw) as position_group,
       m.actual_eur, m.predicted_eur, m.low_eur, m.high_eur, m.residual_pct, m.features
from core.market_value_prediction m
join core.player p using (player_id)
left join lateral (
  select sm.position_group from core.squad_member sm
  where sm.player_id = m.player_id and sm.position_group is not null
  order by sm.season_year desc limit 1
) s on true;

create or replace view api.player_style with (security_invoker = true) as
select st.team_slug, st.player_id, coalesce(p.known_as, p.full_name) as player_name, coalesce(s.position_group, p.position_raw) as position_group,
       st.cluster, st.cluster_label, st.pc1, st.pc2, st.features, st.z, st.percentiles
from core.player_style st
join core.player p using (player_id)
left join lateral (
  select sm.position_group from core.squad_member sm
  where sm.player_id = st.player_id and sm.position_group is not null
  order by sm.season_year desc limit 1
) s on true;
