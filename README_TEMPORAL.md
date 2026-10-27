# README temporal: estado del proyecto

## Dónde estamos: etapa 1 (Preparación)

- Supabase: proyecto `pelotheta-futbol` (`ymnbuywcpkynikudybth`, São Paulo, plan Free). Migraciones en `supabase/migrations/` aplicadas. Solo el esquema `api` está expuesto; tablas en `core` con RLS.
- Web: Next.js 16 en `web/`, lee la fila de prueba de `api.system_status` con la clave publicable.
- Fase 0: `docs/source_audit.md`. Plan de skills: `docs/skills_plan.md`.

## Cómo probar

```bash
uv sync && uv run pytest -q
```

Con `SUPABASE_URL` y `SUPABASE_PUBLISHABLE_KEY` en el entorno, `tests/test_rls.py` prueba la base real (lee sí, escribe no).

```bash
cd web && corepack pnpm@10.34.9 install && corepack pnpm@10.34.9 dev
```

Requiere `web/.env.local` con las dos variables de `web/.env.example`.

## Pasos manuales pendientes del dueño

1. Supabase, panel: Authentication > Sign In / Providers: desactivar «Allow new users to sign up» y el proveedor Email (el sistema no tiene cuentas).
2. GitHub: activar 2FA, secret scanning con push protection, Dependabot y protección de `main`.
3. Decidir la fuente de eventos, alineaciones y box scores (ver `docs/source_audit.md`, sección «Decisión de arquitectura»).

## Próxima etapa (2: Esqueleto)

Skills: `impeccable` (shape), `design:design-system`, `anthropic-skills:design-library`, `framer-motion`; cierre con `impeccable` audit y polish. Foto del equipo: soltarla en `web/public/brand/team.webp`. Logo del sistema: `web/public/brand/system-logo.svg` (o PNG cuadrado de 512 px, fondo transparente).
