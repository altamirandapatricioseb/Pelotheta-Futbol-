"""transfermarkt-datasets (github.com/dcaribou/transfermarkt-datasets): valores de mercado abiertos.

Por qué esta fuente y no Transfermarkt directo: Transfermarkt prohíbe el acceso automatizado en sus
términos. Este proyecto abierto publica sus datos con licencia CC0 (dominio público) como CSV en
un bucket público, y en 2026 incluye la Liga Profesional Argentina (`ARG1`): 1261 jugadores de
32 clubes, con valor de mercado, posición y club actual. Se baja con PoliteClient (robots.txt,
pausa, caché y manifiesto con SHA-256) y nunca se guarda la fecha de nacimiento: solo la edad.

También trae los resultados de liga (`games`), que el predictor suma a los de Promiedos y StrikerAPI.
No trae estadísticas por jugador y partido de la liga argentina: esas quedan para otra fuente.
"""

from __future__ import annotations

import csv
import gzip
import io
from datetime import date
from typing import Any

from pydantic import Field

from pipeline.models import Record
from sources.http_client import PoliteClient

SOURCE = "transfermarkt_datasets"
BASE = "https://pub-e682421888d945d684bcae8890b0ec20.r2.dev/data"
COMPETITIONS = ("ARG1",)  # ligas del dataset que se cargan; sumar otras cuando entren equipos de otras ligas
COUNTRY = {"ARG1": "Argentina"}  # país de cada liga cargada: «extranjero» es otra nacionalidad
POSITIONS = {
    "Goalkeeper": "Arquero",
    "Defender": "Defensor",
    "Midfield": "Mediocampista",
    "Attack": "Delantero",
}


class PoolPlayerRecord(Record):
    """Jugador de otro club: identidad, edad y valor. Las estadísticas llegan por otra fuente."""

    source: str = Field(pattern=r"^[a-z_]+$")
    ext_id: str
    player_name: str
    team_name: str
    club_ext_id: str
    competition: str = Field(pattern=r"^[A-Z0-9]+$")
    position_group: str | None = None
    age: int | None = Field(default=None, ge=14, le=50)
    value_eur: int | None = Field(default=None, gt=0, le=500_000_000)
    value_as_of: date | None = None
    source_url: str | None = Field(default=None, pattern=r"^https://")
    # Para el modelo de valor: hasta cuándo tiene contrato y si es extranjero en esa liga.
    contract_until: date | None = None
    foreign: bool | None = None


def read_csv(client: PoliteClient, name: str) -> list[dict[str, str]]:
    """Un CSV comprimido del dataset, ya leído."""
    if not name.replace("_", "").isalpha():
        raise ValueError("nombre de archivo inválido")
    body = client.get(f"{BASE}/{name}.csv.gz").body
    return list(csv.DictReader(io.StringIO(gzip.decompress(body).decode("utf-8"))))


def _date(text: str) -> date | None:
    try:
        return date.fromisoformat(text[:10])
    except ValueError:
        return None


def _age(birth: str, today: date) -> int | None:
    try:
        born = date.fromisoformat(birth[:10])
    except ValueError:
        return None
    return today.year - born.year - ((today.month, today.day) < (born.month, born.day))


def latest_valuations(rows: list[dict[str, str]]) -> dict[str, tuple[date, int]]:
    """Última valuación de cada jugador: {player_id: (fecha, valor)}."""
    out: dict[str, tuple[date, int]] = {}
    for r in rows:
        try:
            day, value = date.fromisoformat(r["date"][:10]), int(float(r["market_value_in_eur"]))
        except (KeyError, ValueError):
            continue
        if value > 0 and (r["player_id"] not in out or day > out[r["player_id"]][0]):
            out[r["player_id"]] = (day, value)
    return out


