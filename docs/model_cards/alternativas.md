# Ficha del modelo: alternativas (K-means)

| Campo | Valor |
|---|---|
| Propósito | Para cada jugador del plantel, los más parecidos de otro club, en dupla o del mismo plantel |
| Método | 17 estadísticas cada 90 minutos estandarizadas (z); K-means++ con k de 2 a 6 elegido por la silueta; parecido = 100 · (1 − d / d_ref), con d_ref el doble de la mayor distancia al centro (`pipeline/similarity.py`) |
| Datos | Estadísticas del sistema de los jugadores propios con 450 minutos o más (sin arqueros); de otros clubes, los que tengan al menos el 70 % de las estadísticas (lo que falta se completa con el promedio) |
| Salidas | Tres listas de mayor a menor parecido: otro club (10), dupla (5; con precios, más barata que el original) y plantel (5); perfiles, mapa por componentes principales y correlaciones |
| Desglose | Cada opción abre `/alternativas/<jugador>?seccion=&opcion=`: perfil por percentiles, qué se gana y qué se pierde (diferencia en desvíos del plantel), qué estadísticas explican la diferencia y el mapa precio contra parecido de todas las opciones |
| Validación | Silueta media del k elegido y curva por k en la página |
| Límites | Hoy solo hay estadísticas de los jugadores de Boca: las listas de otro club esperan esa fuente. El parecido es estadístico: no mira contexto táctico ni nivel del rival |
| Sesgos | Las estadísticas de volumen favorecen a quien juega en equipos que tienen más la pelota |
