"""Tests del cálculo de métricas propias con un set de datos chico armado a mano."""

from __future__ import annotations

import pytest

from pipeline import metrics as m
from pipeline import own_metrics as om


def match(
    match_id: int, day: str, opponent: str, gf: int, ga: int, home: bool = True, comp: str = "liga"
) -> om.Match:
    return om.Match(
        match_id=match_id,
        date=day,
        competition=comp,
        opponent=opponent,
        home=home,
        goals_for=gf,
        goals_against=ga,
        referee=None,
    )


def inputs() -> om.Inputs:
    matches = [
        match(1, "2026-02-01", "River", 2, 0),
        match(2, "2026-02-08", "Racing", 1, 1, home=False),
        match(3, "2026-02-15", "Independiente", 3, 1, comp="copa"),
    ]
    team = {1: {"xg": 1.8, "xg_against": 0.4}, 2: {"xg": 0.9}, 3: {}}
    pv = {
        # Jugador 10: delantero titular en los tres; jugador 20: suplente en el 3.
        (10, 1): {"minutes": 90, "starts": 1, "goals": 2, "assists": 0, "goal_contributions": 2},
        (10, 2): {"minutes": 90, "starts": 1, "goals": 1, "assists": 0, "goal_contributions": 1},
        (10, 3): {"minutes": 60, "starts": 1, "goals": 1, "assists": 1, "goal_contributions": 2},
        (20, 3): {"minutes": 30, "starts": 0, "goals": 1, "assists": 0, "goal_contributions": 1},
    }
    for values in pv.values():
        values.setdefault("team_goals_on", values["goals"])
        values.setdefault("team_goals_against_on", 0)
    league = [
        m.Game("2026-02-01", "Boca Juniors", "River", 2, 0),
        m.Game("2026-02-08", "Racing", "Boca Juniors", 1, 1),
    ]
    return om.Inputs(
        matches=matches,
        team_values=team,
        player_values=pv,
        players={10: om.Player(position="Delantero", age=25), 20: om.Player(position="Delantero", age=20)},
        league_games=league,
        table=[],
        zone_rank={},
        referee_yellows={},
    )


def values_of(rows: list[dict[str, object]], stat_id: str) -> dict[object, object]:
    return {
        (r.get("entity_id"), r.get("competition_code")): r["value"] for r in rows if r["stat_id"] == stat_id
    }


def test_team_window_values() -> None:
    window, _ = om.compute(inputs())
    assert values_of(window, "eq_forma_5")[(None, "todas")] == 7  # 3 + 1 + 3
    assert values_of(window, "eq_racha_invicto")[(None, "todas")] == 3
    assert values_of(window, "eq_racha_victorias")[(None, "liga")] == 1
    assert values_of(window, "eq_ventaja_localia")[(None, "todas")] == 2  # 3 de local − 1 de visitante


def test_player_window_values() -> None:
    window, _ = om.compute(inputs())
    pct = values_of(window, "pct_minutos")
    assert pct[(10, "todas")] == pytest.approx(240 / 270 * 100)
    dep = values_of(window, "dependencia_goleador")
    assert dep[(10, "todas")] == pytest.approx(5 / 6 * 100)  # 5 G+A de 6 goles de Boca
    assert values_of(window, "racha_goles")[(10, "todas")] == 3


def test_expected_points_only_with_both_xg() -> None:
    _, per_match = om.compute(inputs())
    xpts = {r["match_id"]: r["value"] for r in per_match if r["stat_id"] == "eq_xpts"}
    assert set(xpts) == {1}
    assert xpts[1] == pytest.approx(m.expected_points(1.8, 0.4), abs=1e-4)  # se guarda con 4 decimales


def test_elo_before_each_league_match() -> None:
    _, per_match = om.compute(inputs())
    elo = {r["match_id"]: r["value"] for r in per_match if r["stat_id"] == "eq_elo"}
    assert elo[1] == pytest.approx(m.ELO_START)
    assert elo[2] > m.ELO_START  # ganó el primero
    assert elo[3] == elo[2] or elo[3] > elo[2]  # la copa usa el último Elo conocido
