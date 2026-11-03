# Informe de cierre (2-nov-2026)

**URL:** <https://pelotheta-futbol.vercel.app>

## Alcance logrado frente al planificado

Las 11 etapas de la tabla 3.1 están hechas. Lo que no se hizo tal cual pide el prompt está justificado en
`docs/ideas_extra.md` y en `docs/security/fuera_de_alcance.md`. Desvíos del Gantt en `docs/gestion/gantt.md`:
la pausa del 29-oct al 2-nov y el rediseño por el repositorio privado.

## Métricas finales

| Métrica | Valor |
|---|---|
| Pruebas automatizadas | 558 casos (pytest 255, Vitest 143, Playwright 102 y 58 omitidos): 0 fallan |
| Cobertura | Pipeline 89 % (mínimo 85), web 93 % de líneas (mínimo 80) |
| Accesibilidad | 0 violaciones de axe en 14 rutas, 2 temas, escritorio y celular |
| Lighthouse (celular) | Accesibilidad 100, SEO 100; rendimiento por debajo de 80 en la landing (ver siguientes pasos) |
| Seguridad de la base | pgTAP 10/10 |
| Calidad de datos | 16/16 chequeos sin fallas |
| Base | 40 MB de 500 MB (8 %) |
| Estadísticas | 344 en el catálogo: 157 nivel A, 175 nivel B, 12 nivel C; 332 con datos; 19 estimadas |
| Gráficos | 103 diseñados, 100 con datos reales |
| Tarjetas de situaciones | 132 en el catálogo, 123 con datos reales |

## Fuentes (carga del 2-nov-2026)

| Fuente | Estado |
|---|---|
| Promiedos | Funciona: partidos, alineaciones, eventos y tabla (fuente principal) |
| ScoutingStats | Funciona: 46 partidos |
| Bzzoiro | Funciona: 46 partidos |
| NoFluffPicks | Funciona: 32 partidos (xG de liga) |
| Open-Meteo | Funciona: clima de 46 partidos |
| Wikipedia | Funciona: 36 perfiles |
| StrikerAPI | **Falla:** HTTP 402; quedan los datos de cargas anteriores (750 remates) |
| Statshub | **Falla:** sin respuesta en la última carga; quedan los datos anteriores |
| ELNINE | **Bloqueada:** Cloudflare desafía al cliente automático; no se evade (ADR 0008) |

## Siguientes pasos

1. Renovar o reemplazar StrikerAPI (remates con xG y coordenadas) y revisar Statshub.
2. Calcular la landing en el servidor para subir el rendimiento en celular.
3. Validar el Potencial α con la temporada 2027.
