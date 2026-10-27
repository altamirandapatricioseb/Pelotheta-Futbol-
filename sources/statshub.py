"""Adaptador de Statshub: estadísticas por jugador de Boca y partido en todas las competiciones.

Por qué esta fuente: publica centros, duelos aéreos, despejes, pérdidas, desposesiones, toques,
xG y xA por jugador y partido, que ninguna otra fuente permitida trae. No publica términos de uso
y su robots.txt permite todo. Los datos llegan por la API que usa su propia web (no están en el
HTML); el dueño autorizó usarla explícitamente el 27-oct-2026. Origen de los datos: SofaScore.

Qué se pide: UNA consulta por corrida (rendimiento de todo el plantel en la temporada), con
User-Agent identificable. Se guardan solo números por jugador de Boca; nada de rivales.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any

SOURCE = "statshub"
BASE_URL = "https://www.statshub.com"
BOCA_TEAM_ID = 3202
# Liga Profesional, Libertadores, Sudamericana y Copa Argentina (ids de torneo de la fuente).
TOURNAMENTS = "155,384,480,1024"


def performance_path(season: int) -> str:
    query = f"tournamentId={TOURNAMENTS}&season={season}&location=all"
    return f"/api/team/{BOCA_TEAM_ID}/players/performance?{query}"


# Clave de la fuente -> clave interna (misma convención que el resto de las fuentes).
STAT_KEYS = {
    "totalCross": "crosses",
    "accurateCross": "crosses_accurate",
    "aerialWon": "aerials_won",
    "duelWon": "duels_won",
    "duelLost": "duels_lost",
    "challengeLost": "dribbled_past",
    "totalClearance": "clearances",
    "interceptionWon": "interceptions",
    "totalTackle": "tackles",
    "possessionLostCtrl": "possession_lost",
    "dispossessed": "dispossessed",
    "expectedGoals": "xg",
    "expectedAssists": "xa",
    "keyPass": "key_passes",
    "touches": "touches",
    "wonContest": "dribbles_successful",
    "bigChanceCreated": "big_chances_created",
    "blockedScoringAttempt": "shots_blocked",
    "totalLongBalls": "long_balls",
    "accurateLongBalls": "long_balls_accurate",
    "woodworkHits": "woodwork",
    "totalPass": "passes",
    "accuratePass": "passes_accurate",
}


@dataclass
class MatchLines:
    kickoff_utc: datetime
    players: list[tuple[str, dict[str, float]]] = field(default_factory=list)


def _number(value: Any) -> float | None:
    if value is None or isinstance(value, bool):
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if number >= 0 else None


def parse_performance(payload: dict[str, Any]) -> list[MatchLines]:
    """Una entrada por partido de Boca con las líneas de cada jugador que jugó."""
    kickoffs: dict[int, datetime] = {}
    for item in payload.get("events") or []:
        event = item.get("events") or {}
        if isinstance(event.get("id"), int) and isinstance(event.get("timeStartTimestamp"), int):
            kickoffs[event["id"]] = datetime.fromtimestamp(event["timeStartTimestamp"], tz=UTC)
    matches: dict[int, MatchLines] = {}
    for player in payload.get("data") or []:
        name = player.get("name")
        for line in (player.get("stats") or {}).values():
            event_id = line.get("eventId")
            if not name or line.get("teamId") != BOCA_TEAM_ID or not line.get("minutesPlayed"):
                continue
            if event_id not in kickoffs:
                continue
            values = {key: n for raw, key in STAT_KEYS.items() if (n := _number(line.get(raw))) is not None}
            matches.setdefault(event_id, MatchLines(kickoffs[event_id])).players.append((name, values))
    return sorted(matches.values(), key=lambda m: m.kickoff_utc)
