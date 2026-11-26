"""Estadísticas por jugador de toda una liga desde ScoutingStats (etapa 5j-3).

Para las ligas del sistema que Bzzoiro no cubre (Primera Nacional, Uruguay, Venezuela). El listado de
partidos de cada fecha lo carga una API que robots.txt bloquea, así que se recorre como con Boca:
página de clubes de la liga → página de partidos de cada club → página de cada partido (en caché una
vez terminado). Las filas usan los nombres de campo de Bzzoiro: sirven los mismos perfiles.
Licencia: crudo solo al dataset privado; los perfiles (percentiles, cálculo propio) al público.
"""

from __future__ import annotations

import re
import unicodedata
import urllib.parse
from typing import Any

from sources import scoutingstats as ss
from sources.http_client import FetchError, PoliteClient, RetryableFetchError


def slug_of(url: str) -> str:
    """Primer tramo de la URL del partido («/primera-divisi%C3%B3n/…» → «primera-division»)."""
    first = urllib.parse.unquote(urllib.parse.urlparse(url).path).strip("/").split("/")[0]
    plain = unicodedata.normalize("NFKD", first).encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9]+", "-", plain).strip("-")


def collect(
    client: PoliteClient,
    league_path: str,
    competition_slug: str,
    season_year: int,
    max_new: int | None = None,
    report: dict[str, int] | None = None,
) -> list[dict[str, Any]]:
    """Filas jugador × partido de la temporada. `max_new`: tope de páginas nuevas en esta corrida."""
    new = pending = 0
    clubs_html = client.get(ss.BASE_URL + league_path + "/clubs", use_cache=False).text()
    ids: list[int] = []
    for path in ss.club_match_paths(clubs_html):
        try:
            ids += ss.match_ids(client.get(ss.BASE_URL + path, use_cache=False).text())
        except (FetchError, RetryableFetchError):
            continue
    rows: list[dict[str, Any]] = []
    seen: set[int] = set()
    for match_id in dict.fromkeys(ids):
        if max_new is not None and new >= max_new:
            pending += 1
            continue
        try:
            result = client.get(f"{ss.BASE_URL}/match/{match_id}")
        except (FetchError, RetryableFetchError):
            continue
        new += 0 if result.from_cache else 1
        if slug_of(result.url) != competition_slug:
            continue  # copa o amistoso del club: no es de esta liga
        parsed = ss.parse_league_match(result.text())
        if parsed is None or parsed["kickoff"].year != season_year:
            continue
        seen.add(match_id)
        date = parsed["kickoff"].date().isoformat()
        rows += [
            {"event_id": match_id, "match_date": date, "season_year": season_year, **p}
            for p in parsed["players"]
        ]
    if report is not None:
        report.update({"partidos": len(seen), "pendientes": pending, "consultas_nuevas": new})
    return rows
