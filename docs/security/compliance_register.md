# Registro de cumplimiento de términos por fuente

Revisión inicial: 27-oct-2026 (Fase 0). Próxima revisión: al cerrar la etapa 3 y luego cada 3 meses.

| Fuente | Estado en el sistema | Obligaciones si se usa | Detalle |
|---|---|---|---|
| football-data.co.uk | activa (validación y resultados) | citar la fuente; no mostrar cuotas | `data/raw/phase0/football_data_co_uk.json` |
| API-Football | pendiente de clave | revisar licencia de publicación; no revender; respetar cuota | `data/raw/phase0/api_football.json` |
| TheSportsDB | validación cruzada | uso de desarrollo con clave gratis; atribución si se paga | `data/raw/phase0/thesportsdb.json` |
| BocaStats | validación manual | revisar términos antes de automatizar; no usar `/api/` | `data/raw/phase0/bocastats.json` |
| Wikidata / Wikipedia | pendiente de sonda | CC0 (Wikidata), CC BY-SA con cita (Wikipedia); minimizar datos personales (Ley 25.326) | sonda en `scripts/phase0/probe_wikidata_wikipedia.py` |
| SportScore | descartada | si se activara: enlace visible «Powered by SportScore» | `data/raw/phase0/sportscore.json` |
| Open-Meteo | desactivada | CC BY 4.0 con enlace; uso no comercial | `data/raw/phase0/open_meteo.json` |
| FBref, FootyStats | solo referencia manual | no automatizar; atribución a Sports Reference si se cita | informes respectivos |
| ESPN, FotMob, Sofascore, football-data.org | descartadas | no aplica | informes respectivos |
