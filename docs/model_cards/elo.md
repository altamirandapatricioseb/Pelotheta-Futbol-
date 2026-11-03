# Ficha del modelo: Elo de clubes

| Campo | Valor |
|---|---|
| Propósito | Fuerza relativa de cada club y probabilidad pre-partido (victoria, empate, derrota) |
| Fórmula | E = 1 / (1 + 10^((R_rival − R_propio − V) / 400)); R_nuevo = R + K × (S − E); empate repartido con la tasa de empates de la liga |
| Parámetros | Inicio 1500, K = 30, V (localía) = 50; versión 2 de `projection_param`, calibrados el 2-nov-2026 |
| Datos | Resultados de la Liga Profesional (StrikerAPI y Promiedos), en orden de fecha |
| Supuestos | Todos los clubes arrancan iguales; la localía vale lo mismo en todas las canchas |
| Validación | `notebooks/03_validacion_elo.ipynb`: Brier 0,647 contra 0,661 del pronóstico ingenuo; log-loss 1,0539 con K = 30 y V = 50 (1,0718 con los parámetros de arranque) |
| Límites | Una temporada: los primeros 60 partidos sirven para que el Elo se acomode; no mira lesiones ni rotaciones |
| Sesgos | Favorece a quien jugó más partidos de liga; las copas no entran |
