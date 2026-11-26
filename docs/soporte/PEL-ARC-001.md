# PEL-ARC-001: El archivo abierto no responde

**Qué es.** La página `/club/<id>` lee los datos públicos en Parquet del dataset de Hugging Face (`pelotheta/pelotheta-futbol`) y la lectura falló.

**Qué ve quien usa el sitio.** El aviso «PEL-ARC-001: …» con un enlace a este artículo. Las páginas que leen de Supabase siguen funcionando.

## Causas habituales

- Hugging Face caído o con límite de pedidos (3000 cada 5 minutos por IP sin cuenta).
- Un archivo cambió de ruta o de columnas sin subir `schema_version` (ver `docs/formato-parquet.md`).
- El `manifest.json` no está o quedó a medio subir.

## Cómo se resuelve

1. Abrir https://huggingface.co/datasets/pelotheta/pelotheta-futbol y revisar que estén `manifest.json` y los archivos.
2. Si faltan, volver a correr el workflow «Exportar Parquet».
3. Si están, buscar el error en los logs de Vercel (la ruta y el código HTTP van en el detalle).

## Severidad sugerida

Media: afecta solo a las fichas de club.
