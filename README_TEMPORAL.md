# README temporal: estado del proyecto

## Dónde estamos: etapa 1 (Preparación) terminada el 27-oct-2026

- URL pública: https://pelotheta-futbol.vercel.app/ (lee `api.system_status` desde Supabase con la clave publicable; CSP con nonce, HSTS y consola sin errores verificados en producción).
- Supabase: proyecto `pelotheta-futbol` (`ymnbuywcpkynikudybth`, São Paulo, plan Free). Solo el esquema `api` está expuesto; tablas en `core` con RLS.
- Fuentes: Promiedos principal; football-data.co.uk, TheSportsDB y BocaStats para validar; API-Football solo histórico 2022 a 2024 (el plan Free no incluye 2026). Ver `docs/source_audit.md` y `docs/adr/0004-fuentes-y-boton-actualizar.md`.
- Nueva Interfaz 6 «Actualizar» (botón + fecha y hora de la última actualización): diseño en ADR 0004; se construye en la etapa 3.

## Cierre de seguridad de la etapa 1

- Revisión de seguridad del commit `cf18fd4`: sin hallazgos altos ni medios. Mejora pendiente: `_same_site` en `sources/http_client.py` compara los dos últimos niveles del dominio (en `*.co.uk` acepta cualquier subdominio); se corrige en la etapa 3.
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

## Pasos manuales pendientes del dueño

1. Supabase, panel: Authentication > Sign In / Providers: desactivar «Allow new users to sign up» y el proveedor Email (el sistema no tiene cuentas).
2. GitHub: activar 2FA, secret scanning con push protection, Dependabot y protección de `main`.
3. Antes de la etapa 3 (pipeline y botón Actualizar):
   - GitHub > Settings > Secrets and variables > Actions: crear `SUPABASE_URL`, `SUPABASE_SECRET_KEY` (Supabase > Project Settings > API Keys > clave `sb_secret_...`) y `API_FOOTBALL_KEY`.
   - GitHub > Settings > Developer settings > Fine-grained tokens: token solo para este repositorio con permiso `Actions: Read and write` y vencimiento de 1 año. Cargarlo en Vercel > pelotheta-futbol > Settings > Environment Variables como `GITHUB_DISPATCH_TOKEN`, tipo Sensitive, solo Production.
   - La clave de API-Football se pegó en el chat: si querés máxima seguridad, regenerala en el panel de api-sports y cargá la nueva solo en GitHub Secrets.

## Próxima etapa (2: Esqueleto)

Skills: `impeccable` (shape), `design:design-system`, `anthropic-skills:design-library`, `framer-motion`; cierre con `impeccable` audit y polish. Header con 6 interfaces (Gráficos, Equipo, Jugadores, Situaciones, Comparar, Actualizar). Foto del equipo: soltarla en `web/public/brand/team.webp`. Logo del sistema: `web/public/brand/system-logo.svg` (o PNG cuadrado de 512 px, fondo transparente).
