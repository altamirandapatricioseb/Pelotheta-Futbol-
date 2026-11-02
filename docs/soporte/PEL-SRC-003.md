# PEL-SRC-003: Una fuente de datos falló

**Qué es.** La última corrida de una fuente terminó con error (`source_status.last_status = error`). Se ve en `/estado`.

**Qué ve quien usa el sitio.** El aviso «PEL-SRC-003: …» con un enlace a este artículo. El resto del sitio sigue funcionando.

## Causas habituales

- La fuente cambió su formato o su API.
- Bloqueo o límite de pedidos de la fuente.
- Clave de la API vencida o sin cuota.

## Cómo se resuelve

1. Abrir la corrida del workflow `Actualización` y leer el paso del adaptador que falló.
2. Si cambió el formato: actualizar el adaptador en `sources/` y su prueba con la respuesta guardada.
3. Los datos anteriores siguen publicados: no hay pérdida, solo falta de frescura.

## Severidad sugerida

Media; alta si la fuente es la principal (Promiedos) y pasa de 35 días sin datos (SLO de frescura).
