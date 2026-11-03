# Diccionario de datos

Generado por `scripts/diccionario.py` desde la especificación de la API y el catálogo
de estadísticas.
43 vistas del esquema `api` y 344 estadísticas. Las vistas no declaran nulabilidad: toda columna puede venir vacía (n/d). Las tablas
privadas de `core` están en `docs/diagramas/der.md` y sus reglas en `data/contracts.yml`.

## Vistas del esquema `api`

### `boca_absence`

Bajas por partido: de Boca con el jugador, de los rivales solo el motivo.

| Columna | Tipo | Nota |
|---|---|---|
| `match_id` | int32 | Clave primaria. |
| `match_date` | date |  |
| `competition_code` | text |  |
| `opponent` | text |  |
| `boca_absence` | boolean |  |
| `player_id` | int32 |  |
| `player_name` | text |  |
| `reason` | text |  |
| `source` | text |  |

### `boca_competition_metric`

Métricas de Boca por competición con el promedio y el puesto (ScoutingStats): PPDA, Field Tilt, goles evitados y más.

| Columna | Tipo | Nota |
|---|---|---|
| `source` | text | Clave primaria. |
| `season` | int32 | Clave primaria. |
| `competition` | text | Clave primaria. |
| `metric` | text | Clave primaria. |
| `value` | numeric |  |
| `comp_average` | numeric |  |
| `rank` | int32 |  |
| `n_teams` | int32 |  |

### `boca_formation`

Dibujo táctico de Boca y del rival en cada partido.

| Columna | Tipo | Nota |
|---|---|---|
| `match_id` | int32 | Clave primaria. |
| `match_date` | date |  |
| `competition_code` | text |  |
| `opponent` | text |  |
| `boca_formation` | text |  |
| `opponent_formation` | text |  |
| `source` | text |  |

### `boca_match`

Partidos de Boca con rival, goles a favor y en contra y competición.

| Columna | Tipo | Nota |
|---|---|---|
| `match_id` | int32 | Clave primaria. |
| `match_date` | date |  |
| `kickoff_at` | timestamp with time zone |  |
| `round_label` | text |  |
| `competition_code` | text |  |
| `competition_name` | text |  |
| `season_year` | int32 |  |
| `boca_home` | boolean |  |
| `opponent` | text |  |
| `goals_for` | int32 |  |
| `goals_against` | int32 |  |
| `status` | text |  |
| `venue` | text |  |

### `boca_momentum`

Dominio por minuto: positivo cuando domina Boca, negativo cuando domina el rival.

| Columna | Tipo | Nota |
|---|---|---|
| `match_id` | int32 | Clave primaria. |
| `match_date` | date |  |
| `competition_code` | text |  |
| `opponent` | text |  |
| `minute` | int32 |  |
| `boca_value` | numeric |  |
| `source` | text |  |

### `boca_penalty`

Penales de los partidos de Boca: convertidos, atajados o errados (StrikerAPI, liga).

| Columna | Tipo | Nota |
|---|---|---|
| `match_id` | int32 | Clave primaria. |
| `match_date` | date |  |
| `competition_code` | text |  |
| `opponent` | text |  |
| `boca_shot` | boolean |  |
| `player_id` | int32 |  |
| `player_name` | text |  |
| `minute` | int32 |  |
| `outcome` | text |  |
| `source` | text |  |

### `boca_shot`

Tiros ubicados de los partidos de Boca (a favor y en contra) para el mapa de tiros.

| Columna | Tipo | Nota |
|---|---|---|
| `shot_id` | int64 | Clave primaria. |
| `match_id` | int32 | Clave primaria. |
| `match_date` | date |  |
| `competition_code` | text |  |
| `opponent` | text |  |
| `boca_shot` | boolean |  |
| `player_id` | int32 |  |
| `player_name` | text |  |
| `minute` | int32 |  |
| `outcome` | text |  |
| `body_part` | text |  |
| `penalty` | boolean |  |
| `zone` | text |  |
| `xg` | numeric |  |
| `x` | numeric |  |
| `y` | numeric |  |
| `end_x` | numeric |  |
| `end_y` | numeric |  |
| `source` | text |  |

### `boca_weather`

Clima a la hora del partido (Open-Meteo) junto al resultado de Boca.

| Columna | Tipo | Nota |
|---|---|---|
| `match_id` | int32 | Clave primaria. |
| `match_date` | date |  |
| `competition_code` | text |  |
| `opponent` | text |  |
| `boca_home` | boolean |  |
| `goals_for` | int32 |  |
| `goals_against` | int32 |  |
| `points` | int32 |  |
| `temperature_c` | numeric |  |
| `precipitation_mm` | numeric |  |
| `wind_kmh` | numeric |  |
| `humidity_pct` | numeric |  |
| `place` | text |  |
| `source` | text |  |

### `chart_catalog`

Sin descripción.

| Columna | Tipo | Nota |
|---|---|---|
| `chart_id` | text | Clave primaria. |
| `category` | text |  |
| `title_es` | text |  |
| `chart_type` | text |  |
| `required_data` | text |  |
| `origin_ref` | text |  |
| `powerbi` | text |  |
| `excel` | text |  |
| `available` | boolean |  |
| `reason_es` | text |  |
| `sort_order` | int32 |  |

### `chart_source_map`

Sin descripción.

| Columna | Tipo | Nota |
|---|---|---|
| `chart_id` | text | Clave primaria. This is a Foreign Key to `chart_catalog.chart_id`.<fk table='chart_catalog' column='chart_id'/> |
| `target_type` | text | Clave primaria. |
| `target_ref` | text | Clave primaria. |
| `params` | text | Clave primaria. |
| `label_es` | text |  |

### `club_rating`

Sin descripción.

| Columna | Tipo | Nota |
|---|---|---|
| `source` | text | Clave primaria. |
| `as_of` | date | Clave primaria. |
| `team_name` | text | Clave primaria. |
| `rank` | int32 |  |
| `elo` | numeric |  |

### `club_season_stat`

Sin descripción.

| Columna | Tipo | Nota |
|---|---|---|
| `source` | text | Clave primaria. |
| `season` | int32 | Clave primaria. |
| `team_name` | text | Clave primaria. |
| `stat_key` | text | Clave primaria. |
| `value` | numeric |  |

### `competition_filter`

Sin descripción.

| Columna | Tipo | Nota |
|---|---|---|
| `code` | text |  |
| `name_es` | text |  |
| `sort_order` | int32 |  |
| `matches` | int32 |  |

### `conclusion`

Sin descripción.

| Columna | Tipo | Nota |
|---|---|---|
| `rule_id` | text | Clave primaria. |
| `entity_id` | int32 |  |
| `player_name` | text |  |
| `area` | text |  |
| `title_es` | text |  |
| `kind` | text |  |
| `scope` | text |  |
| `unit` | text |  |
| `link` | text |  |
| `sort_order` | int32 |  |
| `band` | text |  |
| `value` | numeric |  |
| `reference` | numeric |  |
| `percentile` | numeric |  |
| `n` | numeric |  |
| `computed_at` | timestamp with time zone |  |
| `tone` | text |  |
| `text_es` | text |  |
| `player_position` | text |  |

### `data_quality`

Último resultado de cada chequeo de calidad de datos (16.1): filas que fallan y revisadas.

| Columna | Tipo | Nota |
|---|---|---|
| `check_id` | text | Clave primaria. |
| `table_name` | text |  |
| `check_type` | text |  |
| `description_es` | text |  |
| `failing` | int64 |  |
| `total` | int64 |  |
| `checked_at` | timestamp with time zone |  |

### `league_absences`

Lesionados y suspendidos por equipo en la Liga Profesional (conteos, sin nombres).

| Columna | Tipo | Nota |
|---|---|---|
| `team` | text |  |
| `season` | int32 |  |
| `injured` | int32 |  |
| `suspended` | int32 |  |
| `games` | int32 |  |

### `league_leader`

Sin descripción.

| Columna | Tipo | Nota |
|---|---|---|
| `source` | text | Clave primaria. |
| `season` | int32 | Clave primaria. |
| `stat` | text | Clave primaria. |
| `rank` | int32 | Clave primaria. |
| `player_name` | text | Clave primaria. |
| `team_name` | text |  |
| `games` | int32 |  |
| `minutes` | int32 |  |
| `value` | numeric |  |
| `per90` | numeric |  |

