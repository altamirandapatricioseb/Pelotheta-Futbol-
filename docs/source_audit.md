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

## Segunda ronda de fuentes (27-oct-2026, pedido del dueño)

Fuentes propuestas por el dueño para estadísticas avanzadas. Para cada una se leyó robots.txt y los términos de uso antes de pedir datos.

| Fuente | robots.txt | Términos de uso | Datos de Boca 2026 | Decisión |
|---|---|---|---|---|
| NoFluffPicks (`nofluffpicks.com`) | permite todo (`Content-Signal: ai-input=yes`) | permiten navegar y citar con atribución; prohíben republicar partes sustanciales, quitar atribución y saltear controles. No prohíben el acceso automatizado | xG y xGA por partido de ambos equipos, remates, posesión, ataques peligrosos, córners y faltas de los 31 partidos de liga (datos de FootyStats) | **Activa**: xG y ataques peligrosos por partido; remates como validación cruzada |
| SporLens (`sporlens.com`) | permite | cláusula 9: los datos «no pueden recopilarse con herramientas automatizadas (scraping, etc.)» sin permiso escrito | xG, xA, pases, regates por jugador | **Descartada por términos** |
| PlayerStats (`playerstats.football`) | permite | sección 3 prohíbe «automated scraping tools»; sección 13 anuncia acciones legales | xG por jugador y partido | **Descartada por términos** |
| Fichajes.com | permite | aviso legal prohíbe extraer material por procedimientos distintos de los previstos y la reutilización; los datos son de Stats Perform con distribución prohibida | remates por zona, duelos | **Descartada por términos** |
| SofaScore, FotMob, WhoScored | FotMob y WhoScored permiten páginas; SofaScore responde 403 | prohíben el scraping (Fase 0; WhoScored según la documentación de socceraction) | rating, xG, xA, mapas de calor | **Descartadas por términos** |
| FBref | 403 de Cloudflare hasta en robots.txt | — | desde enero de 2026 sin métricas avanzadas | **Descartada**: no se evaden bloqueos |
| FootballNation | — | — | el dominio está a la venta, no hay sitio | **No existe** |
| StatsBomb Open Data | — | licencia abierta | no incluye a Boca 2026 | **No aplica** |
| understat / worldfootballR | — | — | understat no cubre Argentina; worldfootballR raspa FBref y Transfermarkt (mismas restricciones) | **No aplica** |

Conclusión: con NoFluffPicks entran el xG y el xGA por partido de equipo (y todo lo que se deriva: goles − xG, xG por remate, xPts con Poisson, probabilidad pre-partido). Las métricas avanzadas **por jugador** (xG, xA, pases, entradas, duelos, regates, calificación) solo existen en sitios cuyos términos prohíben el acceso automatizado: quedan nivel C hasta tener una fuente con permiso o licencia.

## Tercera ronda de fuentes (27-oct-2026, pedido del dueño: sin pagar, más nicho)

Mismo método: robots.txt y términos antes de pedir datos, User-Agent identificable, 3 s entre requests y nada de evadir desafíos de Cloudflare.

