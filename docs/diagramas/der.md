# Diagrama entidad-relación

Dos esquemas: `core` (privado, con RLS; lo escribe solo el pipeline) y `api` (vistas `security_invoker` que
leen la web, Excel, Power BI y la API pública). Las claves foráneas son las reales de la base (2-nov-2026).

## Esquema `core`: partidos, jugadores y eventos

```mermaid
erDiagram
    competition ||--o{ season : "tiene"
    season ||--o{ match : "agrupa"
    team ||--o{ match : "local o visitante"
    referee |o--o{ match : "dirige"
    match ||--o{ lineup : "alinea"
    player ||--o{ lineup : "juega"
    match ||--o{ event : "registra"
    player |o--o{ event : "protagoniza"
    match ||--o{ shot : "registra"
    player |o--o{ shot : "remata"
    match ||--o{ team_match_stat : "mide"
    team ||--o{ team_match_stat : "de"
    match ||--o{ player_match_stat : "mide"
    player ||--o{ player_match_stat : "de"
    match ||--o{ team_match_formation : "forma"
    match ||--o{ match_absence : "ausencias"
    match ||--o| match_weather : "clima"
    match ||--o| match_context : "DT y estadio"
    match ||--o{ match_momentum : "momentum"
    player ||--o| player_profile : "perfil"
    player ||--o{ squad_member : "plantel"

    competition {
        int competition_id PK
        text code
        text kind
    }
    season {
        int season_id PK
        int competition_id FK
        int year
    }
    match {
        int match_id PK
        int season_id FK
        date match_date
        int home_team_id FK
        int away_team_id FK
        int home_goals
        int away_goals
        int referee_id FK
    }
    team {
        int team_id PK
        text name
        bool is_boca
    }
    player {
        int player_id PK
        text full_name
        date birth_date
    }
    referee {
        int referee_id PK
        text name
    }
    lineup {
        int match_id PK
        int player_id PK
        int team_id FK
        bool started
        int minute_in
        int minute_out
    }
    event {
        bigint event_id PK
        int match_id FK
        int minute
        int period
        text type
        int player_id FK
    }
    shot {
        bigint shot_id PK
        int match_id FK
        int player_id FK
        numeric xg
    }
    team_match_stat {
        int match_id PK
        int team_id PK
        text stat_key PK
        numeric value
    }
    player_match_stat {
        int match_id PK
        int player_id PK
        text stat_key PK
        numeric value
    }
    match_context {
        int match_id PK
        text boca_coach
        text rival_coach
        int stadium_capacity
    }
```

## Esquema `core`: catálogos y resultados calculados

```mermaid
erDiagram
    stat_catalog ||--o{ stat_set_item : "integra"
    stat_set ||--o{ stat_set_item : "contiene"
    stat_catalog ||--o{ stat_value : "valor por entidad"
    stat_catalog ||--o{ stat_match_value : "valor por partido"
    chart_catalog ||--o{ chart_source_map : "origen"
    situational_catalog ||--o{ situational_result : "filas"
    situational_result ||--o{ situational_match : "partidos"
    conclusion_rule ||--o{ conclusion_result : "resultado"

    stat_catalog {
        text stat_id PK
        text entity PK
        text level
        text rule
        bool available
    }
    stat_value {
        text entity PK
        int entity_id PK
        text competition_code PK
        text stat_id PK
        numeric value
    }
    stat_match_value {
        text entity PK
        int entity_id PK
        int match_id PK
        text stat_id PK
        numeric value
    }
    situational_result {
        text card_id PK
        text param_value PK
        int n
        numeric win_pct
        numeric delta
    }
```

Tablas de operación, sin claves foráneas: `ingest_log`, `audit_log`, `pipeline_run_metrics`,
`data_quality_result`, `system_status`, `source_id_map`, `projection_param`, `league_result`,
`league_standing`, `league_leader`, `club_rating`, `club_season_stat` y `club_competition_metric`.

## Esquema `api`

Cada vista lee una o más tablas de `core` y respeta la RLS de quien consulta (`security_invoker`). Las
principales: `boca_match`, `team_match_master` (un partido con sus estadísticas en JSON), `player_master`
(un jugador por competición con sus estadísticas), `player_match_value`, `team_match_value`,
`stat_match_value`, `stat_catalog`, `chart_catalog`, `situational_result`, `conclusion`, `source_status`,
`pipeline_run_metrics` y `data_quality`. La lista completa con sus columnas: `/api-docs` y
`web/public/openapi.json`.

## Modelo estrella de Power BI

```mermaid
erDiagram
    dim_player ||--o{ fact_player_stat : ""
    dim_stat ||--o{ fact_player_stat : ""
    dim_competition ||--o{ fact_player_stat : ""
    dim_player ||--o{ fact_player_match_value : ""
    dim_date ||--o{ fact_match : ""
    dim_competition ||--o{ fact_match : ""
    fact_match ||--o{ fact_team_match_stat : ""
    fact_match ||--o{ fact_shot : ""
    dim_stat ||--o{ fact_stat_match_value : ""
    dim_player ||--o{ fact_projection : ""
    dim_chart ||--o{ chart_source_map : ""

    fact_player_stat {
        int player_id FK
        text stat_id FK
        text competition FK
        numeric value
        numeric percentile
    }
    fact_match {
        int match_id PK
        date date FK
        int goals_for
        int goals_against
    }
```

Detalle de cada tabla y medida DAX: `docs/powerbi_guia.md`.