### `league_result`

Sin descripción.

| Columna | Tipo | Nota |
|---|---|---|
| `source` | text |  |
| `season` | int32 |  |
| `stage` | text |  |
| `match_date` | date |  |
| `home_team` | text |  |
| `away_team` | text |  |
| `home_goals` | int32 |  |
| `away_goals` | int32 |  |
| `referee` | text |  |
| `yellow_home` | int32 |  |
| `yellow_away` | int32 |  |
| `red_home` | int32 |  |
| `red_away` | int32 |  |
| `fouls_home` | int32 |  |
| `fouls_away` | int32 |  |
| `injured_home` | int32 |  |
| `injured_away` | int32 |  |
| `suspended_home` | int32 |  |
| `suspended_away` | int32 |  |

### `league_standing`

Sin descripción.

| Columna | Tipo | Nota |
|---|---|---|
| `source` | text | Clave primaria. |
| `season` | int32 | Clave primaria. |
| `table_name` | text | Clave primaria. |
| `rank` | int32 |  |
| `team_name` | text | Clave primaria. |
| `played` | int32 |  |
| `won` | int32 |  |
| `drawn` | int32 |  |
| `lost` | int32 |  |
| `goals_for` | int32 |  |
| `goals_against` | int32 |  |
| `points` | int32 |  |
| `average` | numeric |  |

### `match_context`

DT de Boca y del rival y estadio con su capacidad, por partido (ELNINE).

| Columna | Tipo | Nota |
|---|---|---|
| `match_id` | int32 | Clave primaria. This is a Foreign Key to `boca_absence.match_id`.<fk table='boca_absence' column='match_id'/> |
| `boca_coach` | text |  |
| `rival_coach` | text |  |
| `stadium` | text |  |
| `stadium_capacity` | int32 |  |
| `source` | text |  |

### `match_lineup`

Sin descripción.

| Columna | Tipo | Nota |
|---|---|---|
| `match_id` | int32 | Clave primaria. This is a Foreign Key to `boca_absence.match_id`.<fk table='boca_absence' column='match_id'/> |
| `player_id` | int32 | Clave primaria. |
| `player_name` | text |  |
| `position` | text |  |
| `shirt_number` | int32 |  |
| `started` | boolean |  |
| `minute_in` | int32 |  |
| `minute_out` | int32 |  |

### `pipeline_run_metrics`

Una fila por corrida del pipeline: duración, partidos, filas cargadas, avisos, errores y tamaño de la base.

| Columna | Tipo | Nota |
|---|---|---|
| `run_id` | uuid | Clave primaria. |
| `started_at` | timestamp with time zone |  |
| `finished_at` | timestamp with time zone |  |
| `duration_s` | numeric |  |
| `status` | text |  |
| `matches` | int32 |  |
| `rows_loaded` | int64 |  |
| `warnings` | int32 |  |
| `errors` | int32 |  |
| `db_size_bytes` | int64 |  |
| `commit_sha` | text |  |

### `player_master`

Sin descripción.

| Columna | Tipo | Nota |
|---|---|---|
| `player_id` | int32 |  |
| `competition_code` | text |  |
| `full_name` | text |  |
| `known_as` | text |  |
| `position_group` | text |  |
| `shirt_number` | int32 |  |
| `age` | int32 |  |
| `height_cm` | int32 |  |
| `weight_kg` | numeric |  |
| `preferred_foot` | text |  |
| `nationality` | text |  |
| `matches` | int32 |  |
| `minutes` | int32 |  |
| `stats` | jsonb |  |

### `player_match_value`

Sin descripción.

| Columna | Tipo | Nota |
|---|---|---|
| `match_id` | int32 |  |
| `player_id` | int32 |  |
| `key` | text |  |
| `value` | numeric |  |

### `player_position`

Sin descripción.

| Columna | Tipo | Nota |
|---|---|---|
| `player_id` | int32 |  |
| `position_raw` | text |  |
| `zone` | text |  |
| `lane` | text |  |
| `role` | text |  |
| `starts` | int64 |  |
| `games` | int64 |  |
| `detail_level` | text |  |

### `player_profile`

Sin descripción.

| Columna | Tipo | Nota |
|---|---|---|
| `player_id` | int32 | Clave primaria. |
| `full_name` | text |  |
| `nationality` | text |  |
| `weight_kg` | numeric |  |
| `youth_club` | text |  |
| `academy` | boolean |  |
| `national_team` | text |  |
| `source` | text |  |
| `preferred_foot` | text |  |

### `player_shot_totals`

Tiros, xG, npxG y goles por tipo de cada jugador de Boca (StrikerAPI).

| Columna | Tipo | Nota |
|---|---|---|
| `player_id` | int32 |  |
| `competition_code` | text |  |
| `shots` | int32 |  |
| `xg` | numeric |  |
| `npxg` | numeric |  |
| `goals` | int32 |  |
| `headers` | int32 |  |
| `header_goals` | int32 |  |
| `shots_outside_box` | int32 |  |
| `goals_outside_box` | int32 |  |
| `shots_blocked` | int32 |  |
| `source` | text |  |

### `player_stat_totals`

Estadísticas avanzadas por jugador de Boca: total, promedio por partido y partidos con dato.

| Columna | Tipo | Nota |
|---|---|---|
| `player_id` | int32 |  |
| `competition_code` | text |  |
| `stat_key` | text |  |
| `matches` | int32 |  |
| `total` | numeric |  |
| `average` | numeric |  |
| `source` | text |  |

### `player_summary`

Resumen por jugador: PJ, titular, minutos, goles, asistencias, G+A y tarjetas, por competición y total.

| Columna | Tipo | Nota |
|---|---|---|
| `player_id` | int32 |  |
| `full_name` | text |  |
| `known_as` | text |  |
| `position_group` | text |  |
| `shirt_number` | int32 |  |
| `age` | int32 |  |
| `height_cm` | int32 |  |
| `competition_code` | text |  |
| `competition_name` | text |  |
| `matches` | int32 |  |
| `starts` | int32 |  |
| `minutes` | int32 |  |
| `goals` | int32 |  |
| `assists` | int32 |  |
| `goal_contributions` | int32 |  |
| `yellow_cards` | int32 |  |
| `red_cards` | int32 |  |

### `projection_param`

Sin descripción.

| Columna | Tipo | Nota |
|---|---|---|
| `sport` | text | Clave primaria. |
| `param` | text | Clave primaria. |
| `value` | numeric |  |
| `version` | int32 | Clave primaria. |
| `valid_from` | date |  |
| `description_es` | text |  |

### `referee_stats`

Árbitros de la Liga Profesional: tarjetas, faltas y resultados de los partidos que dirigieron.

| Columna | Tipo | Nota |
|---|---|---|
| `referee` | text |  |
| `season` | int32 |  |
| `games` | int32 |  |
| `yellow_per_game` | numeric |  |
| `red_per_game` | numeric |  |
| `fouls_per_game` | numeric |  |
| `home_win_pct` | numeric |  |
| `yellow_home_minus_away` | numeric |  |

### `situational_catalog`

Sin descripción.

| Columna | Tipo | Nota |
|---|---|---|
| `card_id` | text | Clave primaria. |
| `category` | text |  |
| `title_es` | text |  |
| `condition_es` | text |  |
| `params_es` | text |  |
| `measured_es` | text |  |
| `required_data` | text |  |
| `level` | text |  |
| `available` | boolean |  |
| `estimated` | boolean |  |
| `reason_es` | text |  |
| `sort_order` | int32 |  |
| `main_metric` | text |  |
| `extra_metrics` | text |  |

### `situational_match`

Sin descripción.

| Columna | Tipo | Nota |
|---|---|---|
| `card_id` | text | Clave primaria. |
| `param_value` | text | Clave primaria. |
| `match_id` | int32 | Clave primaria. This is a Foreign Key to `boca_absence.match_id`.<fk table='boca_absence' column='match_id'/> |
| `match_date` | date |  |
| `competition_name` | text |  |
| `opponent` | text |  |
| `home` | boolean |  |
| `goals_for` | int32 |  |
| `goals_against` | int32 |  |
| `result` | text |  |

### `situational_result`

