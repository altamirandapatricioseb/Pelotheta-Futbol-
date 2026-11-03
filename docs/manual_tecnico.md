# Manual técnico y de operación

## Arquitectura en una línea

Pipeline en Python (GitHub Actions, mensual) → Postgres de Supabase (`core` privado con RLS, `api` de
lectura) → web en Next.js 16 en Vercel, más libros de Excel y CSV de Power BI en el bucket `exports`.
Diagramas en `docs/diagramas/`; decisiones en `docs/adr/`.

## Entorno local

```bash
just bootstrap          # herramientas, configuración, dependencias, pruebas y build (ver scripts/bootstrap.sh)
just dev                # web en http://localhost:3000
just pipeline           # carga completa contra Supabase (~8 min)
just test               # pytest y Vitest
cd web && pnpm e2e      # Playwright: accesibilidad, seguridad y regresión visual
```

## Variables de entorno

| Variable | Dónde | Para qué |
|---|---|---|
| `SUPABASE_URL` | `.env`, GitHub Secrets | Proyecto de Supabase del pipeline |
| `SUPABASE_SECRET_KEY` (o `API_SUPABASE_SECRET_KEY`) | `.env`, GitHub Secrets | Carga del pipeline. Nunca en la web |
| `STRIKER_API_KEY`, `BZZOIRO_API_KEY` | `.env`, GitHub Secrets | Fuentes con clave (opcionales) |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | `web/.env.local`, Vercel | Lectura de la web (la clave publicable es pública) |
| `GITHUB_DISPATCH_TOKEN` | Vercel | Botón Actualizar (token fine-grained, solo Actions de este repositorio) |
| `E2E_BASE_URL` | Opcional | Correr Playwright contra otro sitio |

## Cómo agregar…

**Una estadística.** Una fila en `data/stat_catalog.csv` (id, entidad, nombre, descripción, unidad, fuente,
nivel, fórmula, regla de agregación y sus argumentos). Si sale de una clave base que no existe, agregarla en
`sql/player_match_value.sql` o `sql/team_match_value.sql` y su migración. `tests/test_stat_catalog.py`
valida el CSV. La web y los libros la toman en la próxima carga.

**Un gráfico.** Una fila en `data/chart_catalog.csv` (y su origen en `data/chart_source_map.csv`) y su
función en `web/components/charts/definitions.tsx` (`CHARTS`). `tests/test_chart_catalog.py` controla que
cada gráfico tenga su fila y su origen.

**Una tarjeta de situaciones.** Una fila en `data/situational_catalog.csv` y su consulta en
`sql/situational/` (con su migración). `tests/test_situational_catalog.py` valida el catálogo.

**Una fuente.** Un adaptador en `sources/` que use `PoliteClient` (pausa, robots.txt, caché y manifiesto),
con funciones puras `parse_*` y su test con una respuesta guardada; su `crawl_*` en `pipeline/run.py`
atrapando sus errores como aviso; la fila en `docs/source_audit.md` y en
`docs/security/compliance_register.md`. Si el sitio desafía a clientes automáticos, no se evade (ver
`sources/elnine.py`).

**Un chequeo de calidad.** Una fila en `sql/quality/checks.sql`, la misma en una migración nueva y su id en
`data/contracts.yml`; `tests/test_contracts.py` controla que coincidan.

## Runbooks

**Carga fallida.** 1. Abrir la corrida en Actions (o `/actualizar`, que muestra el paso). 2. Si es una
fuente: el resto ya cargó; corregir el adaptador y volver a correr. 3. Si es la base: ver «Supabase
pausado». 4. Volver a correr: la carga es idempotente.

**Supabase pausado.** Panel de Supabase → Restore project; `/api/health` vuelve a `ok`; correr
`keepalive.yml` a mano. El keepalive corre dos veces por semana para que no pase.

**Rotar claves.** Supabase → Settings → API Keys: crear una clave secreta nueva, cargarla en GitHub Secrets y
`.env`, correr una carga de prueba y revocar la vieja. Para la publicable: crear la nueva, actualizar Vercel,
los valores por defecto de los workflows (`keepalive`, `lighthouse`, `security_weekly`) y
`notebooks/datos.py`, y redesplegar.

**Restaurar el backup.** Descargar el artefacto `backup-cifrado` de la corrida de `backup.yml` y correr
`just backup --verify <archivo>` (usa `~/.pelotheta/backup-age.key`). Los JSON descifrados son las vistas de
`api`; para reconstruir la base desde cero, aplicar `supabase/migrations/` y correr el pipeline
(`docs/recuperacion.md`).

**Rollback de la web.** Vercel → Deployments → el deploy anterior → «Promote to Production». Si el problema
está en una migración, escribir una migración nueva que la revierta (nunca editar una aplicada).

**Rollback de un parámetro.** `projection_param` guarda versiones: insertar una versión nueva con el valor
anterior (por ejemplo, volver a `ELO_K = 20`) y correr la carga.
