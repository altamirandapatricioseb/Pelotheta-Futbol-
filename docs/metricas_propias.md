# Métricas propias

Todas son nivel B (calculadas) y las marcadas como **estimadas** usan un supuesto. Se calculan en
`pipeline/own_metrics.py` (con las fórmulas de `pipeline/metrics.py`, `pipeline/projection.py` y
`pipeline/projection_data.py`) al final de cada corrida, con todo lo que hay en la base. Los valores por
partido se calculan solo con datos anteriores o iguales a la fecha de ese partido.

## Parámetros (supuestos de arranque, configurables)

| Parámetro | Valor | Dónde |
|---|---|---|
| Elo inicial, K, ventaja de localía V | 1500, 20, 100 | `metrics.ELO_START`, `ELO_K`, `ELO_HOME_ADVANTAGE` |
| Exponente pitagórico `x` | **calibrado**: 1,29 con la Tabla Anual 2026 (28-oct) | `metrics.calibrate_pythagorean` |
| Goles por equipo y partido de la liga `L` | 1,09 (liga 2026) | `own_metrics._league_goals_per_team` |
| Tasa de empates de la liga | 27 % | separa el empate en las probabilidades del Elo |
| Nivel de reemplazo | compañeros de la misma posición con 90 minutos o más y menos minutos que la mediana | `own_metrics._replacement` |
| Mínimo de minutos de la referencia de 6.1 | 450 | `projection_data.MIN_MINUTES` |
| K de confiabilidad (Mejoría α), K del nivel (Potencial) | 270 y 900 | `projection.K_RELIABILITY`, `K_LEVEL` |
| Pico de edad, G, λ, rango | 27 (porteros 29), 1,5, 0,5, ± 8 | `projection.PEAK_AGE`... |

## Equipo

- **Elo propio:** `E = 1 / (1 + 10^((R_rival − R_propio − V) / 400))` y `R_nuevo = R + K × (S − E)`, con todos
  los partidos de la liga 2025 y 2026 (sin duplicados entre fuentes: el mismo cruce a ±1 día es el mismo partido, porque StrikerAPI fecha en UTC y Promiedos en hora argentina). Para los partidos de copa se usa el último Elo
  conocido de Boca; el del rival existe solo si jugó la liga.
- **Probabilidad previa de ganar, empatar y perder (estimada):** el Elo da un solo número
  (`E = P(G) + P(E) / 2`). El empate se separa con la tasa de empates de la liga, máxima entre equipos parejos:
  `P(E) = d × 4E(1 − E)`. Se respeta `E` y las tres suman 1.
- **Sorpresa:** `resultado − E` (1, 0,5 o 0 menos el esperado). **Brier:** `Σ (p − o)²` de los tres resultados.
- **xPts (estimado):** `3 × P(gana) + P(empata)` con goles de Poisson independientes de media xG. Solo con el xG de
  los dos equipos. **Puntos − xPts:** suerte o eficacia por encima del juego.
- **Pitagórico:** `x` minimiza `Σ (puntos reales − 3 × PJ × GF^x / (GF^x + GC^x))²` en la Tabla Anual, por búsqueda
  en grilla de 0,5 a 3 con paso 0,01 (mínimos cuadrados de un parámetro, sin optimizador).
- **Rachas, forma, consistencia:** máximo de partidos seguidos; puntos de los últimos 5; desvío estándar muestral.
- **Rotación y estabilidad del once:** titulares nuevos frente al partido anterior y Jaccard
  (`|A ∩ B| / |A ∪ B|`).
- **Concentración de goles (Herfindahl):** `Σ (goles del jugador / goles del equipo)²`.
- **Puntos por tercio del rival:** según el puesto del rival en la Tabla Anual (solo rivales de la liga).

## Jugadores

- **NR** = `GF_on − GA_on` cada 90 minutos con el jugador en cancha. **NR relativo** = `NR − (GF_rep − GA_rep)`.
- **EWA** = `(Min / 90) × [P(GF_on) − P(GF_rep)]` y **ELA** = `(Min / 90) × [Q(GA_on) − Q(GA_rep)]`, con
  `P(a) = a^x / (a^x + L^x)`. ELA negativo es bueno.
- Son **resultados del equipo con el jugador en cancha, no producción individual**, y con menos de 900 minutos la
  web muestra un aviso de muestra pequeña.
- **Límite conocido del nivel de reemplazo:** los suplentes entran sobre todo en los segundos tiempos, cuando hay
  más goles, y eso infla su GF cada 90. Por eso el EWA de casi todos los titulares de 2026 da negativo: compara
  contra un reemplazo que jugó en el tramo más goleador. Se mantiene la definición del prompt y se avisa.
- **NR con xG:** `(xG_on − xGA_on) × 90 / minutos`, con el xG de cada tiro con minuto (StrikerAPI, solo liga) que
  cae entre la entrada y la salida del jugador. Solo cuenta los minutos de los partidos con tiros cargados.

## Sección 6.1: Mejoría y Potencial

Implementadas como pide el prompt (índice de rendimiento por componentes, Mejoría α y β, Potencial α y β), con cada
ejemplo numérico reproducido en `tests/test_projection.py`. Detalle, supuestos, validación y sesgos en
`docs/model_cards/mejoria_potencial.md`.

**Variantes descartadas, y por qué:**

- (a) «percentil × EWA / calificación × (28 − edad) / 10»: mezcla unidades, se vuelve cero o negativa después de los
  28 años, un EWA negativo invierte el signo y dividir por la calificación premia a quien juega peor.
- (b) «promedio de los últimos N − promedio de la temporada» de una sola estadística: no se descarta del todo, ya
  existe como ventana en la estadística desglosada (9.8, etapa 6), así que no hace falta una métrica aparte.

**Cambios frente al prompt por falta de datos:** el componente C no tiene pases progresivos (ninguna fuente
permitida) y el set de Mejoría α de mediocampistas no tiene pases progresivos cada 90; los pesos se reescalan como
indica 6.1.1. La edad es en años enteros: la fecha de nacimiento no es pública en la base (dato personal, 14.7).
Los parámetros viven en la tabla `core.projection_param` (con versión y fecha de vigencia; la vista `api.projection_param` da la vigente): el pipeline los lee antes de calcular y los valores del código son solo el arranque.

## Validación (2-nov-2026, `notebooks/`)

- **Elo (02 y 03):** con la liga 2026 (404 partidos evaluados), K = 30 y V = 50 dan un log-loss de 1,0539
  contra 1,0718 de K = 20 y V = 100. Se aplicó como versión 2 de `projection_param`. El Elo le gana a un
  pronóstico ingenuo (Brier 0,647 contra 0,661). La curva de calibración sobreestimaba al local con V = 100.
- **Exponente pitagórico (02):** 1,30 en la tabla anual (entre 0,91 y 1,55 según la zona); el pipeline
  lo calibra en cada corrida.
- **Mejoría α (04):** con 202 casos, su correlación con el cambio de calificación del bloque siguiente es
  negativa (Spearman −0,46) y la del nivel previo con ese cambio, más negativa (−0,62). Es la firma de la
  regresión a la media: la Mejoría α describe lo que pasó y **no anticipa** el bloque siguiente; hay que
  leerla como descripción, no como pronóstico.
- **Potencial α:** no se puede validar con una sola temporada por jugador; queda pendiente para 2027.