def parse_players(
    players: list[dict[str, str]], valuations: dict[str, tuple[date, int]], today: date
) -> list[PoolPlayerRecord]:
    """Jugadores con club actual en las ligas de `COMPETITIONS`."""
    out = []
    for r in players:
        competition = r.get("current_club_domestic_competition_id") or ""
        if competition not in COMPETITIONS or not r.get("name"):
            continue
        val = valuations.get(r["player_id"])
        raw_value = r.get("market_value_in_eur") or ""
        value = val[1] if val else (int(float(raw_value)) if raw_value else None)
        age = _age(r.get("date_of_birth") or "", today)
        url = r.get("url") or ""
        citizenship = (r.get("country_of_citizenship") or "").strip()
        out.append(
            PoolPlayerRecord(
                source=SOURCE,
                ext_id=r["player_id"],
                player_name=r["name"].strip(),
                team_name=(r.get("current_club_name") or "").strip(),
                club_ext_id=r.get("current_club_id") or "",
                competition=competition,
                position_group=POSITIONS.get(r.get("position") or ""),
                age=age if age is not None and 14 <= age <= 50 else None,
                value_eur=value or None,
                value_as_of=val[0] if val else None,
                source_url=url if url.startswith("https://") else None,
                contract_until=_date(r.get("contract_expiration_date") or ""),
                foreign=citizenship != COUNTRY.get(competition) if citizenship else None,
            )
        )
    return out


def club_values(
    players: list[dict[str, str]], valuations: dict[str, tuple[date, int]], since_season: int
) -> dict[str, int]:
    """Valor del plantel de cada club del dataset (todas sus ligas): suma de la última valuación de
    los jugadores que siguen ahí desde `since_season`. Sirve para medir rivales de otras ligas."""
    out: dict[str, int] = {}
    for r in players:
        val = valuations.get(r.get("player_id", ""))
        club = (r.get("current_club_name") or "").strip()
        try:
            recent = int(r.get("last_season") or 0) >= since_season
        except ValueError:
            recent = False
        if val and club and recent:
            out[club] = out.get(club, 0) + val[1]
    return out


# Ligas de la zona (Conmebol) que trae el dataset: país y nombre para el selector del predictor.
ZONE = {
    "ARG1": ("Argentina", "Liga Profesional"),
    "BRA1": ("Brasil", "Brasileirão Série A"),
    "COL1": ("Colombia", "Liga BetPlay"),
}


def club_leagues(players: list[dict[str, str]], since_season: int) -> dict[str, str]:
    """Liga (código del dataset) de cada club, según sus jugadores actuales."""
    out: dict[str, str] = {}
    for r in players:
        club = (r.get("current_club_name") or "").strip()
        comp = r.get("current_club_domestic_competition_id") or ""
        try:
            recent = int(r.get("last_season") or 0) >= since_season
        except ValueError:
            recent = False
        if club and comp and recent:
            out.setdefault(club, comp)
    return out


def valuation_history(rows: list[dict[str, str]], ids: set[str]) -> dict[str, list[tuple[date, int]]]:
    """Historial de valuaciones de algunos jugadores: {player_id: [(fecha, valor)]} en orden de fecha."""
    out: dict[str, list[tuple[date, int]]] = {}
    for r in rows:
        pid = r.get("player_id", "")
        if pid not in ids:
            continue
        try:
            out.setdefault(pid, []).append(
                (date.fromisoformat(r["date"][:10]), int(float(r["market_value_in_eur"])))
            )
        except (KeyError, ValueError):
            continue
    return {k: sorted(v) for k, v in out.items()}


def fetch(client: PoliteClient, today: date) -> list[PoolPlayerRecord]:
    players = read_csv(client, "players")
    return parse_players(players, latest_valuations(read_csv(client, "player_valuations")), today)


def dump(rows: list[PoolPlayerRecord]) -> list[dict[str, Any]]:
    return [r.model_dump(mode="json") for r in rows]


def parse_games(rows: list[dict[str, str]], since_year: int) -> list[dict[str, Any]]:
    """Resultados de liga de `COMPETITIONS` desde `since_year`, con la forma de `api.league_result`.

    La temporada sale del año de la fecha: el dataset rotula «2025» al Apertura jugado en 2026.
    """
    out = []
    for r in rows:
        try:
            day = date.fromisoformat(r["date"][:10])
            home_goals, away_goals = int(r["home_club_goals"]), int(r["away_club_goals"])
        except (KeyError, ValueError):
            continue
        if r.get("competition_id") in COMPETITIONS and day.year >= since_year and r.get("home_club_name"):
            out.append(
                {
                    "source": SOURCE,
                    "season": day.year,
                    "match_date": day.isoformat(),
                    "home_team": r["home_club_name"],
                    "away_team": r["away_club_name"],
                    "home_goals": home_goals,
                    "away_goals": away_goals,
                }
            )
    return out
