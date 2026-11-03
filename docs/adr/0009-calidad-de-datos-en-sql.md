# ADR 0009: chequeos de calidad en SQL escrito a mano

- Estado: aceptada (2-nov-2026, 16.1)

## Contexto
La sección 16.1 pide contratos, chequeos (unicidad, nulos, rangos, referencias, frescura, conciliación) y
menciona `pandera`. Los registros ya se validan al entrar con Pydantic.

## Decisión
Los chequeos de tabla viven en `sql/quality/checks.sql` (una vista, una fila por chequeo con id estable), los
corre `ingest.run_quality_checks()` al final de cada carga y el resultado se publica en `api.data_quality` y
en `/estado`. Los contratos (`data/contracts.yml`) nombran esos ids y un test los ata. No se agrega `pandera`.

## Consecuencias
- Los chequeos corren donde están los datos, sin bajarlos a Python.
- El primer chequeo de conciliación encontró los penales de la definición contados como goles (corregido).
