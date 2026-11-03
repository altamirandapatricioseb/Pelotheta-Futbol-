-- Elo calibrado con la liga 2026 (notebooks/02_calibracion.ipynb): K = 30 y V = 50 minimizan el
-- log-loss de la probabilidad pre-partido (1,0539 contra 1,0718 de K = 20 y V = 100, 404 partidos).
-- Versión nueva de cada parámetro: la anterior queda en la tabla y api.projection_param muestra la
-- vigente. El Elo publicado cambia en la próxima corrida del pipeline.
insert into core.projection_param (sport, param, value, version, valid_from, description_es)
select p.sport, p.param, n.new_value, p.version + 1, date '2026-11-02',
       coalesce(p.description_es, '') || ' Calibrado el 2-nov-2026 (notebooks/02_calibracion.ipynb).'
from (values ('ELO_K', 30::numeric), ('ELO_HOME_ADVANTAGE', 50::numeric)) as n(name, new_value)
join lateral (
  select * from core.projection_param p
  where p.sport = 'futbol' and p.param = n.name
  order by p.version desc limit 1
) p on true
on conflict (sport, param, version) do nothing;
