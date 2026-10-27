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


class PlayerStatRecord(Record):
    """Estadística de un jugador de Boca en un partido (formato largo, como las de equipo)."""

    match_source_id: str
    player_source_id: str
    stat_key: str = Field(pattern=r"^[a-z_]+$")
    value: float = Field(ge=0)
    source: str = Field(pattern=r"^[a-z_]+$")


class ShotRecord(Record):
    """Un tiro con su ubicación (x = distancia a la línea de gol como fracción de media cancha,
    y = ancho, 0,5 es el centro). De los rivales se guarda el tiro sin el jugador."""

    match_source_id: str
    team_source_id: str
    player_source_id: str | None = None
    minute: int | None = Field(default=None, ge=0, le=130)
    outcome: str = Field(pattern=r"^[a-z_]+$")
    body_part: str | None = Field(default=None, pattern=r"^[a-z_]+$")
    penalty: bool = False
    zone: str | None = Field(default=None, pattern=r"^[a-z_]+$")
    xg: float = Field(ge=0, le=1)
    x: float | None = Field(default=None, ge=0, le=2)  # más de 1 = tiro desde campo propio
    y: float | None = Field(default=None, ge=0, le=1)
    end_x: float | None = Field(default=None, ge=0, le=2)
    end_y: float | None = Field(default=None, ge=0, le=1)
    source: str = Field(pattern=r"^[a-z_]+$")


class FormationRecord(Record):
    match_source_id: str
    team_source_id: str
    formation: str = Field(pattern=r"^\d(-\d){2,4}$")
    source: str = Field(pattern=r"^[a-z_]+$")


class WeatherRecord(Record):
    """Clima a la hora del inicio del partido (Open-Meteo)."""

    match_source_id: str
    temperature_c: float | None = Field(default=None, ge=-30, le=50)
    precipitation_mm: float | None = Field(default=None, ge=0, le=200)
    wind_kmh: float | None = Field(default=None, ge=0, le=200)
    humidity_pct: float | None = Field(default=None, ge=0, le=100)
    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)
    place: str
    source: str = Field(pattern=r"^[a-z_]+$")


AbsenceReason = Literal["lesion", "suspension_roja", "suspension_amarillas", "seleccion", "personal", "otro"]


class AbsenceRecord(Record):
    """Baja de un partido. De los rivales se guarda solo el motivo, nunca el nombre."""

    match_source_id: str
    team_source_id: str
    player_source_id: str | None = None
    reason: AbsenceReason
    source: str = Field(pattern=r"^[a-z_]+$")


class MomentumRecord(Record):
    """Barra del gráfico de momentum: qué equipo dominó ese minuto y con qué intensidad (0 a 1)."""

    match_source_id: str
    minute: int = Field(ge=1, le=130)
    side: Literal["home", "away"]
    value: float = Field(ge=0, le=1)
    source: str = Field(pattern=r"^[a-z_]+$")


class LeagueResultRecord(Record):
    """Resultado de cualquier partido de la liga (para Elo, calendario y tablas)."""

    source: str = Field(pattern=r"^[a-z_]+$")
    ext_id: str
    season: int
    stage: str | None = None
    match_date: date
    home_team: str
    away_team: str
    home_goals: int = Field(ge=0)
    away_goals: int = Field(ge=0)


class ClubRatingRecord(Record):
    source: str = Field(pattern=r"^[a-z_]+$")
    team_name: str
    rank: int = Field(ge=1)
    elo: float
    as_of: date


class ClubSeasonStatRecord(Record):
    """Promedio por partido de un club en la temporada (a favor y en contra)."""

    source: str = Field(pattern=r"^[a-z_]+$")
    season: int
    team_name: str
    stat_key: str = Field(pattern=r"^[a-z_0-9]+$")
    value: float


class LeagueLeaderRecord(Record):
    source: str = Field(pattern=r"^[a-z_]+$")
    season: int
    stat: str = Field(pattern=r"^[a-z_]+$")
    rank: int = Field(ge=1)
    player_name: str
    team_name: str | None = None
    games: int | None = None
    minutes: int | None = None
    value: float
    per90: float | None = None


class StandingRecord(Record):
    source: str = Field(pattern=r"^[a-z_]+$")
    season: int
    table_name: str
    rank: int = Field(ge=1)
    team_name: str
    played: int | None = None
    won: int | None = None
    drawn: int | None = None
    lost: int | None = None
    goals_for: int | None = None
    goals_against: int | None = None
    points: int | None = None
    average: float | None = None  # solo en la tabla de promedios (descenso)


class PlayerProfileRecord(Record):
    """Datos públicos del jugador que no trae Promiedos (Wikipedia, CC BY-SA)."""

    player_source_id: str
    nationality: str | None = Field(default=None, pattern=r"^[A-Z]{3}$")
    weight_kg: float | None = Field(default=None, ge=40, le=130)
    youth_club: str | None = None
    academy: bool = False
    national_team: str | None = None
    source: str = Field(pattern=r"^[a-z_]+$")
