"""Tests de la sección 6.1: cada ejemplo numérico del prompt reproducido y propiedades."""

from __future__ import annotations

import pytest
from hypothesis import given
from hypothesis import strategies as st

from pipeline import projection as pj
from pipeline import projection_data as pdata

NO_POSITION = pj.WEIGHTS[None]


def test_index_example_without_position() -> None:
    # 6.1.1: A = 80, C = 60, D = 45, E = 75, P = 90 → 24 + 15 + 11,25 + 7,5 + 9 = 66,75.
    value, coverage = pj.performance_index({"A": 80, "C": 60, "D": 45, "E": 75, "P": 90}, NO_POSITION)
    assert value == pytest.approx(66.75)
    assert coverage == pytest.approx(1.0)


def test_missing_component_rescales_weights() -> None:
    # Sin D (0,25): los demás pesos se reescalan para sumar 1 y la cobertura es 0,75.
    value, coverage = pj.performance_index({"A": 80, "C": 60, "D": None, "E": 75, "P": 90}, NO_POSITION)
    assert coverage == pytest.approx(0.75)
    assert value == pytest.approx((0.30 * 80 + 0.25 * 60 + 0.10 * 75 + 0.10 * 90) / 0.75)


def test_low_coverage_is_not_available() -> None:
    value, coverage = pj.performance_index({"A": 80, "C": None, "D": None, "E": None, "P": 90}, NO_POSITION)
    assert value is None
    assert coverage == pytest.approx(0.40)


@given(
    st.dictionaries(st.sampled_from("ACDEP"), st.one_of(st.none(), st.floats(0, 100)), min_size=5, max_size=5)
)
def test_rescaled_weights_sum_one(components: dict[str, float | None]) -> None:
    weights = pj.rescaled_weights(components, NO_POSITION)
    if weights:
        assert sum(weights.values()) == pytest.approx(1)


def test_z_change_example() -> None:
    # 6.1.2: npxG + xA cada 90 de 0,55 en R y 0,35 en B con σ = 0,25 → z = 0,8.
    assert pj.z_change(0.55, 0.35, 0.25, higher_is_better=True) == pytest.approx(0.8)
    assert pj.z_change(0.55, 0.35, 0.25, higher_is_better=False) == pytest.approx(-0.8)
    assert pj.z_change(5.0, 0.0, 0.25, higher_is_better=True) == 3  # recortado a ±3


def test_reliability_example() -> None:
    # 440 minutos en R y 1.300 en B, K = 270 → w = 440 / 710 ≈ 0,62.
    assert pj.reliability(440, 1300) == pytest.approx(440 / 710)


def test_mejoria_alpha_example() -> None:
    # Z = 0,6 y w ≈ 0,62 → 50 + 16,7 × 0,62 × 0,6 ≈ 56,2.
    w = pj.reliability(440, 1300)
    assert pj.mejoria_alpha([(0.6, 1.0), (0.6, 1.0), (0.6, 2.0)], w) == pytest.approx(50 + 16.7 * w * 0.6)
    assert pj.mejoria_alpha([(0.6, 1.0), (0.6, 1.0), (0.6, 2.0)], w) == pytest.approx(56.2, abs=0.05)


def test_mejoria_alpha_needs_three_stats() -> None:
    assert pj.mejoria_alpha([(1.0, 1.0), (1.0, 2.0)], 0.9) is None


@given(st.lists(st.tuples(st.floats(-10, 10), st.sampled_from([1.0, 2.0])), min_size=3), st.floats(0, 1))
def test_mejoria_alpha_is_between_0_and_100(zs: list[tuple[float, float]], w: float) -> None:
    value = pj.mejoria_alpha(zs, w)
    assert value is not None and 0 <= value <= 100


@given(st.lists(st.sampled_from([1.0, 2.0]), min_size=3), st.floats(0, 1))
def test_mejoria_alpha_is_50_when_nothing_changed(weights: list[float], w: float) -> None:
    assert pj.mejoria_alpha([(0.0, wt) for wt in weights], w) == pytest.approx(50)


def test_mejoria_beta_example() -> None:
    assert pj.mejoria_beta(68, 52) == 16
    assert pj.mejoria_beta(85, 82) == 3


