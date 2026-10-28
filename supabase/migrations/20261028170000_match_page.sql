-- Página de partido (pendiente de la etapa 6): alineación de Boca en cada partido, con el nombre,
-- el puesto, la camiseta y los minutos de entrada y salida. Solo datos públicos del plantel.

create view api.match_lineup
with (security_invoker = true) as
select l.match_id, l.player_id,
       coalesce(nullif(p.known_as, ''), p.full_name) as player_name,
       l.position, l.shirt_number, l.started, l.minute_in, l.minute_out
from core.lineup l
join core.team t on t.team_id = l.team_id and t.is_boca
join core.player p on p.player_id = l.player_id;
grant select on api.match_lineup to anon, service_role;
