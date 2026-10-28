-- Etapa 6: posición del jugador en las conclusiones (la web las agrupa por posición).
drop view api.conclusion;
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
