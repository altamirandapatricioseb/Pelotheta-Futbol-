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
from pydantic import ValidationError

from pipeline.models import (
    ClubRatingRecord,
    ClubSeasonStatRecord,
    LeagueLeaderRecord,
    LeagueResultRecord,
)
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
class GoalInfo:
    """Un gol descrito por el relato de la fuente (en inglés, con frases fijas)."""

    team_id: str
    scorer: str | None
    assister: str | None
    body: str | None  # header, left_foot, right_foot
    zone: str | None  # six_yard_box, box, outside_box
    situation: str | None  # corner, set_piece, free_kick, penalty, fast_break
    assist_type: str | None  # cross, through_ball, headed_pass, pass


SCORER_RE = re.compile(r"^Goal! [^.]*\. (.+?) \(")
ASSIST_RE = re.compile(r"Assisted by (.+?)(?: with a| following|\.$)")
BODY_TEXTS = (("header", "header"), ("left footed", "left_foot"), ("right footed", "right_foot"))
ZONE_TEXTS = (
    ("outside the box", "outside_box"),
    ("six yard box", "six_yard_box"),
    ("very close range", "six_yard_box"),
    ("of the box", "box"),
)
SITUATION_TEXTS = (
    ("following a corner", "corner"),
    ("following a set piece situation", "set_piece"),
    ("from a free kick", "free_kick"),
    ("penalty", "penalty"),
    ("following a fast break", "fast_break"),
)
ASSIST_TEXTS = (
    ("with a cross", "cross"),
    ("with a through ball", "through_ball"),
    ("with a headed pass", "headed_pass"),
)
# Claves de equipo que se cuentan por partido a partir de los goles.
GOAL_TYPE_KEYS = {
    "goals_header": lambda g: g.body == "header",
    "goals_left_foot": lambda g: g.body == "left_foot",
    "goals_right_foot": lambda g: g.body == "right_foot",
    "goals_outside_box": lambda g: g.zone == "outside_box",
    "goals_six_yard_box": lambda g: g.zone == "six_yard_box",
    "goals_corner": lambda g: g.situation == "corner",
    "goals_set_piece": lambda g: g.situation == "set_piece",
    "goals_free_kick": lambda g: g.situation == "free_kick",
    "goals_penalty": lambda g: g.situation == "penalty",
    "goals_fast_break": lambda g: g.situation == "fast_break",
    "goals_from_cross": lambda g: g.assist_type == "cross",
}


def _first(text: str, options: tuple[tuple[str, str], ...]) -> str | None:
    lowered = text.lower()
    return next((value for phrase, value in options if phrase in lowered), None)


def parse_goal_text(text: str, team_id: str) -> GoalInfo:
    scorer = SCORER_RE.search(text)
    assister = ASSIST_RE.search(text)
    assist_type = _first(text, ASSIST_TEXTS) or ("pass" if assister else None)
    return GoalInfo(
        team_id=team_id,
        scorer=scorer.group(1) if scorer else None,
        assister=assister.group(1) if assister else None,
        body=_first(text, BODY_TEXTS),
        zone=_first(text, ZONE_TEXTS),
        situation=_first(text, SITUATION_TEXTS),
        assist_type=assist_type,
    )


def goal_type_counts(goals: list[GoalInfo], home_id: str, away_id: str) -> dict[str, tuple[float, float]]:
    """Goles de cada tipo por equipo en el partido. Con el relato completo, cero es un dato."""
    return {
        key: (
            float(sum(1 for g in goals if g.team_id == home_id and test(g))),
            float(sum(1 for g in goals if g.team_id == away_id and test(g))),
        )
        for key, test in GOAL_TYPE_KEYS.items()
    }


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
    goals: list[GoalInfo] = field(default_factory=list)

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
    goals = [
        parse_goal_text(str(ev.get("text") or ""), str(ev.get("team_id")))
        for ev in data.get("key_events") or []
        if str(ev.get("type") or "").startswith(("goal", "penalty---scored"))
        and not ev.get("own_goal")
        and not ev.get("shootout")
    ]
    team_stats.update(goal_type_counts(goals, home_id, away_id))
    kickoff = datetime.fromisoformat(str(game["starts_at"]).replace("Z", "+00:00")).astimezone(UTC)
    return GameLine(
        game_id=str(game.get("game_id")),
        kickoff_utc=kickoff,
        boca_home=home_id == BOCA_ID,
        team_stats=team_stats,
        boca_players=players,
        goals=goals,
    )


@dataclass
class StrikerClient:
    """Cliente de la API con pausa entre llamadas y caché en disco para partidos terminados."""

    api_key: str
    cache_dir: Path = CACHE_DIR / SOURCE
    _last: float = 0.0
    credits_used: int = 0
    credits_remaining: int | None = None

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
        remaining = response.headers.get("x-credits-remaining")
        if remaining and remaining.isdigit():
            self.credits_remaining = int(remaining)
        data: dict[str, Any] = response.json()
        if cache_file is not None:
            cache_file.parent.mkdir(parents=True, exist_ok=True)
            cache_file.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
        return data


# --- liga -------------------------------------------------------------------------------