def test_potencial_alpha_example() -> None:
    # Extremo de 20 años, N = 60, Mejoría α 65 (M = 0,3), 7 años al pico → 1,5 × 7 × 1,15 = 12,1.
    value, low, high = pj.potencial_alpha(60, age=20, mejoria=65, goalkeeper=False)
    assert value == pytest.approx(72.075)
    assert (low, high) == pytest.approx((64.075, 80.075))


@given(st.floats(0, 100), st.floats(27, 45), st.one_of(st.none(), st.floats(0, 100)))
def test_potencial_alpha_after_the_peak_is_the_current_level(
    level: float, age: float, mej: float | None
) -> None:
    value, _, _ = pj.potencial_alpha(level, age=age, mejoria=mej, goalkeeper=False)
    assert value == pytest.approx(level)


def test_potencial_beta_examples() -> None:
    # A: 19 años, R = 65, Mejoría β +8 → T = 73 → 39 + 18,25 + 13,5 = 70,75.
    assert pj.potencial_beta(65, mejoria=8, age=19, goalkeeper=False) == pytest.approx(70.75)
    # B: 28 años, R = 82, Mejoría β +2 → T = 84 → 49,2 + 21 + 5,25 = 75,45.
    assert pj.potencial_beta(82, mejoria=2, age=28, goalkeeper=False) == pytest.approx(75.45)


@given(st.floats(0, 100), st.one_of(st.none(), st.floats(-100, 100)), st.floats(15, 45), st.booleans())
def test_potencial_beta_is_at_most_100(r: float, mej: float | None, age: float, gk: bool) -> None:
    assert pj.potencial_beta(r, mejoria=mej, age=age, goalkeeper=gk) <= 100


def test_small_sample_shrinks_towards_50() -> None:
    # Un pibe de 150 minutos con percentil 90 no aparece como crack: N = 50 + 40 × 150 / 1.050.
    assert pj.shrink(90, minutes=150) == pytest.approx(50 + 40 * 150 / 1050)
    assert pj.shrink(90, minutes=0) == 50


def _season(pid: int, position: str, age: int, form: list[float]) -> pdata.PlayerSeason:
    games = [
        {
            "minutes": 90,
            "npg": f,
            "npxg": f,
            "xa": f / 2,
            "shots_on_target": 2 * f,
            "goals": f,
            "shots_total": 4,
            "key_passes": 1 + f,
            "rating": 6 + f,
            "tackles_won": 1,
            "interceptions": 1,
            "passes": 40,
            "passes_accurate": 30 + 5 * f,
            "dribbles_successful": 1 + f,
            "dribbles_attempted": 3,
        }
        for f in form
    ]
    return pdata.PlayerSeason(pid, position, age, games)


def test_projection_rows_on_a_synthetic_squad() -> None:
    # Diez delanteros con 20 partidos; el 1 mejora mucho en los últimos partidos.
    players = [_season(pid, "Delantero", 20 + pid, [0.2] * 20) for pid in range(2, 11)]
    players.append(_season(1, "Delantero", 20, [0.1] * 15 + [0.9] * 5))
    rows = pdata.projection_rows(players, team_matches=20)
    by = {(r["entity_id"], r["stat_id"]): r for r in rows}
    assert 0 <= by[(1, "rendimiento_indice")]["value"] <= 100
    assert by[(1, "mejoria_alpha")]["value"] > 50  # mejoró frente a su propia temporada
    assert by[(2, "mejoria_alpha")]["value"] == pytest.approx(50)  # constante: sin cambio
    pot = by[(1, "potencial_alpha")]
    assert pot["low"] <= pot["value"] <= pot["high"]
    assert all(r["value"] <= 100 for r in rows if r["stat_id"].startswith("potencial"))


def test_percent_rank_and_inversion() -> None:
    reference = [1.0, 2.0, 3.0, 4.0, 5.0]
    assert pj.percentile(3.0, reference, higher_is_better=True) == pytest.approx(50)
    assert pj.percentile(5.0, reference, higher_is_better=True) == pytest.approx(100)
    assert pj.percentile(5.0, reference, higher_is_better=False) == pytest.approx(0)
