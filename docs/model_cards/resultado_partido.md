# Ficha del modelo: resultado del partido (16.4)

**Estado: no publicado.** No le gana al Elo calibrado de forma consistente, que era la condición para
aparecer en la web.

| Campo | Valor |
|---|---|
| Tarea | Probabilidad de victoria, empate o derrota del local |
| Modelo | Regresión logística multinomial (`scikit-learn`) |
| Variables | Diferencia de Elo con localía (K = 30, V = 50), forma (puntos de los últimos 5) local − visitante, días de descanso local − visitante (tope 14). Todas conocidas antes del partido |
| Datos | Liga Profesional 2026, 464 partidos (StrikerAPI); los primeros 60 acomodan el Elo y la forma; 404 evaluados |
| Validación | `TimeSeriesSplit` de 5 pliegues, en orden de fecha: nunca entrena con partidos posteriores a los que pronostica |
| Comparación | El Elo solo, calibrado en `notebooks/02_calibracion.ipynb`, con la tasa de empates del tramo de entrenamiento |
| Resultado (2-nov-2026) | Log-loss medio 1,0836 (modelo) contra 1,0672 (Elo); el modelo gana en 2 de 5 pliegues |
| Primera versión | Contra el Elo sin calibrar (V = 100) el modelo ganaba (1,0846 contra 1,0877): su ventaja era corregir la localía, no información nueva. Por eso la comparación válida es contra el Elo calibrado |
| Formato | Coeficientes en JSON dentro del notebook (no `pickle`), para poder explicarlos |
| Límites | Una sola temporada; sin xG previo por equipo (la cobertura de xG de la liga es parcial) |
| Cuándo revisarlo | Con la temporada 2027 completa o con xG móvil de todos los equipos |

Notebook: `notebooks/05_modelo_resultado.ipynb` (HTML en `docs/notebooks/`).
