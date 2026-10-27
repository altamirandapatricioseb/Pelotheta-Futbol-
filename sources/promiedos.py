"""Adaptador de Promiedos (fuente principal, ver docs/adr/0004-fuentes-y-boton-actualizar.md).

Qué hace:
- Lee solo páginas HTML públicas (equipo y partido). Los datos vienen en el JSON
  `__NEXT_DATA__` que Next.js deja en el HTML del servidor: no hace falta ejecutar JavaScript
  ni usar endpoints internos.
- Convierte cada partido jugado de Boca en registros del lote (`pipeline.models`).
- De los rivales guarda solo el equipo y su lado de cada evento: nunca nombres de jugadores
  rivales (minimización de datos personales).

Por qué los minutos se calculan acá y no en SQL: la fuente da el minuto de cada cambio y de
cada expulsión; con eso se arma entrada y salida de cada jugador una sola vez, y las vistas
solo restan. Los minutos de descuento no se suman (convención habitual: 90 por partido).
"""

from __future__ import annotations

import json
import re
import unicodedata
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta, timezone
from typing import Any

from pipeline.models import (
    CompetitionRecord,
    EventRecord,
    EventType,
    LineupRecord,
    MatchRecord,
    PlayerRecord,
    SquadRecord,
    TeamRecord,
    TeamStatRecord,
)

SOURCE = "promiedos"
BASE_URL = "https://www.promiedos.com.ar"
BOCA_ID = "igg"
BOCA_TEAM_PATH = "/team/boca-juniors/igg"
AR_TZ = timezone(timedelta(hours=-3))  # Argentina no usa horario de verano desde 2009

NEXT_DATA_RE = re.compile(r'<script id="__NEXT_DATA__"[^>]*>(.*?)</script>', re.S)
MINUTE_RE = re.compile(r"^(\d{1,3})'(?:\+(\d{1,2}))?$")

# Códigos de evento de Promiedos. Se dedujeron conciliando eventos con el marcador final de
# 34 partidos (Fase 0): 1 y 3 suman goles; 5 y 6 sacan al jugador; 17 solo aparece en tandas.
# Los códigos que no se pudieron identificar (7 y 10) se guardan como 'otro' con el código.
EVENT_TYPES: dict[int, EventType] = {
    1: "gol",
    3: "penal_convertido",
    4: "amarilla",
    5: "segunda_amarilla",
    6: "roja",
    9: "var",
    15: "cambio",
    17: "penal_fallado",
}
SENDING_OFF = {"segunda_amarilla", "roja"}

# Estadísticas por equipo que se cargan (nombre en Promiedos -> clave interna).
STAT_KEYS = {
    "Total Remates": "shots_total",
    "Remates al arco": "shots_on_target",
    "Posesión": "possession_pct",
    "Ataques": "attacks",
    "Saques de falta": "free_kicks",
    "Saques de Esquina": "corners",
    "Fueras de Juego": "offsides",
    "Faltas": "fouls",
    "Tarjetas Amarillas": "yellow_cards",
    "Tarjetas Rojas": "red_cards",
}

POSITION_GROUPS = {"Arquero", "Defensor", "Mediocampista", "Delantero"}
# En el plantel la línea viene en plural («Arqueros»); en las alineaciones, en singular.
PLURAL_TO_GROUP = {f"{g}es" if g.endswith("r") else f"{g}s": g for g in POSITION_GROUPS}


def position_group(text: str | None) -> str | None:
    if text in POSITION_GROUPS:
        return text
    return PLURAL_TO_GROUP.get(text or "")


@dataclass(frozen=True)
class GameRef:
    """Partido de Boca encontrado en una página de equipo."""

    game_id: str
    url_name: str

    @property
    def path(self) -> str:
        return f"/game/{self.url_name}/{self.game_id}"


@dataclass
class ParsedGame:
    competition: CompetitionRecord
    teams: list[TeamRecord]
    match: MatchRecord
    players: list[PlayerRecord] = field(default_factory=list)
    lineups: list[LineupRecord] = field(default_factory=list)
    events: list[EventRecord] = field(default_factory=list)
    team_stats: list[TeamStatRecord] = field(default_factory=list)


# --- utilidades -------------------------------------------------------------------------


