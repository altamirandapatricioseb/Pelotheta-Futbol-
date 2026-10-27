"""Adaptador de StrikerAPI (tiros con coordenadas y datos por jugador de la Liga Profesional).

Por qué esta fuente: es la única revisada con tiros ubicados en la cancha, parte del cuerpo y
xG por tiro para la Liga Profesional 2026, y sus términos permiten guardar y mostrar los datos
en un sitio propio (prohíben revender o redistribuirlos como dataset, y scrapear la web: por
eso se usa SOLO la API con la clave del dueño). No cubre copas. Ver docs/source_audit.md.

Cuidado con los créditos (500 gratis por mes): el mapa de tiros de toda la temporada cuesta
10 por llamada, y cada partido completo 5. Los partidos terminados se guardan en caché local
para no volver a pagarlos.
"""

from __future__ import annotations

import json
import re
import time
from dataclasses import dataclass, field
from datetime import UTC, date, datetime
from pathlib import Path
from typing import Any

import httpx

from sources.http_client import CACHE_DIR, USER_AGENT

SOURCE = "strikerapi"
BASE_URL = "https://mcp.strikerapi.com/v1"
LEAGUE = "argentina"
BOCA_ID = "5"
MIN_INTERVAL_SECONDS = 1.2  # la API admite 60 por minuto; se queda bien por debajo

# Claves de equipo que solo trae esta fuente (el resto ya lo traen Promiedos o ScoutingStats).
TEAM_KEYS = {
    "clearances": "clearances",
    "effective_tackles": "tackles_won",
    "penalty_attempts": "penalties_attempted",
    "penalty_goals": "penalties_scored",
}
PLAYER_KEYS = ("fouls_committed", "fouls_suffered", "offsides", "saves", "shots_faced")
TOKEN_RE = re.compile(r"^[a-z_]+$")


class StrikerError(RuntimeError):
    """Falla de la API, con un mensaje que nunca incluye la clave."""


@dataclass(frozen=True)
class Shot:
    game_id: str
    date: date
    boca: bool
    minute: int | None
    player: str | None
    outcome: str
    body_part: str | None
    penalty: bool
    zone: str | None
    xg: float
    x: float | None
    y: float | None
    end_x: float | None
    end_y: float | None


@dataclass(frozen=True)
class PlayerLine:
    name: str
    stats: dict[str, float]


@dataclass
class GameLine:
    game_id: str
    kickoff_utc: datetime
    boca_home: bool
    team_stats: dict[str, tuple[float, float]]
    boca_players: list[PlayerLine] = field(default_factory=list)

    @property
    def utc_date(self) -> date:
        return self.kickoff_utc.date()


def _float(value: Any) -> float | None:
    if isinstance(value, bool) or value is None:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _token(value: Any) -> str | None:
    return value if isinstance(value, str) and TOKEN_RE.match(value) else None


def parse_shots(payload: dict[str, Any], boca: bool) -> list[Shot]:
    """Tiros de `get_shot_map`. Un tiro con forma rara se omite sin cortar el resto."""
    shots = []
    for raw in (payload.get("data") or {}).get("shots") or []:
        xg, outcome = _float(raw.get("xg")), _token(raw.get("outcome"))
        try:
            shot_date = date.fromisoformat(str(raw.get("date")))
        except ValueError:
            continue
        if xg is None or not 0 <= xg <= 1 or outcome is None or not raw.get("game_id"):
            continue
        minute = raw.get("minute")
        shots.append(
            Shot(
                game_id=str(raw["game_id"]),
                date=shot_date,
                boca=boca,
                minute=minute if isinstance(minute, int) and 0 <= minute <= 130 else None,
                player=raw.get("player") if isinstance(raw.get("player"), str) else None,
                outcome=outcome,
                body_part=_token(raw.get("body_part")),
                penalty=raw.get("penalty") is True,
                zone=_token(raw.get("zone")),
                xg=xg,
                x=_float(raw.get("x")),
                y=_float(raw.get("y")),
                end_x=_float(raw.get("end_x")),
                end_y=_float(raw.get("end_y")),
            )
        )
    return shots


def final_game_ids(payload: dict[str, Any]) -> list[str]:
    games = (payload.get("data") or {}).get("games") or []
    return [str(g["game_id"]) for g in games if g.get("status") == "final" and g.get("game_id")]


def parse_game(payload: dict[str, Any]) -> GameLine | None:
    """Partido terminado de `get_game`: claves nuevas de equipo y datos de jugadores de Boca."""
    data = payload.get("data") or {}
    game = data.get("game") or {}
    if game.get("status") != "final":
        return None
    home_id = str((game.get("home") or {}).get("team_id"))
    away_id = str((game.get("away") or {}).get("team_id"))
    if BOCA_ID not in (home_id, away_id):
        return None
    by_team = {str(t.get("team_id")): t for t in data.get("team_stats") or []}
    team_stats: dict[str, tuple[float, float]] = {}
    for raw_key, key in TEAM_KEYS.items():
        h, a = _float(by_team.get(home_id, {}).get(raw_key)), _float(by_team.get(away_id, {}).get(raw_key))
        if h is not None and a is not None:
            team_stats[key] = (h, a)
    players = []
    for raw in data.get("players") or []:
        if str(raw.get("team_id")) != BOCA_ID or not isinstance(raw.get("name"), str):
            continue
        if raw.get("minute_on") is None:
            continue  # suplente que no entró: sin datos que aportar (y Promiedos puede no listarlo)
        stats = {k: v for k in PLAYER_KEYS if (v := _float(raw.get(k))) is not None and v >= 0}
        players.append(PlayerLine(name=raw["name"], stats=stats))
    kickoff = datetime.fromisoformat(str(game["starts_at"]).replace("Z", "+00:00")).astimezone(UTC)
    return GameLine(
        game_id=str(game.get("game_id")),
        kickoff_utc=kickoff,
        boca_home=home_id == BOCA_ID,
        team_stats=team_stats,
        boca_players=players,
    )


@dataclass
class StrikerClient:
    """Cliente de la API con pausa entre llamadas y caché en disco para partidos terminados."""

    api_key: str
    cache_dir: Path = CACHE_DIR / SOURCE
    _last: float = 0.0
    credits_used: int = 0

    def call(self, tool: str, payload: dict[str, Any], cache_key: str | None = None) -> dict[str, Any]:
        cache_file = self.cache_dir / f"{cache_key}.json" if cache_key else None
        if cache_file is not None and cache_file.exists():
            cached: dict[str, Any] = json.loads(cache_file.read_text(encoding="utf-8"))
            return cached
        wait = MIN_INTERVAL_SECONDS - (time.monotonic() - self._last)
        if wait > 0:
            time.sleep(wait)
        try:
            response = httpx.post(
                f"{BASE_URL}/{tool}",
                json={"league": LEAGUE, **payload},
                headers={"x-api-key": self.api_key, "User-Agent": USER_AGENT},
                timeout=60,
            )
        except httpx.HTTPError as exc:
            raise StrikerError(f"{tool}: {type(exc).__name__}") from None
        self._last = time.monotonic()
        if response.status_code != 200:
            raise StrikerError(f"{tool}: HTTP {response.status_code}")
        self.credits_used += int(response.headers.get("x-credits-used", "0") or 0)
        data: dict[str, Any] = response.json()
        if cache_file is not None:
            cache_file.parent.mkdir(parents=True, exist_ok=True)
            cache_file.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
        return data
