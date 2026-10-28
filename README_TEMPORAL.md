# README temporal: estado del proyecto

Registro vivo: dónde estamos, qué falta, qué quedó a medias o falló. Actualizado el 28-oct-2026.
Para retomar en un chat nuevo: leer este archivo, `PROMPT-1-BOCA-FUTBOL.md` (ya recortado) y
`docs/source_audit.md`.

## Etapas (sección 3.1 del prompt)

| Etapa | Estado |
|---|---|
| 1. Preparación | Hecha (27-oct) |
| 2. Esqueleto desplegado | Hecha (27-oct) |
| 3. Pipeline completo | Hecha (28-oct): workflow corrido desde el botón con éxito y fecha nueva visible en la web |
| 4. Estadísticas, métricas propias y tablas | **Desplegada** (28-oct): Interfaces 2 y 3 en producción; quedan pendientes menores (ver abajo) |
| 5. Gráficos (Interfaz 1) | Pendiente |
| 6. Situaciones y estadística desglosada | Pendiente |
| 7. Comparación directa | Pendiente |
| 8. Excel | Pendiente |
| 9. Power BI | Pendiente |
| 10. Pulido | Pendiente |
| 11. Documentación y entrega | Pendiente |

## Etapa 3: cierre (28-oct-2026)

- URL: https://pelotheta-futbol.vercel.app/ — `/actualizar` con el botón (Interfaz 6).
- **Criterio cumplido:** corridas desde el botón el 28-oct a las 02:52 UTC y a las 03:55 UTC, las dos
  exitosas (unos 4 minutos con la caché). Después de la segunda, `/actualizar` y el header muestran
  «28/10/2026, 00:59» (hora argentina).
- Fuentes activas (detalle y permisos en `docs/source_audit.md` y `docs/security/compliance_register.md`):
  Promiedos (principal), ScoutingStats, Statshub (API de su web, con autorización explícita del dueño),
  Bzzoiro (clave), StrikerAPI (clave, 500 créditos/mes), NoFluffPicks, Open-Meteo, Wikipedia.
- **StrikerAPI sin créditos este mes:** responde HTTP 402. El pipeline sigue sin ella y conserva sus datos
  anteriores (1585 filas por jugador, 930 por equipo y 750 tiros). Se recarga el mes que viene.
- Base: 48 partidos de Boca 2026, unas 35 500 estadísticas por jugador, 25 MB de 500 MB.
- `.github/workflows/update.yml` (día 1 de cada mes y botón) y `.github/workflows/keepalive.yml` (lunes y
  jueves, sección 8.4).
- Botón: `POST /api/actualizar` dispara el workflow; verificación de Origin, enfriamiento de 60 min,
  estado cada 10 s y paso fallido visible en la página. Cuando una corrida termina bien, la web descarta
  su caché de datos (si no, la fecha nueva tardaba hasta 6 horas en verse).

### Qué falló y cómo se resolvió

1. **Dos corridas fallaron sin dejar rastro** (27-oct, 36 min; 28-oct 00:49 UTC, 44 min). Causa: el
   secret `SUPABASE_URL` terminaba en `.supabase.com` (copiado del `.env` local, que tenía el mismo
   error); la correcta termina en `.supabase.co`. El scraping terminaba y la carga se rechazaba por la
   forma de la URL; el registro del fallo usaba la misma URL y también fallaba. Arreglo: el pipeline
   limpia la URL y la clave, las valida y prueba una lectura a la base **antes** del scraping (si algo
   está mal, corta en segundos con un mensaje claro), y cualquier error inesperado queda en `ingest_log`.
   El dueño volvió a crear los secrets `SUPABASE_URL` y `SUPABASE_SECRET_KEY` el 28-oct.
2. **Claves expuestas, decisión del dueño (28-oct):** el `.env` completo (secreta de Supabase,
   StrikerAPI, Bzzoiro, API-Football) quedó en el chat por una captura. El dueño decidió **no rotarlas**.
   Riesgo aceptado y registrado (R01 en `docs/security/risk_register.csv`).

### Cierre de seguridad 14.9 de la etapa 3

- Security Advisor: 0 ERROR, 0 WARN, 2 INFO intencionales (`docs/security/advisors.md`).
- Cabeceras verificadas en la URL real: CSP con nonce, HSTS con preload, COOP, Permissions-Policy,
  nosniff, `X-Frame-Options: DENY`.
