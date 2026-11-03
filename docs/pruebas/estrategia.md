# Estrategia de pruebas (16.7)

| Nivel | Qué cubre | Herramienta | Dónde corre | Estado (2-nov-2026) |
|---|---|---|---|---|
| Unidad (Python) | Adaptadores con respuestas guardadas, fórmulas, carga, Excel, Power BI, backup, contratos | pytest + hypothesis | CI en cada push | 254 pruebas; cobertura de la lógica 89 % (objetivo ≥ 85 %, el CI falla por debajo) |
| Unidad (web) | Lógica de `web/lib`: estadísticas, comparación, exportación, seguridad, errores | Vitest | CI en cada push | 143 pruebas; cobertura 93 % de líneas (objetivo ≥ 80 %) |
| Base de datos | RLS, permisos, funciones de carga, vistas, bucket | pgTAP (`supabase/tests/database/`) | MCP o SQL Editor antes de cada entrega (en CI haría falta la contraseña de la base) | 10/10 |
| Calidad de datos | Unicidad, no nulos, rangos, referencias, frescura y conciliación | SQL a mano (`sql/quality/`) | Al final de cada corrida del pipeline | 16/16 |
| Punta a punta | Accesibilidad (axe) en 14 rutas, dos temas y dos dispositivos; sin desplazamiento horizontal; CSP y parámetros maliciosos | Playwright | Local y semanal contra producción | En verde |
| Regresión visual | Las 5 interfaces en los dos temas, con datos tapados | Playwright `toHaveScreenshot` | Local (líneas base de Windows en el repositorio) | 10/10 |
| Rendimiento | Presupuesto de Lighthouse | Lighthouse CI | Cada PR de la web | Límites en `web/lighthouserc.json` |
| Carga | 20 usuarios virtuales, p95 < 800 ms | k6 (`k6/carga.js`) | A mano contra un preview o local; nunca producción | Script listo; no corrido (k6 no está instalado y el preview está protegido) |
| Notebooks | Análisis y validación de punta a punta | nbmake | CI en cada push | 5/5 |

**Mutation testing:** opcional en el prompt y no aplicado. `mutmut` sobre `pipeline/metrics.py` sería el
primer candidato; queda en `docs/ideas_extra.md`.

**Defectos:** se registran como issues con la plantilla «Algo no funciona» (pasos, resultado esperado,
resultado obtenido y severidad); ver `docs/soporte/README.md`.
