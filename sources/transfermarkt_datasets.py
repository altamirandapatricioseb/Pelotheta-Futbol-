"""transfermarkt-datasets (github.com/dcaribou/transfermarkt-datasets): valores de mercado abiertos.

Por qué esta fuente y no Transfermarkt directo: Transfermarkt prohíbe el acceso automatizado en sus
términos. Este proyecto abierto publica sus datos con licencia CC0 (dominio público) como CSV en
un bucket público, y en 2026 incluye la Liga Profesional Argentina (`ARG1`): 1261 jugadores de
32 clubes, con valor de mercado, posición y club actual. Se baja con PoliteClient (robots.txt,
pausa, caché y manifiesto con SHA-256) y nunca se guarda la fecha de nacimiento: solo la edad.

No trae estadísticas por partido de la liga argentina: esas quedan para otra fuente.
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


def read_csv(client: PoliteClient, name: str) -> list[dict[str, str]]:
    """Un CSV comprimido del dataset, ya leído."""
    if not name.replace("_", "").isalpha():
        raise ValueError("nombre de archivo inválido")
    body = client.get(f"{BASE}/{name}.csv.gz").body
    return list(csv.DictReader(io.StringIO(gzip.decompress(body).decode("utf-8"))))


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
            )
        )
    return out


def fetch(client: PoliteClient, today: date) -> list[PoolPlayerRecord]:
    players = read_csv(client, "players")
    return parse_players(players, latest_valuations(read_csv(client, "player_valuations")), today)


def dump(rows: list[PoolPlayerRecord]) -> list[dict[str, Any]]:
    return [r.model_dump(mode="json") for r in rows]
