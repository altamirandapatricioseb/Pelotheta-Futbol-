# Registro de cumplimiento de términos por fuente

Revisión inicial: 27-oct-2026 (Fase 0). Próxima revisión: al cerrar la etapa 3 y luego cada 3 meses.

| Fuente | Estado en el sistema | Obligaciones si se usa | Detalle |
|---|---|---|---|
| Promiedos | activa (principal) | citar «Promiedos» y «Opta»; solo páginas HTML públicas; no mostrar cuotas ni datos crudos; 3 s entre requests | `data/raw/phase0/promiedos.json`, ADR 0004 |
| NoFluffPicks | activa (xG por partido) | citar «NoFluffPicks (datos de FootyStats)» con enlace; no republicar partes sustanciales ni textos; 3 s entre requests | `docs/source_audit.md`, segunda ronda |
| ScoutingStats | activa (estadísticas avanzadas de equipo y jugador, formaciones) | citar «ScoutingStats (datos de Sportmonks)» con enlace; solo páginas de partido; no pedir `/api/` ni páginas de jugador (Cloudflare); no republicar textos, previas ni predicciones; 3 s entre requests | `docs/source_audit.md`, tercera ronda |
| StrikerAPI | activa (tiros ubicados, xG por tiro, faltas y despejes; solo Liga Profesional) | clave solo en GitHub Secrets; no revender ni redistribuir como dataset; 500 créditos por mes | `docs/source_audit.md`, tercera ronda |
| PitchMath, GoalPulz, MatchPulseStats, ESPN | descartadas | términos prohíben scraping | `docs/source_audit.md`, tercera ronda |
| SporLens, PlayerStats, Fichajes.com, WhoScored | descartadas | términos prohíben scraping o reutilización | `docs/source_audit.md`, segunda ronda |
| football-data.co.uk | activa (validación y resultados) | citar la fuente; no mostrar cuotas | `data/raw/phase0/football_data_co_uk.json` |
| API-Football | solo histórico 2022 a 2024 (plan Free) | no publica 2026; no revender; cuota 100 por día; clave solo en `.env` local y GitHub Secrets | `data/raw/phase0/api_football.json` |
| TheSportsDB | validación cruzada | uso de desarrollo con clave gratis; atribución si se paga | `data/raw/phase0/thesportsdb.json` |
| BocaStats | validación manual | revisar términos antes de automatizar; no usar `/api/` | `data/raw/phase0/bocastats.json` |
| Wikipedia (es) | activa (nacionalidad, peso, club formador, selección) | citar «Wikipedia» con enlace (CC BY-SA); solo artículos (robots.txt cierra páginas especiales y la API); datos mínimos (Ley 25.326) | `sources/wikipedia.py` |
| Wikidata | sin uso | robots.txt cierra `/sparql`; las fichas JSON están permitidas pero no suman | `docs/source_audit.md`, cuarta ronda |
| Statshub | activa (estadísticas por jugador, todas las competiciones) | sin términos publicados, robots.txt abierto; API de su web usada con autorización explícita del dueño (27-oct-2026); una consulta por corrida; origen SofaScore: riesgo de que cierre | `docs/source_audit.md`, cuarta ronda |
| SportScore | descartada | si se activara: enlace visible «Powered by SportScore» | `data/raw/phase0/sportscore.json` |
| Open-Meteo | activa (clima a la hora del partido) | sitio no comercial (decisión del dueño, 27-oct-2026); citar «Datos del clima: Open-Meteo.com» (CC BY 4.0) con enlace; una consulta por partido con caché. Su robots.txt dice «Disallow: /» en los dominios de la API: se interpreta dirigido a rastreadores de páginas, no a consultas puntuales a una API publicada para uso programático; se revisa si Open-Meteo indica lo contrario | `sources/openmeteo.py` |
| Transfermarkt, worldfootball.net | descartadas | términos prohíben automatizar / Cloudflare | no aplica |
| FBref, FootyStats | solo referencia manual | no automatizar; atribución a Sports Reference si se cita | informes respectivos |
| ESPN, FotMob, Sofascore, football-data.org | descartadas | no aplica | informes respectivos |
