# Ficha del modelo: Mejoría y Potencial (sección 6.1)

## Propósito

Ordenar y explicar la evolución reciente y la proyección de los jugadores del plantel de Boca 2026. Son
**estimaciones** para conversar sobre el plantel, no predicciones ni valuaciones de mercado.

| Métrica | Pregunta | Escala |
|---|---|---|
| Índice de rendimiento | ¿Qué tan bien rinde frente a los de su posición? | 0 a 100 |
| Mejoría α | ¿Rinde mejor ahora que antes, en sus propias estadísticas? | 0 a 100; 50 = sin cambio |
| Mejoría β | ¿Cuántos puntos del índice subió o bajó frente a su posición? | −100 a +100 |
| Potencial α | ¿A qué percentil puede llegar en su pico de edad? | 0 a 100, rango ± 8 |
| Potencial β | ¿Qué tan prometedor es hoy (nivel, tendencia y edad)? | 0 a 100 |

## Datos

Valores por partido de `api.player_match_value` (alineaciones y eventos de Promiedos; estadísticas por jugador de
ScoutingStats, Statshub y Bzzoiro; tiros de StrikerAPI), minutos reconstruidos desde alineaciones y cambios,
posición del plantel y edad a la fecha de la carga. Temporada 2026, todas las competiciones oficiales.

## Método

- **Índice:** cada componente (A ataque, C creación, D defensa, E eficiencia, P participación, G portería) es el
  promedio de los percentiles de sus estadísticas contra la distribución de temporada de la misma posición (mínimo
  450 minutos; con menos de 8 jugadores se usan todos los de campo). Pesos por posición de 6.1.1. Un componente sin
  datos se saca y los pesos se reescalan; con cobertura menor a 0,6 el índice es `n/d`.
- **Mejoría α:** últimos 5 partidos (R) contra el resto de la temporada (B, mínimo 10). Tasas agregadas (suma sobre
  suma), `z = signo × (tasa_R − tasa_B) / σ` recortado a ±3, confiabilidad `w = min(Min) / (min(Min) + 270)` y
  `Mejoría α = 50 + 16,7 × w × Z`. La calificación pesa doble; menos de 3 estadísticas, `n/d`.
- **Mejoría β:** índice de las últimas 10 apariciones menos el de las 10 anteriores (mínimo 6 apariciones por
  bloque; entre 270 y 449 minutos se marca como provisional), con la misma referencia de temporada.
- **Potencial α:** nivel `N` (promedio de percentiles del set de Mejoría α) reducido por muestra chica
  (`50 + (N − 50) × Min / (Min + 900)`) más `G × años al pico × (1 + λ × M)`, tope 100, rango ± 8.
- **Potencial β:** `0,60 × R* + 0,25 × T + 0,15 × 100 × F_edad`, con `R*` el índice reducido por muestra chica y
  `T = R* + Mejoría β`.

## Supuestos

Todos los parámetros son los de arranque del prompt (pico de edad 27, porteros 29; `G` = 1,5; `λ` = 0,5; ± 8;
bandas de edad de 6.1.5). No se calibraron: hay una sola temporada cargada y el método delta necesita varias.

## Validación

- `tests/test_projection.py`: los cinco ejemplos numéricos del prompt reproducidos exactos y propiedades con
  `hypothesis` (Mejoría α entre 0 y 100 y 50 si no hay cambio; Potencial α = N pasado el pico; Potencial β ≤ 100;
  pesos reescalados suman 1) y una prueba con un plantel sintético.
- Pendiente para la etapa 6 (estadística desglosada): la serie partido a partido «a la fecha» y su backtesting
  (16.3), que reemplazaría el ± 8 por el error real.

## Límites y sesgos

- **Sesgo de supervivencia:** los jóvenes que juegan ya pasaron un filtro del cuerpo técnico; su Potencial puede
  sobreestimar el de un juvenil promedio.
- **Muestra chica:** con pocos minutos todo tiende a 50 a propósito (factores `w` y la reducción a 900 minutos).
- **Contexto:** no distingue rival, localía ni rol táctico; un cambio de posición altera los percentiles.
- **Datos faltantes:** sin pases progresivos; xG y xA dependen de la cobertura de cada fuente por competición.
- **Edad entera:** sin fecha de nacimiento pública, la edad no tiene decimales.
