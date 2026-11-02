# Supabase Advisors

## 2-nov-2026 (etapas 9 y 10.1)

Security Advisor: 0 ERROR, 0 WARN. Siguen solo los 2 INFO intencionales de la etapa 1. El rol
`powerbi_reader` no generó avisos.

## 28-oct-2026 (cierre de la etapa 3)

Security Advisor: 0 ERROR, 0 WARN. Siguen solo los 2 INFO intencionales de la etapa 1
(`rls_enabled_no_policy` en `core.audit_log` y `core.source_id_map`).

## 27-oct-2026 (etapa 1)

Security Advisor: 0 ERROR, 0 WARN.

| Nivel | Hallazgo | Justificación |
|---|---|---|
| INFO | `rls_enabled_no_policy` en `core.audit_log` y `core.source_id_map` | Intencional: RLS activo sin políticas niega todo a anon y authenticated. Solo los usa el pipeline con la clave secreta. |

Performance Advisor: se agregaron índices a las 4 claves foráneas señaladas (migración `fk_indexes`). Los avisos `unused_index` son esperables con la base vacía.
