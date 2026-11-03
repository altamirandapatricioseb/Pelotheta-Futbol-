# Visión del producto (16.8)

**Problema.** Los datos de Boca están repartidos en sitios que muestran el último partido o la tabla, pero
no permiten mirar una estadística en el tiempo, compararla contra el plantel o saber cuándo un número es
confiable. Los análisis serios existen detrás de pagos o en planillas privadas.

**Usuarios.**

| Persona | Quiere | Usa |
|---|---|---|
| Hincha analítico | Entender por qué Boca gana o pierde, más allá del resultado | Gráficos, Situaciones, estadística desglosada |
| Periodista deportivo | Un dato verificable, con fuente y fecha, para una nota | Tablas, «Ver origen de los datos», exportación a Excel |
| Reclutador técnico | Ver cómo trabaja quien hizo el sistema | `/api-docs`, `/estado`, los notebooks y la documentación de seguridad |

**Propuesta de valor.** Toda la temporada de Boca en un solo lugar, con cada número explicado (fuente,
nivel A, B o C, si es estimado) y rastreable hasta el partido que lo origina, gratis y sin cuentas.

**Qué no es.** No es un sitio de apuestas ni de pronósticos (el modelo predictivo no le gana al Elo y no se
publica), no tiene cuentas de usuario ni comentarios y no cubre otros equipos más que como rivales.

## KPIs de producto

Se ven en vivo en `/estado` («Cobertura del catálogo», «Calidad de datos» y «Objetivos de servicio»).

| KPI | Meta | 2-nov-2026 |
|---|---|---|
| Estadísticas con datos | ≥ 90 % del catálogo | 332 de 344 (97 %) |
| Gráficos con datos | ≥ 90 % | 100 de 103 (97 %) |
| Tarjetas de situaciones con datos | ≥ 90 % | 123 de 132 (93 %) |
| Valores `n/d` entre los calculados | ≤ 5 % | 0 % |
| Frescura de los partidos | ≤ 35 días | 1 día |
| Chequeos de calidad sin fallas | 100 % | 16 de 16 |

## Backlog priorizado (MoSCoW)

| Prioridad | Ítem | Estimación |
|---|---|---|
| Must | Calcular los datos de la landing en el servidor (rendimiento en celular) | 3 días |
| Must | Validar el Potencial α con la temporada 2027 (notebook 04) | 1 día, en 2027 |
| Should | Situaciones con montaje diferido, como la landing | 0,5 días |
| Should | Fuente con xG de todos los equipos de la liga (mejoraría el modelo de resultado) | 2 días, si aparece una fuente con permiso |
| Could | ELNINE si deja de bloquear clientes automáticos (DT y capacidad del estadio) | Ya implementado; se activa solo |
| Could | Mutation testing sobre `pipeline/metrics.py` | 1 día |
| Won't | Cuentas de usuario, comentarios, otros equipos | — |

## Hoja de ruta

| Cuándo | Qué |
|---|---|
| Noviembre de 2026 | Etapa 11: documentación y entrega |
| Diciembre de 2026 | Cierre de la temporada; backup y simulacro con datos completos |
| Febrero de 2027 | Temporada 2027: competiciones nuevas en el catálogo y revisión trimestral de accesos |
| Marzo de 2027 | Validación del Potencial α con dos temporadas |
