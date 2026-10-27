"""Adaptador de Bzzoiro Sports Data (API gratuita con clave del dueño).

Por qué esta fuente: publica por jugador y partido lo que no trae ninguna otra fuente permitida
para Argentina: regates y entradas intentados, recuperaciones, bloqueos, duelos aéreos perdidos,
salidas y errores del arquero, conducciones progresivas. Su licencia (docs/api-license) permite
guardar los datos y mostrarlos en un sitio propio; prohíbe revender o redistribuir los datos
crudos y presentarlos como oficiales. Cuota del plan gratis: 7500 consultas por día.

Qué se pide: la lista de partidos de Boca y, por cada partido nuevo, sus estadísticas por
jugador y sus alineaciones (para los nombres). Los partidos terminados quedan en caché.
"""

from __future__ import annotations

import json
import time
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import httpx

from sources.http_client import CACHE_DIR, USER_AGENT

SOURCE = "bzzoiro"
BASE_URL = "https://sports.bzzoiro.com"
BOCA_TEAM_ID = 780
MIN_INTERVAL_SECONDS = 1.0

STAT_KEYS = {
    "total_contest": "dribbles_attempted",
    "won_contest": "dribbles_successful",
    "total_tackle": "tackles_attempted",
    "won_tackle": "tackles_won",
    "ball_recovery": "recoveries",
    "outfielder_block": "blocks",
    "aerial_won": "aerials_won",
    "aerial_lost": "aerials_lost",
    "total_clearance": "clearances",
    "clearance_off_line": "clearances_off_line",
    "last_man_tackle": "last_man_tackles",
    "punches": "punches",
    "high_claims": "high_claims",
    "total_keeper_sweeper": "sweeper_actions",
    "accurate_keeper_sweeper": "sweeper_actions_accurate",
    "saved_shots_from_inside_the_box": "saves_inside_box",
    "goals_prevented": "goals_prevented",
    "error_lead_to_a_goal": "errors_to_goal",
    "error_lead_to_a_shot": "errors_to_shot",
    "progressive_ball_carries_count": "progressive_carries",
    "ball_carries_count": "carries",
    "total_ball_carries_distance": "carry_distance_m",
    "total_progressive_ball_carries_distance": "progressive_carry_distance_m",
    "total_progression": "progression_m",
    "total_opposition_half_passes": "opp_half_passes",
    "accurate_opposition_half_passes": "opp_half_passes_accurate",
    "unsuccessful_touch": "miscontrols",
    "big_chance_missed": "big_chances_missed",
    "expected_goals_on_target": "xgot",
    "expected_goals": "xg",
    "expected_assists": "xa",
    "possession_lost": "possession_lost",
    "dispossessed": "dispossessed",
    "touches": "touches",
}


class BzzoiroError(RuntimeError):
    """Falla de la API, con un mensaje que nunca incluye la clave."""


@dataclass(frozen=True)
class Event:
    event_id: int
    kickoff_utc: datetime


def parse_events(payload: dict[str, Any], season_year: int) -> list[Event]:
    events = []
    for e in payload.get("results") or []:
        if e.get("status") != "finished" or BOCA_TEAM_ID not in (
            e.get("home_team_id"),
            e.get("away_team_id"),
        ):
            continue
        try:
            kickoff = datetime.fromisoformat(str(e["event_date"])).astimezone(UTC)
        except (KeyError, ValueError):
            continue
        if kickoff.year == season_year:
            events.append(Event(int(e["id"]), kickoff))
    return events


def _number(value: Any) -> float | None:
    if value is None or isinstance(value, bool):
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return round(number, 4) if number >= 0 else None


FEET = {"R": "derecho", "L": "izquierdo", "B": "ambidiestro"}


def foot(player: dict[str, Any]) -> str | None:
    """Pie hábil de la ficha del jugador (R, L o B)."""
    return FEET.get(str(player.get("preferred_foot") or "").upper())


def boca_player_ids(lineups: dict[str, Any]) -> dict[int, str]:
    """id -> nombre de los jugadores de Boca en la alineación (titulares y suplentes)."""
    names: dict[int, str] = {}
    for side in (lineups.get("lineups") or {}).values():
        if side.get("team_id") == BOCA_TEAM_ID:
            people = [*(side.get("players") or []), *(side.get("substitutes") or [])]
            names.update({p["id"]: p["name"] for p in people if p.get("id") and p.get("name")})
    return names


def parse_player_stats(stats: dict[str, Any], lineups: dict[str, Any]) -> list[tuple[str, dict[str, float]]]:
    """(nombre, estadísticas) de cada jugador de Boca que jugó. Los nombres salen de la alineación."""
    names = boca_player_ids(lineups)
    lines = []
    for row in stats.get("player_stats") or []:
        name = names.get(row.get("player_id"))
        if row.get("team_id") != BOCA_TEAM_ID or not row.get("minutes_played") or not name:
            continue
        values = {key: n for raw, key in STAT_KEYS.items() if (n := _number(row.get(raw))) is not None}
        lines.append((name, values))
    return lines


class BzzoiroClient:
    def __init__(self, api_key: str, cache_dir: Path = CACHE_DIR / SOURCE) -> None:
        self.api_key, self.cache_dir, self._last = api_key, cache_dir, 0.0

    def get(
        self, path: str, params: dict[str, Any] | None = None, cache_key: str | None = None
    ) -> dict[str, Any]:
        cache_file = self.cache_dir / f"{cache_key}.json" if cache_key else None
        if cache_file is not None and cache_file.exists():
            cached: dict[str, Any] = json.loads(cache_file.read_text(encoding="utf-8"))
            return cached
        wait = MIN_INTERVAL_SECONDS - (time.monotonic() - self._last)
        if wait > 0:
            time.sleep(wait)
        try:
            response = httpx.get(
                BASE_URL + path,
                params=params,
                headers={"Authorization": f"Token {self.api_key}", "User-Agent": USER_AGENT},
                timeout=60,
            )
        except httpx.HTTPError as exc:
            raise BzzoiroError(f"{path}: {type(exc).__name__}") from None
        self._last = time.monotonic()
        if response.status_code != 200:
            raise BzzoiroError(f"{path}: HTTP {response.status_code}")
        data: dict[str, Any] = response.json()
        if cache_file is not None:
            cache_file.parent.mkdir(parents=True, exist_ok=True)
            cache_file.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
        return data
