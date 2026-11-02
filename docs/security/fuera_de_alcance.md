# Fuera de alcance por plan gratuito

| Control | Por qué no | Alternativa aplicada |
|---|---|---|
| Restricción de red por IP en Supabase | Exige plan pago | `powerbi_reader` sin login hasta que el dueño lo activa; solo lectura; 5 conexiones |
| Backups descargables de Supabase (PITR) | El plan Free no los garantiza | Backup propio con `pg_dump` cifrado con `age` (workflow pendiente de la clave pública del dueño) |
| Limitación de tasa en Vercel Firewall | Reglas de rate limit limitadas en Hobby | Mitigación de DDoS de la plataforma, caché de datos de 6 h y enfriamiento de 60 min en Actualizar |
| Deployment Protection con contraseña | Plan pago | Vercel Authentication en los previews (solo el dueño) |
| Actualización programada en Power BI | Exige publicar en el servicio y licencia | Actualización manual en Power BI Desktop |
| Publicar el reporte de Power BI en la web | Licencia y habilitación del administrador | La web tiene sus propios gráficos |
| ZAP contra cada preview de PR | El preview está protegido y su URL cambia | ZAP baseline semanal contra producción |
