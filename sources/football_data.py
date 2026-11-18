"""football-data.org (API v4): resultados de ligas para el predictor de otros equipos.

Estado: listo y sin conectar a la corrida. El plan gratis (TIER_ONE) no incluye la Liga
Profesional Argentina (docs/source_audit.md), pero sí el Brasileirão (BSA), que es la próxima
liga del selector de equipos. Se conecta cuando haya clave y la tabla de resultados distinga la
competición (si no, los partidos de Brasil se mezclarían con el Elo de la liga argentina).

Términos: una clave por aplicación, nunca en el repositorio (va en FOOTBALL_DATA_ORG_KEY) y
atribución visible «Football data provided by the Football-Data.org API».
"""

from __future__ import annotations

import os
from datetime import date
from typing import Any

from pydantic import ValidationError

from pipeline.models import LeagueResultRecord
from sources.http_client import PoliteClient

SOURCE = "football_data"
API = "https://api.football-data.org/v4"
ATTRIBUTION = "Football data provided by the Football-Data.org API"


def token() -> str | None:
    return os.environ.get("FOOTBALL_DATA_ORG_KEY", "").strip() or None


def matches_url(competition: str, season: int) -> str:
    """URL de los partidos terminados de una competición (código de football-data, p. ej. BSA)."""
    if not competition.isalnum():
        raise ValueError("código de competición inválido")
    return f"{API}/competitions/{competition}/matches?season={season}&status=FINISHED"


def parse_matches(payload: dict[str, Any], season: int) -> list[LeagueResultRecord]:
    """Partidos con resultado final del tiempo regular. Una fila rara se saltea."""
    rows = []
    for g in payload.get("matches") or []:
        full = ((g.get("score") or {}).get("fullTime")) or {}
        try:
            rows.append(
                LeagueResultRecord(
                    source=SOURCE,
                    ext_id=str(g["id"]),
                    season=season,
                    stage=g.get("stage"),
                    match_date=date.fromisoformat(str(g["utcDate"])[:10]),
                    home_team=str(g["homeTeam"]["name"]),
                    away_team=str(g["awayTeam"]["name"]),
                    home_goals=int(full["home"]),
                    away_goals=int(full["away"]),
                )
            )
        except (KeyError, TypeError, ValueError, ValidationError):
            continue
    return rows


def fetch_matches(client: PoliteClient, competition: str, season: int) -> list[LeagueResultRecord]:
    """Pide los partidos con la clave en el header (nunca en la URL, la caché ni el manifiesto)."""
    key = token()
    if key is None:
        return []
    result = client.get(matches_url(competition, season), headers={"X-Auth-Token": key})
    return parse_matches(result.json(), season)
