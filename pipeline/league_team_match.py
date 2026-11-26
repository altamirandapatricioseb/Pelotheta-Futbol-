"""Estadísticas de equipo por partido de cualquier club (etapa 5k-1), con las mismas claves que la
vista `api.team_match_value` de Boca: así la tabla de Equipo de la web sirve para todos.

Por equipo y partido: resultado (`matches`, `wins`, `points`, `goals_for`…), goles por tramo de 15
minutos si los minutos cierran con el marcador, y las estadísticas de Promiedos (Opta) propias y del
rival (`shots_total` y `shots_total_against`). Promiedos permite compartirlas citando la fuente.
"""

from __future__ import annotations

from typing import Any

from pipeline.models import LeagueResultRecord

# Mismos tramos que la vista de Boca; el descuento queda en su tiempo (45+2 → 45).
BANDS = (("00_15", 0, 15), ("16_30", 16, 30), ("31_45", 31, 45), ("46_60", 46, 60), ("61_75", 61, 75))


def _band(minute: int) -> str:
    return next((name for name, lo, hi in BANDS if lo <= minute <= hi), "76_90")


def _side(
    gf: int,
    ga: int,
    own: dict[str, float],
    rival: dict[str, float],
    mins_for: list[int] | None,
    mins_against: list[int] | None,
) -> dict[str, float]:
    points = 3 if gf > ga else 1 if gf == ga else 0
    stats: dict[str, float] = {
        "matches": 1,
        "wins": int(gf > ga),
        "draws": int(gf == ga),
        "losses": int(gf < ga),
        "points": points,
        "goals_for": gf,
        "goals_against": ga,
        "goal_difference": gf - ga,
        "clean_sheets": int(ga == 0),
        "failed_to_score": int(gf == 0),
        **own,
        **{f"{k}_against": v for k, v in rival.items()},
    }
    if mins_for is not None and mins_against is not None:
        for side, mins in (("goals_for", mins_for), ("goals_against", mins_against)):
            for name, _, _ in (*BANDS, ("76_90", 0, 0)):
                stats[f"{side}_{name}"] = sum(_band(m) == name for m in mins)
    return stats


def team_match_rows(
    games: list[LeagueResultRecord], team_stats: dict[str, dict[str, dict[str, float]]]
) -> list[dict[str, Any]]:
    """Dos filas por partido (una por equipo). `team_stats`: ext_id → nombre del club → estadísticas."""
    rows = []
    for g in games:
        stats = team_stats.get(g.ext_id, {})
        complete = len(g.home_goal_minutes) == g.home_goals and len(g.away_goal_minutes) == g.away_goals
        for home in (True, False):
            team, rival = (g.home_team, g.away_team) if home else (g.away_team, g.home_team)
            gf, ga = (g.home_goals, g.away_goals) if home else (g.away_goals, g.home_goals)
            mins = (
                (g.home_goal_minutes, g.away_goal_minutes)
                if home
                else (g.away_goal_minutes, g.home_goal_minutes)
            )
            rows.append(
                {
                    "source": g.source,
                    "ext_id": g.ext_id,
                    "season": g.season,
                    "match_date": g.match_date.isoformat(),
                    "stage": g.stage,
                    "team_name": team,
                    "opponent": rival,
                    "home": home,
                    "goals_for": gf,
                    "goals_against": ga,
                    "referee": g.referee,
                    "stats": _side(
                        gf,
                        ga,
                        stats.get(team, {}),
                        stats.get(rival, {}),
                        list(mins[0]) if complete else None,
                        list(mins[1]) if complete else None,
                    ),
                }
            )
    return rows
