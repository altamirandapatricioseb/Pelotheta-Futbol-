# PEL-DB-001: La base de datos no responde

**Qué es.** La consulta a Supabase falló o tardó más que el límite (3 s para la clave pública).

**Qué ve quien usa el sitio.** El aviso «PEL-DB-001: …» con un enlace a este artículo. El resto del sitio sigue funcionando.

## Causas habituales

- El proyecto gratuito de Supabase se pausa tras 7 días sin actividad (el workflow `keepalive` lo evita).
- Corte del servicio de Supabase.
- Una consulta más pesada de lo normal que supera el `statement_timeout`.

## Cómo se resuelve

1. Abrir `/api/health`: si dice `base: caida`, la base no contesta.
2. Panel de Supabase: si el proyecto está pausado, reanudarlo (Restore).
3. Si responde pero una página sigue fallando, buscar la consulta en los logs de la API (Supabase → Logs) y revisar su plan.

## Severidad sugerida

Alta si afecta a todo el sitio; media si es una sola página.
