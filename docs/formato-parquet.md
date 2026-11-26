# Formato Parquet de la capa fría

Lo escribe `pipeline/export_parquet.py` (etapa 3 de `docs/plan-escala-conmebol.md`). Pensado para durar: formato abierto, versionado y con hashes.

## Estructura

```
publico/                      → dataset público de Hugging Face
  README.md                   tarjeta del dataset (licencia y atribuciones)
  manifest.json               versión, fecha y por archivo: filas, bytes, sha256, licencia, fuentes
  pais=ARG/equipo=<uid>/temporada=<año>/<tabla>.parquet
  pais=ARG/liga=<uid>/temporada=<año>/<tabla>.parquet
  referencia/<tabla>.parquet  cobertura, ids y alias, catálogo de estadísticas
privado/                      → solo a un dataset privado (nunca público)
  (misma estructura)          estadísticas de fuentes que no permiten redistribuir
```

- Compresión zstd nivel 9. Las columnas `jsonb` (stats, features) van como texto JSON.
- Los faltantes son `null`, nunca `0`. `referencia/coverage.parquet` dice qué hay por competición, temporada y tabla.
- Cada archivo lleva en sus metadatos `schema_version`, `tabla`, `licencia` y `fuentes`.

## Qué va a `publico` y qué a `privado`

1. Cada tabla se declara `abierta` o `restringida` en `TABLES` (con su motivo).
2. En las tablas con columna `source` que indica de dónde salió la fila, solo son públicas las filas de fuentes de `OPEN_SOURCES` (Promiedos con atribución, CC0, CC BY-SA y cálculos propios). El resto va a `privado` aunque la tabla sea abierta.
3. Una tabla nueva sin declarar no se exporta: hay que agregarla a `TABLES` y decidir su licencia.

## Versiones y migraciones

| `schema_version` | Fecha | Cambio |
|---|---|---|
| 1 | 25-nov-2026 | Primera versión: 26 vistas `api`, partición por equipo o liga y temporada |
| 1 | 26-nov-2026 | Tablas nuevas (compatible): `league_fixture` (próximos partidos, Promiedos), `model_run` (β y métricas de modelos propios), `league_market_value` (valor real CC0 y esperado por el modelo propio), `league_player_match` (crudo de Bzzoiro, solo privado) y `league_player_profile` (percentiles por posición cada 90, público) |

Regla para cambiar el formato:

1. Agregar una columna es compatible: no cambia la versión.
2. Renombrar, quitar o cambiar el tipo de una columna, o cambiar la partición, sube `SCHEMA_VERSION` y suma una fila a esta tabla con el cambio y cómo leer los archivos viejos.
3. Una migración reescribe particiones enteras con la versión nueva; nunca edita archivos en el lugar. El manifiesto viejo queda en el historial del repo de Hugging Face.

## Atajos de hoy (se quitan en la etapa 5)

- País, equipo y liga fijos (`ARG`, `arg-boca-juniors`, `arg-liga-profesional-argentina`): hoy solo hay datos de Boca.
- Lo que no trae fecha (agregados) va a la temporada en curso.
