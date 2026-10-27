# ADR 0002: todo el cálculo en el pipeline, la web solo lee

- Estado: aceptada (27-oct-2026, etapa 1)

## Contexto
Vercel Hobby limita la duración de las funciones y es solo para uso no comercial. Las fuentes gratuitas son frágiles (regla 8).

## Decisión
- El pipeline de Python (GitHub Actions) baja datos crudos mínimos, los valida y calcula todas las métricas (niveles A, B y C) con SQL escrito a mano.
- La web solo lee resultados ya calculados desde el esquema `api`.

## Consecuencias
- La web es rápida y barata; un cambio de fórmula implica correr el pipeline.
- Si cae una fuente, la web sigue mostrando lo último cargado y la fecha de actualización.
