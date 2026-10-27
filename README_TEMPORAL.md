# README temporal: estado del proyecto

## Dónde estamos: etapa 2 (Esqueleto) en verificación

- URL pública: https://pelotheta-futbol.vercel.app/ — header con las 6 interfaces, `/jugadores` con la tabla «Resumen» real (44 jugadores, 48 partidos oficiales 2026: Liga Profesional 31, Sudamericana 8, Libertadores 6, Copa Argentina 3).
- Pipeline: `uv run python -m pipeline.run` (Promiedos -> validación pydantic -> `ingest.load_batch` en Supabase por HTTPS con la clave secreta). Encuentra los partidos de enero a abril leyendo las páginas de los rivales. Amistosos excluidos.
- Base: esquema `ingest` expuesto solo para `service_role`; `anon` recibe 401 (probado en `tests/test_rls.py`). La edad sale de `core.player_age` sin exponer la fecha de nacimiento.
- Diseño: `PRODUCT.md` (contexto de diseño), tokens en `web/styles/tokens.css`.

## Etapa 1 (Preparación): terminada el 27-oct-2026

### Cierre de seguridad de la etapa 1

- Revisión de seguridad del commit `cf18fd4`: sin hallazgos altos ni medios. `_same_site` ya compara el host completo.
- Supabase Security Advisor: 0 errores, 0 avisos (`docs/security/advisors.md`).
- La clave de API-Football está solo en `.env` local (ignorado por git); no está en el repositorio ni en su historial.

## Cómo probar

```bash
uv sync && uv run pytest -q
```

Con `SUPABASE_URL` y `SUPABASE_PUBLISHABLE_KEY` en el entorno, `tests/test_rls.py` prueba la base real (lee sí, escribe no).

```bash
cd web && corepack pnpm@10.34.9 install && corepack pnpm@10.34.9 dev
```

Requiere `web/.env.local` con las dos variables de `web/.env.example`.

## Pasos manuales del dueño

Hechos (27-oct-2026): GitHub Secrets (`SUPABASE_URL`, clave secreta de Supabase, `API_FOOTBALL_KEY`), `GITHUB_DISPATCH_TOKEN` en Vercel, registros de usuarios desactivados en Supabase y protecciones de GitHub. Pendiente opcional: foto del equipo en `web/public/brand/team.webp` y logo en `web/public/brand/system-logo.svg` (o PNG cuadrado de 512 px con fondo transparente); mientras falten se ve el monograma «BJ» y el nombre en texto.

## Próxima etapa (3: Pipeline completo y botón Actualizar)

Skills: `superpowers:test-driven-development`, `karpathy-guidelines`, `superpowers:systematic-debugging` si algo falla, cierre con `code-review`. Workflow mensual y keepalive en GitHub Actions, Interfaz 6 Actualizar (ADR 0004), validación cruzada con football-data.co.uk.
