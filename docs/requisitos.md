# Requisitos y trazabilidad

## Funcionales

| Id | Requisito | Caso de uso |
|---|---|---|
| RF01 | Mostrar al menos 50 gráficos de la temporada por categoría, con filtros globales | CU1 |
| RF02 | Tablas de jugadores y del equipo con una categoría visible a la vez, orden por columna y panel del jugador y la estadística actuales | CU2 |
| RF03 | Abrir la estadística desglosada con doble clic desde tablas, gráficos, tarjetas y comparación | CU3 |
| RF04 | Al menos 100 tarjetas de situaciones calculadas en SQL, con «Ver los partidos» | CU4 |
| RF05 | Comparar un jugador contra plantel, zona, posición y otro jugador, sin incluirlo en su referencia | CU5 |
| RF06 | Exportar cada tabla a Excel con estilos y descargar libros con gráficos nativos | CU6 |
| RF07 | Publicar los datos para Power BI (CSV en estrella) y por una API de solo lectura documentada | CU7 |
| RF08 | Actualizar los datos desde la web con enfriamiento y aviso de fallas | CU8 |
| RF09 | Cargar la temporada mensualmente desde las fuentes, con validación, cuarentena y upserts idempotentes | CU9 |
| RF10 | Mostrar el estado del sistema: SLOs, corridas, calidad de datos, cobertura y fuentes | CU10 |
| RF11 | Calcular Mejoría α y β y Potencial α y β sin datos futuros, con su aviso de estimación | CU2, CU3 |

## No funcionales

| Id | Tipo | Requisito |
|---|---|---|
| RNF01 | Seguridad | Con la clave pública se lee y no se escribe (RLS); ninguna clave secreta en el repositorio ni en el navegador |
| RNF02 | Seguridad | CSP con nonce, HSTS, nosniff, COOP y Permissions-Policy en todas las páginas |
| RNF03 | Seguridad | Parámetros de URL validados contra listas cerradas; nunca un error 500 ni un reflejo sin escapar |
| RNF04 | Accesibilidad | WCAG 2.2 AA (axe sin violaciones) en todas las rutas, en los dos temas y en celular |
| RNF05 | Accesibilidad | Respeto de «reducir movimiento» en todas las animaciones |
| RNF06 | Rendimiento | Sin regresiones respecto del presupuesto del 2-nov-2026 (Lighthouse: TBT ≤ 2 s, CLS ≤ 0,1) |
| RNF07 | Disponibilidad | 99 % mensual medido cada 6 horas; frescura de datos ≤ 35 días |
| RNF08 | Responsive | Ninguna página se desplaza de costado en 375 px |
| RNF09 | Calidad de datos | Chequeos de unicidad, nulos, rangos, referencias, frescura y conciliación en cada carga |
| RNF10 | Recuperación | Backup mensual cifrado y restauración probada |

## Historias de usuario

```gherkin
Característica: Estadística desglosada
  Escenario: Abrir una estadística desde la tabla de jugadores
    Dado que estoy en /jugadores con la categoría Ataque
    Cuando hago doble clic en la celda de goles de un jugador
    Entonces veo /estadistica/goles con sus ventanas de tiempo
    Y la ventana «Últimos 5 partidos» muestra n y la diferencia contra la temporada

Característica: Seguridad de la API pública
  Escenario: Intento de escritura con la clave publicable
    Dado que tengo la clave publicable de /api-docs
    Cuando envío un POST a /rest/v1/boca_match
    Entonces la base lo rechaza
    Y ninguna fila cambia

Característica: Calidad de datos
  Escenario: La definición por penales no suma al resultado
    Dado un partido que terminó 0-1 y se definió por penales
    Cuando corren los chequeos de calidad
    Entonces la conciliación de goles no marca falla

Característica: Estado del sistema
  Escenario: Ver la última corrida
    Dado que el pipeline terminó una carga
    Cuando abro /estado
    Entonces veo su resultado, duración, filas cargadas y el tamaño de la base
```

## Matriz de trazabilidad

| Requisito | Caso de uso | Prueba | Código |
|---|---|---|---|
| RF01 | CU1 | `tests/test_chart_catalog.py`, `web/lib/charts/transform.test.ts`, `web/e2e/visual.spec.ts` | `web/components/charts/`, `data/chart_catalog.csv` |
| RF02 | CU2 | `web/lib/stats/sort.test.ts`, `web/lib/stats/catalog.test.ts` | `web/components/players/player-master.tsx`, `web/components/team/team-table.tsx` |
| RF03 | CU3 | `web/lib/stats/detail.test.ts`, `tests/test_excel.py` (hoja Desglosada) | `web/app/estadistica/[stat]/page.tsx`, `sql/desglosada.sql` |
| RF04 | CU4 | `tests/test_situational_catalog.py`, `web/lib/situations/board.test.ts` | `sql/situational/`, `web/components/situations/board.tsx` |
| RF05 | CU5 | `web/lib/compare/compare.test.ts`, `web/lib/compare/breakdown.test.ts` | `web/lib/compare/`, `web/components/compare/` |
| RF06 | CU6 | `tests/test_excel.py`, `web/lib/export/xlsx.test.ts` | `pipeline/excel.py`, `web/lib/export/` |
| RF07 | CU7 | `tests/test_powerbi.py`, `tests/test_openapi.py` | `pipeline/powerbi.py`, `scripts/openapi.py`, `web/app/api-docs/page.tsx` |
| RF08 | CU8 | `web/lib/update/state.test.ts` | `web/app/api/actualizar/route.ts`, `web/components/update/update-panel.tsx` |
| RF09 | CU9 | `tests/test_pipeline_run.py`, `tests/test_pipeline_load.py`, `tests/test_promiedos.py` y demás adaptadores | `pipeline/run.py`, `pipeline/load.py`, `sources/` |
| RF10 | CU10 | `web/e2e/a11y.spec.ts` (ruta /estado), `tests/test_contracts.py` | `web/app/estado/page.tsx`, `sql/quality/checks.sql` |
| RF11 | CU2, CU3 | `tests/test_projection.py`, `tests/test_own_metrics.py` | `pipeline/projection.py`, `pipeline/own_metrics.py` |
| RNF01 | CU7 | `tests/test_rls.py`, `supabase/tests/database/security.test.sql` | `supabase/migrations/` |
| RNF02 | — | `web/lib/security/csp.test.ts`, `web/e2e/security.spec.ts` | `web/proxy.ts`, `web/next.config.ts` |
| RNF03 | — | `web/e2e/security.spec.ts`, `web/lib/security/blocklist.test.ts` | Validación Zod en `web/app/*/page.tsx` |
| RNF04 | Todos | `web/e2e/a11y.spec.ts` | `web/app/globals.css` |
| RNF05 | — | `web/e2e/a11y.spec.ts` (emula reducir movimiento) | `web/components/motion-provider.tsx` |
| RNF06 | — | Lighthouse CI (`web/lighthouserc.json`) | `web/components/charts/chart-card.tsx` |
| RNF07 | CU10 | `.github/workflows/health.yml` | `web/app/api/health/route.ts` |
| RNF08 | — | `web/e2e/a11y.spec.ts` (sin desplazamiento horizontal) | `web/app/globals.css` |
| RNF09 | CU9 | `tests/test_contracts.py` | `sql/quality/checks.sql`, `data/contracts.yml` |
| RNF10 | — | `tests/test_backup.py` | `scripts/backup.py`, `.github/workflows/backup.yml` |
