# Ficha del modelo: predictor de partidos

| Campo | Valor |
|---|---|
| Propósito | Probabilidad de ganar, empatar y perder del equipo contra cada rival, de local y de visitante |
| Fórmula | Maher (1982): λ_local = μ_local · ataque_local · defensa_visitante; goles Poisson independientes; matriz de marcadores de 0 a 6. Ataque y defensa encogidos hacia 1 con 3 partidos «promedio» |
| Datos | Resultados de la Liga Profesional de las últimas 3 temporadas (Promiedos, StrikerAPI y transfermarkt-datasets, nombres unificados con `TEAM_ALIASES`), cada partido pesado por 0,5^(días / 180) |
| Validación | Backtest sin mirar el futuro sobre la temporada actual. 18-nov-2026, 480 partidos: Brier 0,645 contra 0,657 de la línea de base (frecuencias de local, empate y visitante); log-loss 1,069 contra 1,085. La vida media de 180 días ganó a 90, 270, 365 y 540 días y a no pesar |
| Pruebas | χ² de bondad de ajuste a Poisson de goles a favor, en contra y de la liga; independencia entre localía y resultado; intervalo t de los goles a favor |
| Límites | Solo goles: no mira xG, lesiones, rotaciones ni copas. Los recién ascendidos arrancan en el promedio |
| Uso | No son cuotas de apuestas: el producto no muestra cuotas |