| Fuente | robots.txt | Términos de uso | Datos de Boca 2026 | Decisión |
|---|---|---|---|---|
| **ScoutingStats** (`scoutingstats.ai`) | permite páginas; bloquea `/api/` salvo algunas rutas de jugador | no prohíben el acceso automatizado (uso lícito, propiedad intelectual del contenido). Datos de Sportmonks | Páginas de partido terminadas, en HTML y sin login: xG, xGOT, npxG, xG de jugada y de pelota parada, puntos esperados, ocasiones claras, tiros dentro y fuera del área, pases y pases largos, centros, regates, entradas, intercepciones, duelos, atajadas y formaciones. **Por jugador de Boca:** calificación, pases y %, pases clave, remates y al arco, entradas, intercepciones, duelos ganados y regates. 45 partidos jugados (liga, Libertadores y Sudamericana), xG en 37. Sin Copa Argentina | **Activa** (`sources/scoutingstats.py`). Las páginas de jugador tienen desafío de Cloudflare: no se piden |
| StrikerAPI (`strikerapi.com`) | `/api/` cerrado al rastreo web; la API es el canal previsto | permiten uso personal y comercial, guardar y mostrar los datos; prohíben scrapear la web y revender. 500 créditos gratis por mes | Solo Liga Profesional (sin copas), desde 2000; **tiros con coordenadas, parte del cuerpo, resultado y xG propio desde 2014**; por jugador: goles, asistencias, remates, faltas, tarjetas y atajadas. Frescura de 2026 sin verificar | **Activa** (`sources/strikerapi.py`, clave `STRIKER_API_KEY`): 750 tiros ubicados de los 31 partidos de liga, faltas por jugador, despejes y entradas ganadas. Usa unos 175 créditos la primera vez y 2 por corrida sin partidos nuevos |
| OpenFootAPI (`openfootapi.com`) | permite | permiten guardar respuestas y uso analítico; exigen citar `meta.sources`. 5000 requests gratis por mes | Liga Profesional, Libertadores y Sudamericana 2026: fixture, tablas y alineaciones. xG solo en el plan pago | **Reserva** (validación cruzada; no suma estadísticas nuevas) |
| OpenScores (`openscores.ai`) | permite | uso libre con límites | solo las 5 grandes ligas de Europa y el Mundial | **No aplica** |
| SportAPI (`sportapi.ai`) | permite | uso en proyectos propios | su página de cobertura lista solo Inglaterra, España, Alemania, Italia y Francia | **No aplica** |
| PitchMath | permite | «Do not scrape the site» | percentiles de equipo | **Descartada por términos** |
| GoalPulz | permite (bloquea bots de IA) | «Do not scrape it in bulk, automate requests» | percentiles por área | **Descartada por términos** |
| MatchPulseStats | permite | prohíbe «Scraping, crawling or automated data extraction» | xG local y visitante | **Descartada por términos** |
| ESPN | — | términos de Disney prohíben robots, scripts y scraping | xG por jugador y partido | **Descartada por términos** |
| Tifolab, SoccerSTATS, Club Elo | desafío de Cloudflare hasta en robots.txt | — | xG y xA de Boca (Tifolab) | **Descartadas**: no se evaden bloqueos. Club Elo no lista equipos sudamericanos |
| Statshub, MakeYourStats, APWin | permiten | no se encontraron términos publicados | estadísticas de partido | **Sin uso**: ScoutingStats ya cubre lo que traen |
| FootyStats | permite páginas, cierra `/api/club*` | — | xG local/visitante | **Indirecta**: sus datos ya llegan por NoFluffPicks |
| openfootball, el-ega/data, dataset de Kaggle 2014-2025 | — | CC0 / CC BY-SA | resultados históricos (el de Kaggle copia FBref, cuyos términos no permiten redistribuir) | **Histórico, opcional**: solo resultados, sin estadísticas avanzadas |
| Goal Labs, Touchline, JLA Tactics Board, SportsLabTools | — | — | herramientas de video y pizarra, no publican datos | **No son fuentes** |

Conclusión: ScoutingStats destraba las estadísticas por jugador que faltaban (calificación, pases, pases clave, entradas, intercepciones, duelos y regates) y las tácticas de equipo (formación, xGOT, xG de jugada y de pelota parada, ocasiones claras, pases largos, duelos). Sigue sin haber fuente permitida para el xG y el xA por jugador, los pases progresivos, las presiones por zona y los eventos con coordenadas. StrikerAPI resolvería los mapas de tiros si el dueño crea la cuenta gratis.

## Cuarta ronda (27-oct-2026): lo que ya teníamos y no usábamos, más dos fuentes

Pedido del dueño: subir las estadísticas crudas a 75 % o más y el total a 90 %. Se revisó primero
lo que las fuentes activas ya publican y no se extraía, y después fuentes nuevas.

| Fuente | Qué se agregó | Decisión |
|---|---|---|
| Promiedos (ya activa) | Formación de ambos equipos en todas las competiciones; capitán; código 10 = remate al palo (coincide uno a uno con los tiros «woodwork» de StrikerAPI); VAR con la decisión («Gol anulado») y el jugador; bajas de cada partido con motivo (lesión, roja, amarillas, selección, personal: de Boca con el jugador, de los rivales solo el motivo); tablas por zona, anual y de promedios; rankings del torneo (goles, asistencias, tarjetas, barridas); todos los partidos de la liga con árbitro, tarjetas, faltas y bajas por motivo | **Activa** |
| StrikerAPI (ya activa) | Relato de cada gol (pierna, zona, corner, tiro libre, penal, contraataque, tipo de asistencia); eventos del partido: el pase previo a cada tiro (`player2`) da el **xA**, y las faltas de penal dan penales cometidos y provocados; resultados de toda la liga, Elo, promedios de los 30 clubes (2026 y 2025), goleadores, asistidores y xG de la liga | **Activa**. Los eventos cuestan 10 créditos por partido: se bajan con una reserva de 100 créditos y se completan en los meses siguientes |
| ScoutingStats (ya activa) | Momentum por minuto; páginas de rendimiento por competición con 29 métricas, promedio de la competición y puesto (incluye PPDA, Field Tilt y goles evitados de la fuente) | **Activa** |
| Wikipedia en español | Nacionalidad, club formador y nivel de selección (plantilla del plantel) y peso (ficha de cada jugador, 19 de 35) | **Activa** (CC BY-SA, se cita) |
| Wikidata | Tiene peso, altura y nacionalidad, pero su robots.txt cierra `/sparql` y la búsqueda; las fichas `Special:EntityData/*.json` sí están permitidas, pero no aportan más que Wikipedia | **Sin uso** |
| Statshub | Sin términos publicados y robots.txt abierto, pero los datos por jugador llegan solo por una API interna (el HTML no los trae) y son de SofaScore, cuyos términos prohíben el scraping. La revisión automática de seguridad bloqueó leer su JavaScript para ubicar esa API | **Activa** desde la autorización explícita del dueño: una consulta por corrida trae centros, duelos aéreos ganados, despejes, pérdidas, desposesiones, toques, xG y xA por jugador y partido |
| Pie hábil | No figura en Promiedos, Wikipedia ni Wikidata | **Sin fuente** |

