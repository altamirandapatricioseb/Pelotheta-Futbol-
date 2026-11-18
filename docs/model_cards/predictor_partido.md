# Ficha del modelo: predictor de partidos

| Campo | Valor |
|---|---|
| Propósito | Probabilidad de ganar, empatar y perder contra cada rival de la liga y de las copas (Libertadores, Sudamericana, Copa Argentina) |
| Fórmula | Poisson con enlace log (GLM) por mínimos cuadrados reponderados: ln λ = β₀ + β·ln(ataque propio) + β·ln(defensa del rival) + β·ln(valor del plantel propio / rival) + β·localía (y, como candidatas, Elo y forma). Ataque y defensa de Maher (1982), pesados por 0,5^(días / 180). Goles independientes: matriz de marcadores de 0 a 6 |
| Selección de variables | Backtest sin mirar el futuro sobre la temporada actual con cinco combinaciones; queda la de menor Brier. 18-nov-2026, 480 partidos: goles 0,645; goles + valor 0,622 (elegida); + Elo 0,624; + forma 0,622; todas 0,625. Línea de base (frecuencias): 0,657 |
| Datos | Resultados de la Liga Profesional de las últimas 3 temporadas (Promiedos, StrikerAPI, transfermarkt-datasets); valor del plantel de cada club (transfermarkt-datasets, incluye Brasil, Colombia y México); rivales de copa de la temporada |
| Rivales sin datos | Clubes de ligas que el dataset no cubre (Chile, Ecuador, Paraguay...) usan el valor típico de un club de la liga; uno de Primera Nacional, el 40 % del plantel más barato de Primera. La página lo marca como supuesto |
| Pruebas | χ² de bondad de ajuste a Poisson; independencia localía-resultado; intervalo t de los goles a favor; z de cada coeficiente |
| Límites | El valor del plantel es el actual (se usa también para partidos de meses atrás). No mira lesiones ni rotaciones; ataque y defensa no son significativos por separado porque el valor del plantel dice mucho de lo mismo |
| Uso | No son cuotas de apuestas: el producto no muestra cuotas |
