# Recuperación ante desastres (16.5)

Qué hacer si se pierde la máquina, el proyecto de Supabase o el despliegue, y cuánto tarda volver.

## Qué hay y dónde

| Pieza | Dónde vive | Se recupera desde |
|---|---|---|
| Código, migraciones, catálogos, documentación | GitHub | `git clone` |
| Datos de partidos y estadísticas | Supabase (`core`) | El pipeline los vuelve a calcular desde las fuentes (unos 30 min); el backup cifrado mensual (`backup.yml`, artefacto de 90 días) guarda todo lo publicado aunque una fuente desaparezca |
| Libros de Excel y CSV de Power BI | Bucket `exports` | Se regeneran con `pipeline.excel` y `pipeline.powerbi --upload` |
| Sitio | Vercel (conectado al repositorio) | Un push a `main`, o «Redeploy» en Vercel |
| Claves | GitHub Secrets, Vercel y el `.env` del dueño | Se rotan y se vuelven a cargar (ver `docs/security/access_review.md`) |

## Objetivos

- **RPO (cuántos datos se pueden perder):** ninguno de lo que todavía publican las fuentes, porque se vuelve
  a calcular; de lo publicado, como mucho un mes (el último backup cifrado).
- **RTO (cuánto tarda volver):** objetivo de 2 horas con el proyecto de Supabase en pie y de 4 horas si hay
  que crear uno nuevo.

## Procedimiento

1. **Máquina nueva:** `git clone`, copiar `.env.example` a `.env` y `web/.env.example` a `web/.env.local`, y
   completarlos (las claves salen de Supabase → Settings → API Keys).
2. **Proyecto de Supabase nuevo, si hace falta:** crearlo en la misma región, aplicar las migraciones con
   `npx supabase link --project-ref <ref>` y `npx supabase db push`, deshabilitar el registro en Auth y
   crear el bucket con la migración `exports_bucket`. Revisar el Security Advisor: 0 ERROR y 0 WARN.
3. **`bash scripts/bootstrap.sh --con-datos`** (o `just bootstrap`): comprueba herramientas y configuración,
   instala dependencias, corre las pruebas, verifica que la base responda, corre el pipeline, regenera los
   libros y los CSV y arma la web. Cronometra cada paso.
4. **Sitio:** actualizar en Vercel las dos variables públicas si cambió el proyecto y volver a desplegar.
   Actualizar los secretos de GitHub (`SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `SUPABASE_PUBLISHABLE_KEY`).
5. **Verificar:** `/api/health` responde `ok`, `/estado` muestra la corrida nueva y `pnpm e2e` contra
   producción (`E2E_BASE_URL=https://pelotheta-futbol.vercel.app pnpm e2e`) da todo en verde.

## Simulacros

| Fecha | Alcance | Resultado | Tiempo |
|---|---|---|---|
| 2-nov-2026 | Pasos 1 y 3 sin `--con-datos` en la máquina del dueño (dependencias en caché) | Todo en verde | 2 min |
| 2-nov-2026 | Backup cifrado de las 40 vistas y restauración de prueba (`scripts/backup.py --verify`) | 96.734 filas restauradas y verificadas contra el manifiesto | 2 s |

La clave privada del backup está en la máquina del dueño (`~/.pelotheta/backup-age.key`). Sin ella, los
backups no se pueden abrir: guardala también fuera de esa máquina.
