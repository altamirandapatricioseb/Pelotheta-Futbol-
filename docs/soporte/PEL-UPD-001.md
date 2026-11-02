# PEL-UPD-001: El botón Actualizar no está habilitado

**Qué es.** La función `/api/actualizar` no tiene configurado el token de GitHub.

**Qué ve quien usa el sitio.** El aviso «PEL-UPD-001: …» con un enlace a este artículo. El resto del sitio sigue funcionando.

## Causas habituales

- Falta la variable `GITHUB_DISPATCH_TOKEN` en Vercel (o no tiene el formato de un token de GitHub).
- El token venció.

## Cómo se resuelve

1. Crear un token fine-grained con permiso solo de Actions en este repositorio.
2. Cargarlo en Vercel → Settings → Environment Variables y volver a desplegar.

## Severidad sugerida

Baja: los datos se siguen cargando con el workflow mensual.
