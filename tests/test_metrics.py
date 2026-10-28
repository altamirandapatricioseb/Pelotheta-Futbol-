"""Tests de las fórmulas de las métricas propias (secciones 5.6, 5.7 y 6).

Cada fórmula se prueba con un ejemplo calculado a mano y, cuando corresponde, con propiedades
(hypothesis) que tienen que valer para cualquier entrada.
"""

from __future__ import annotations

import math

import pytest
from hypothesis import given
from hypothesis import strategies as st

from pipeline import metrics as m


def test_elo_expected_score_with_home_advantage() -> None:
    # Iguales en Elo, el local con 100 puntos de ventaja: E = 1 / (1 + 10^(−100/400)) ≈ 0,6401.
    assert m.elo_expected(1500, 1500, home_advantage=100) == pytest.approx(0.6401, abs=1e-4)


def test_elo_update_after_a_home_win() -> None:
    # R_nuevo = R + K × (S − E) = 1500 + 20 × (1 − 0,6401) ≈ 1507,2; el visitante pierde lo mismo.
    home, away = m.elo_update(1500, 1500, home_goals=2, away_goals=0, k=20, home_advantage=100)
    assert home == pytest.approx(1507.198, abs=1e-3)
    assert home + away == pytest.approx(3000)


def test_elo_run_returns_ratings_before_each_match() -> None:
    games = [
        m.Game(date="2026-01-01", home="A", away="B", home_goals=1, away_goals=0),
        m.Game(date="2026-01-08", home="B", away="A", home_goals=0, away_goals=0),
    ]
    before = m.elo_run(games, k=20, home_advantage=100)
    assert before[0] == (1500, 1500)  # antes del primer partido todos arrancan igual
    assert before[1][0] < 1500 < before[1][1]  # B perdió, A ganó


@given(st.floats(0.01, 0.99), st.floats(0.0, 0.4))
def test_elo_outcome_probabilities_add_up(expected: float, draw_rate: float) -> None:
    win, draw, loss = m.outcome_probabilities(expected, draw_rate)
    assert win + draw + loss == pytest.approx(1)
    assert win + draw / 2 == pytest.approx(expected)
    assert min(win, draw, loss) >= 0


def test_brier_score_of_a_perfect_and_a_bad_forecast() -> None:
    assert m.brier((1.0, 0.0, 0.0), "G") == 0
    assert m.brier((0.0, 0.0, 1.0), "G") == 2


def test_xpts_without_chances_is_a_draw() -> None:
    assert m.expected_points(0.0, 0.0) == pytest.approx(1.0)


@given(st.floats(0, 5), st.floats(0, 5))
def test_xpts_is_between_0_and_3_and_symmetric(xg_for: float, xg_against: float) -> None:
    mine = m.expected_points(xg_for, xg_against)
    theirs = m.expected_points(xg_against, xg_for)
    assert 0 <= mine <= 3
    # Puntos repartidos: 3 si alguien gana, 2 si empatan. Entre los dos suman entre 2 y 3.
    assert 2 - 1e-6 <= mine + theirs <= 3 + 1e-6


def test_pythagorean_share() -> None:
    # Con x = 2, 30 goles a favor y 10 en contra: 900 / (900 + 100) = 0,9.
    assert m.pythagorean_share(30, 10, 2) == pytest.approx(0.9)


def test_pythagorean_exponent_is_recovered_from_a_table_built_with_it() -> None:
    rows = [
        m.TableRow(played=30, goals_for=gf, goals_against=ga, points=0)
        for gf, ga in [(50, 20), (35, 30), (25, 40), (20, 45)]
    ]
    table = [
        r._replace(points=3 * r.played * m.pythagorean_share(r.goals_for, r.goals_against, 1.4)) for r in rows
    ]
    assert m.calibrate_pythagorean(table) == pytest.approx(1.4, abs=0.01)


def test_longest_streak() -> None:
    results = ["G", "G", "E", "G", "G", "G", "P"]
    assert m.longest_streak(results, {"G"}) == 3
    assert m.longest_streak(results, {"G", "E"}) == 6
    assert m.longest_streak([], {"G"}) == 0


def test_herfindahl_concentration() -> None:
    # Goles 2, 1 y 1 de un total de 4: 0,5² + 0,25² + 0,25² = 0,375.
    assert m.herfindahl([2, 1, 1]) == pytest.approx(0.375)
    assert m.herfindahl([]) is None


def test_jaccard_of_two_lineups() -> None:
    a = set(range(1, 12))
    b = set(range(1, 11)) | {12}
    assert m.jaccard(a, b) == pytest.approx(10 / 12)


def test_win_probability_share_used_by_ewa() -> None:
    # P(a) = a^x / (a^x + L^x): con a = L vale 0,5 para cualquier x.
    assert m.win_share(1.3, 1.3, 1.35) == pytest.approx(0.5)


def test_ewa_and_ela_signs() -> None:
    # Más goles a favor que el reemplazo: suma victorias. Menos en contra: resta derrotas.
    assert m.ewa(900, gf_on=2.0, gf_rep=1.5, league_goals=1.2, x=1.35) > 0
    assert m.ela(900, ga_on=0.8, ga_rep=1.2, league_goals=1.2, x=1.35) < 0
    # Sin diferencia con el reemplazo, cero.
    assert m.ewa(900, gf_on=1.5, gf_rep=1.5, league_goals=1.2, x=1.35) == 0


def test_ewa_scales_with_minutes() -> None:
    once = m.ewa(90, gf_on=2.0, gf_rep=1.5, league_goals=1.2, x=1.35)
    ten = m.ewa(900, gf_on=2.0, gf_rep=1.5, league_goals=1.2, x=1.35)
    assert ten == pytest.approx(10 * once)


def test_minutes_in_window() -> None:
    played = [("2026-03-01", 90), ("2026-03-05", 60), ("2026-03-20", 30)]
    assert m.minutes_in_last_days(played, days=7) == 30  # solo el del 20 (del 14 al 20)
    assert m.minutes_in_last_days(played, days=28) == 180


def test_standard_deviation_needs_two_values() -> None:
    assert m.stdev([1.0]) is None
    assert m.stdev([2.0, 4.0]) == pytest.approx(math.sqrt(2))