Lo que sigue sin ninguna fuente gratis y permitida para Argentina (22 crudas): pases progresivos y al
último tercio, duelos aéreos, recuperaciones, despejes y bloqueos por jugador, presiones, pérdidas por
jugador, centros por jugador, regates y entradas intentados por jugador, salidas y errores del arquero,
distancia recorrida, altura de línea, mapas de calor y redes de pases. Todas necesitan eventos con
coordenadas o tracking (Opta, StatsBomb, Wyscout o SofaScore), que solo se consiguen pagando o en
sitios que prohíben el scraping. La cobertura se calcula con `scripts/coverage_report.py`.

## Dato crudo mínimo y lo que se deriva

| Dato crudo | Fuentes que lo traen hoy | Qué se deriva | Qué se pierde si cae la fuente principal |
|---|---|---|---|
| Partidos con resultado final (Boca y toda la liga) | football-data.co.uk (verificado), TheSportsDB (parcial), API-Football (con clave) | PJ, PG, PE, PP, puntos, GF, GC, diferencia, rachas, forma, tabla y su evolución, local/visitante, Elo, calidad del calendario, probabilidad pre-partido y Brier, puntos pitagóricos, ventaja de localía, rendimiento por nivel de rival, sorpresas, días de descanso, tarjetas de situaciones de resultados y rachas | Nada: football-data.co.uk lo cubre solo |
| Resultado al descanso | API-Football, TheSportsDB (parcial) | Situaciones al descanso, matriz descanso → final | Familias de tarjetas «al descanso» |
| Eventos con minuto (goles con tipo y asistente, tarjetas, cambios, penales) | API-Football (con clave), TheSportsDB (5 filas), BocaStats (por verificar) | Goles por tramo, minutos con ventaja/empate/desventaja, puntos desde atrás, primer gol, goles tardíos, tarjetas por tramo, asistencias | Tramos de minutos, situaciones por minuto, NR/EWA/ELA |
| Alineaciones con minutos de entrada y salida | API-Football (titulares + eventos de cambio) | Minutos en cancha, `v_on_court`, NR, EWA, ELA, carga 7/14/28 días, rotación, estabilidad del once (Jaccard), eficiencia de suplentes, con/sin jugador | Métricas propias de 6 y todo lo que depende de minutos |
| Box score por equipo (tiros, posesión, pases, córners, faltas) | API-Football, TheSportsDB (parcial) | Precisión de tiro, goles por tiro, situaciones de tiros, posesión, córners y disciplina | Familias C, D, E y F de situaciones |
| Box score por jugador (minutos, tiros, pases, entradas, calificación) | ScoutingStats (45 partidos de 2026), API-Football (histórico) | Todo «por 90», porcentajes, percentiles, índice de rendimiento, Mejoría α y β, Potencial α y β, comparación | Interfaces 3 y 5 casi completas |
| xG por partido y equipo | ScoutingStats (37 partidos, incluye copas), NoFluffPicks (31 de liga, respaldo) | xPts, goles − xG, xG por remate, probabilidad pre-partido con Poisson | Si caen las dos, quedan `n/d` |
| xGOT, xG de jugada y de pelota parada, ocasiones claras, formación | ScoutingStats | Goles evitados del arquero, calidad de definición, % de xG de pelota parada, rendimiento por formación | Quedan `n/d` |
| xG por jugador | ninguna permitida | npxG, xG/90, xA por jugador | Quedan `n/d` |
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