Sin descripción.

| Columna | Tipo | Nota |
|---|---|---|
| `card_id` | text | Clave primaria. |
| `param_value` | text | Clave primaria. |
| `param_order` | int32 |  |
| `n` | int32 |  |
| `w` | int32 |  |
| `d` | int32 |  |
| `l` | int32 |  |
| `win_pct` | numeric |  |
| `ppg` | numeric |  |
| `goal_diff` | numeric |  |
| `base_win_pct` | numeric |  |
| `delta` | numeric |  |
| `computed_at` | timestamp with time zone |  |
| `gf_avg` | numeric |  |
| `ga_avg` | numeric |  |
| `clean_pct` | numeric |  |
| `scored_pct` | numeric |  |
| `base_ppg` | numeric |  |
| `base_gf` | numeric |  |
| `base_ga` | numeric |  |
| `base_clean` | numeric |  |
| `stats` | jsonb |  |
| `base_stats` | jsonb |  |

### `source_status`

Estado de la última carga de cada fuente y fecha de la última carga exitosa.

| Columna | Tipo | Nota |
|---|---|---|
| `source` | text |  |
| `last_status` | text |  |
| `last_run_at` | timestamp with time zone |  |
| `last_success_at` | timestamp with time zone |  |

### `stat_catalog`

Catálogo de estadísticas (sección 5): descripción, nivel A/B/C y regla de cálculo.

| Columna | Tipo | Nota |
|---|---|---|
| `stat_id` | text | Clave primaria. |
| `entity` | text |  |
| `name_es` | text |  |
| `short_name` | text |  |
| `description_es` | text |  |
| `stat_group` | text |  |
| `category` | text |  |
| `unit` | text |  |
| `source` | text |  |
| `level` | text |  |
| `formula` | text |  |
| `higher_is_better` | boolean |  |
| `available` | boolean |  |
| `estimated` | boolean |  |
| `per90` | boolean |  |
| `rule` | text |  |
| `arg1` | text |  |
| `arg2` | text |  |
| `factor` | numeric |  |
| `reading_es` | text |  |
| `lines` | array |  |
| `key_stat` | boolean |  |

### `stat_match_value`

Sin descripción.

| Columna | Tipo | Nota |
|---|---|---|
| `entity` | text | Clave primaria. |
| `entity_id` | int32 | Clave primaria. |
| `match_id` | int32 | Clave primaria. This is a Foreign Key to `boca_absence.match_id`.<fk table='boca_absence' column='match_id'/> |
| `stat_id` | text | Clave primaria. This is a Foreign Key to `stat_catalog.stat_id`.<fk table='stat_catalog' column='stat_id'/> |
| `value` | numeric |  |
| `low` | numeric |  |
| `high` | numeric |  |

### `stat_set`

Conjuntos de columnas del desplegable de las Interfaces 2 y 3.

| Columna | Tipo | Nota |
|---|---|---|
| `set_id` | text | Clave primaria. |
| `entity` | text |  |
| `name_es` | text |  |
| `description_es` | text |  |
| `sort_order` | int32 |  |
| `stat_ids` | array |  |

### `stat_value_detail`

Sin descripción.

| Columna | Tipo | Nota |
|---|---|---|
| `player_id` | int32 |  |
| `stat_id` | text | Note: This is a Foreign Key to `stat_catalog.stat_id`.<fk table='stat_catalog' column='stat_id'/> |
| `value` | numeric |  |
| `detail` | jsonb |  |

### `system_status`

Estado público del sistema. Fila de prueba de la etapa 1.

| Columna | Tipo | Nota |
|---|---|---|
| `key` | text | Clave primaria. |
| `value` | text |  |
| `updated_at` | timestamp with time zone |  |

### `team_match_master`

Partidos de Boca con valores base y métricas propias por partido (Interfaz 2).

| Columna | Tipo | Nota |
|---|---|---|
| `match_id` | int32 | Clave primaria. |
| `match_date` | date |  |
| `kickoff_at` | timestamp with time zone |  |
| `round_label` | text |  |
| `competition_code` | text |  |
| `competition_name` | text |  |
| `opponent` | text |  |
| `boca_home` | boolean |  |
| `goals_for` | int32 |  |
| `goals_against` | int32 |  |
| `penalties_for` | int32 |  |
| `penalties_against` | int32 |  |
| `referee` | text |  |
| `venue` | text |  |
| `stats` | jsonb |  |

### `team_match_value`

Valores base por partido de Boca y del rival (sufijo _against).

| Columna | Tipo | Nota |
|---|---|---|
| `match_id` | int32 |  |
| `key` | text |  |
| `value` | numeric |  |

### `team_window_value`

Métricas del equipo calculadas por ventana (competición o todas).

| Columna | Tipo | Nota |
|---|---|---|
| `competition_code` | text |  |
| `stat_id` | text | Note: This is a Foreign Key to `stat_catalog.stat_id`.<fk table='stat_catalog' column='stat_id'/> |
| `value` | numeric |  |
| `low` | numeric |  |
| `high` | numeric |  |
| `coverage` | numeric |  |

## Estadísticas del catálogo

Nivel A: viene de una fuente. B: calculada desde datos crudos. C: sin dato (n/d). «Estimada»: el
cálculo usa un supuesto y la web lo marca.

