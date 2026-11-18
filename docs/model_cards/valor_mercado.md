# Ficha del modelo: valor de mercado

| Campo | Valor |
|---|---|
| Propósito | Comparar el valor de mercado de cada jugador con el que «merece» por edad, minutos y rendimiento |
| Fórmula | ln(valor) = β₀ + β₁·edad + β₂·edad² + β₃·minutos (miles) + β₄·(G+A)/90 + β₅·(npxG+xA)/90 + β₆·índice de rendimiento, por mínimos cuadrados (`pipeline/market_value.py`, sin dependencias) |
| Datos | Valores de transfermarkt-datasets (CC0) o del CSV manual; estadísticas del sistema de cada jugador con 450 minutos o más. Si hay jugadores de otros clubes con estadísticas, también entrenan |
| Salidas | Valor predicho con intervalo de predicción del 95 %, residuo en %, β con error estándar, t, p e intervalo |
| Validación | R², R² ajustado y error medio absoluto en %. 18-nov-2026: n = 20, R² 0,74, R² ajustado 0,62, error medio 37 % |
| Límites | Con 20 jugadores ningún coeficiente es significativo: leer los residuos como señal, no como precio. El valor de Transfermarkt es una estimación de su comunidad, no un precio de venta |
| Sesgos | Los jugadores jóvenes con pocos minutos quedan afuera; la reputación y el contrato no entran |
