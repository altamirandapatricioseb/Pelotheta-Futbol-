# ADR 0001: tablas en esquema privado `core` y lectura pública por vistas en `api`

- Estado: aceptada (27-oct-2026, etapa 1)

## Contexto
El sitio es público y usa la clave publicable de Supabase. Cualquiera puede leer esa clave del navegador o del HTML.

## Decisión
- Las tablas viven en `core`, que PostgREST no expone (`pgrst.db_schemas = 'api'`).
- La web lee solo vistas `security_invoker` del esquema `api`; RLS activo en todas las tablas con políticas de solo lectura para `anon`.
- Columnas sensibles (`player.birth_date`) quedan fuera de los permisos de columna.
- Solo el pipeline escribe, con la clave secreta guardada en GitHub Secrets.

## Consecuencias
- Un error de RLS no expone tablas que no estén en `api`. Cada vista nueva se agrega a propósito.
- `tests/test_rls.py` verifica contra la base real que `anon` lee `api` y no puede escribir ni ver `core`.