def next_data(html: str) -> dict[str, Any]:
    """Extrae `props.pageProps` del JSON `__NEXT_DATA__` de una página."""
    match = NEXT_DATA_RE.search(html)
    if match is None:
        raise ValueError("La página no trae __NEXT_DATA__ (¿cambió el sitio?)")
    data: dict[str, Any] = json.loads(match.group(1))["props"]["pageProps"]
    return data


def player_key(name: str) -> str:
    """Clave estable de un jugador: nombre sin tildes, en minúsculas y con espacios simples.

    Promiedos no publica ids de jugador, así que el nombre normalizado hace de id. Se usa en
    source_id_map para no duplicar al mismo jugador entre partidos.
    """
    decomposed = unicodedata.normalize("NFKD", name)
    plain = "".join(ch for ch in decomposed if not unicodedata.combining(ch))
    return " ".join(plain.lower().split())


def parse_minute(text: str) -> tuple[int, int | None]:
    """'45'+2' -> (45, 2); '94'' -> (94, None)."""
    match = MINUTE_RE.match(text.strip())
    if match is None:
        raise ValueError(f"Minuto con formato desconocido: {text!r}")
    added = match.group(2)
    return int(match.group(1)), int(added) if added else None


def period_for(stage_name: str, minute: int) -> int:
    """Tiempo del partido según el bloque de eventos de Promiedos (y el minuto como respaldo)."""
    if stage_name == "Entretiempo":
        return 1
    if stage_name == "Fin de los 90 minutos":
        return 2
    if minute <= 45:
        return 1
    if minute <= 90:
        return 2
    return 3 if minute <= 105 else 4


def parse_height(text: str | None) -> int | None:
    """'1.91' -> 191. Valores fuera de rango humano se descartan (la fuente a veces trae 0)."""
    try:
        cm = round(float(text or "") * 100)
    except ValueError:
        return None
    return cm if 140 <= cm <= 220 else None


def parse_birthdate(text: str | None) -> date | None:
    try:
        return datetime.strptime(text or "", "%d/%m/%Y").date()
    except ValueError:
        return None


def competition_kind(name: str) -> str:
    lowered = name.lower()
    if "amistoso" in lowered:
        return "amistoso"
    if "conmebol" in lowered or "libertadores" in lowered or "sudamericana" in lowered:
        return "copa_internacional"
    if "copa" in lowered:
        return "copa_nacional"
    return "liga"


