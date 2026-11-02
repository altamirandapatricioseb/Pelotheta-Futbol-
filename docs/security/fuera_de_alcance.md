# Fuera de alcance por plan gratuito

| Control | Por qué no | Alternativa aplicada |
|---|---|---|
| Restricción de red por IP en Supabase | Exige plan pago | `powerbi_reader` sin login hasta que el dueño lo activa; solo lectura; 5 conexiones |
| Backups descargables de Supabase (PITR) | El plan Free no los garantiza | Backup mensual propio de las vistas `api`, cifrado con age (`backup.yml`); restauración probada con `scripts/backup.py --verify` |
| Limitación de tasa en Vercel Firewall | Reglas de rate limit limitadas en Hobby | Mitigación de DDoS de la plataforma, caché de datos de 6 h y enfriamiento de 60 min en Actualizar |
| Deployment Protection con contraseña | Plan pago | Vercel Authentication en los previews (solo el dueño) |
| Actualización programada en Power BI | Exige publicar en el servicio y licencia | Actualización manual en Power BI Desktop |
| Publicar el reporte de Power BI en la web | Licencia y habilitación del administrador | La web tiene sus propios gráficos |
| ZAP contra cada preview de PR | El preview está protegido y su URL cambia | ZAP baseline semanal contra producción |
| Avisos privados de vulnerabilidades de GitHub | El repositorio es privado: no están disponibles para terceros | Contacto por el perfil del responsable (`security.txt`, `/privacidad#seguridad`) |
| Resultados de CodeQL y Scorecard en la pestaña Security | Repositorio privado sin GitHub Advanced Security | Informes SARIF como artefactos; CodeQL falla con hallazgos altos o críticos |
| Secret scanning con push protection | Configuración de la cuenta, no confirmada por el dueño | gitleaks en cada push y semanal sobre todo el historial |
| Protección de la rama `main` | El dueño publica directo a `main` | CI (lint, tipos, pruebas, Semgrep, gitleaks, auditorías) en cada push |
| Registro deshabilitado en Supabase Auth | No confirmado por el dueño | El sitio no usa Auth; `authenticated` no tiene permisos de escritura (pgTAP, prueba 2) |
| 2FA en las cuentas | No confirmado por el dueño | Riesgo aceptado (R16) con RLS y backup como límite del impacto |
| Pruebas pgTAP en CI | Necesitan la contraseña de la base | Se corren con el MCP o el SQL Editor antes de cada entrega (10/10 el 2-nov-2026) |
| ELNINE como fuente | Cloudflare desafía a clientes automáticos | No se evade; el adaptador lo registra como aviso |
