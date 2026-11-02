# PEL-UPD-002: No se pudo consultar el estado de la actualización

**Qué es.** La API de GitHub no respondió a la consulta del estado del workflow.

**Qué ve quien usa el sitio.** El aviso «PEL-UPD-002: …» con un enlace a este artículo. El resto del sitio sigue funcionando.

## Causas habituales

- Corte o límite de pedidos de la API de GitHub.
- Token sin permiso de lectura de Actions.

## Cómo se resuelve

1. Probar de nuevo en unos minutos.
2. Si persiste, revisar el permiso del token y el estado de GitHub (githubstatus.com).

## Severidad sugerida

Baja.
