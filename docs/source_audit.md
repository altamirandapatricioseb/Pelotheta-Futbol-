# Auditoría de fuentes (Fase 0)

Fecha: 27-oct-2026. Objetivo: comprobar con pocas requests reales qué devuelve cada fuente gratuita para Boca Juniors 2026 y qué permite cada una, antes de armar el catálogo de estadísticas.

## Metodología

- Todas las requests de datos pasan por `sources/http_client.py` (`PoliteClient`): User-Agent identificable con el enlace al repositorio, pausa mínima de 3 s por host (6 s en FBref), caché local, lectura de robots.txt antes de cada host (si no se puede leer, no se pide nada), TLS verificado, tamaño máximo, sin redirecciones a otros dominios y manifiesto con SHA-256 en `data/raw/manifest.jsonl`.
- Tope de 10 requests de datos por fuente. Sin evasión de bloqueos, sin cuentas nuevas, sin claves pedidas en el chat.
- Términos y documentación se leyeron aparte (lectura de documentación, no de datos).
- Reproducir una sonda: `uv run python -m scripts.phase0.probe_<fuente>` (o `just probe <fuente>`). Informe completo de cada una en `data/raw/phase0/<fuente>.json`. La caché cruda no se publica (`data/raw/cache/` está en `.gitignore`).

## Resumen

| Fuente | Estado | Cubre Liga Profesional 2026 | Datos crudos mínimos que aporta | Requests | Recomendación |
|---|---|---|---|---|---|
| API-Football | probado con clave (27-oct) | **no**: el plan Free responde `errors.plan` y solo permite 2022 a 2024 | partidos, alineaciones, eventos, box score equipo y jugador (solo temporadas viejas) | 5 | Solo histórico 2022 a 2024 |
| Promiedos | funciona (sin robots.txt; datos en `__NEXT_DATA__` del HTML) | sí: Liga Profesional, Copa Argentina, Libertadores; 34 partidos jugados de Boca listados | alineaciones con formación, eventos con minuto (goles, tarjetas, cambios), estadísticas por equipo, árbitro, estadio, plantel con nacimiento y altura, tabla, goleadores | 3 | **Principal** |
| FBref | bloqueado (Cloudflare, 403 hasta en robots.txt) | no verificado | ninguno | 1 | Descartar en automático; solo referencia manual |
| FootyStats | no probado por términos (web prohíbe automatizar; API paga, robots `Disallow: /`) | sí (en la web) | ninguno | 1 | Solo referencia manual |
| ESPN | no probado por términos (Disney 2.B(x) prohíbe scripts; robots de la API 403) | no verificado | ninguno | 3 | Descartar |
| FotMob y Sofascore | solo revisión documental (términos prohíben scraping; robots prohíbe `/api/`) | no verificado | ninguno | 2 | Descartar; siguen desactivadas |
| TheSportsDB (clave gratis 123) | funciona parcial | sí | partidos, eventos con minuto, box score equipo, tabla (con topes: 15 partidos por temporada, 5 filas por detalle) | 9 | Validación cruzada y puente de ids |
| SportScore | no probado por términos (robots prohíbe `/api/`; términos tras desafío de Cloudflare) | no verificado | ninguno | 3 | Descartar por ahora |
| football-data.org | sin cobertura (Liga Profesional en plan pago TIER_TWO) | no | ninguno | 2 | Descartar |
| Football Soccer API (footballsoccerapi.com) | requiere clave (alta solo con Google) | no verificado | no verificado | 1 | Pendiente de decisión del dueño |
| BocaStats | funciona (páginas permitidas por robots; `/api/` prohibido) | sí: temporada 2026 con Liga Profesional (19), Copa Argentina (3), Libertadores (6), Sudamericana (8) | resultados, goleadores, plantel y fichas (HTML); términos no verificados | 4 | Validación cruzada manual hasta revisar sus términos |
| football-data.co.uk (`new/ARG.csv`) | funciona | sí: 449 partidos de la Liga Profesional 2026, 30 equipos, 30 de Boca | partidos con resultado final de toda la liga | 2 | Validación cruzada de resultados y tabla |
| worldfootball.net | bloqueado (desafío de Cloudflare) | no verificado | ninguno | 1 | Descartar |
| Transfermarkt | robots permite, términos prohíben el acceso automatizado | sí (en la web) | ninguno | 1 | Descartar |
| Wikidata y Wikipedia | sonda escrita, ejecución interrumpida | no aplica | plantel con fecha de nacimiento, altura y posición; coordenadas de estadios | 0 | Pendiente: correr `just probe wikidata_wikipedia` |
| Open-Meteo | no probado (robots.txt de la API prohíbe todo a robots) | no aplica | clima (opcional) | 0 | Desactivada; decisión del dueño |

