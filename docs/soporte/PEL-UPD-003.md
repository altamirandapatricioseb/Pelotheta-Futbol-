# PEL-UPD-003: La última actualización falló

**Qué es.** El workflow `Actualización` terminó con error; el panel muestra en qué paso.

**Qué ve quien usa el sitio.** El aviso «PEL-UPD-003: …» con un enlace a este artículo. El resto del sitio sigue funcionando.

## Causas habituales

- Una fuente caída (ver PEL-SRC-003).
- Error del pipeline (excepción en un cálculo).
- La base no aceptó la carga (ver PEL-DB-001).

## Cómo se resuelve

1. Abrir la corrida en Actions y leer el paso fallido.
2. Corregir y volver a correr: la carga es idempotente (upserts), no duplica datos.

## Severidad sugerida

Media; alta si falla dos meses seguidos.
