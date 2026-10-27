# Plan de skills

Lista real de skills disponibles en la cuenta del dueño al 26-oct-2026 (las que aparecen al escribir `/`), elegidas por **función** para cada etapa de la sección 3.1. **El orden de las filas es el orden de uso.** Todas las skills de esta tabla las puede invocar el agente por su cuenta; si alguna dejara de estarlo, el README temporal lo indica con «activá `/nombre` antes de continuar».

| Etapa | Skill | Para qué la usás en esa etapa | Cuándo | Por qué esta y no otra |
|---|---|---|---|---|
| 1. Preparación | `workflow-authoring` (modo ultracode) | Orquestar la Fase 0: un agente por fuente que lee robots.txt y términos y hace pocas requests reales, más síntesis y verificación adversaria del documento | Antes de escribir código de fuentes | Permite probar 13 fuentes en paralelo sin mezclar contextos y con un revisor que contrasta el documento contra los informes |
| 1. Preparación | `anthropic-skills:deep-research` | Profundizar en términos de uso y cobertura de una fuente cuando la sonda deja dudas | Al revisar `docs/source_audit.md` | Investigación con fuentes citadas; las sondas solo prueban, no interpretan términos largos |
| 1. Preparación | `security-review` | Revisar migraciones, RLS, privilegios y el cliente HTTP antes del primer deploy | Al terminar la etapa | Es la revisión de seguridad específica de cambios; `code-review` mira corrección en general |
| 1. Preparación | `engineering:architecture` | Escribir los primeros ADR (esquema privado más `api`, cálculo en el pipeline) | Al terminar la etapa | Formato de decisión con alternativas y consecuencias, que es lo que pide MADR |
| 2. Esqueleto | `impeccable` (subcomandos `shape` y luego `colorize` / `typeset`) | Definir el sistema de diseño: tokens de color verde, Montserrat, header, jerarquía, modo full negro | Antes de escribir el header y los tokens | Es la skill de diseño frontend más completa instalada y tiene la secuencia de mejora que se reusa en la etapa 10 |
| 2. Esqueleto | `design:design-system` | Documentar los tokens y componentes base en `web/styles/tokens.css` y su guía | Mientras se escriben los tokens | Se ocupa del sistema (nombres, escalas, estados), no de una pantalla puntual |
| 2. Esqueleto | `anthropic-skills:design-library` | Elegir componentes animados concretos: subrayado deslizante de pestañas, header que se compacta, contadores | Al construir el header y la tabla «Resumen» | Biblioteca curada de componentes animados (motion, animejs, React Bits, skiper-ui) lista para adaptar |
| 2. Esqueleto | `framer-motion` | Implementar las cascadas de entrada y transiciones con `motion` | Al escribir las animaciones | Guía específica de rendimiento de motion (animar transform y opacity) |
| 2. Esqueleto | `impeccable` (`audit` y `polish`) | Revisión de cierre del esqueleto | Al cerrar la etapa | La sección 2.1 pide revisar con Impeccable al cerrar las etapas 2, 5 y 6 |
| 3. Pipeline | `superpowers:test-driven-development` | Escribir primero los tests de adaptadores (respuestas guardadas) y de fórmulas | Antes de escribir cada adaptador | El proyecto exige tests con pytest por módulo; TDD evita fórmulas sin prueba |
| 3. Pipeline | `karpathy-guidelines` | Mantener el código simple y explicable en una entrevista | Durante la escritura | Reduce sobreingeniería, que es el riesgo principal de un pipeline grande |
| 3. Pipeline | `superpowers:systematic-debugging` | Diagnosticar fallas de adaptadores o del workflow mensual | Cuando algo falla | Obliga a encontrar la causa antes de parchear |
| 3. Pipeline | `code-review` | Revisar el pipeline completo antes de mergear | Al terminar la etapa | Busca bugs de corrección en el diff; `simplify` solo mira calidad |
| 4. Tablas y estadísticas | `data:sql-queries` y `data:write-query` | Escribir a mano las vistas, CTEs y funciones de ventana (rachas, forma, percentiles) | Antes de escribir cada vista | Especializadas en SQL analítico correcto y eficiente |
| 4. Tablas y estadísticas | `data:validate-data` | Validar el catálogo y los resultados contra cálculos a mano | Al terminar las vistas | Revisión de calidad de datos (nulos, rangos, conciliación) |
| 4. Tablas y estadísticas | `data:statistical-analysis` | Calibrar el exponente pitagórico y las métricas de 6.1 | Al implementar NR, EWA, ELA, Mejoría y Potencial | Métodos estadísticos (mínimos cuadrados, desvíos, regresión a la media) |
| 4. Tablas y estadísticas | `design:accessibility-review` | Revisar la grilla ARIA de las tablas maestras (teclado, lectores de pantalla) | Al terminar las Interfaces 2 y 3 | Específica de accesibilidad WCAG |
| 5. Gráficos | `dataviz` | Paleta, marcas, ejes y tooltips de los 50 o más gráficos con un sistema único | Antes de escribir el primer gráfico | Método agnóstico con validador de colores, coherente en claro y oscuro |
| 5. Gráficos | `data:create-viz` y `data:data-visualization` | Elegir el tipo de gráfico correcto para cada pregunta del catálogo | Al armar `chart_catalog.csv` | Heurística de forma de gráfico por tipo de dato |
| 5. Gráficos | `animejs` | Trazado de líneas con brillo neón y dibujo de SVG propio | Al animar gráficos | Anime.js maneja bien trazos SVG; motion queda para componentes React |
| 5. Gráficos | `impeccable` (`audit` y `polish`) | Revisión de cierre de la landing | Al cerrar la etapa | Pedido explícito de la sección 2.1 |
| 6. Situaciones y desglosada | `impeccable` (`shape` y `animate`) | Diseñar el tablero tipo Miro, marcos, tarjetas y la página desglosada | Antes de escribir el lienzo | Cubre interacción, jerarquía y movimiento |
| 6. Situaciones y desglosada | `animation-components:animated-component-libraries` | Inercia de arrastre, aparición escalonada y transición de elemento compartido | Al implementar el lienzo | Conoce las librerías de animación y sus costos |
| 6. Situaciones y desglosada | `impeccable` (`audit` y `polish`) | Revisión de cierre del tablero | Al cerrar la etapa | Pedido explícito de la sección 2.1 |
| 7. Comparación | `dataviz` | Radar, barras divergentes y gráfico de bala de la Interfaz 5 | Antes de escribir los gráficos | Mismo sistema visual que la landing |
| 8. Excel | `anthropic-skills:xlsx` | Libros con gráficos nativos, hojas interactivas con validación de datos y estilos | Antes de escribir el generador | Skill específica de hojas de cálculo con fórmulas y gráficos |
| 9. Power BI | `data:build-dashboard` y `data:sql-queries` | Modelo estrella, vistas para `powerbi_reader` y diseño de páginas | Antes de exportar los CSV | No hay una skill específica de Power BI y DAX (ver faltantes) |
| 10. Pulido | `impeccable` en secuencia `harden` → `shape` → `adapt` → `audit` → `polish` | Endurecer estados de error, responsive, auditoría y pulido final | En ese orden, al inicio de la etapa | Es la secuencia recomendada por el prompt para el pulido |
| 10. Pulido | `design:accessibility-review` | Auditoría WCAG final de las 5 interfaces | Después de `adapt` | Complementa a axe en Playwright con revisión humana |
| 10. Pulido | `security-review` y `code-review` | Revisión de seguridad (sección 14) y de código del proyecto completo | Antes del deploy final | Una mira amenazas y la otra corrección |
| 10. Pulido | `engineering:deploy-checklist` | Lista de verificación antes de cada deploy a producción | Antes de desplegar | Evita olvidar variables, migraciones y rollback |
| 10. Pulido | `superpowers:verification-before-completion` | Comprobar con evidencia cada criterio de la sección 13 | Al cerrar la etapa | Prohíbe declarar terminado sin ejecutar la verificación |
| 11. Documentación | `engineering:documentation` | README principal, manual técnico y de operación | Al inicio de la etapa | Documentación técnica estructurada |
| 11. Documentación | `anthropic-skills:doc-coauthoring` | Requisitos, casos de uso y plan de pruebas | Mientras se escriben | Flujo de redacción y revisión por lectores |
| 11. Documentación | `figma:figma-generate-diagram` | Diagramas en FigJam cuando Mermaid o PlantUML no alcancen | Solo si hace falta | Los diagramas principales van como código Mermaid en el repo |
| 11. Documentación | `operations:runbook` y `operations:risk-assessment` | Runbooks de incidentes y registro de riesgos | Al escribir `docs/security/` y `docs/gestion/` | Formatos operativos estándar |
| 11. Documentación | `anthropic-skills:xlsx` | Matriz de casos de prueba con resultados reales y estilos | Al final, con los reportes JUnit | Genera el `.xlsx` con formato |
| 11. Documentación | `anthropic-skills:pdf` | Documento único de entrega en PDF | Al final | Compila y numera el PDF |
| 11. Documentación | `human-resources:interview-prep` | Guía de 30 preguntas de entrevista sobre el proyecto | Al escribir `docs/portfolio/` | Arma preguntas y respuestas por perfil de puesto |

## Skills clave que faltan

- **Supabase y Postgres:** no hay una skill instalada de buenas prácticas de Supabase (RLS, privilegios, esquemas expuestos). Existe el paquete oficial `supabase/agent-skills` (`npx skills add supabase/agent-skills`); instalarlo es decisión del dueño. Mientras tanto se usan el MCP de Supabase, su Security Advisor y `security-review`.
- **Power BI y DAX:** no hay skill específica. Se cubre con `data:build-dashboard`, la documentación oficial y pruebas manuales en Power BI Desktop.
- **Pruebas end-to-end con Playwright:** no hay skill específica; se usa `superpowers:test-driven-development` y la documentación oficial de Playwright.
