# ADR 0004: Promiedos como fuente principal y botón «Actualizar»

- Estado: aceptada (27-oct-2026, cierre de etapa 1)

## Contexto
- API-Football (plan Free) responde `errors.plan` para 2026: solo da temporadas 2022 a 2024.
- FBref y worldfootball.net están detrás de un desafío de Cloudflare (no se evade). Transfermarkt, ESPN, FotMob, Sofascore y Flashscore prohíben el acceso automatizado en sus términos o en robots.txt.
- Promiedos no tiene robots.txt (404, permitido por RFC 9309), publica los datos en el HTML del servidor (`__NEXT_DATA__`) y trae por partido: alineaciones con formación y posición, eventos con minuto (goles, tarjetas, cambios), estadísticas por equipo (remates, al arco, posesión, ataques, faltas, córners, offsides, tarjetas), árbitro y estadio; por equipo: plantel con fecha de nacimiento y altura, tabla y goleadores.
- El dueño pidió tener todas las estadísticas posibles y un botón que actualice todo.

## Decisión
1. **Fuente principal:** Promiedos, solo páginas HTML públicas (no `api.promiedos.com.ar`), con `PoliteClient` (3 s de pausa, User-Agent identificable, caché: un partido terminado se baja una sola vez).
2. **Validación cruzada:** football-data.co.uk (resultados de toda la liga), TheSportsDB y BocaStats.
3. **API-Football:** queda para histórico 2022 a 2024 (referencias de Mejoría y Potencial), nunca para 2026 en el plan Free.
4. **Sin box score individual** (pases, remates, entradas por jugador): ninguna fuente gratuita y permitida lo trae para 2026. Esas estadísticas quedan nivel C (`n/d`). Minutos, goles, asistencias, tarjetas, NR, EWA, ELA, carga y rotación salen de alineaciones y eventos (nivel B).
5. **Interfaz 6 «Actualizar»:** un botón y la fecha y hora de la última actualización.
   - El botón llama a un route handler de Next.js (`POST /api/actualizar`) que dispara el workflow `update.yml` de GitHub Actions con `workflow_dispatch`. El token de GitHub (fine-grained, solo `Actions: write` en este repositorio) vive solo en Vercel como variable sensible del servidor.
   - Defensas: verificación de `Origin`, enfriamiento de 60 minutos (se consulta a GitHub si hubo una corrida reciente), `concurrency` en el workflow y respuesta sin detalles internos.
   - El workflow scrapea, valida, carga en Supabase con la clave secreta (GitHub Secrets) y recalcula.
   - La página consulta el estado de la corrida cada 10 s; al terminar, el servidor invalida la caché de datos (`revalidateTag`) y la página se refresca sola.
   - El workflow mensual programado sigue existiendo; el botón es un disparo adicional.

## Consecuencias
- Los datos de partido de Promiedos llevan atribución a Promiedos y a Opta; no se muestran cuotas ni datos crudos, solo estadísticas derivadas.
- Si Promiedos cambia su HTML, el adaptador falla con un error claro en `ingest_log` y la web sigue con lo último cargado.
- Riesgo de términos: la página legal de Promiedos no tiene texto legible en el HTML; se revisa de nuevo al cerrar la etapa 3 y cada 3 meses.
