# ADR 0007: publicar la clave publicable de Supabase

- Estado: aceptada (2-nov-2026, etapa 10)

## Contexto
La web leía la base solo desde el servidor, así que la clave publicable no estaba en el navegador. Pero la
API de solo lectura (16.2) es inútil sin ella, y los workflows que leen la base (keepalive, Lighthouse,
control semanal) dependían de un secreto que nadie iba a cargar: sin él, el keepalive fallaba y Supabase
pausaba la base.

## Decisión
La clave publicable se publica en `/api-docs` y queda como valor por defecto en esos workflows y en
`notebooks/datos.py`. `.gitleaks.toml` la exceptúa; la clave secreta sigue prohibida en todo el repositorio.

## Consecuencias
- Seguridad: la protección es la RLS, no el secreto de la clave. pgTAP verifica cero permisos de escritura en
  las 40 vistas para anon, authenticated y powerbi_reader; anon tiene 3 s por consulta y 1000 filas por pedido.
- Riesgo R17 (abuso de lectura) mitigado con esos límites y la caché de 6 h de la web.
