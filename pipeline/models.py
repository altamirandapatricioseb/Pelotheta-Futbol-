"""Modelos del lote que el pipeline carga en Supabase (`ingest.load_batch`).

Cada adaptador de fuente devuelve estos registros. Pydantic valida tipos y rangos ANTES de
tocar la base: un dato raro de la fuente corta la carga con un error claro en vez de
ensuciar las tablas (los mismos rangos están como CHECK en SQL, defensa en profundidad).
"""

from __future__ import annotations

from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

EventType = Literal[
    "gol",
    "gol_en_contra",
    "penal_convertido",
    "penal_fallado",
    "amarilla",
    "segunda_amarilla",
    "roja",
    "cambio",
    "var",
    "otro",
]


class Record(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")


class CompetitionRecord(Record):
    source_id: str
    code: str = Field(pattern=r"^[a-z0-9_]+$")
    name_es: str
    kind: Literal["liga", "copa_nacional", "copa_internacional", "amistoso"]
    country: str | None = None
    sort_order: int = 100


class TeamRecord(Record):
    source_id: str
    name: str
    short_name: str | None = None
    country: str | None = None
    stadium: str | None = None
    is_boca: bool = False


class PlayerRecord(Record):
    source_id: str
    full_name: str
    known_as: str | None = None
    birth_date: date | None = None
    position_raw: str | None = None
    height_cm: int | None = Field(default=None, ge=140, le=220)


class SquadRecord(Record):
    player_source_id: str
    shirt_number: int | None = Field(default=None, ge=0, le=99)
    position_group: Literal["Arquero", "Defensor", "Mediocampista", "Delantero"] | None = None


class MatchRecord(Record):
    source_id: str
    competition_source_id: str
    match_date: date
    kickoff_at: datetime
    round_label: str | None = None
    home_source_id: str
    away_source_id: str
    home_goals: int = Field(ge=0)
    away_goals: int = Field(ge=0)
    home_goals_ht: int | None = Field(default=None, ge=0)
    away_goals_ht: int | None = Field(default=None, ge=0)
    status: Literal["jugado"] = "jugado"
    venue: str | None = None
    referee: str | None = None
    extra_time: bool = False
    penalties_home: int | None = Field(default=None, ge=0)
    penalties_away: int | None = Field(default=None, ge=0)


class LineupRecord(Record):
    match_source_id: str
    player_source_id: str
    team_source_id: str
    started: bool
    minute_in: int | None = Field(default=None, ge=0, le=130)
    minute_out: int | None = Field(default=None, ge=0, le=130)
    position: str | None = None
    shirt_number: int | None = Field(default=None, ge=0, le=99)


class EventRecord(Record):
    match_source_id: str
    minute: int = Field(ge=0, le=130)
    added_time: int | None = Field(default=None, ge=0, le=30)
    period: int = Field(ge=1, le=5)
    type: EventType
    team_source_id: str
    player_source_id: str | None = None
    related_player_source_id: str | None = None
    detail: str | None = None


class TeamStatRecord(Record):
    match_source_id: str
    team_source_id: str
    stat_key: str = Field(pattern=r"^[a-z_]+$")
    value: float
    # Fuente del número si no es la del lote (por ejemplo, el xG de NoFluffPicks dentro del
    # lote de Promiedos). Se guarda por fila para citar bien cada dato.
    source: str | None = Field(default=None, pattern=r"^[a-z_]+$")
