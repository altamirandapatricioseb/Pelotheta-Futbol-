"""Catálogo de estadísticas (sección 5) y conjuntos de columnas de las tablas (9.1 y 9.5).

`data/stat_catalog.csv` tiene una fila por estadística con su descripción, su nivel (A, B o C)
y la **regla de cálculo** que interpreta la vista SQL de la tabla maestra:

- `suma`: suma por partido de un valor base (`arg1`) que produce la vista `api.player_match_value`
  o `api.team_match_value`. Se puede ver en totales o cada 90 minutos.
- `promedio`: promedio por partido de un valor base (por ejemplo, la calificación).
- `cociente`: `arg1 / arg2 × factor`, con las sumas de toda la ventana (suma sobre suma, nunca
  promedio de porcentajes: un partido de 10 minutos no pesa igual que uno de 90).
- `diferencia` y `adicion`: `arg1 − arg2` y `arg1 + arg2`, también sobre las sumas.
- `perfil`: dato de la ficha del jugador (edad, altura, pie...).
- `metrica`: métrica propia calculada en Python (secciones 5.7 y 6) y cargada ya resuelta.
- `especial`: cálculo propio en SQL con funciones de ventana (rachas, forma, días de descanso).
- `nd`: nivel C, sin fuente gratuita: se muestra `n/d`.

Los compuestos solo combinan sumas o promedios. Así la vista resuelve todo en una pasada y
cada número se puede rastrear hasta sus valores por partido. Un compuesto usa solo los partidos
que tienen los dos datos: si el xG falta en la Copa Argentina, «goles − xG» no resta goles de
partidos sin xG.

`por90`: en jugadores, si la estadística se puede ver cada 90 minutos; en el equipo, si se puede
ver como promedio por partido.
"""

from __future__ import annotations

import csv
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

ROOT = Path(__file__).resolve().parent.parent
CATALOG_PATH = ROOT / "data" / "stat_catalog.csv"
SETS_PATH = ROOT / "data" / "stat_sets.csv"

Entity = Literal["jugador", "equipo"]
Rule = Literal["suma", "promedio", "cociente", "diferencia", "adicion", "perfil", "metrica", "especial", "nd"]
COMPOSITE = ("cociente", "diferencia", "adicion")

