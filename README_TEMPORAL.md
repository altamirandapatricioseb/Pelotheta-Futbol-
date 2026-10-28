# README temporal: estado del proyecto

Registro vivo: dónde estamos, qué falta, qué quedó a medias o falló. Actualizado el 27/28-oct-2026.
Para retomar en un chat nuevo: leer este archivo, `PROMPT-1-BOCA-FUTBOL.md` (ya recortado) y
`docs/source_audit.md`.

## Etapas (sección 3.1 del prompt)

| Etapa | Estado |
|---|---|
| 1. Preparación | Hecha (27-oct) |
| 2. Esqueleto desplegado | Hecha (27-oct) |
| 3. Pipeline completo | **En curso**: fuentes, workflow, keepalive e Interfaz 6 hechos; falta una corrida exitosa en GitHub Actions |
| 4. Estadísticas, métricas propias y tablas | Pendiente |
| 5. Gráficos (Interfaz 1) | Pendiente |
| 6. Situaciones y estadística desglosada | Pendiente |
| 7. Comparación directa | Pendiente |
| 8. Excel | Pendiente |
| 9. Power BI | Pendiente |
| 10. Pulido | Pendiente |
| 11. Documentación y entrega | Pendiente |

## Etapa 3: qué está hecho

- URL: https://pelotheta-futbol.vercel.app/ — `/actualizar` con el botón (Interfaz 6).
- Fuentes activas (detalle y permisos en `docs/source_audit.md` y `docs/security/compliance_register.md`):
  Promiedos (principal), ScoutingStats, Statshub (API de su web, con autorización explícita del dueño),
  Bzzoiro (clave), StrikerAPI (clave, 500 créditos/mes), NoFluffPicks, Open-Meteo, Wikipedia.
- Base: 48 partidos de Boca 2026 (5 competiciones: Apertura, Clausura, Libertadores, Sudamericana,
  Copa Argentina), ~35 500 estadísticas por jugador, 750 tiros ubicados, bajas, momentum, clima, tablas,
  rankings, 814 resultados de liga, árbitros de 313 partidos, Elo, pie hábil y perfiles.
- Cobertura (`uv run python scripts/coverage_report.py`): crudas 90,9 % (88,1 % del inventario original),
  calculables 98,7 %, total 93,7 %. Sin fuente: pases progresivos y al último tercio, presiones,
  distancia recorrida, altura de línea, mapas de calor, redes de pases.
- `.github/workflows/update.yml` (día 1 de cada mes y botón) y `.github/workflows/keepalive.yml` (lunes).
- Botón: `POST /api/actualizar` dispara el workflow; verificación de Origin, enfriamiento de 60 min,
  estado cada 10 s y paso fallido visible en la página.
- Robustez: si una fuente secundaria falla, sus datos anteriores se conservan (migración `20261027260000`).

## Etapa 3: qué falta o falló

1. **Primera corrida del workflow desde el botón: falló** (27-oct, 36 min, paso «Pipeline»). Causa sin
   confirmar; probable falta de GitHub Secrets. Ya se agregó: corte temprano si faltan claves, registro
   del fallo en `ingest_log`, resumen en la página de la corrida y caché guardada aunque falle.
   Segunda corrida lanzada a las 00:49 UTC del 28-oct (ver resultado en `/actualizar`).
2. **GitHub Secrets** (Settings → Secrets and variables → Actions). Cargados (28-oct, ~00:50 UTC):
   `SUPABASE_URL`, `API_SUPABASE_SECRET_KEY`, `STRIKER_API_KEY`, `BZZOIRO_API_KEY`, `API_FOOTBALL_KEY`.
   `SUPABASE_URL` y la clave secreta se cargaron recién ahí: causa probable de la primera falla.
   **Falta** `SUPABASE_PUBLISHABLE_KEY` (la usa `keepalive.yml`; es la clave pública).
3. **Claves expuestas, decisión del dueño (28-oct):** el `.env` completo (secreta de Supabase,
   StrikerAPI, Bzzoiro, API-Football) quedó en el chat por una captura. El dueño decidió **no rotarlas**.
   Riesgo aceptado y registrado.
4. Cierre de seguridad 14.9 de la etapa 3: Advisor sin ERROR (2 INFO intencionales) y cabeceras OK
   verificados; falta confirmar CI en verde (repo privado: verlo en GitHub) y revisar `risk_register.csv`.
5. Eventos de StrikerAPI: 15 de 31 partidos (el resto llega cuando se recargan los créditos).
6. Mails de permiso enviados (SporLens, ScoutingStats, PitchMath, GoalPulz): sin respuesta todavía.

## Cómo probar

```bash
uv sync && uv run pytest -q
uv run python -m pipeline.run
```

Con `SUPABASE_URL` y `SUPABASE_PUBLISHABLE_KEY` en el entorno, `tests/test_rls.py` prueba la base real.

```bash
cd web && corepack pnpm@10.34.9 install && corepack pnpm@10.34.9 dev
```

## Próxima etapa (4: Estadísticas, métricas propias y tablas)

Skills: `superpowers:test-driven-development`, `karpathy-guidelines`, `impeccable` para las tablas,
cierre con `code-review`. Catálogo `data/stat_catalog.csv`, métricas de 5.7, 5.8 y sección 6,
Interfaz 3 completa e Interfaz 2.
