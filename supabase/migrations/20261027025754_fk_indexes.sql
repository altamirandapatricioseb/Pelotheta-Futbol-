-- Índices para las claves foráneas que señaló el Performance Advisor.
-- Por qué: sin índice, cada join o borrado en cascada por estas columnas recorre la tabla
-- entera, y con anon limitado a 3 s eso terminaría en timeouts cuando haya datos.
create index event_team_idx on core.event (team_id);
create index event_related_player_idx on core.event (related_player_id);
create index lineup_team_idx on core.lineup (team_id);
create index match_referee_idx on core.match (referee_id);