def competition_code(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", player_key(name)).strip("_")


SORT_ORDER = {"liga": 10, "copa_internacional": 20, "copa_nacional": 30, "amistoso": 90}


def team_record(team: dict[str, Any]) -> TeamRecord:
    return TeamRecord(
        source_id=team["id"],
        name=team["name"],
        short_name=team.get("short_name"),
        country=team.get("country_id"),
        is_boca=team["id"] == BOCA_ID,
    )


def _info(game: dict[str, Any], label: str) -> str | None:
    for item in game.get("game_info") or []:
        if item.get("name") == label:
            value = str(item.get("value") or "").strip()
            return value or None
    return None


def _stat_value(text: str) -> float | None:
    try:
        return float(text.replace("%", "").replace(",", ".").strip())
    except ValueError:
        return None


# --- partido ----------------------------------------------------------------------------


def parse_game(game: dict[str, Any]) -> ParsedGame | None:
    """Convierte un partido de Promiedos en registros. Devuelve None si no corresponde cargarlo.

    Se omiten partidos no terminados y los que no tienen alineaciones (por ejemplo, amistosos
    sin datos): sin alineaciones no hay minutos y el partido ensuciaría los promedios.
    """
    if (game.get("status") or {}).get("enum") != 3:
        return None
    if competition_kind((game.get("league") or {}).get("name", "")) == "amistoso":
        return None
    lineup_teams = ((game.get("players") or {}).get("lineups") or {}).get("teams") or []
    if not lineup_teams:
        return None

    home, away = game["teams"][0], game["teams"][1]
    side_id = {1: home["id"], 2: away["id"]}
    boca_side = 1 if home["id"] == BOCA_ID else 2 if away["id"] == BOCA_ID else None
    if boca_side is None:
        return None
    match_id = game["id"]
    stages = game.get("events") or []
    regular = [s for s in stages if not s.get("is_penalties_stage")]
    shootout = [s for s in stages if s.get("is_penalties_stage")]
    extra_time = any(s.get("name") == "Suplementario" for s in stages)
    end_minute = 120 if extra_time else 90

    league = game["league"]
    kind = competition_kind(league["name"])
    competition = CompetitionRecord(
        source_id=league["id"],
        code=competition_code(league["name"]),
        name_es=league["name"],
        kind=kind,  # type: ignore[arg-type]
        country=league.get("country_id"),
        sort_order=SORT_ORDER[kind],
    )

    kickoff = datetime.strptime(game["start_time"], "%d-%m-%Y %H:%M").replace(tzinfo=AR_TZ)
    half_time = next((s.get("scores") for s in regular if s.get("name") == "Entretiempo"), None)
    pens = shootout[-1].get("scores") if shootout else None
    match = MatchRecord(
        source_id=match_id,
        competition_source_id=league["id"],
        match_date=kickoff.date(),
        kickoff_at=kickoff,
        round_label=game.get("stage_round_name"),
        home_source_id=home["id"],
        away_source_id=away["id"],
        home_goals=game["scores"][0],
        away_goals=game["scores"][1],
        home_goals_ht=half_time[0] if half_time else None,
        away_goals_ht=half_time[1] if half_time else None,
        venue=_info(game, "Estadio"),
        referee=_info(game, "Árbitro"),
        extra_time=extra_time,
        penalties_home=pens[0] if pens else None,
        penalties_away=pens[1] if pens else None,
    )

    # Eventos. Se recorre una vez y se anotan los minutos de cambios y expulsiones de Boca.
    events: list[EventRecord] = []
    sub_in: dict[str, int] = {}
    sub_out: dict[str, int] = {}
    sent_off: dict[str, int] = {}
    for stage in regular:
        for row in stage.get("rows") or []:
            for ev in row.get("events") or []:
                minute, added = parse_minute(ev["time"])
                ev_type = EVENT_TYPES.get(ev["type"], "otro")
                is_boca = ev["team"] == boca_side
                texts = [player_key(t) for t in ev.get("texts") or []]
                main = texts[0] if texts and is_boca and ev_type != "var" else None
                related = texts[1] if len(texts) > 1 and is_boca and ev_type in ("gol", "cambio") else None
                if is_boca and ev_type == "cambio" and main and related:
                    sub_in[main] = minute
                    sub_out[related] = minute
                if is_boca and ev_type in SENDING_OFF and main:
                    sent_off[main] = minute
                events.append(
                    EventRecord(
                        match_source_id=match_id,
                        minute=minute,
                        added_time=added,
                        period=period_for(stage.get("name", ""), minute),
                        type=ev_type,
                        team_source_id=side_id[ev["team"]],
                        player_source_id=main,
                        related_player_source_id=related,
                        detail=None if ev["type"] in EVENT_TYPES else f"promiedos_tipo_{ev['type']}",
                    )
                )
    for stage in shootout:
        for row in stage.get("rows") or []:
            for ev in row.get("events") or []:
                is_boca = ev["team"] == boca_side
                texts = ev.get("texts") or []
                events.append(
                    EventRecord(
                        match_source_id=match_id,
                        minute=end_minute,
                        period=5,
                        type="penal_convertido" if ev["type"] == 3 else "penal_fallado",
                        team_source_id=side_id[ev["team"]],
                        player_source_id=player_key(texts[0]) if texts and is_boca else None,
                        detail="tanda de penales",
                    )
                )

    # Alineación de Boca con minutos de entrada y salida.
    players: list[PlayerRecord] = []
    lineups: list[LineupRecord] = []
    boca_lineup = next((t for t in lineup_teams if t.get("team_num") == boca_side), None)
    if boca_lineup is not None:
        for started, group in (
            (True, boca_lineup.get("starting") or []),
            (False, boca_lineup.get("bench") or []),
        ):
            for p in group:
                key = player_key(p["name"])
                if started:
                    minute_in: int | None = 0
                elif key in sub_in:
                    minute_in = sub_in[key]
                else:
                    minute_in = None
                minute_out = None
                if minute_in is not None:
                    exits = [m for m in (sub_out.get(key), sent_off.get(key)) if m is not None]
                    minute_out = max(minute_in, min([*exits, end_minute]))
                players.append(
                    PlayerRecord(
                        source_id=key,
                        full_name=p["name"],
                        known_as=p.get("player_short_name"),
                        position_raw=position_group(p.get("position")),
                        height_cm=parse_height(p.get("height")),
                    )
                )
                jersey = p.get("jersey_num")
                lineups.append(
                    LineupRecord(
                        match_source_id=match_id,
                        player_source_id=key,
                        team_source_id=BOCA_ID,
                        started=started,
                        minute_in=minute_in,
                        minute_out=minute_out,
                        position=p.get("formation_position") or p.get("position"),
                        shirt_number=jersey if isinstance(jersey, int) and 0 <= jersey <= 99 else None,
                    )
                )

    team_stats: list[TeamStatRecord] = []
    for stat in game.get("statistics") or []:
        key = STAT_KEYS.get(stat.get("name", ""))
        if key is None:
            continue
        for side, raw in enumerate(stat.get("values") or [], start=1):
            value = _stat_value(str(raw))
            if value is not None and side in side_id:
                team_stats.append(
                    TeamStatRecord(
                        match_source_id=match_id, team_source_id=side_id[side], stat_key=key, value=value
                    )
                )

    return ParsedGame(
        competition=competition,
        teams=[team_record(home), team_record(away)],
        match=match,
        players=players,
        lineups=lineups,
        events=events,
        team_stats=team_stats,
    )


# --- equipo -----------------------------------------------------------------------------


def parse_squad(team_data: dict[str, Any]) -> tuple[list[PlayerRecord], list[SquadRecord]]:
    """Plantel actual de Boca: jugadores (con fecha de nacimiento y altura) y dorsales."""
    players: list[PlayerRecord] = []
    squad: list[SquadRecord] = []
    for group in (team_data.get("squad") or {}).get("groups") or []:
        for row in group.get("rows") or []:
            obj = (row.get("entity") or {}).get("object") or {}
            if obj.get("is_staff") or not obj.get("name"):
                continue
            key = player_key(obj["name"])
            position = obj.get("position")
            players.append(
                PlayerRecord(
                    source_id=key,
                    full_name=obj["name"],
                    known_as=obj.get("sname"),
                    birth_date=parse_birthdate(obj.get("birthdate")),
                    position_raw=position_group(position),
                    height_cm=parse_height(obj.get("height")),
                )
            )
            num = str(obj.get("num") or "")
            squad.append(
                SquadRecord(
                    player_source_id=key,
                    shirt_number=int(num) if num.isdigit() and int(num) <= 99 else None,
                    position_group=position_group(position),  # type: ignore[arg-type]
                )
            )
    return players, squad


def _games_with_boca(rows: list[dict[str, Any]], season_year: int) -> list[GameRef]:
    refs = []
    for row in rows:
        g = row.get("game") or {}
        ids = {t.get("id") for t in g.get("teams") or []}
        start = str(g.get("start_time", ""))
        if BOCA_ID in ids and start[6:10] == str(season_year) and g.get("id") and g.get("url_name"):
            refs.append(GameRef(game_id=g["id"], url_name=g["url_name"]))
    return refs


def boca_game_refs(team_data: dict[str, Any], season_year: int) -> list[GameRef]:
    """Partidos de Boca de la temporada listados en una página de equipo (de Boca o de un rival)."""
    games = team_data.get("games") or {}
    rows = [*(games.get("last") or {}).get("rows", []), *(games.get("next") or {}).get("rows", [])]
    return _games_with_boca(rows, season_year)


def head_to_head_refs(game: dict[str, Any], season_year: int) -> list[GameRef]:
    """Partidos de Boca de la temporada en el bloque «historial» de un partido."""
    games = (game.get("head_to_head") or {}).get("games") or []
    return _games_with_boca([{"game": g} for g in games], season_year)


def opponent_paths(game: dict[str, Any]) -> list[str]:
    """Rutas de las páginas de equipo de los rivales de un partido."""
    return [f"/team/{t['url_name']}/{t['id']}" for t in game.get("teams") or [] if t.get("id") != BOCA_ID]