## Permisos por fuente

Tres permisos distintos además de consultar (regla de permisos de la sección 4).

| Fuente | Consultar | Descargar en bloque | Automatizar | Reutilizar en app pública | Atribución |
|---|---|---|---|---|---|
| API-Football | sí, con clave | no especificado; reventa prohibida | sí, dentro de la cuota | condicionado: los términos no otorgan licencia de publicación | no especificada |
| FBref | sí, persona en navegador | no | restringido sin permiso | según términos, sí con atribución | obligatoria (Sports Reference / FBref) |
| FootyStats | uso personal | no (web) | web prohibido; API paga sí | API paga sí | no exigida (API) |
| ESPN | uso personal | no | no sin permiso escrito | no | no especificada |
| FotMob y Sofascore | uso personal | prohibido | prohibido | prohibido | no aplica |
| TheSportsDB | sí (clave de desarrollo) | no especificado | sí | dudoso con la clave gratis | obligatoria para pagos |
| SportScore | ambiguo | no especificado | contradictorio (robots lo prohíbe) | según el cliente oficial, sí con enlace | obligatoria: «Powered by SportScore» |
| football-data.org | sí | no especificado | sí | sí, con atribución | obligatoria |
| football-data.co.uk | sí («My data is free») | de hecho sí (un CSV por liga) | no especificado; robots lo permite | no especificado | recomendada |
| BocaStats | sí | no especificado | robots lo permite salvo `/api/` | no especificado | recomendada |
| Open-Meteo | sí, no comercial | no especificado | conflicto con robots.txt | sí, CC BY 4.0 | obligatoria |

Términos revisados (URLs) y detalle de cada respuesta: ver `data/raw/phase0/<fuente>.json` y `docs/security/compliance_register.md`.

## Detalle por fuente

### API-Football (`v3.football.api-sports.io`)
- Ids supuestos, no verificados: liga 128 (Liga Profesional), equipo 451 (Boca).
- Según documentación: `/fixtures` (fecha, árbitro, estadio, resultado por tiempo), `/fixtures/lineups` (titulares y suplentes, sin minutos), `/fixtures/events` (minuto `elapsed` + `extra`, tipo, jugador, asistente; los cambios dan los minutos de entrada y salida), `/fixtures/statistics` (tiros, posesión, pases, córners, faltas, atajadas; `expected_goals` solo en algunas ligas), `/fixtures/players` (minutos, calificación, tiros, pases, entradas, duelos, regates, tarjetas, penales), `/players` (fecha de nacimiento, altura, peso, nacionalidad), `/standings`.
- Plan Free: 100 requests por día y 10 por minuto. Un reporte no oficial del 20-oct-2026 indica que la temporada en curso responde `errors.plan` en Free.
- Riesgo: el robots.txt del host de datos respondió 403; si sigue así, `PoliteClient` no lo consultará sin una decisión explícita del dueño (`check_robots=False` solo para una API autenticada).

### football-data.co.uk
- `new/ARG.csv`: Country, League, Season, Date, Time, Home, Away, HG, AG, Res y cuotas de cierre. Sin ids (equipos por nombre), sin medio tiempo, sin eventos.
- Las cuotas no se muestran en el sitio.

### TheSportsDB
- Boca: idTeam 135156; liga 4406 (Argentinian Primera Division, temporada `2026`).
- Endpoints gratis con topes: eventsseason (15 partidos), lookuptimeline, lookuplineup, lookupeventstats (5 filas). Trae ids cruzados de API-Football y ESPN: útil como puente.

### BocaStats
- Páginas de temporada, plantel, tabla, fichas de jugador y de partido permitidas por robots.txt; `/api/` prohibido. Datos en HTML y JSON-LD. Términos de uso no verificados todavía.

### Descartadas o en pausa
FBref, ESPN, FotMob, Sofascore, SportScore y football-data.org: los motivos están en la tabla de resumen. FootyStats y FBref quedan como referencia manual de una persona en el navegador. Open-Meteo queda desactivada.

