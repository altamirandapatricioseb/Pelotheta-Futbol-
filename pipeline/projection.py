"""Sección 6.1: índice de rendimiento, Mejoría α y β y Potencial α y β (estimadas).

Funciones puras con los parámetros de arranque del prompt. Los valores son supuestos
configurables: se muestran en la web junto a cada métrica y se documentan en
`docs/metricas_propias.md` y `docs/model_cards/mejoria_potencial.md`.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence

# 6.1.1: pesos por posición (A ataque, C creación, D defensa, E eficiencia, P participación,
# G portería). La clave None es «sin posición informada».
WEIGHTS: dict[str | None, dict[str, float]] = {
    "Delantero": {"A": 0.40, "C": 0.25, "D": 0.10, "E": 0.15, "P": 0.10},
    "Mediocampista": {"A": 0.20, "C": 0.35, "D": 0.25, "E": 0.10, "P": 0.10},
    "Defensor": {"A": 0.10, "C": 0.20, "D": 0.50, "E": 0.10, "P": 0.10},
    "Arquero": {"C": 0.15, "P": 0.10, "G": 0.75},
    None: {"A": 0.30, "C": 0.25, "D": 0.25, "E": 0.10, "P": 0.10},
}
MIN_COVERAGE = 0.6

# 6.1.2: Mejoría α.
K_RELIABILITY = 270
Z_CLIP = 3.0
ALPHA_SCALE = 16.7  # Z = 3 con w = 1 lleva el índice a 100

# 6.1.4: Potencial α.
K_LEVEL = 900  # mismo umbral que el aviso de muestra pequeña
PEAK_AGE = 27.0
PEAK_AGE_GOALKEEPER = 29.0
GROWTH_PER_YEAR = 1.5
TREND_WEIGHT = 0.5  # λ
UNCERTAINTY = 8.0

# 6.1.5: Potencial β, factor de edad por bandas (porteros: las mismas corridas 2 años).
AGE_BANDS = ((18, 1.00), (21, 0.90), (24, 0.75), (27, 0.55), (30, 0.35))
AGE_FACTOR_OLDER = 0.15


def _clip(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


def percentile(value: float, reference: Sequence[float], higher_is_better: bool) -> float:
    """Percentil (0 a 100) de un valor en una distribución de referencia fija (percent_rank).

    Con `higher_is_better = False` se invierte: tener menos goles recibidos es mejor.
    """
    if len(reference) < 2:
        return 50.0
    below = sum(r < value for r in reference)
    rank = _clip(below / (len(reference) - 1) * 100, 0, 100)
    return rank if higher_is_better else 100 - rank


def rescaled_weights(
    components: Mapping[str, float | None], weights: Mapping[str, float]
) -> dict[str, float]:
    """Pesos de los componentes con datos, reescalados para sumar 1 (un faltante no vale cero)."""
    present = {c: w for c, w in weights.items() if components.get(c) is not None}
    total = sum(present.values())
    return {c: w / total for c, w in present.items()} if total else {}


def performance_index(
    components: Mapping[str, float | None], weights: Mapping[str, float]
) -> tuple[float | None, float]:
    """(R, cobertura): R = Σ peso × componente con los pesos reescalados; n/d si cobertura < 0,6."""
    coverage = sum(w for c, w in weights.items() if components.get(c) is not None)
    if coverage < MIN_COVERAGE:
        return None, coverage
    scaled = rescaled_weights(components, weights)
    return sum(w * float(components[c] or 0) for c, w in scaled.items()), coverage


def z_change(rate_recent: float, rate_base: float, sigma: float, higher_is_better: bool) -> float:
    """z = signo × (tasa_R − tasa_B) / σ, recortado a ±3."""
    sign = 1 if higher_is_better else -1
    return _clip(sign * (rate_recent - rate_base) / sigma, -Z_CLIP, Z_CLIP)


def reliability(minutes_recent: float, minutes_base: float) -> float:
    """w = min(Min_R, Min_B) / (min(Min_R, Min_B) + K): con pocos minutos, cerca de 0."""
    low = min(minutes_recent, minutes_base)
    return low / (low + K_RELIABILITY) if low > 0 else 0.0


def mejoria_alpha(z_scores: Sequence[tuple[float, float]], w: float) -> float | None:
    """Mejoría α = 50 + 16,7 × w × Z, con Z el promedio ponderado de los z; n/d con menos de 3."""
    if len(z_scores) < 3:
        return None
    total = sum(weight for _, weight in z_scores)
    z = sum(_clip(value, -Z_CLIP, Z_CLIP) * weight for value, weight in z_scores) / total
    return _clip(50 + ALPHA_SCALE * w * z, 0, 100)


def mejoria_beta(r_recent: float, r_previous: float) -> float:
    """Mejoría β = R_reciente − R_anterior, en puntos del índice de rendimiento."""
    return r_recent - r_previous


def shrink(value: float, minutes: float, k: float | None = None) -> float:
    """Reducción por muestra chica: 50 + (valor − 50) × Min / (Min + K)."""
    k = K_LEVEL if k is None else k
    return 50 + (value - 50) * minutes / (minutes + k) if minutes > 0 else 50.0


def potencial_alpha(
    level: float, age: float, mejoria: float | None, goalkeeper: bool
) -> tuple[float, float, float]:
    """(Potencial α, mínimo, máximo): min(100, N + G × años × (1 + λ × M)) con rango ± 8.

    Si la Mejoría α es n/d, M = 0 y el Potencial se calcula solo con el nivel y la edad.
    """
    peak = PEAK_AGE_GOALKEEPER if goalkeeper else PEAK_AGE
    years = max(0.0, peak - age)
    trend = (mejoria - 50) / 50 if mejoria is not None else 0.0
    value = min(100.0, level + GROWTH_PER_YEAR * years * (1 + TREND_WEIGHT * trend))
    return value, _clip(value - UNCERTAINTY, 0, 100), _clip(value + UNCERTAINTY, 0, 100)


def age_factor(age: float, goalkeeper: bool) -> float:
    """F_edad por bandas: 16-18 → 1,00 ... 31 o más → 0,15 (porteros, dos años más)."""
    shifted = age - 2 if goalkeeper else age
    for limit, factor in AGE_BANDS:
        if shifted < limit + 1:
            return factor
    return AGE_FACTOR_OLDER


def potencial_beta(r_star: float, mejoria: float | None, age: float, goalkeeper: bool) -> float:
    """Potencial β = min(100, 0,60 × R* + 0,25 × T + 0,15 × 100 × F_edad)."""
    trend = _clip(r_star + mejoria, 0, 100) if mejoria is not None else r_star
    return min(100.0, 0.60 * r_star + 0.25 * trend + 0.15 * 100 * age_factor(age, goalkeeper))
