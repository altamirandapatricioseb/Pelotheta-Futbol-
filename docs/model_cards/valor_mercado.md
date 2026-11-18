# Ficha del modelo: valor de mercado

| Campo | Valor |
|---|---|
| Propósito | Saber si el mercado paga a cada jugador más o menos de lo que se esperaría por su edad, posición, contrato, nacionalidad, club y rendimiento |
| Fórmula | Paso 1, con toda la liga: ln(valor) = β₀ + β₁·edad + β₂·edad² + β·posición + β₆·años de contrato + β₇·extranjero + β₈·ln(valor del resto del plantel), por mínimos cuadrados. Paso 2, con los jugadores propios: el residuo del paso 1 contra el índice de rendimiento del sistema (`pipeline/market_value.py`) |
| Datos | ~920 jugadores de la Liga Profesional con valor, edad, posición, contrato y nacionalidad (transfermarkt-datasets, CC0); índice de rendimiento del sistema para los propios |
| Salidas | Valor esperado con rango del 95 %, diferencia en %, aporte de cada variable frente al jugador promedio, 6 comparables de la liga (misma posición, edad y valor esperado parecidos) |
| Validación | Fuera de muestra: se entrena sin el club propio y se lo predice. 18-nov-2026: error típico (mediana) 58 %, R² 0,34 en la liga. Edad, contrato, nacionalidad y club significativos (p < 0,001). Rendimiento contra residuo: r = 0,63 con 33 jugadores (p < 0,001) |
| Por qué cambió | La versión del 18-nov usaba solo 20 jugadores con estadísticas: decía errar 37 %, pero dejando a cada uno afuera erraba 75 % (sobreajuste). Agregar estadísticas de rendimiento al primer paso empeoraba el error fuera de muestra |
| Límites | El valor de Transfermarkt es una estimación de su comunidad; lesiones, representante y ofertas no están en ningún dato abierto. El rango del 95 % es amplio: leer la diferencia como señal, no como precio |
| Sesgos | El paso 2 solo existe para el club propio (la liga no tiene estadísticas por jugador en fuentes abiertas) |
