# Ficha del modelo: pitagórico y puntos esperados (xPts)

| Campo | Valor |
|---|---|
| Propósito | Puntos que «merecía» un equipo según sus goles (pitagórico) o según la calidad de sus ocasiones (xPts) |
| Fórmulas | Pitagórico: GF^x / (GF^x + GC^x), con x calibrado en cada carga sobre la tabla de la liga. xPts = 3 × P(gana) + P(empata), con goles de Poisson independientes a partir del xG de cada equipo |
| Datos | Tabla de posiciones (Promiedos); xG por partido (ScoutingStats, NoFluffPicks) |
| Supuestos | Goles independientes entre equipos (Poisson); el xG de la fuente es correcto |
| Validación | `notebooks/02_calibracion.ipynb`: x = 1,30 en la tabla anual 2026 (entre 0,91 y 1,55 según la zona) |
| Límites | Con pocas fechas el exponente varía mucho; xPts depende de la cobertura de xG (37 de 48 partidos de Boca) |
| Se muestra | Siempre como estimado, con su nivel B |