## Dato crudo mínimo y lo que se deriva

| Dato crudo | Fuentes que lo traen hoy | Qué se deriva | Qué se pierde si cae la fuente principal |
|---|---|---|---|
| Partidos con resultado final (Boca y toda la liga) | football-data.co.uk (verificado), TheSportsDB (parcial), API-Football (con clave) | PJ, PG, PE, PP, puntos, GF, GC, diferencia, rachas, forma, tabla y su evolución, local/visitante, Elo, calidad del calendario, probabilidad pre-partido y Brier, puntos pitagóricos, ventaja de localía, rendimiento por nivel de rival, sorpresas, días de descanso, tarjetas de situaciones de resultados y rachas | Nada: football-data.co.uk lo cubre solo |
| Resultado al descanso | API-Football, TheSportsDB (parcial) | Situaciones al descanso, matriz descanso → final | Familias de tarjetas «al descanso» |
| Eventos con minuto (goles con tipo y asistente, tarjetas, cambios, penales) | API-Football (con clave), TheSportsDB (5 filas), BocaStats (por verificar) | Goles por tramo, minutos con ventaja/empate/desventaja, puntos desde atrás, primer gol, goles tardíos, tarjetas por tramo, asistencias | Tramos de minutos, situaciones por minuto, NR/EWA/ELA |
| Alineaciones con minutos de entrada y salida | API-Football (titulares + eventos de cambio) | Minutos en cancha, `v_on_court`, NR, EWA, ELA, carga 7/14/28 días, rotación, estabilidad del once (Jaccard), eficiencia de suplentes, con/sin jugador | Métricas propias de 6 y todo lo que depende de minutos |
| Box score por equipo (tiros, posesión, pases, córners, faltas) | API-Football, TheSportsDB (parcial) | Precisión de tiro, goles por tiro, situaciones de tiros, posesión, córners y disciplina | Familias C, D, E y F de situaciones |
| Box score por jugador (minutos, tiros, pases, entradas, calificación) | API-Football | Todo «por 90», porcentajes, percentiles, índice de rendimiento, Mejoría α y β, Potencial α y β, comparación | Interfaces 3 y 5 casi completas |
| xG | ninguna verificada (API-Football solo en algunas ligas) | xPts, goles − xG, npxG, xG por tiro | Quedan `n/d` |
| Plantel con fecha de nacimiento y posición | Wikidata (pendiente), API-Football, BocaStats | Edad a la fecha del partido, tramos de edad, Potencial, referencias por posición y zona | Potenciales y edades |

## Decisión de arquitectura de fuentes

Detalle y motivos en `docs/adr/0004-fuentes-y-boton-actualizar.md`.

1. **Principal:** Promiedos (páginas HTML públicas, sonda en `scripts/phase0/probe_promiedos.py`).
2. **Validación cruzada:** football-data.co.uk (resultados de toda la liga), TheSportsDB y BocaStats.
3. **Histórico:** API-Football 2022 a 2024 (el plan Free no incluye 2026).
4. **Respaldo manual:** `data/manual/` con CSV, esquema documentado en la etapa 3.
5. **Descartadas:** ESPN, FotMob, Sofascore, SportScore, football-data.org, Transfermarkt, worldfootball.net; FBref y FootyStats solo como referencia manual.

## Impacto orientativo en el catálogo

- Nivel B seguro (desde resultados): resultados, forma y rachas, tabla, Elo y probabilidad pre-partido, pitagóricos, localía, rendimiento por rival, días de descanso.
- Nivel A/B condicionado a eventos y alineaciones: tramos de minutos, NR, EWA, ELA, carga, rotación, situaciones por minuto.
- Desde alineaciones y eventos de Promiedos (nivel B): minutos, goles, asistencias y tarjetas por 90, NR, EWA, ELA, carga, rotación, situaciones por minuto, edad al partido.
- Sin fuente gratuita permitida (nivel C): box score individual (remates, pases, entradas, duelos y calificación por jugador). El índice de rendimiento, Mejoría y Potencial se calculan con las estadísticas disponibles y se marcan como estimados.
- Nivel C probable: xG, xA, npxG, pases progresivos, presiones, PPDA, Field Tilt, distancia y sprints, mapas de tiros.