| Id | Entidad | Nombre | Unidad | Fuente | Nivel | Estimada | Fórmula |
|---|---|---|---|---|---|---|---|
| `partidos` | jugador | Partidos jugados | partidos | promiedos | B | no | Partidos con minuto de entrada registrado |
| `titularidades` | jugador | Titularidades | partidos | promiedos | B | no | Partidos con titular = sí |
| `convocado_suplente` | jugador | Partidos en el banco | partidos | promiedos | B | no | Partidos en la lista de suplentes |
| `entradas_banco` | jugador | Entradas desde el banco | partidos | promiedos | B | no | Suplentes con minuto de entrada |
| `minutos` | jugador | Minutos jugados | minutos | promiedos | B | no | Σ (minuto de salida − minuto de entrada) |
| `minutos_por_partido` | jugador | Minutos por partido | minutos | promiedos | B | no | Minutos / Partidos jugados |
| `pct_minutos` | jugador | Porcentaje de minutos | % | promiedos | B | no | Minutos / (90 × partidos del equipo) × 100 |
| `partidos_completos` | jugador | Partidos completos | partidos | promiedos | B | no | Titular sin salida antes del final |
| `sustituido` | jugador | Veces sustituido | partidos | promiedos | B | no | Titular con minuto de salida por cambio |
| `capitan` | jugador | Partidos como capitán | partidos | promiedos | A | no | Suma por partido |
| `calificacion` | jugador | Calificación media | puntos | scoutingstats | A | no | Promedio de la nota de cada partido |
| `goles` | jugador | Goles | goles | promiedos | B | no | Eventos de gol del jugador |
| `asistencias` | jugador | Asistencias | asistencias | promiedos | B | no | Eventos de gol con el jugador como asistidor |
| `goles_asistencias` | jugador | Goles más asistencias | participaciones | promiedos | B | no | Goles + Asistencias |
| `goles_penal` | jugador | Goles de penal | goles | promiedos | B | no | Eventos de penal convertido |
| `penales_lanzados` | jugador | Penales lanzados | penales | promiedos|strikerapi | B | no | Penales convertidos + penales fallados |
| `penales_fallados` | jugador | Penales fallados | penales | promiedos|strikerapi | B | no | Penales lanzados − Goles de penal |
| `pct_penales` | jugador | Efectividad en penales | % | promiedos|strikerapi | B | no | Goles de penal / Penales lanzados × 100 |
| `autogoles` | jugador | Goles en contra | goles | promiedos | B | no | Eventos de gol en contra |
| `goles_anulados` | jugador | Goles anulados por el VAR | goles | promiedos | B | no | Eventos de gol anulado |
| `edad` | jugador | Edad | años | promiedos | B | no | Días desde el nacimiento / 365,25 |
| `altura` | jugador | Altura | cm | promiedos | A | no | Dato de la ficha |
| `peso` | jugador | Peso | kg | wikipedia | A | no | Dato de la ficha |
| `pie` | jugador | Pie hábil | texto | bzzoiro | A | no | Dato de la ficha |
| `nacionalidad` | jugador | Nacionalidad | texto | wikipedia | A | no | Dato de la ficha |
| `posicion` | jugador | Posición | texto | promiedos | A | no | Dato del plantel |
| `goles_sin_penal` | jugador | Goles sin penal | goles | promiedos | B | no | Goles − Goles de penal |
| `goles_cabeza` | jugador | Goles de cabeza | goles | strikerapi | A | no | Tiros de cabeza que fueron gol |
| `goles_fuera_area` | jugador | Goles desde fuera del área | goles | strikerapi | A | no | Tiros desde fuera del área que fueron gol |
| `remates` | jugador | Remates | remates | scoutingstats | A | no | Suma por partido |
| `remates_arco` | jugador | Remates al arco | remates | scoutingstats | A | no | Suma por partido |
| `remates_no_arco` | jugador | Remates desviados o bloqueados | remates | scoutingstats | B | no | Remates − Remates al arco |
| `remates_bloqueados` | jugador | Remates bloqueados | remates | statshub | A | no | Suma por partido |
| `pct_remates_arco` | jugador | Precisión de remate | % | scoutingstats | B | no | Remates al arco / Remates × 100 |
| `goles_por_remate` | jugador | Goles por remate | goles por remate | promiedos|scoutingstats | B | no | Goles / Remates |
| `goles_por_remate_arco` | jugador | Goles por remate al arco | goles por remate | promiedos|scoutingstats | B | no | Goles / Remates al arco |
| `remates_cabeza` | jugador | Remates de cabeza | remates | strikerapi | A | no | Tiros con la cabeza |
| `remates_fuera_area` | jugador | Remates desde fuera del área | remates | strikerapi | A | no | Tiros desde fuera del área |
| `xg` | jugador | Goles esperados | xG | scoutingstats|statshub | A | no | Suma por partido |
| `npxg` | jugador | Goles esperados sin penales | xG | scoutingstats|statshub | B | sí | xG − 0,76 × Penales lanzados |
| `xg_por_remate` | jugador | xG por remate | xG por remate | scoutingstats|statshub | B | no | xG / Remates |
| `goles_menos_xg` | jugador | Goles menos xG | goles | scoutingstats|statshub | B | no | Goles − xG |
| `npg_menos_npxg` | jugador | Goles sin penal menos npxG | goles | scoutingstats|statshub | B | sí | nPG − npxG |
| `xgot` | jugador | xG al arco | xG | bzzoiro | A | no | Suma por partido |
| `ocasiones_claras_falladas` | jugador | Ocasiones claras falladas | ocasiones | bzzoiro | A | no | Suma por partido |
| `remates_palo` | jugador | Remates al palo | remates | statshub | A | no | Suma por partido |
| `fueras_de_juego` | jugador | Fueras de juego | veces | strikerapi | A | no | Suma por partido |
| `faltas_recibidas` | jugador | Faltas recibidas | faltas | strikerapi | A | no | Suma por partido |
| `penales_provocados` | jugador | Penales provocados | penales | strikerapi | A | no | Suma por partido |
| `regates_exitosos` | jugador | Regates exitosos | regates | scoutingstats|statshub | A | no | Suma por partido |
| `regates_intentados` | jugador | Regates intentados | regates | bzzoiro | A | no | Suma por partido |
| `pct_regates` | jugador | Efectividad en regates | % | bzzoiro|statshub | B | no | Regates exitosos / Regates intentados × 100 |
| `toques` | jugador | Toques | toques | statshub | A | no | Suma por partido |
| `pases` | jugador | Pases intentados | pases | scoutingstats|statshub | A | no | Suma por partido |
| `pases_completos` | jugador | Pases completados | pases | statshub | A | no | Suma por partido |
| `pct_pases` | jugador | Precisión de pase | % | statshub | B | no | Pases completados / Pases intentados × 100 |
| `pases_clave` | jugador | Pases clave | pases | scoutingstats|statshub | A | no | Suma por partido |
| `ocasiones_claras_creadas` | jugador | Ocasiones claras creadas | ocasiones | statshub | A | no | Suma por partido |
| `ocasiones_creadas` | jugador | Ocasiones creadas | ocasiones | strikerapi | A | no | Suma por partido |
| `xa` | jugador | Asistencias esperadas | xA | statshub|bzzoiro | A | no | Suma por partido |
| `npxg_xa` | jugador | npxG más xA | xG | statshub|scoutingstats | B | sí | npxG + xA |
| `asistencias_menos_xa` | jugador | Asistencias menos xA | asistencias | promiedos|statshub | B | no | Asistencias − xA |
| `pases_largos` | jugador | Pases largos | pases | statshub | A | no | Suma por partido |
| `pases_largos_completos` | jugador | Pases largos completados | pases | statshub | A | no | Suma por partido |
| `pct_pases_largos` | jugador | Precisión de pase largo | % | statshub | B | no | Pases largos completados / Pases largos × 100 |
| `centros` | jugador | Centros | centros | statshub | A | no | Suma por partido |
| `centros_completos` | jugador | Centros completados | centros | statshub | A | no | Suma por partido |
| `pct_centros` | jugador | Precisión de centro | % | statshub | B | no | Centros completados / Centros × 100 |
| `pases_campo_rival` | jugador | Pases en campo rival | pases | bzzoiro | A | no | Suma por partido |
| `pases_campo_rival_completos` | jugador | Pases completados en campo rival | pases | bzzoiro | A | no | Suma por partido |
| `pct_pases_campo_rival` | jugador | Precisión en campo rival | % | bzzoiro | B | no | Pases completados en campo rival / Pases en campo rival × 100 |
| `perdidas` | jugador | Pérdidas de posesión | pérdidas | statshub | A | no | Suma por partido |
| `desposesiones` | jugador | Desposesiones | veces | statshub | A | no | Suma por partido |
| `malos_controles` | jugador | Malos controles | veces | bzzoiro | A | no | Suma por partido |
| `conducciones` | jugador | Conducciones | conducciones | bzzoiro | A | no | Suma por partido |
| `conducciones_progresivas` | jugador | Conducciones progresivas | conducciones | bzzoiro | A | no | Suma por partido |
| `distancia_conduccion` | jugador | Metros en conducción | metros | bzzoiro | A | no | Suma por partido |
| `progresion` | jugador | Metros de progresión | metros | bzzoiro | A | no | Suma por partido |
| `asistencias_centro` | jugador | Asistencias de centro | asistencias | strikerapi | A | no | Suma por partido |
| `asistencias_filtrado` | jugador | Asistencias con pase filtrado | asistencias | strikerapi | A | no | Suma por partido |
| `asistencias_cabeza` | jugador | Asistencias de cabeza | asistencias | strikerapi | A | no | Suma por partido |
| `asistencias_pase` | jugador | Asistencias con pase común | asistencias | strikerapi | A | no | Suma por partido |
| `pases_progresivos` | jugador | Pases progresivos | pases | ninguna | C | no |  |
| `pases_ultimo_tercio` | jugador | Pases al último tercio | pases | ninguna | C | no |  |
| `pases_clave_juego_abierto` | jugador | Pases clave de juego abierto | pases | ninguna | C | no |  |
| `entradas` | jugador | Entradas | entradas | scoutingstats|statshub | A | no | Suma por partido |
| `entradas_intentadas` | jugador | Entradas intentadas | entradas | bzzoiro | A | no | Suma por partido |
| `entradas_ganadas` | jugador | Entradas ganadas | entradas | bzzoiro | A | no | Suma por partido |
| `pct_entradas` | jugador | Efectividad en entradas | % | bzzoiro | B | no | Entradas ganadas / Entradas intentadas × 100 |
| `intercepciones` | jugador | Intercepciones | intercepciones | scoutingstats|statshub | A | no | Suma por partido |
| `despejes` | jugador | Despejes | despejes | statshub | A | no | Suma por partido |
| `despejes_linea` | jugador | Despejes sobre la línea | despejes | bzzoiro | A | no | Suma por partido |
| `bloqueos` | jugador | Bloqueos | bloqueos | bzzoiro | A | no | Suma por partido |
| `acciones_defensivas` | jugador | Acciones defensivas | acciones | scoutingstats|statshub | B | no | Entradas + Intercepciones |
| `recuperaciones` | jugador | Recuperaciones | recuperaciones | bzzoiro | A | no | Suma por partido |
| `duelos_ganados` | jugador | Duelos ganados | duelos | scoutingstats|statshub | A | no | Suma por partido |
| `duelos_perdidos` | jugador | Duelos perdidos | duelos | statshub | A | no | Suma por partido |
| `duelos_disputados` | jugador | Duelos disputados | duelos | statshub | B | no | Duelos ganados + Duelos perdidos |
| `pct_duelos` | jugador | Duelos ganados (%) | % | statshub | B | no | Duelos ganados / Duelos disputados × 100 |
| `aereos_ganados` | jugador | Duelos aéreos ganados | duelos | statshub | A | no | Suma por partido |
| `aereos_perdidos` | jugador | Duelos aéreos perdidos | duelos | bzzoiro | A | no | Suma por partido |
| `aereos_disputados` | jugador | Duelos aéreos disputados | duelos | statshub|bzzoiro | B | no | Aéreos ganados + Aéreos perdidos |
| `pct_aereos` | jugador | Duelos aéreos ganados (%) | % | statshub|bzzoiro | B | no | Aéreos ganados / Aéreos disputados × 100 |
| `veces_regateado` | jugador | Veces regateado | veces | statshub | A | no | Suma por partido |
| `entradas_ultimo_hombre` | jugador | Entradas de último hombre | entradas | bzzoiro | A | no | Suma por partido |
| `errores_remate` | jugador | Errores que terminan en remate | errores | bzzoiro | A | no | Suma por partido |
| `errores_gol` | jugador | Errores que terminan en gol | errores | bzzoiro | A | no | Suma por partido |
| `faltas_cometidas` | jugador | Faltas cometidas | faltas | strikerapi | A | no | Suma por partido |
| `presiones` | jugador | Presiones | presiones | ninguna | C | no |  |
| `presiones_exitosas` | jugador | Presiones exitosas | presiones | ninguna | C | no |  |
| `pct_presiones` | jugador | Presiones exitosas (%) | % | ninguna | C | no |  |
| `goles_recibidos` | jugador | Goles recibidos | goles | promiedos | B | no | Goles del rival entre la entrada y la salida |
| `vallas_invictas` | jugador | Vallas invictas | partidos | promiedos | B | no | Partidos completos con 0 goles en contra |
| `atajadas` | jugador | Atajadas | atajadas | strikerapi|scoutingstats | A | no | Suma por partido |
| `remates_arco_recibidos` | jugador | Remates al arco recibidos | remates | promiedos | A | no | Remates al arco del rival con el arquero en cancha |
| `pct_atajadas` | jugador | Porcentaje de atajadas | % | strikerapi|promiedos | B | no | Atajadas / Remates al arco recibidos × 100 |
| `xgot_recibido` | jugador | xG al arco recibido | xG | scoutingstats | A | no | xGOT del rival con el arquero en cancha |
| `goles_evitados` | jugador | Goles evitados | goles | scoutingstats|promiedos | B | no | xGOT recibido − Goles recibidos |
| `penales_enfrentados` | jugador | Penales enfrentados | penales | strikerapi | A | no | Penales del rival con el arquero en cancha |
| `penales_atajados` | jugador | Penales atajados | penales | strikerapi | A | no | Suma por partido |
| `centros_atrapados` | jugador | Centros atrapados | centros | bzzoiro | A | no | Suma por partido |
| `despejes_punos` | jugador | Despejes de puños | despejes | bzzoiro | A | no | Suma por partido |
| `salidas` | jugador | Salidas | salidas | bzzoiro | A | no | Suma por partido |
| `salidas_exitosas` | jugador | Salidas exitosas | salidas | bzzoiro | A | no | Suma por partido |
| `pct_salidas` | jugador | Salidas exitosas (%) | % | bzzoiro | B | no | Salidas exitosas / Salidas × 100 |
| `atajadas_dentro_area` | jugador | Atajadas de remates en el área | atajadas | bzzoiro | A | no | Suma por partido |
| `amarillas` | jugador | Tarjetas amarillas | tarjetas | promiedos | B | no | Eventos de amarilla |
| `rojas` | jugador | Expulsiones | tarjetas | promiedos | B | no | Eventos de roja o segunda amarilla |
| `penales_cometidos` | jugador | Penales cometidos | penales | strikerapi | A | no | Suma por partido |
| `manos` | jugador | Manos sancionadas | veces | strikerapi | A | no | Suma por partido |
| `partidos_suspendido` | jugador | Partidos por suspensión | partidos | promiedos | A | no | Bajas por suspensión en cada partido |
| `carga_7d` | jugador | Carga de 7 días | minutos | promiedos | B | no | Σ minutos en los últimos 7 días |
| `carga_14d` | jugador | Carga de 14 días | minutos | promiedos | B | no | Σ minutos en los últimos 14 días |
| `carga_28d` | jugador | Carga de 28 días | minutos | promiedos | B | no | Σ minutos en los últimos 28 días |
| `distancia_recorrida` | jugador | Distancia recorrida | km | ninguna | C | no |  |
| `sprints` | jugador | Sprints | sprints | ninguna | C | no |  |
| `goles_equipo_en_cancha` | jugador | Goles de Boca con él en cancha | goles | promiedos | B | no | Goles de Boca entre la entrada y la salida |
| `goles_contra_en_cancha` | jugador | Goles en contra con él en cancha | goles | promiedos | B | no | Goles del rival entre la entrada y la salida |
| `gf_en_cancha` | jugador | Goles a favor cada 90 en cancha | goles cada 90 | promiedos | B | no | Goles de Boca en cancha × 90 / Minutos |
| `gc_en_cancha` | jugador | Goles en contra cada 90 en cancha | goles cada 90 | promiedos | B | no | Goles en contra en cancha × 90 / Minutos |
| `nr` | jugador | Net Rating | goles cada 90 | promiedos | B | no | GF_on − GA_on |
| `nr_relativo` | jugador | Net Rating relativo | goles cada 90 | promiedos | B | no | NR − (GF_rep − GA_rep) |
| `nr_xg` | jugador | Net Rating con xG | xG cada 90 | strikerapi | B | no | xG_on − xGA_on |
| `ewa` | jugador | Expected Wins Added | victorias | promiedos | B | sí | (Min / 90) × [P(GF_on) − P(GF_rep)] |
| `ela` | jugador | Expected Losses Added | derrotas | promiedos | B | sí | (Min / 90) × [Q(GA_on) − Q(GA_rep)] |
| `participacion_goles` | jugador | Participación en goles | % | promiedos | B | no | G+A / Goles de Boca en cancha × 100 |
| `dependencia_goleador` | jugador | Dependencia del goleador | % | promiedos | B | no | G+A / Goles de Boca × 100 |
| `ga_como_suplente` | jugador | G+A entrando desde el banco | participaciones | promiedos | B | no | Suma por partido como suplente |
| `minutos_como_suplente` | jugador | Minutos entrando desde el banco | minutos | promiedos | B | no | Suma por partido como suplente |
| `ga_suplente_90` | jugador | Eficiencia como suplente | participaciones cada 90 | promiedos | B | no | G+A como suplente × 90 / Minutos como suplente |
| `racha_goles` | jugador | Racha goleadora | partidos | promiedos | B | no | Máximo de partidos consecutivos con gol |
| `racha_asistencias` | jugador | Racha de asistencias | partidos | promiedos | B | no | Máximo de partidos consecutivos con asistencia |
| `racha_vallas` | jugador | Racha de vallas invictas | partidos | promiedos | B | no | Máximo de partidos consecutivos con valla invicta |
| `consistencia_calificacion` | jugador | Consistencia de la calificación | puntos | scoutingstats | B | no | Desvío estándar de la nota por partido |
| `rendimiento_indice` | jugador | Índice de rendimiento | puntos | calculo propio | B | sí | Σ peso × componente (promedio de percentiles) |
| `rendimiento_cobertura` | jugador | Cobertura del índice | proporción | calculo propio | B | no | Σ pesos de los componentes con datos |
| `mejoria_alpha` | jugador | Mejoría α | puntos | calculo propio | B | sí | 50 + 16,7 × w × Z |
| `mejoria_beta` | jugador | Mejoría β | puntos | calculo propio | B | sí | R_reciente − R_anterior |
| `potencial_alpha` | jugador | Potencial α | percentil | calculo propio | B | sí | min(100, N + G × años × (1 + λ × M)) |
| `potencial_beta` | jugador | Potencial β | puntos | calculo propio | B | sí | min(100, 0,60 × R* + 0,25 × T + 0,15 × 100 × F_edad) |
| `eq_partidos` | equipo | Partidos jugados | partidos | promiedos | B | no | Partidos terminados |
| `eq_ganados` | equipo | Partidos ganados | partidos | promiedos | B | no | Goles a favor > goles en contra |
| `eq_empatados` | equipo | Partidos empatados | partidos | promiedos | B | no | Goles a favor = goles en contra |
| `eq_perdidos` | equipo | Partidos perdidos | partidos | promiedos | B | no | Goles a favor < goles en contra |
| `eq_pct_victorias` | equipo | Porcentaje de victorias | % | promiedos | B | no | PG / PJ × 100 |
| `eq_pct_empates` | equipo | Porcentaje de empates | % | promiedos | B | no | PE / PJ × 100 |
| `eq_pct_derrotas` | equipo | Porcentaje de derrotas | % | promiedos | B | no | PP / PJ × 100 |
| `eq_puntos` | equipo | Puntos | puntos | promiedos | B | no | 3 × PG + PE |
| `eq_puntos_por_partido` | equipo | Puntos por partido | puntos | promiedos | B | no | Puntos / PJ |
| `eq_goles_favor` | equipo | Goles a favor | goles | promiedos | B | no | Suma por partido |
| `eq_goles_contra` | equipo | Goles en contra | goles | promiedos | B | no | Suma por partido |
| `eq_diferencia_gol` | equipo | Diferencia de gol | goles | promiedos | B | no | GF − GC |
| `eq_vallas_invictas` | equipo | Vallas invictas | partidos | promiedos | B | no | Partidos con GC = 0 |
| `eq_pct_vallas` | equipo | Vallas invictas (%) | % | promiedos | B | no | Vallas invictas / PJ × 100 |
| `eq_sin_marcar` | equipo | Partidos sin marcar | partidos | promiedos | B | no | Partidos con GF = 0 |
| `eq_pct_sin_marcar` | equipo | Partidos sin marcar (%) | % | promiedos | B | no | Partidos sin marcar / PJ × 100 |
| `eq_goles_favor_ht` | equipo | Goles a favor en el primer tiempo | goles | promiedos | B | no | Marcador al descanso |
| `eq_goles_contra_ht` | equipo | Goles en contra en el primer tiempo | goles | promiedos | B | no | Marcador al descanso |
| `eq_goles_cabeza` | equipo | Goles de cabeza | goles | strikerapi | A | no | Suma por partido |
| `eq_goles_fuera_area` | equipo | Goles desde fuera del área | goles | strikerapi | A | no | Suma por partido |
| `eq_goles_area_chica` | equipo | Goles desde el área chica | goles | strikerapi | A | no | Suma por partido |
| `eq_goles_penal` | equipo | Goles de penal | goles | strikerapi | A | no | Suma por partido |
| `eq_goles_tiro_libre` | equipo | Goles de tiro libre | goles | strikerapi | A | no | Suma por partido |
| `eq_goles_corner` | equipo | Goles de córner | goles | strikerapi | A | no | Suma por partido |
| `eq_goles_pelota_parada` | equipo | Goles de pelota parada | goles | strikerapi | A | no | Suma por partido |
| `eq_goles_contraataque` | equipo | Goles de contraataque | goles | strikerapi | A | no | Suma por partido |
| `eq_goles_centro` | equipo | Goles después de un centro | goles | strikerapi | A | no | Suma por partido |
| `eq_goles_pie_izquierdo` | equipo | Goles de pie izquierdo | goles | strikerapi | A | no | Suma por partido |
| `eq_goles_pie_derecho` | equipo | Goles de pie derecho | goles | strikerapi | A | no | Suma por partido |
| `eq_pct_goles_cabeza` | equipo | Goles de cabeza (%) | % | strikerapi|promiedos | B | no | Goles de cabeza / GF × 100 |
| `eq_pct_goles_fuera_area` | equipo | Goles desde fuera del área (%) | % | strikerapi|promiedos | B | no | Goles desde fuera del área / GF × 100 |
| `eq_pct_goles_pelota_parada` | equipo | Goles de pelota parada (%) | % | strikerapi|promiedos | B | no | Goles de pelota parada / GF × 100 |
| `eq_autogoles_favor` | equipo | Goles en contra del rival | goles | promiedos | B | no | Eventos de gol en contra del rival |
| `eq_goles_anulados_favor` | equipo | Goles de Boca anulados por el VAR | goles | promiedos | B | no | Eventos de gol anulado de Boca |
| `eq_goles_anulados_contra` | equipo | Goles del rival anulados por el VAR | goles | promiedos | B | no | Eventos de gol anulado del rival |
| `eq_goles_cabeza_contra` | equipo | Goles de cabeza en contra | goles | strikerapi | A | no | Suma por partido |
| `eq_goles_fuera_area_contra` | equipo | Goles en contra desde fuera del área | goles | strikerapi | A | no | Suma por partido |
| `eq_goles_pelota_parada_contra` | equipo | Goles de pelota parada en contra | goles | strikerapi | A | no | Suma por partido |
| `eq_goles_contraataque_contra` | equipo | Goles de contraataque en contra | goles | strikerapi | A | no | Suma por partido |
| `eq_remates` | equipo | Remates | remates | promiedos | A | no | Suma por partido |
| `eq_remates_arco` | equipo | Remates al arco | remates | promiedos | A | no | Suma por partido |
| `eq_remates_afuera` | equipo | Remates desviados | remates | scoutingstats | A | no | Suma por partido |
| `eq_remates_bloqueados` | equipo | Remates bloqueados | remates | scoutingstats | A | no | Suma por partido |
| `eq_pct_remates_arco` | equipo | Precisión de remate | % | promiedos | B | no | Remates al arco / Remates × 100 |
| `eq_remates_dentro_area` | equipo | Remates dentro del área | remates | scoutingstats | A | no | Suma por partido |
| `eq_remates_fuera_area` | equipo | Remates fuera del área | remates | scoutingstats | A | no | Suma por partido |
| `eq_pct_remates_dentro` | equipo | Remates dentro del área (%) | % | scoutingstats|promiedos | B | no | Remates dentro del área / Remates × 100 |
| `eq_goles_por_remate` | equipo | Goles por remate | goles por remate | promiedos | B | no | GF / Remates |
| `eq_ocasiones_claras` | equipo | Ocasiones claras | ocasiones | scoutingstats | A | no | Suma por partido |
| `eq_ocasiones_claras_falladas` | equipo | Ocasiones claras falladas | ocasiones | scoutingstats | A | no | Suma por partido |
| `eq_ocasiones_claras_convertidas` | equipo | Ocasiones claras convertidas | ocasiones | scoutingstats | B | no | Ocasiones claras − Ocasiones claras falladas |
| `eq_conversion_ocasiones` | equipo | Conversión de ocasiones claras | % | scoutingstats | B | no | Ocasiones claras convertidas / Ocasiones claras × 100 |
| `eq_ocasiones_claras_contra` | equipo | Ocasiones claras concedidas | ocasiones | scoutingstats | A | no | Suma por partido |
| `eq_ataques` | equipo | Ataques | ataques | promiedos | A | no | Suma por partido |
| `eq_ataques_peligrosos` | equipo | Ataques peligrosos | ataques | scoutingstats | A | no | Suma por partido |
| `eq_pct_ataques_peligrosos` | equipo | Ataques peligrosos (%) | % | scoutingstats|promiedos | B | no | Ataques peligrosos / Ataques × 100 |
| `eq_ataques_peligrosos_partido` | equipo | Ataques peligrosos del partido | ataques | scoutingstats | B | no | Ataques peligrosos propios + del rival |
| `eq_dominio` | equipo | Dominio | % | scoutingstats | B | no | Ataques peligrosos propios / del partido × 100 |
| `eq_centros` | equipo | Centros | centros | scoutingstats | A | no | Suma por partido |
| `eq_centros_completos` | equipo | Centros completados | centros | scoutingstats | A | no | Suma por partido |
| `eq_pct_centros` | equipo | Precisión de centro | % | scoutingstats | B | no | Centros completados / Centros × 100 |
| `eq_regates` | equipo | Regates intentados | regates | scoutingstats | A | no | Suma por partido |
| `eq_regates_exitosos` | equipo | Regates exitosos | regates | scoutingstats | A | no | Suma por partido |
| `eq_pct_regates` | equipo | Efectividad en regates | % | scoutingstats | B | no | Regates exitosos / Regates intentados × 100 |
| `eq_pases_clave` | equipo | Pases clave | pases | scoutingstats | A | no | Suma por partido |
| `eq_fueras_juego` | equipo | Fueras de juego | veces | promiedos | A | no | Suma por partido |
| `eq_remates_contra` | equipo | Remates del rival | remates | promiedos | A | no | Suma por partido |
| `eq_remates_arco_contra` | equipo | Remates al arco del rival | remates | promiedos | A | no | Suma por partido |
| `eq_xg` | equipo | Goles esperados | xG | scoutingstats | A | no | Suma por partido |
| `eq_xg_contra` | equipo | Goles esperados en contra | xG | scoutingstats | A | no | Suma por partido |
| `eq_npxg` | equipo | xG sin penales | xG | scoutingstats | A | no | Suma por partido |
| `eq_npxg_contra` | equipo | xG sin penales en contra | xG | scoutingstats | A | no | Suma por partido |
| `eq_xg_diferencia` | equipo | Diferencia de xG | xG | scoutingstats | B | no | xG − xGA |
| `eq_goles_menos_xg` | equipo | Goles menos xG | goles | scoutingstats|promiedos | B | no | GF − xG |
| `eq_goles_contra_menos_xg_contra` | equipo | Goles en contra menos xGA | goles | scoutingstats|promiedos | B | no | GC − xGA |
| `eq_xg_por_remate` | equipo | xG por remate | xG por remate | scoutingstats|promiedos | B | no | xG / Remates |
| `eq_xg_jugada` | equipo | xG de jugada | xG | scoutingstats | A | no | Suma por partido |
| `eq_xg_pelota_parada` | equipo | xG de pelota parada | xG | scoutingstats | A | no | Suma por partido |
| `eq_xg_pelota_parada_contra` | equipo | xG de pelota parada en contra | xG | scoutingstats | A | no | Suma por partido |
| `eq_pct_xg_pelota_parada` | equipo | xG de pelota parada (%) | % | scoutingstats | B | no | xG de pelota parada / xG × 100 |
| `eq_xgot` | equipo | xG al arco | xG | scoutingstats | A | no | Suma por partido |
| `eq_xgot_contra` | equipo | xG al arco en contra | xG | scoutingstats | A | no | Suma por partido |
| `eq_calidad_definicion` | equipo | Calidad de definición | xG | scoutingstats | B | no | xGOT − xG |
| `eq_goles_evitados` | equipo | Goles evitados | goles | scoutingstats|promiedos | B | no | xGOT en contra − GC |
| `eq_xpts_fuente` | equipo | Puntos esperados de la fuente | puntos | scoutingstats | A | no | Suma por partido |
| `eq_xpts` | equipo | Puntos esperados | puntos | calculo propio | B | sí | 3 × P(gana) + P(empata) |
| `eq_puntos_menos_xpts` | equipo | Puntos menos xPts | puntos | calculo propio | B | sí | Puntos − xPts |
| `eq_puntos_pitagoricos` | equipo | Puntos pitagóricos | puntos | calculo propio | B | sí | 3 × PJ × GF^x / (GF^x + GC^x) |
| `eq_posesion` | equipo | Posesión | % | promiedos | A | no | Promedio por partido |
| `eq_pases` | equipo | Pases intentados | pases | scoutingstats | A | no | Suma por partido |
| `eq_pases_completos` | equipo | Pases completados | pases | scoutingstats | A | no | Suma por partido |
| `eq_pct_pases` | equipo | Precisión de pase | % | scoutingstats | B | no | Pases completados / Pases × 100 |
| `eq_pases_largos` | equipo | Pases largos | pases | scoutingstats | A | no | Suma por partido |
| `eq_pases_largos_completos` | equipo | Pases largos completados | pases | scoutingstats | A | no | Suma por partido |
| `eq_pct_pases_largos` | equipo | Precisión de pase largo | % | scoutingstats | B | no | Pases largos completados / Pases largos × 100 |
| `eq_verticalidad` | equipo | Verticalidad | % | scoutingstats | B | no | Pases largos / Pases × 100 |
| `eq_pases_contra` | equipo | Pases del rival | pases | scoutingstats | A | no | Suma por partido |
| `eq_perdidas` | equipo | Pérdidas de posesión | pérdidas | statshub | A | no | Suma de los jugadores |
| `eq_recuperaciones` | equipo | Recuperaciones | recuperaciones | bzzoiro | A | no | Suma de los jugadores |
| `eq_conducciones` | equipo | Conducciones | conducciones | bzzoiro | A | no | Suma de los jugadores |
| `eq_acciones_ppda` | equipo | Acciones defensivas del PPDA | acciones | scoutingstats|promiedos | B | no | Entradas + Intercepciones + Faltas |
| `eq_ppda` | equipo | PPDA | pases por acción | scoutingstats|promiedos | B | sí | Pases del rival / (Entradas + Intercepciones + Faltas) |
| `eq_pases_progresivos` | equipo | Pases progresivos | pases | ninguna | C | no |  |
| `eq_pases_ultimo_tercio` | equipo | Pases al último tercio | pases | ninguna | C | no |  |
| `eq_field_tilt` | equipo | Field Tilt | % | ninguna | C | no |  |
| `eq_entradas` | equipo | Entradas | entradas | scoutingstats | A | no | Suma por partido |
| `eq_entradas_ganadas` | equipo | Entradas ganadas | entradas | strikerapi | A | no | Suma por partido |
| `eq_intercepciones` | equipo | Intercepciones | intercepciones | scoutingstats | A | no | Suma por partido |
| `eq_despejes` | equipo | Despejes | despejes | strikerapi | A | no | Suma por partido |
| `eq_duelos_ganados` | equipo | Duelos ganados | duelos | scoutingstats | A | no | Suma por partido |
| `eq_aereos_ganados` | equipo | Duelos aéreos ganados | duelos | statshub | A | no | Suma de los jugadores |
| `eq_acciones_defensivas` | equipo | Acciones defensivas | acciones | scoutingstats | B | no | Entradas + Intercepciones |
| `eq_bloqueos` | equipo | Bloqueos | bloqueos | scoutingstats | A | no | Remates bloqueados del rival |
| `eq_atajadas` | equipo | Atajadas | atajadas | scoutingstats | A | no | Suma por partido |
| `eq_faltas` | equipo | Faltas cometidas | faltas | promiedos | A | no | Suma por partido |
| `eq_faltas_recibidas` | equipo | Faltas recibidas | faltas | promiedos | A | no | Suma por partido |
| `eq_presiones` | equipo | Presiones | presiones | ninguna | C | no |  |
| `eq_corners` | equipo | Córners a favor | córners | promiedos | A | no | Suma por partido |
| `eq_corners_contra` | equipo | Córners en contra | córners | promiedos | A | no | Suma por partido |
| `eq_tiros_libres` | equipo | Tiros libres a favor | tiros libres | promiedos | A | no | Suma por partido |
| `eq_penales_favor` | equipo | Penales a favor | penales | strikerapi | A | no | Suma por partido |
| `eq_penales_convertidos` | equipo | Penales convertidos | penales | strikerapi | A | no | Suma por partido |
| `eq_pct_penales` | equipo | Efectividad en penales | % | strikerapi | B | no | Penales convertidos / Penales a favor × 100 |
| `eq_penales_contra` | equipo | Penales en contra | penales | strikerapi | A | no | Suma por partido |
| `eq_penales_convertidos_contra` | equipo | Penales convertidos en contra | penales | strikerapi | A | no | Suma por partido |
| `eq_amarillas` | equipo | Tarjetas amarillas | tarjetas | promiedos | A | no | Suma por partido |
| `eq_rojas` | equipo | Expulsiones | tarjetas | promiedos | A | no | Suma por partido |
| `eq_amarillas_rival` | equipo | Amarillas del rival | tarjetas | promiedos | A | no | Suma por partido |
| `eq_rojas_rival` | equipo | Expulsiones del rival | tarjetas | promiedos | A | no | Suma por partido |
| `eq_arbitro` | equipo | Árbitro | texto | promiedos | A | no | Dato del partido |
| `eq_arbitro_amarillas` | equipo | Amarillas por partido del árbitro | tarjetas | promiedos | B | no | Amarillas de sus partidos / Partidos que dirigió |
| `eq_gf_00_15` | equipo | Goles a favor del minuto 0 al 15 | goles | promiedos | B | no | Goles con minuto entre 0 y 15 |
| `eq_gf_16_30` | equipo | Goles a favor del minuto 16 al 30 | goles | promiedos | B | no | Goles con minuto entre 16 y 30 |
| `eq_gf_31_45` | equipo | Goles a favor del minuto 31 al 45 | goles | promiedos | B | no | Goles con minuto entre 31 y 45+ |
| `eq_gf_46_60` | equipo | Goles a favor del minuto 46 al 60 | goles | promiedos | B | no | Goles con minuto entre 46 y 60 |
| `eq_gf_61_75` | equipo | Goles a favor del minuto 61 al 75 | goles | promiedos | B | no | Goles con minuto entre 61 y 75 |
| `eq_gf_76_90` | equipo | Goles a favor del minuto 76 al 90 | goles | promiedos | B | no | Goles con minuto entre 76 y 90+ |
| `eq_gc_00_15` | equipo | Goles en contra del minuto 0 al 15 | goles | promiedos | B | no | Goles con minuto entre 0 y 15 |
| `eq_gc_16_30` | equipo | Goles en contra del minuto 16 al 30 | goles | promiedos | B | no | Goles con minuto entre 16 y 30 |
| `eq_gc_31_45` | equipo | Goles en contra del minuto 31 al 45 | goles | promiedos | B | no | Goles con minuto entre 31 y 45+ |
| `eq_gc_46_60` | equipo | Goles en contra del minuto 46 al 60 | goles | promiedos | B | no | Goles con minuto entre 46 y 60 |
| `eq_gc_61_75` | equipo | Goles en contra del minuto 61 al 75 | goles | promiedos | B | no | Goles con minuto entre 61 y 75 |
| `eq_gc_76_90` | equipo | Goles en contra del minuto 76 al 90 | goles | promiedos | B | no | Goles con minuto entre 76 y 90+ |
| `eq_estadio` | equipo | Estadio | texto | promiedos | A | no | Dato del partido |
| `eq_ventaja_localia` | equipo | Ventaja de localía | puntos | promiedos | B | no | Pts/PJ de local − Pts/PJ de visitante |
| `eq_dias_descanso` | equipo | Días de descanso | días | promiedos | B | no | Fecha del partido − fecha del anterior |
| `eq_elo` | equipo | Elo de Boca | puntos Elo | calculo propio | B | no | R + K × (S − E) |
| `eq_elo_rival` | equipo | Elo del rival | puntos Elo | calculo propio | B | no | R + K × (S − E) |
| `eq_calidad_calendario` | equipo | Calidad del calendario | puntos Elo | calculo propio | B | no | Promedio del Elo de los rivales |
| `eq_prob_victoria` | equipo | Probabilidad de victoria | % | calculo propio | B | sí | Elo con ventaja de localía |
| `eq_prob_empate` | equipo | Probabilidad de empate | % | calculo propio | B | sí | Elo con ventaja de localía |
| `eq_prob_derrota` | equipo | Probabilidad de derrota | % | calculo propio | B | sí | Elo con ventaja de localía |
| `eq_sorpresa` | equipo | Sorpresa | puntos | calculo propio | B | sí | S − E |
| `eq_brier` | equipo | Brier score del Elo | puntos | calculo propio | B | sí | Promedio de (probabilidad − resultado)² |
| `eq_ppp_rival_alto` | equipo | Puntos contra rivales del tercio alto | puntos | promiedos | B | no | Puntos / PJ contra el tercio alto |
| `eq_ppp_rival_medio` | equipo | Puntos contra rivales del tercio medio | puntos | promiedos | B | no | Puntos / PJ contra el tercio medio |
| `eq_ppp_rival_bajo` | equipo | Puntos contra rivales del tercio bajo | puntos | promiedos | B | no | Puntos / PJ contra el tercio bajo |
| `eq_temperatura` | equipo | Temperatura | °C | openmeteo | A | no | Promedio por partido |
| `eq_lluvia` | equipo | Lluvia | mm | openmeteo | A | no | Promedio por partido |
| `eq_bajas_rival` | equipo | Bajas del rival | jugadores | promiedos | A | no | Bajas informadas por partido |
| `eq_forma_5` | equipo | Forma reciente | puntos | promiedos | B | no | Σ puntos de los últimos 5 partidos |
| `eq_racha_victorias` | equipo | Racha de victorias | partidos | promiedos | B | no | Máximo de victorias consecutivas |
| `eq_racha_invicto` | equipo | Racha invicta | partidos | promiedos | B | no | Máximo de partidos consecutivos sin derrota |
| `eq_racha_derrotas` | equipo | Racha de derrotas | partidos | promiedos | B | no | Máximo de derrotas consecutivas |
| `eq_racha_vallas` | equipo | Racha de vallas invictas | partidos | promiedos | B | no | Máximo de partidos consecutivos con GC = 0 |
| `eq_minutos_ganando` | equipo | Minutos ganando | minutos | promiedos | B | no | Tiempo entre goles con el marcador a favor |
| `eq_minutos_empatando` | equipo | Minutos empatando | minutos | promiedos | B | no | Tiempo entre goles con el marcador igualado |
| `eq_minutos_perdiendo` | equipo | Minutos perdiendo | minutos | promiedos | B | no | Tiempo entre goles con el marcador en contra |
| `eq_puntos_desde_atras` | equipo | Puntos remontados | puntos | promiedos | B | no | Puntos de los partidos en que perdía y no perdió |
| `eq_puntos_perdidos_ventaja` | equipo | Puntos perdidos desde la ventaja | puntos | promiedos | B | no | 3 − puntos de los partidos en que ganaba y no ganó |
| `eq_consistencia_gf` | equipo | Consistencia de goles a favor | goles | promiedos | B | no | Desvío estándar de GF por partido |
| `eq_consistencia_gc` | equipo | Consistencia de goles en contra | goles | promiedos | B | no | Desvío estándar de GC por partido |
| `eq_rotacion` | equipo | Rotación | jugadores | promiedos | B | no | Titulares nuevos frente al partido anterior |
| `eq_estabilidad_once` | equipo | Estabilidad del once | proporción | promiedos | B | no | /A ∩ B/ / /A ∪ B/ |
| `eq_edad_once` | equipo | Edad del equipo | años | promiedos | B | no | Σ edad × minutos / Σ minutos |
| `eq_min_hasta_21` | equipo | Minutos de jugadores de hasta 21 años | % | promiedos | B | no | Minutos de ese tramo / Minutos totales × 100 |
| `eq_min_22_26` | equipo | Minutos de jugadores de 22 a 26 años | % | promiedos | B | no | Minutos de ese tramo / Minutos totales × 100 |
| `eq_min_27_31` | equipo | Minutos de jugadores de 27 a 31 años | % | promiedos | B | no | Minutos de ese tramo / Minutos totales × 100 |
| `eq_min_32_mas` | equipo | Minutos de jugadores de 32 años o más | % | promiedos | B | no | Minutos de ese tramo / Minutos totales × 100 |
| `eq_nr` | equipo | Net Rating del equipo | goles | promiedos | B | no | (GF − GC) / PJ |
| `eq_nr_xg` | equipo | Net Rating con xG | xG | scoutingstats | B | no | (xG − xGA) / PJ |
| `eq_herfindahl` | equipo | Concentración de goles | índice | promiedos | B | no | Σ (goles del jugador / goles del equipo)² |
| `eq_exponente_pitagorico` | equipo | Exponente pitagórico | exponente | calculo propio | B | no | argmin Σ (puntos reales − pitagóricos)² |
| `eq_posicion` | equipo | Posición en la tabla | puesto | promiedos | A | no | Tabla de la fuente |