- `docs/security/risk_register.csv` creado (13 riesgos) y revisado.
- Falta confirmar el CI en verde: el repo es privado y se ve en GitHub (pestaña Actions, workflow «CI»).

### Pendientes que no bloquean

1. Eventos de StrikerAPI: 15 de 31 partidos (el resto llega cuando se recarguen los créditos).
2. Mails de permiso enviados (SporLens, ScoutingStats, PitchMath, GoalPulz): sin respuesta todavía.
3. Aviso automático si la base pasa los 400 MB (sección 7): el tamaño se mide en cada carga, el aviso
   falta.
4. Identidades duplicadas entre fuentes: «J. Barinaga» y «Juan Barinaga» figuran como dos jugadores
   (lo mismo puede pasar con «G. Gelini»).

## Cómo probar

```bash
uv sync && uv run pytest -q
uv run python -m pipeline.run
```

Con `SUPABASE_URL` y `SUPABASE_PUBLISHABLE_KEY` en el entorno, `tests/test_rls.py` prueba la base real.

```bash
cd web && corepack pnpm@10.34.9 install && corepack pnpm@10.34.9 dev
```

Si Supabase se pausa por inactividad (plan gratis, 7 días): entrar al panel de Supabase, abrir el
proyecto `pelotheta-futbol` y tocar «Restore project». El keepalive de lunes y jueves debería evitarlo.

## Etapa 4: estado (28-oct-2026)

Criterio («ambas interfaces muestran una tabla a la vez con sus descripciones»): **cumplido en producción**.

- **Catálogo:** `data/stat_catalog.csv` con 160 estadísticas de jugador y 184 de equipo (A 157, B 175, C 12), cada
  una con descripción propia y regla de cálculo; `data/stat_sets.csv` con los 11 conjuntos de 9.1 y los 14 de 9.5.
  Resumen y reemplazos posibles en `docs/catalogo_estadisticas.md`.
- **Base:** valores por partido (`sql/player_match_value.sql`, `sql/team_match_value.sql`) y tablas maestras
  materializadas que refresca el pipeline (la web lee resultados ya calculados, en milisegundos).
- **Métricas propias** (`pipeline/own_metrics.py`, se calculan al final de cada corrida): Elo propio con
  probabilidades previas, sorpresa y Brier; xPts por Poisson; exponente pitagórico calibrado (x = 1,29); rachas,
  forma, rotación, estabilidad del once, concentración de goles, edad; NR, NR relativo, EWA y ELA; índice de
  rendimiento, Mejoría α y β y Potencial α y β (6.1), con los ejemplos del prompt en tests. Ver
  `docs/metricas_propias.md` y `docs/model_cards/mejoria_potencial.md`.
- **Interfaz 3** (`/jugadores`): desplegable de conjuntos y Personalizado, por 90, filtros, percentiles, estimadas,
  porteros aparte, aviso de muestra pequeña. **Interfaz 2** (`/equipo`): vistas por partido, rival, mes,
  competición y acumulada, con total y promedio al pie.
- Revisión de código de cierre hecha: 5 correcciones aplicadas. Security Advisor: 0 ERROR, 0 WARN.

Pendientes de la etapa 4 (no bloquean la 5):

1. Filas «Promedio de la liga» y «Boca vs liga (percentil)» en la Interfaz 2 (hay datos de los 30 clubes en
   `club_season_stat`).
2. NR con xG (necesita minutos de entrada y salida junto a los tiros con minuto) y la serie partido a partido de
   6.1 «a la fecha»: van con la estadística desglosada de la etapa 6.
3. Parámetros de 6.1 en una tabla `projection_param` (hoy en `pipeline/projection.py`).
4. Revisión de accesibilidad de las tablas (`design:accessibility-review`) y doble clic a la desglosada (etapa 6).
5. Revisar en el Elo si Promiedos y StrikerAPI fechan distinto los partidos nocturnos (podrían quedar duplicados).
6. Las estadísticas solo de liga muestran 0 (no `n/d`) a quien jugó solo copas en la ventana «todas».

## Próxima etapa (5: Gráficos, Interfaz 1)

Skills: `dataviz` antes del primer gráfico, `data:create-viz` y `data:data-visualization` para el catálogo,
`animejs` para los trazos, cierre con `impeccable` (`audit` y `polish`).
