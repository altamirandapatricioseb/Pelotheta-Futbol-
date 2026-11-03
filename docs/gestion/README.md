# Gestión del proyecto (16.9)

El proyecto se llevó por etapas (tabla 3.1 del prompt), una por entregable, con un commit de cierre y el
estado en `README_TEMPORAL.md` al terminar cada una. Los informes de estado y las retrospectivas están en
`estado/`; la visión, el backlog y la hoja de ruta, en `docs/producto/vision.md`.

## Por qué no hay tablero de GitHub Projects

El repositorio es privado y lo lleva una sola persona: un tablero con un issue por entregable duplicaría lo
que ya registran los commits de cierre y el README temporal. Si el repositorio se abre o se suma alguien,
cada fila de la tabla de abajo pasa a ser un milestone y cada ítem del backlog un issue.

## Definición de Terminado (aplicada en cada etapa)

1. Funciona en producción (`https://pelotheta-futbol.vercel.app`) y se verificó en el navegador.
2. Lint, tipos y pruebas en verde (Python y web), con pruebas nuevas para la lógica nueva.
3. Accesibilidad: axe sin violaciones en las rutas tocadas.
4. Seguridad: cierre 14.9 (sin secretos, RLS, cabeceras, advisors de Supabase en 0 ERROR y 0 WARN).
5. Documentado: README temporal y el documento de la sección correspondiente.

## Etapas

| Etapa | Planificado | Real | Desvío |
|---|---|---|---|
| 1. Base, Fase 0 y seguridad | 27-oct | 27-oct | — |
| 2. Esqueleto y tabla Resumen | 27-oct | 27-oct | — |
| 3. Pipeline mensual y Actualizar | 27-oct | 28-oct | Cierre de 14.9 y keepalive |
| 4. Catálogo y tablas maestras | 28-oct | 28-oct | — |
| 5. Gráficos | 28-oct | 28-oct | — |
| 6. Situaciones y desglosada | 28-oct | 28-oct | Más conclusiones que las pedidas |
| 7. Comparación | 28-oct | 28-oct | — |
| 8. Excel | 28-oct | 2-nov | La hoja Desglosada quedó pendiente hasta el 2-nov |
| 9. Power BI | 2-nov | 2-nov | — |
| 10. Pulido, seguridad y extras | 2-nov | 2-nov | Repositorio privado: soporte y reporte rediseñados ([informe](estado/2026-11-02_etapa-10.md)) |
| 11. Documentación y entrega | — | En curso | — |