# Valores por partido que producen las vistas `api.player_match_value` y `api.team_match_value`.
# Las claves que vienen de las fuentes están en `core.player_match_stat` y `core.team_match_stat`;
# las demás se derivan en SQL de alineaciones, eventos, tiros y resultados.
_PLAYER_SOURCE_KEYS = {
    "aerials_lost",
    "aerials_won",
    "assists_cross",
    "assists_headed_pass",
    "assists_pass",
    "assists_through_ball",
    "big_chances_created",
    "big_chances_missed",
    "blocks",
    "captain",
    "carries",
    "carry_distance_m",
    "clearances",
    "clearances_off_line",
    "crosses",
    "crosses_accurate",
    "dispossessed",
    "dribbled_past",
    "dribbles_attempted",
    "dribbles_successful",
    "duels_lost",
    "duels_won",
    "errors_to_goal",
    "errors_to_shot",
    "fouls_committed",
    "fouls_suffered",
    "goals_corner",
    "goals_fast_break",
    "goals_prevented",
    "goals_set_piece",
    "handballs",
    "high_claims",
    "interceptions",
    "key_passes",
    "last_man_tackles",
    "long_balls",
    "long_balls_accurate",
    "miscontrols",
    "offsides",
    "opp_half_passes",
    "opp_half_passes_accurate",
    "passes",
    "passes_accurate",
    "penalties_conceded",
    "penalties_won",
    "possession_lost",
    "progression_m",
    "progressive_carries",
    "progressive_carry_distance_m",
    "punches",
    "rating",
    "recoveries",
    "saves",
    "saves_inside_box",
    "shot_assists",
    "shots_blocked",
    "shots_faced",
    "shots_on_target",
    "shots_total",
    "sweeper_actions",
    "sweeper_actions_accurate",
    "tackles",
    "tackles_attempted",
    "tackles_won",
    "touches",
    "woodwork",
    "xa",
    "xg",
    "xgot",
}
_PLAYER_DERIVED_KEYS = {
    # Alineaciones y cambios.
    "appearances",
    "starts",
    "benched",
    "sub_ins",
    "complete_matches",
    "subbed_off",
    "minutes",
    "minutes_sub",
    # Eventos con minuto (sin la tanda de penales).
    "goals",
    "assists",
    "goal_contributions",
    "goal_contributions_sub",
    "penalty_goals",
    "penalties_taken",
    "npg",
    "own_goals",
    "yellow_cards",
    "red_cards",
    "var_disallowed",
    # Tiros ubicados (StrikerAPI, solo liga).
    "header_goals",
    "headers",
    "goals_outside_box",
    "shots_outside_box",
    # xG − 0,76 × penales pateados (estimado, tabla 5.6).
    "npxg",
    # Sumas de dos claves de la fuente, solo en partidos con las dos.
    "duels_total",
    "aerials_total",
    # Arqueros: lo que pasó con el arquero en cancha.
    "goals_conceded",
    "clean_sheets",
    "shots_on_target_faced",
    "xgot_faced",
    "penalties_faced",
    "penalties_saved",
    # Ventana de minutos con el jugador en cancha (base de NR, sección 6).
    "team_goals_on",
    "team_goals_against_on",
    # Partidos que se perdió por suspensión.
    "suspensions",
}
_TEAM_SOURCE_KEYS = {
    "attacks",
    "big_chances",
    "big_chances_missed",
    "clearances",
    "corners",
    "crosses",
    "crosses_accurate",
    "dangerous_attacks",
    "dribbles",
    "dribbles_successful",
    "duels_won",
    "expected_points",
    "fouls",
    "free_kicks",
    "goals_corner",
    "goals_fast_break",
    "goals_free_kick",
    "goals_from_cross",
    "goals_header",
    "goals_left_foot",
    "goals_outside_box",
    "goals_penalty",
    "goals_right_foot",
    "goals_set_piece",
    "goals_six_yard_box",
    "interceptions",
    "key_passes",
    "long_passes",
    "long_passes_accurate",
    "npxg",
    "offsides",
    "passes",
    "passes_accurate",
    "penalties_attempted",
    "penalties_scored",
    "possession_pct",
    "red_cards",
    "saves",
    "shots_blocked",
    "shots_inside_box",
    "shots_off_target",
    "shots_on_target",
    "shots_outside_box",
    "shots_total",
    "tackles",
    "tackles_won",
    "xg",
    "xg_open_play",
    "xg_set_pieces",
    "xgot",
    "yellow_cards",
}
_TEAM_DERIVED_KEYS = {
    "matches",
    "wins",
    "draws",
    "losses",
    "points",
    "goals_for",
    "goals_against",
    "goal_difference",
    "goals_for_ht",
    "goals_against_ht",
    "clean_sheets",
    "failed_to_score",
    "var_disallowed_for",
    "var_disallowed_against",
    "own_goals_for",
    *(
        f"goals_{side}_{band}"
        for side in ("for", "against")
        for band in ("00_15", "16_30", "31_45", "46_60", "61_75", "76_90")
    ),
    # Suma de los jugadores de Boca (no hay dato del rival).
    "aerials_won_players",
    "recoveries_players",
    "possession_lost_players",
    "carries_players",
    # Combinaciones de claves de la fuente, solo en partidos que tienen todas.
    "xg_difference",
    "big_chances_scored",
    "dangerous_attacks_total",
    "defensive_actions",
    "defensive_actions_ppda",
    # Marcador a lo largo del partido.
    "minutes_leading",
    "minutes_level",
    "minutes_trailing",
    "points_from_behind",
    "points_dropped_from_ahead",
    # Contexto: calendario, clima y bajas del rival.
    "rest_days",
    "temperature_c",
    "precipitation_mm",
    "opponent_absences",
}
BASE_KEYS: dict[str, set[str]] = {
    "jugador": _PLAYER_SOURCE_KEYS | _PLAYER_DERIVED_KEYS,
    "equipo": _TEAM_DERIVED_KEYS | _TEAM_SOURCE_KEYS | {f"{k}_against" for k in _TEAM_SOURCE_KEYS},
}


