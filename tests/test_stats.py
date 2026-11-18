"""Tests de pipeline.stats contra valores de tablas conocidas y propiedades."""

from __future__ import annotations

import math

import pytest
from hypothesis import given
from hypothesis import strategies as st

from pipeline import stats


def test_inverse_2x2() -> None:
    inv = stats.inverse([[4.0, 7.0], [2.0, 6.0]])
    assert inv[0] == pytest.approx([0.6, -0.7])
    assert inv[1] == pytest.approx([-0.2, 0.4])


def test_inverse_singular() -> None:
    with pytest.raises(ValueError, match="singular"):
        stats.inverse([[1.0, 2.0], [2.0, 4.0]])


@given(st.floats(min_value=0.05, max_value=8))
def test_poisson_sums_to_one(lam: float) -> None:
    assert sum(stats.poisson_pmf(k, lam) for k in range(80)) == pytest.approx(1.0, abs=1e-9)


def test_poisson_values() -> None:
    assert stats.poisson_pmf(2, 1.5) == pytest.approx(math.exp(-1.5) * 1.5**2 / 2)
    assert stats.poisson_pmf(0, 0) == 1.0
    assert stats.poisson_pmf(3, 0) == 0.0


def test_t_distribution_table_values() -> None:
    # Tabla t: t(0,975; 10) = 2,228; t(0,975; 30) = 2,042; p de dos colas de t = 2 con 10 gl = 0,0734.
    assert stats.t_quantile(0.975, 10) == pytest.approx(2.228139, abs=1e-4)
    assert stats.t_quantile(0.975, 30) == pytest.approx(2.042272, abs=1e-4)
    assert stats.t_two_sided_p(2.0, 10) == pytest.approx(0.07339, abs=1e-4)
    assert stats.t_two_sided_p(0.0, 5) == pytest.approx(1.0)


def test_chi2_table_values() -> None:
    # Valores críticos al 5 %: 3,841 (1 gl), 5,991 (2 gl), 11,070 (5 gl).
    assert stats.chi2_sf(3.841459, 1) == pytest.approx(0.05, abs=1e-5)
    assert stats.chi2_sf(5.991465, 2) == pytest.approx(0.05, abs=1e-5)
    assert stats.chi2_sf(11.0705, 5) == pytest.approx(0.05, abs=1e-4)
    assert stats.chi2_sf(0, 3) == 1.0


def test_mean_ci_and_variance() -> None:
    xs = [2.0, 4.0, 4.0, 4.0, 5.0, 5.0, 7.0, 9.0]
    assert stats.variance(xs) == pytest.approx(32 / 7)
    m, low, high = stats.mean_ci(xs)
    half = stats.t_quantile(0.975, 7) * math.sqrt(32 / 7 / 8)
    assert (m, low, high) == pytest.approx((5.0, 5 - half, 5 + half))


def test_pearson() -> None:
    assert stats.pearson([1, 2, 3], [2, 4, 6]) == pytest.approx(1.0)
    assert stats.pearson([1, 2, 3], [3, 2, 1]) == pytest.approx(-1.0)
    assert stats.pearson([1, 1, 1], [1, 2, 3]) == 0.0


def test_zscores_have_mean_zero_and_sd_one() -> None:
    (z,) = stats.zscores([[1.0, 2.0, 3.0, 10.0]])
    assert stats.mean(z) == pytest.approx(0.0)
    assert stats.variance(z) == pytest.approx(1.0)
    assert stats.zscores([[5.0, 5.0]]) == [[0.0, 0.0]]


def test_ols_matches_simple_regression_formulas() -> None:
    x = [1.0, 2.0, 3.0, 4.0, 5.0, 6.0]
    y = [2.1, 3.9, 6.2, 7.8, 10.1, 12.2]
    model = stats.ols(["x"], [[v] for v in x], y)
    mx, my = stats.mean(x), stats.mean(y)
    sxx = sum((v - mx) ** 2 for v in x)
    slope = sum((a - mx) * (b - my) for a, b in zip(x, y, strict=True)) / sxx
    intercept = my - slope * mx
    assert model.coefs[0].value == pytest.approx(intercept)
    assert model.coefs[1].value == pytest.approx(slope)
    s = math.sqrt(sum(e * e for e in model.residuals) / 4)
    assert model.coefs[1].std_err == pytest.approx(s / math.sqrt(sxx))
    assert model.r2 == pytest.approx(stats.pearson(x, y) ** 2)
    assert model.coefs[1].p < 0.001
    y_hat, low, high = model.predict([3.5])
    assert y_hat == pytest.approx(intercept + slope * 3.5)
    assert low < y_hat < high


def test_ols_needs_more_rows_than_coefficients() -> None:
    with pytest.raises(ValueError, match="más de 2 filas"):
        stats.ols(["x"], [[1.0], [2.0]], [1.0, 2.0])


def test_chi2_gof_and_independence() -> None:
    stat, df, p = stats.chi2_gof([10, 10, 10], [10, 10, 10])
    assert (stat, df, p) == (0.0, 2, 1.0)
    stat, df, p, expected = stats.chi2_independence([[10, 20], [30, 40]])
    assert df == 1
    assert expected[0] == pytest.approx([12.0, 18.0])
    assert stat == pytest.approx(4 / 12 + 4 / 18 + 4 / 28 + 4 / 42)
    assert 0 < p < 1


BLOBS = [[0.0, 0.0], [0.2, 0.1], [0.1, 0.3], [5.0, 5.0], [5.2, 4.9], [4.9, 5.1]]


def test_kmeans_separates_blobs() -> None:
    labels, centers, inertia = stats.kmeans(BLOBS, 2)
    assert len(set(labels[:3])) == 1
    assert len(set(labels[3:])) == 1
    assert labels[0] != labels[3]
    assert inertia < 1
    assert stats.silhouette(BLOBS, labels) > 0.9
    assert stats.kmeans(BLOBS, 2) == (labels, centers, inertia)  # semilla fija: reproducible


def test_silhouette_single_group() -> None:
    assert stats.silhouette(BLOBS, [0] * 6) == 0.0


def test_pca_on_a_line_explains_everything() -> None:
    coords, (first, second) = stats.pca2([[float(i), 2.0 * i] for i in range(6)])
    assert first == pytest.approx(1.0, abs=1e-6)
    assert second == pytest.approx(0.0, abs=1e-6)
    assert abs(coords[-1][0] - coords[0][0]) == pytest.approx(5 * math.sqrt(5), rel=1e-6)
