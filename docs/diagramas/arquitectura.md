# Arquitectura, despliegue, red y linaje

## C4: contexto

```mermaid
flowchart LR
    V([Visitante: hincha, periodista, reclutador])
    A([Analista con Excel o Power BI])
    D([Dueño-administrador])
    P[[Pelotheta Θ]]
    F[(Fuentes externas: Promiedos, ScoutingStats, Statshub, Bzzoiro, StrikerAPI, NoFluffPicks, Open-Meteo, Wikipedia, ELNINE)]
    V -- navega, exporta --> P
    A -- descarga libros y CSV, consulta la API --> P
    D -- Actualizar, despliega, revisa /estado --> P
    P -- scraping educado y APIs --> F
```

## C4: contenedores

```mermaid
flowchart TB
    subgraph Vercel
        W[Web Next.js 16: 6 interfaces, desglosada, /estado, /soporte, /api-docs]
        H[/api/health y /api/actualizar/]
    end
    subgraph GitHub
        R[Repositorio]
        WF[Actions: update mensual, keepalive, salud, seguridad semanal, backup, CI, CodeQL, Lighthouse]
    end
    subgraph Supabase
        API[Data API PostgREST: esquemas api e ingest]
        DB[(Postgres: core con RLS)]
        ST[(Storage: bucket exports)]
    end
    PL[Pipeline Python: sources y pipeline]
    W -- lectura con clave publicable --> API
    H -- dispara workflow_dispatch --> WF
    WF -- corre --> PL
    PL -- clave secreta, rpc ingest --> API
    API --> DB
    PL -- xlsx y CSV --> ST
    W -- enlaces de descarga --> ST
    R -- push a main --> Vercel
```

## Despliegue

```mermaid
flowchart LR
    Dev[Máquina del dueño] -- git push --> GH[GitHub main]
    GH -- integración --> VP[Vercel: build y deploy]
    VP --> Prod[pelotheta-futbol.vercel.app]
    GH -- cron --> GA[GitHub Actions ubuntu-latest]
    GA -- HTTPS 443 --> SB[Supabase: proyecto gratuito]
    Prod -- HTTPS 443 --> SB
```

## Red

```mermaid
flowchart LR
    U[Navegador, IPv4 o IPv6] -- DNS: pelotheta-futbol.vercel.app --> DNS[(DNS de Vercel)]
    U -- TCP 443, TLS 1.2 o 1.3 --> EDGE[Red de borde anycast de Vercel]
    EDGE -- interno --> FN[Funciones de Next.js]
    FN -- TCP 443, TLS, inicia la función --> SBAPI[Supabase: *.supabase.co detrás de su CDN]
    SBAPI -- interno --> PG[(Postgres 5432, sin acceso público directo)]
    GHA[GitHub Actions] -- TCP 443, inicia el runner --> SBAPI
    PBI[Power BI Desktop] -. opcional: pooler de sesión 5432 con powerbi_reader, hoy sin login .-> PG
```

Todas las conexiones salen del cliente hacia el servidor: ni Vercel ni Supabase abren conexiones hacia
la máquina del dueño. Detalle de DNS, TLS y dominio propio en `docs/red/dominio.md`.

## Linaje de datos

```mermaid
flowchart LR
    S[Fuente: Promiedos] --> RAW[Crudo: data/raw, caché y manifiesto]
    RAW --> STG[Staging: core.match, core.event, core.player_match_stat]
    STG --> MV[Materializadas: core.player_match_value_mv]
    MV --> T[core.stat_value y stat_match_value]
    T --> VW[Vista: api.player_master]
    VW --> G[Gráfico: ranking del plantel en la landing]
    VW --> X[Excel: Tabla maestra]
    VW --> PB[Power BI: fact_player_stat]
```