class Stat(BaseModel):
    """Una fila de `stat_catalog.csv` (columnas de la sección 5 más la regla de cálculo)."""

    model_config = ConfigDict(frozen=True, extra="forbid")

    id: str = Field(pattern=r"^[a-z][a-z0-9_]*$")
    entidad: Entity
    nombre_es: str = Field(min_length=2)
    abrev: str = Field(min_length=1, max_length=10)
    descripcion_es: str
    lectura_es: str  # cómo leer el valor: si más alto es mejor, qué significa negativo...
    grupo: str
    categoria: str
    unidad: str
    fuente: str
    nivel: Literal["A", "B", "C"]
    formula: str
    higher_is_better: bool
    available: bool
    estimada: bool
    por90: bool
    agregacion: Rule
    arg1: str
    arg2: str
    factor: float = 1.0

    @field_validator("factor", mode="before")
    @classmethod
    def _empty_factor(cls, value: object) -> object:
        return 1.0 if value in ("", None) else value


class StatSet(BaseModel):
    """Conjunto de columnas de una tabla: el desplegable de categoría de las Interfaces 2 y 3."""

    model_config = ConfigDict(frozen=True, extra="forbid")

    id: str = Field(pattern=r"^[a-z][a-z0-9_]*$")
    entidad: Entity
    nombre_es: str
    descripcion_es: str = Field(max_length=200)
    stats: tuple[str, ...]


def _bool(value: str) -> bool:
    if value not in ("true", "false"):
        raise ValueError(f"booleano inválido: {value!r}")
    return value == "true"


def load_catalog(path: Path = CATALOG_PATH) -> list[Stat]:
    with path.open(encoding="utf-8", newline="") as handle:
        rows = list(csv.DictReader(handle))
    flags = ("higher_is_better", "available", "estimada", "por90")
    return [Stat.model_validate({**row, **{f: _bool(row[f]) for f in flags}}) for row in rows]


_ENTITY_DB = {"jugador": "player", "equipo": "team"}


def to_payload(stats: list[Stat], sets: list[StatSet]) -> dict[str, list[dict[str, object]]]:
    """Lote de `ingest.load_catalog`: el CSV usa nombres en español; la base, en inglés."""
    return {
        "stats": [
            {
                "stat_id": s.id,
                "entity": _ENTITY_DB[s.entidad],
                "name_es": s.nombre_es,
                "short_name": s.abrev,
                "description_es": s.descripcion_es,
                "reading_es": s.lectura_es,
                "stat_group": s.grupo,
                "category": s.categoria,
                "unit": s.unidad,
                "source": s.fuente,
                "level": s.nivel,
                "formula": s.formula,
                "higher_is_better": s.higher_is_better,
                "available": s.available,
                "estimated": s.estimada,
                "per90": s.por90,
                "rule": s.agregacion,
                "arg1": s.arg1,
                "arg2": s.arg2,
                "factor": s.factor,
            }
            for s in stats
        ],
        "sets": [
            {
                "set_id": st.id,
                "entity": _ENTITY_DB[st.entidad],
                "name_es": st.nombre_es,
                "description_es": st.descripcion_es,
                "sort_order": order,
                "stats": list(st.stats),
            }
            for order, st in enumerate(sets, start=1)
        ],
    }


def load_sets(path: Path = SETS_PATH) -> list[StatSet]:
    with path.open(encoding="utf-8", newline="") as handle:
        rows = list(csv.DictReader(handle))
    return [StatSet.model_validate({**row, "stats": tuple(row["stats"].split())}) for row in rows]
