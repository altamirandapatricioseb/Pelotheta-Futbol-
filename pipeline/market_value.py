"""Predictor de valor de mercado: regresión lineal múltiple sobre ln(valor).

Qué hace: con los jugadores que tienen un valor de mercado real (Transfermarkt cargado a mano en
`data/manual/market_values.csv`), ajusta ln(valor) = β₀ + β·x por mínimos cuadrados y predice el
valor de todo el plantel. La diferencia entre lo que el modelo cree que vale y lo que el mercado
dice que vale es la lectura: «el mercado lo paga más» o «más barato de lo que rinde».

Por qué ln(valor): los valores van de cientos de miles a decenas de millones; en escala log el
error es proporcional (un 20 % de error pesa igual en un jugador barato y en uno caro) y los
residuos se parecen más a una normal, que es el supuesto de la inferencia sobre los β.
Sin valores reales suficientes el modelo no se entrena (estado «sin_datos»): no se inventa nada.
"""

from __future__ import annotations

import math
from collections.abc import Callable, Mapping, Sequence
from typing import Any

from pipeline import stats

MIN_MINUTES = 450  # el mismo umbral que la distribución de referencia de la sección 6.1
EXTRA_ROWS = 5  # filas de más sobre la cantidad de coeficientes para que la inferencia tenga sentido
GAP_PCT = 25.0  # |real − predicho| / predicho por encima de esto se marca como diferencia

Player = Mapping[str, Any]


def _per90(key: str) -> Callable[[Player], float | None]:
    def get(p: Player) -> float | None:
        value = (p.get("stats") or {}).get(key)
        minutes = p.get("minutes") or 0
        return float(value) * 90 / minutes if value is not None and minutes > 0 else None

    return get


def _stat(key: str) -> Callable[[Player], float | None]:
    def get(p: Player) -> float | None:
        value = (p.get("stats") or {}).get(key)
        return float(value) if value is not None else None

    return get


def _age(p: Player) -> float | None:
    return float(p["age"]) if p.get("age") is not None else None


def _age2(p: Player) -> float | None:
    # Edad² permite la curva «sube hasta el pico y después baja» con un modelo lineal en los β.
    age = _age(p)
    return age * age if age is not None else None


def _minutes_k(p: Player) -> float | None:
    return float(p["minutes"]) / 1000 if p.get("minutes") else None


# (nombre, etiqueta, función). Configurable: agregar una variable es sumar una fila acá.
FEATURES: tuple[tuple[str, str, Callable[[Player], float | None]], ...] = (
    ("edad", "Edad", _age),
    ("edad2", "Edad²", _age2),
    ("minutos_mil", "Minutos (miles)", _minutes_k),
    ("ga90", "Goles + asistencias cada 90", _per90("goles_asistencias")),
    ("xgxa90", "npxG + xA cada 90", _per90("npxg_xa")),
    ("indice", "Índice de rendimiento", _stat("rendimiento_indice")),
)


def features_of(p: Player) -> dict[str, float] | None:
    """Variables del jugador, o None si le falta alguna (no se imputa: se excluye)."""
    out = {}
    for name, _, get in FEATURES:
        value = get(p)
        if value is None or not math.isfinite(value):
            return None
        out[name] = value
    return out


def fit(
    players: Sequence[Player], values: Mapping[int, float], team_slug: str, others: Sequence[Player] = ()
) -> dict[str, Any]:
    """Run del modelo: {'run': ..., 'predictions': [...], 'coefs': [...]} listo para la base.

    `others`: jugadores de otros clubes (con `value_eur`). Solo suman al entrenamiento cuando tienen
    las mismas estadísticas; las predicciones que se guardan son las del equipo elegido.
    """
    eligible = [
        (p, f)
        for p in players
        if (p.get("minutes") or 0) >= MIN_MINUTES and (f := features_of(p)) is not None
    ]
    names = [n for n, _, _ in FEATURES]
    train = [(f, values[p["player_id"]]) for p, f in eligible if values.get(p["player_id"], 0) > 0] + [
        (f, float(p["value_eur"]))
        for p in others
        if (p.get("value_eur") or 0) > 0
        and (p.get("minutes") or 0) >= MIN_MINUTES
        and (f := features_of(p)) is not None
    ]
    needed = len(names) + 1 + EXTRA_ROWS
    params = {
        "target": "ln(valor_eur)",
        "features": [{"id": n, "label": label} for n, label, _ in FEATURES],
        "min_minutes": MIN_MINUTES,
        "gap_pct": GAP_PCT,
        "needed_rows": needed,
    }
    base = [
        {"player_id": p["player_id"], "actual_eur": values.get(p["player_id"]), "features": f}
        for p, f in eligible
    ]
    if len(train) < needed:
        return {
            "run": {
                "model": "valor_mercado",
                "team_slug": team_slug,
                "status": "sin_datos",
                "n": len(train),
                "metrics": {},
                "params": params,
                "message": f"Hay {len(train)} jugadores con valor de mercado y {needed} hacen falta.",
            },
            "predictions": base,
            "coefs": [],
        }
    try:
        model = stats.ols(
            names,
            [[f[n] for n in names] for f, _ in train],
            [math.log(v) for _, v in train],
        )
    except ValueError as exc:
        return {
            "run": {
                "model": "valor_mercado",
                "team_slug": team_slug,
                "status": "sin_datos",
                "n": len(train),
                "metrics": {},
                "params": params,
                "message": f"No se pudo ajustar: {exc}.",
            },
            "predictions": base,
            "coefs": [],
        }
    predictions = []
    errors = []
    for row in base:
        y, low, high = model.predict([row["features"][n] for n in names])
        predicted = math.exp(y)
        actual = row["actual_eur"]
        gap = (actual - predicted) / predicted * 100 if actual else None
        if gap is not None:
            errors.append(abs(gap))
        predictions.append(
            {
                **row,
                "predicted_eur": round(predicted),
                "low_eur": round(math.exp(low)),
                "high_eur": round(math.exp(high)),
                "residual_pct": round(gap, 1) if gap is not None else None,
            }
        )
    coefs = [
        {
            "feature": c.name,
            "coef": c.value,
            "std_err": c.std_err,
            "t_stat": c.t,
            "p_value": c.p,
            "ci_low": c.low,
            "ci_high": c.high,
        }
        for c in model.coefs
    ]
    return {
        "run": {
            "model": "valor_mercado",
            "team_slug": team_slug,
            "status": "ok",
            "n": model.n,
            "metrics": {
                "r2": model.r2,
                "adj_r2": model.adj_r2,
                "rmse_log": model.rmse,
                "mape": stats.mean(errors) if errors else None,
            },
            "params": params,
            "message": None,
        },
        "predictions": predictions,
        "coefs": coefs,
    }
