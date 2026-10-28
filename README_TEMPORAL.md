# README temporal: estado del proyecto

Registro vivo: dónde estamos, qué falta, qué quedó a medias o falló. Actualizado el 28-oct-2026.
Para retomar en un chat nuevo: leer este archivo, `PROMPT-1-BOCA-FUTBOL.md` (ya recortado) y
`docs/source_audit.md`.

## Etapas (sección 3.1 del prompt)

| Etapa | Estado |
|---|---|
| 1. Preparación | Hecha (27-oct) |
| 2. Esqueleto desplegado | Hecha (27-oct) |
| 3. Pipeline completo | Hecha (28-oct): workflow corrido desde el botón con éxito y fecha nueva visible en la web |
| 4. Estadísticas, métricas propias y tablas | **En curso** en la rama `etapa-4` (ver abajo) |
| 5. Gráficos (Interfaz 1) | Pendiente |
| 6. Situaciones y estadística desglosada | Pendiente |
| 7. Comparación directa | Pendiente |
| 8. Excel | Pendiente |
| 9. Power BI | Pendiente |
| 10. Pulido | Pendiente |
| 11. Documentación y entrega | Pendiente |

## Etapa 3: cierre (28-oct-2026)

- URL: https://pelotheta-futbol.vercel.app/ — `/actualizar` con el botón (Interfaz 6).
- **Criterio cumplido:** corridas desde el botón el 28-oct a las 02:52 UTC y a las 03:55 UTC, las dos
  exitosas (unos 4 minutos con la caché). Después de la segunda, `/actualizar` y el header muestran
  «28/10/2026, 00:59» (hora argentina).
- Fuentes activas (detalle y permisos en `docs/source_audit.md` y `docs/security/compliance_register.md`):
  Promiedos (principal), ScoutingStats, Statshub (API de su web, con autorización explícita del dueño),
  Bzzoiro (clave), StrikerAPI (clave, 500 créditos/mes), NoFluffPicks, Open-Meteo, Wikipedia.
- **StrikerAPI sin créditos este mes:** responde HTTP 402. El pipeline sigue sin ella y conserva sus datos
  anteriores (1585 filas por jugador, 930 por equipo y 750 tiros). Se recarga el mes que viene.
- Base: 48 partidos de Boca 2026, unas 35 500 estadísticas por jugador, 25 MB de 500 MB.
- `.github/workflows/update.yml` (día 1 de cada mes y botón) y `.github/workflows/keepalive.yml` (lunes y
  jueves, sección 8.4).
- Botón: `POST /api/actualizar` dispara el workflow; verificación de Origin, enfriamiento de 60 min,
  estado cada 10 s y paso fallido visible en la página. Cuando una corrida termina bien, la web descarta
  su caché de datos (si no, la fecha nueva tardaba hasta 6 horas en verse).

### Qué falló y cómo se resolvió

1. **Dos corridas fallaron sin dejar rastro** (27-oct, 36 min; 28-oct 00:49 UTC, 44 min). Causa: el
   secret `SUPABASE_URL` terminaba en `.supabase.com` (copiado del `.env` local, que tenía el mismo
   error); la correcta termina en `.supabase.co`. El scraping terminaba y la carga se rechazaba por la
   forma de la URL; el registro del fallo usaba la misma URL y también fallaba. Arreglo: el pipeline
   limpia la URL y la clave, las valida y prueba una lectura a la base **antes** del scraping (si algo
   está mal, corta en segundos con un mensaje claro), y cualquier error inesperado queda en `ingest_log`.
   El dueño volvió a crear los secrets `SUPABASE_URL` y `SUPABASE_SECRET_KEY` el 28-oct.
2. **Claves expuestas, decisión del dueño (28-oct):** el `.env` completo (secreta de Supabase,
   StrikerAPI, Bzzoiro, API-Football) quedó en el chat por una captura. El dueño decidió **no rotarlas**.
   Riesgo aceptado y registrado (R01 en `docs/security/risk_register.csv`).

### Cierre de seguridad 14.9 de la etapa 3

- Security Advisor: 0 ERROR, 0 WARN, 2 INFO intencionales (`docs/security/advisors.md`).
- Cabeceras verificadas en la URL real: CSP con nonce, HSTS con preload, COOP, Permissions-Policy,
  nosniff, `X-Frame-Options: DENY`.
- `docs/security/risk_register.csv` creado (13 riesgos) y revisado.
- Falta confirmar el CI en verde: el repo es privado y se ve en GitHub (pestaña Actions, workflow «CI»).

### Pendientes que no bloquean

1. Eventos de StrikerAPI: 15 de 31 partidos (el resto llega cuando se recarguen los créditos).
2. Mails de permiso enviados (SporLens, ScoutingStats, PitchMath, GoalPulz): sin respuesta todavía.
3. Aviso automático si la base pasa los 400 MB (sección 7): el tamaño se mide en cada carga, el aviso
   falta.
4. Identidades duplicadas entre fuentes: «J. Barinaga» y «Juan Barinaga» figuran como dos jugadores
   (lo mismo puede pasar con «G. Gelini»).

## Cómo probar

```bash
uv sync && uv run pytest -q
uv run python -m pipeline.run
```

Con `SUPABASE_URL` y `SUPABASE_PUBLISHABLE_KEY` en el entorno, `tests/test_rls.py` prueba la base real.

```bash
cd web && corepack pnpm@10.34.9 install && corepack pnpm@10.34.9 dev
```

Si Supabase se pausa por inactividad (plan gratis, 7 días): entrar al panel de Supabase, abrir el
proyecto `pelotheta-futbol` y tocar «Restore project». El keepalive de lunes y jueves debería evitarlo.

## Etapa 4 (en curso, rama `etapa-4`)

Skills: `superpowers:test-driven-development`, `karpathy-guidelines`, `data:sql-queries`,
`data:statistical-analysis`, `impeccable` para las tablas, cierre con `code-review` y
`design:accessibility-review`.