def parse_results(payload: dict[str, Any]) -> list[LeagueResultRecord]:
    """Resultados terminados de `list_games` (toda la liga o un equipo)."""
    rows = []
    for g in (payload.get("data") or {}).get("games") or []:
        home, away = g.get("home") or {}, g.get("away") or {}
        if g.get("status") != "final" or home.get("score") is None or away.get("score") is None:
            continue
        try:
            rows.append(
                LeagueResultRecord(
                    source=SOURCE,
                    ext_id=str(g["game_id"]),
                    season=int(g.get("season") or 0),
                    stage=g.get("stage"),
                    match_date=date.fromisoformat(str(g["date"])),
                    home_team=str(home["name"]),
                    away_team=str(away["name"]),
                    home_goals=int(home["score"]),
                    away_goals=int(away["score"]),
                )
            )
        except (KeyError, ValueError, ValidationError):
            continue
    return rows


def parse_ratings(payload: dict[str, Any]) -> list[ClubRatingRecord]:
    data = payload.get("data") or {}
    as_of = date.fromisoformat(str(data.get("as_of")))
    return [
        ClubRatingRecord(
            source=SOURCE, team_name=str(r["name"]), rank=int(r["rank"]), elo=float(r["elo"]), as_of=as_of
        )
        for r in data.get("ratings") or []
        if r.get("name") and _float(r.get("elo")) is not None
    ]


def parse_team_stats(payload: dict[str, Any]) -> list[ClubSeasonStatRecord]:
    """Promedios por partido de cada club. Un valor nulo no se guarda (no es cero)."""
    data = payload.get("data") or {}
    season = int(data.get("season") or 0)
    rows = []
    for team in data.get("teams") or []:
        name = team.get("display_name") or team.get("name")
        for key, value in team.items():
            number = _float(value)
            if name and number is not None and key not in ("team_id",) and re.fullmatch(r"[a-z_0-9]+", key):
                rows.append(
                    ClubSeasonStatRecord(
                        source=SOURCE, season=season, team_name=str(name), stat_key=key, value=number
                    )
                )
    return rows


def parse_leaders(payload: dict[str, Any]) -> list[LeagueLeaderRecord]:
    data = payload.get("data") or {}
    stat, season = str(data.get("stat")), int(data.get("season") or 0)
    return [
        LeagueLeaderRecord(
            source=SOURCE,
            season=season,
            stat=stat,
            rank=int(r["rank"]),
            player_name=str(r["name"]),
            team_name=r.get("team"),
            games=r.get("games"),
            minutes=r.get("minutes"),
            value=float(r["value"]),
            per90=_float(r.get("per90")),
        )
        for r in data.get("leaders") or []
        if r.get("name") and _float(r.get("value")) is not None
    ]


# --- eventos de un partido -------------------------------------------------------------------

PENALTY_FOUL_RE = re.compile(r"^Penalty (conceded by|[^.]+\. .+ draws a foul)")
VAR_PENALTY_RE = re.compile(r"^VAR Decision: Penalty ")
EVENTS_CREDIT_RESERVE = 100  # créditos que se dejan libres para las corridas del resto del mes


def boca_event_stats(payload: dict[str, Any]) -> dict[str, dict[str, float]]:
    """Estadísticas por jugador de Boca a partir de los eventos del partido.

    - xa y shot_assists: xG y cantidad de los tiros que habilitó (el pase previo al tiro,
      `player2`). Los penales no cuentan como asistencia esperada.
    - penalties_conceded y penalties_won: quién cometió y quién recibió cada falta de penal (la
      fuente la relata de dos formas; se cuenta una vez). Un penal a favor que solo figura como
      decisión del VAR se acredita al jugador que nombra el VAR.
    - handballs: manos sancionadas.
    """
    stats: dict[str, dict[str, float]] = {}

    def add(name: str | None, key: str, value: float = 1) -> None:
        if name:
            row = stats.setdefault(name, {})
            row[key] = round(row.get(key, 0) + value, 3)

    seen_penalty_fouls: set[tuple[object, object]] = set()
    penalty_minutes: set[object] = set()
    var_penalties: list[dict[str, Any]] = []
    for ev in (payload.get("data") or {}).get("events") or []:
        is_boca = str(ev.get("team_id")) == BOCA_ID
        shot = ev.get("shot") or {}
        xg = _float(shot.get("xg"))
        if shot and is_boca and ev.get("player2") and xg is not None and not shot.get("penalty"):
            add(ev["player2"], "xa", xg)
            add(ev["player2"], "shot_assists")
        text = str(ev.get("text") or "")
        if ev.get("type") == "foul" and PENALTY_FOUL_RE.match(text):
            # La misma falta puede venir relatada dos veces («conceded by» y «draws a foul»).
            pair = (ev.get("player"), ev.get("player2"))
            if pair not in seen_penalty_fouls:
                seen_penalty_fouls.add(pair)
                penalty_minutes.add(ev.get("minute"))
                if is_boca:
                    add(ev.get("player"), "penalties_conceded")
                else:
                    add(ev.get("player2"), "penalties_won")
        if is_boca and VAR_PENALTY_RE.match(text) and "Boca Juniors" in text:
            var_penalties.append(ev)
        if ev.get("type") == "handball" and is_boca:
            add(ev.get("player"), "handballs")
    # Penal a favor dado por el VAR sin falta relatada: se acredita al jugador que nombra el VAR.
    for ev in var_penalties:
        minute = ev.get("minute")
        if not any(
            isinstance(m, int) and isinstance(minute, int) and abs(m - minute) <= 3 for m in penalty_minutes
        ):
            add(ev.get("player"), "penalties_won")
    return stats
