# PEL-NF-404: No existe esa página o ese dato

**Qué es.** La ruta no existe, o el id de jugador, partido o estadística no está en la base.

**Qué ve quien usa el sitio.** El aviso «PEL-NF-404: …» con un enlace a este artículo. El resto del sitio sigue funcionando.

## Causas habituales

- Enlace viejo de antes de un cambio de rutas.
- Jugador que dejó el plantel y ya no está en `player_master`.
- Parámetros de la URL que no pasan la validación (Zod con listas cerradas).

## Cómo se resuelve

1. Comprobar el id en la vista correspondiente de `api`.
2. Si el enlace sale del propio sitio, es un defecto: abrir un issue con la página de origen.

## Severidad sugerida

Baja, salvo que el enlace roto salga del propio sitio (media).
