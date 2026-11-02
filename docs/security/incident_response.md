# Respuesta a incidentes

Basado en NIST SP 800-61 (preparación; detección y análisis; contención, erradicación y
recuperación; actividad posterior). Un solo responsable: el dueño.

## Severidades

| Nivel | Ejemplo | Tiempo de respuesta |
|---|---|---|
| Crítica | Clave secreta filtrada; datos alterados publicados | Mismo día |
| Alta | Sitio caído o desfigurado; dependencia con CVE explotable | 24 h |
| Media | Hallazgo de ZAP o CodeQL sin explotación conocida | 7 días |
| Baja | Cabecera faltante, aviso informativo | Próxima etapa |

Detección: issues automáticos de `security_weekly.yml` (etiqueta `security`) y `health.yml`
(etiqueta `salud`), alertas de Dependabot, CodeQL y secret scanning, y reportes por `SECURITY.md`.
Estados de cada issue: nuevo, en análisis, mitigado, cerrado, falso positivo.

## Evidencia a conservar siempre

Antes de tocar nada: captura o export de la corrida de Actions, filas relevantes de
`core.audit_log` e `core.ingest_log`, hashes de `data/raw/manifest.jsonl`, el SHA desplegado
(`/api/health`) y la hora (UTC) de cada paso.

## Playbooks

### Clave filtrada

1. **Revocar y rotar** en el panel del proveedor (Supabase → API Keys: crear una secreta nueva y
   borrar la vieja; GitHub → Settings → Tokens; fuentes de datos en su panel).
2. Actualizar GitHub Secrets (`SUPABASE_SECRET_KEY`) y las variables de Vercel; volver a desplegar.
3. Revisar `core.audit_log` y los logs de Supabase (API y Storage) desde la hora de la filtración:
   ¿hubo escrituras que no son del pipeline?
4. Si la clave llegó al repositorio: quitarla del historial (`git filter-repo`), forzar push y pedir
   a GitHub que purgue las cachés. gitleaks sobre todo el historial para confirmar.
5. Si hubo escritura indebida, seguir el playbook de datos alterados.

### Datos corruptos o alterados

1. Frenar el workflow `update.yml` (deshabilitarlo en Actions) para que no se propaguen.
2. Comparar con la corrida anterior (`ingest_log`: filas, partidos, sumas de control).
3. Restaurar desde el backup cifrado o recargar desde `data/raw` por hash con
   `python -m pipeline.run` sobre la caché.
4. Invalidar la caché de la web (botón Actualizar o `revalidateTag('supabase-datos')`).

### Sitio caído o desfigurado

1. Vercel → Deployments → el último despliegue sano → **Instant Rollback**.
2. Si es un ataque de tráfico: Vercel → Firewall → **Attack Challenge Mode**.
3. Revisar el commit que se desplegó y quién lo hizo; rotar el token de Vercel si hace falta.

### Dependencia comprometida

1. Fijar la versión sana en el lockfile (`pnpm` o `uv`) y volver a desplegar.
2. Revisar el lockfile y el SBOM: ¿qué versiones llegaron a producción y cuándo?
3. Si la dependencia corre en el pipeline, tratar las claves de GitHub Secrets como filtradas.

### Supabase pausado

1. Panel de Supabase → **Restore project** (tarda unos minutos).
2. Confirmar con `/api/health` y `/estado`; correr `keepalive.yml` a mano.
3. Si el proyecto no vuelve: crear uno nuevo, aplicar `supabase/migrations/` y restaurar el backup.

## Después de cada incidente

Línea de tiempo, causa raíz, qué control falló o faltó, y una fila nueva o actualizada en
`risk_register.csv`.

## Simulacro

Pendiente antes de la entrega (etapa 11): ejercicio de mesa del playbook de clave filtrada,
documentado en este archivo con fecha, duración y lo aprendido.
