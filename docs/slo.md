# Objetivos de servicio (SLO)

Un proyecto de portfolio con plan gratuito no promete lo mismo que un servicio pago: estos objetivos son los
que el sistema puede cumplir de verdad y cómo se mide cada uno. El estado actual se ve en `/estado`.

| SLO | Objetivo | Cómo se mide | Dónde se ve | Si no se cumple |
|---|---|---|---|---|
| Disponibilidad del sitio | 99 % mensual (unas 7 h de caída al mes) | `health.yml` consulta `/api/health` cada 6 h, dos veces seguidas | Issues con la etiqueta `salud` | Playbook «sitio caído» de `docs/security/incident_response.md` |
| Frescura de los datos | La última carga exitosa de partidos (Promiedos) tiene 35 días o menos | `source_status.last_success_at` de `promiedos` | `/estado`, «Objetivos de servicio» | Correr Actualizar; si falla, PEL-SRC-003 o PEL-UPD-003 |
| Carga mensual exitosa | La corrida mensual termina en `ok` o `parcial` | `pipeline_run_metrics.status` (una fila por corrida) | `/estado`, «Corridas del pipeline» | Leer el paso que falló en Actions; la carga es idempotente |
| Rendimiento de la web | Sin regresiones respecto del 2-nov-2026 | Lighthouse CI en cada PR que toque la web (`web/lighthouserc.json`) | Check «Lighthouse» del PR | Corregir antes de mergear |
| Tamaño de la base | Menos de 400 MB (el límite gratuito es 500 MB) | `pipeline_run_metrics.db_size_bytes`, medido por el servidor al terminar cada corrida | `/estado` | Podar `stat_match_value` de estadísticas sin uso (ver 9.8) |

## Presupuesto de rendimiento (2-nov-2026)

Lighthouse móvil (CPU ×4, red 4G lenta simulada), build de producción:

| Página | Rendimiento | TBT | LCP | CLS | Elementos del DOM |
|---|---|---|---|---|---|
| Inicio (gráficos) | 62 | 1,24 s | 4,0 s | 0 | 2.955 |
| Jugadores | 69 | 1,00 s | 3,5 s | 0 | 777 |
| Situaciones | 63 | 1,33 s | 3,7 s | 0 | 11.238 |
| Estadística desglosada | 76 | 0,66 s | 3,2 s | 0 | 1.036 |

Accesibilidad 100 y buenas prácticas 96 en todas. El CI falla si el rendimiento baja de 45, el TBT pasa
de 2 s, el CLS de 0,1 o accesibilidad de 95.

**Deuda conocida:** la landing calcula los ~100 gráficos en un solo componente de cliente, y eso explica la
mayor parte del TBT y del LCP. Los gráficos ya se montan recién cerca de la pantalla (el DOM bajó de 9.701 a
2.955 elementos y el TBT de 1,87 s a 1,24 s); el siguiente paso es calcular los datos de cada gráfico en el
servidor. Situaciones dibuja todas las tarjetas a la vez y es candidata al mismo montaje diferido.
