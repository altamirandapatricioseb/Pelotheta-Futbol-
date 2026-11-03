# Diagramas de flujo

## Carga mensual completa

```mermaid
flowchart TD
    A[workflow update.yml: cron mensual o botón Actualizar] --> B{¿La base responde con la clave secreta?}
    B -- no --> X1[Termina con error antes de scrapear] --> Z[Issue y aviso en /actualizar]
    B -- sí --> C[Scraping de Promiedos: partidos, alineaciones, eventos]
    C -- falla --> X2[log_failure en ingest_log] --> Z
    C --> D[Fuentes complementarias: ScoutingStats, Statshub, Bzzoiro, StrikerAPI, NoFluffPicks, Open-Meteo, Wikipedia, ELNINE]
    D --> E{¿Cada registro pasa la validación Pydantic?}
    E -- no --> Q[Cuarentena en data/quarantine y aviso]
    E -- sí --> F[Lote: load_batch con upserts idempotentes]
    Q --> F
    F --> G[Catálogos, gráficos, situaciones, conclusiones]
    G --> H[Métricas propias y tablas maestras materializadas]
    H --> I[Chequeos de calidad: run_quality_checks]
    I --> J[Métricas de la corrida: log_run]
    J --> K[Excel y CSV de Power BI al bucket exports]
    K --> L[Revalidación de la caché de la web]
```

## Nivel A, B o C de una estadística

```mermaid
flowchart TD
    A[Estadística del catálogo] --> B{¿Se puede calcular desde datos crudos mínimos?}
    B -- sí --> C{¿El cálculo necesita un supuesto?}
    C -- no --> NB[Nivel B: calculada]
    C -- sí --> NBE[Nivel B estimada: se marca en la web]
    B -- no --> D{¿Una fuente con permiso la publica directa?}
    D -- sí --> NA[Nivel A: viene de la fuente; otra fuente valida si existe]
    D -- no --> NC[Nivel C: n/d con el motivo]
```

## Mejoría α y β y Potencial α y β

```mermaid
flowchart TD
    A[Jugador y fecha] --> B{¿Edad y posición conocidas?}
    B -- no --> ND1[n/d]
    B -- sí --> C[Índice de rendimiento R: componentes con datos y pesos de su línea]
    C --> D{¿Cobertura de pesos ≥ mínima?}
    D -- no --> ND2[R = n/d]
    D -- sí --> E[Ventanas: últimos 5 partidos contra el resto, sin datos futuros]
    E --> F{¿Minutos y mínimos de intentos en las dos ventanas?}
    F -- no --> ND3[Mejoría = n/d]
    F -- sí --> G[z de cada tasa, peso w por minutos, Mejoría α = 50 + escala × w × Z]
    C --> H[Nivel N con reducción por muestra chica]
    H --> I[Potencial α = N + crecimiento hasta el pico ± margen]
    H --> J[Potencial β = 0,60 R* + 0,25 T + 0,15 factor de edad]
```

## Doble clic a la estadística desglosada

```mermaid
flowchart LR
    A[Celda, barra, tarjeta o valor de Comparar] -- doble clic o Enter y D --> B[/estadistica/id con entidad e id/]
    B --> C[Ventanas, gráficos, partidos y relacionadas]
    C -- Volver --> D[Origen con scroll, filtros y elemento enfocado]
```

## Playbook: clave filtrada

```mermaid
flowchart TD
    A[Aviso: gitleaks, un tercero o el monitoreo] --> B{¿Qué clave?}
    B -- publicable --> P[Es pública por diseño: verificar que siga sin escritura con pgTAP]
    B -- secreta de Supabase --> S1[Rotar en Supabase] --> S2[Actualizar GitHub Secrets y .env] --> S3[Revisar pg_stat_statements y ingest_log]
    B -- token de GitHub o de una API --> T1[Revocar y crear uno nuevo] --> T2[Actualizar Vercel o Secrets]
    S3 --> R[Registrar en risk_register.csv y en incident_response.md]
    T2 --> R
    P --> R
```

## Ramas, previews y producción

```mermaid
flowchart LR
    A[Commit en una rama] --> B[CI: lint, tipos, pruebas, cobertura, Semgrep, gitleaks, notebooks]
    B --> C[Preview de Vercel protegido]
    C --> D[PR a main: Lighthouse CI y CodeQL]
    D --> E[Merge o push a main]
    E --> F[Deploy a producción en Vercel]
    F --> G[Salud cada 6 h y controles semanales]
```
