"""Valor de mercado: regresión lineal sobre ln(valor) con toda la Liga Profesional.

Qué hace: con los ~900 jugadores de la liga que tienen valor en transfermarkt-datasets (CC0), ajusta
    ln(valor) = β₀ + β₁·edad + β₂·edad² + β·posición + β₆·años de contrato + β₇·extranjero
                + β₈·ln(valor del resto del plantel)
por mínimos cuadrados y predice el valor de cada jugador del equipo elegido. La diferencia entre lo
que el mercado paga y lo que el modelo espera para alguien de su edad, posición, contrato y club es
la lectura: «el mercado lo paga más» o «más barato de lo que se esperaría».

Por qué así y no con las estadísticas de rendimiento (la versión anterior): con solo los 20
jugadores de Boca que tienen valor y estadísticas, el modelo de rendimiento parecía errar un 37 %,
pero dejando a cada jugador afuera del ajuste erraba un 75 % (sobreajuste: 7 coeficientes con 20
filas). Con la liga entera los coeficientes son significativos y el error se mide fuera de muestra
(se entrena sin el club y se predice a sus jugadores). El rendimiento queda como contraste: si los
que rinden más están por encima de lo que el modelo espera, el mercado paga el rendimiento.

Por qué ln(valor): los valores van de cientos de miles a decenas de millones; en escala log el
error es proporcional y los residuos se parecen más a una normal (supuesto de la inferencia).
Sin datos suficientes no se entrena (estado «sin_datos»): no se inventa nada.
"""

from __future__ import annotations

import math
import statistics
from collections import defaultdict
from collections.abc import Mapping, Sequence
from datetime import date
from typing import Any

from pipeline import stats

EXTRA_ROWS = 5  # filas de más sobre la cantidad de coeficientes para que la inferencia tenga sentido
GAP_PCT = 25.0  # |real − predicho| / predicho por encima de esto se marca como diferencia
FOLDS = 5
N_COMPARABLES = 6
MIN_ADJUST = 10  # jugadores propios con índice de rendimiento para el ajuste del segundo paso
POSITIONS = ("Defensor", "Mediocampista", "Delantero")  # el arquero es la referencia

# (id, etiqueta, qué significa en criollo). El orden es el de las columnas de la regresión.
FEATURES: tuple[tuple[str, str, str], ...] = (
    ("edad", "Edad", "Años del jugador."),
    ("edad2", "Edad²", "La edad al cuadrado: permite que el valor suba hasta un pico y después baje."),
    ("defensor", "Defensor", "1 si es defensor (la referencia es el arquero)."),
    ("mediocampista", "Mediocampista", "1 si es mediocampista (la referencia es el arquero)."),
    ("delantero", "Delantero", "1 si es delantero (la referencia es el arquero)."),
    ("contrato", "Años de contrato", "Cuánto le falta de contrato: con más contrato, el club pide más."),
    ("extranjero", "Extranjero", "1 si no es argentino."),
    (
        "ln_club",
        "Valor del resto del plantel",
        "Lo que vale el resto de su plantel (en ln): mide el tamaño del club.",
    ),
)
NAMES = [f for f, _, _ in FEATURES]

# Rendimiento que se muestra como contraste (claves del catálogo del sistema).
PERFORMANCE = (
    ("rendimiento_indice", "Índice de rendimiento", False),
    ("goles_asistencias", "Goles + asistencias cada 90", True),
    ("npxg_xa", "npxG + xA cada 90", True),
)

Row = Mapping[str, Any]


def features_of(p: Row, club_total: Mapping[str, float], today: date) -> dict[str, float] | None:
    """Variables de un jugador de la liga, o None si le falta alguna (no se imputa: se excluye)."""
    age, value, until = p.get("age"), p.get("value_eur"), p.get("contract_until")
    if age is None or not value or p.get("foreign") is None or p.get("position_group") is None:
        return None
    if isinstance(until, str):
        until = date.fromisoformat(until[:10])
    rest = club_total.get(p.get("club_id") or "", 0.0) - value
    return {
        "edad": float(age),
        "edad2": float(age) ** 2,
        **{pos.lower(): 1.0 if p["position_group"] == pos else 0.0 for pos in POSITIONS},
        "contrato": max(0.0, (until - today).days / 365.25) if until else 0.0,
        "extranjero": 1.0 if p["foreign"] else 0.0,
        "ln_club": math.log(max(rest, 1e6)),
    }


def _performance(p: Row) -> dict[str, float | None]:
    st = p.get("stats") or {}
    minutes = p.get("minutes") or 0
    out: dict[str, float | None] = {"minutos": float(minutes) if minutes else None}
    for key, _, per90 in PERFORMANCE:
        v = st.get(key)
        out[key] = None if v is None else (float(v) * 90 / minutes if per90 and minutes else float(v))
    return out


def _sin_datos(team_slug: str, n: int, params: dict[str, Any], message: str) -> dict[str, Any]:
    return {
        "run": {
            "model": "valor_mercado",
            "team_slug": team_slug,
            "status": "sin_datos",
            "n": n,
            "metrics": {},
            "params": params,
            "message": message,
        },
        "predictions": [],
        "coefs": [],
    }


def fit(
    league: Sequence[Row], own: Sequence[Row], team_slug: str, club_id: str, today: date
) -> dict[str, Any]:
    """Run del modelo: {'run', 'predictions', 'coefs'} listo para la base.

    `league`: jugadores de la liga (name, team, club_id, age, position_group, contract_until, foreign,
    value_eur). `own`: los del equipo elegido, con player_id y, si hay, minutes y stats del sistema.
    """
    club_total: dict[str, float] = defaultdict(float)
    for p in league:
        if p.get("value_eur"):
            club_total[p.get("club_id") or ""] += float(p["value_eur"])
    data = [(p, f) for p in league if (f := features_of(p, club_total, today)) is not None]
    needed = len(NAMES) + 1 + EXTRA_ROWS
    params: dict[str, Any] = {
        "target": "ln(valor_eur)",
        "features": [{"id": f, "label": label, "help": text} for f, label, text in FEATURES],
        "gap_pct": GAP_PCT,
        "needed_rows": needed,
        "source": "transfermarkt-datasets (CC0)",
    }
    if len(data) < needed:
        return _sin_datos(
            team_slug, len(data), params, f"Hay {len(data)} jugadores con valor y {needed} hacen falta."
        )
    x = [[f[n] for n in NAMES] for _, f in data]
    y = [math.log(float(p["value_eur"])) for p, _ in data]
    try:
        model = stats.ols(NAMES, x, y)
    except ValueError as exc:
        return _sin_datos(team_slug, len(data), params, f"No se pudo ajustar: {exc}.")

    # Error honesto: el equipo elegido fuera del ajuste, y validación cruzada en toda la liga.
    outside = [i for i, (p, _) in enumerate(data) if p.get("club_id") != club_id]
    inside = [i for i, (p, _) in enumerate(data) if p.get("club_id") == club_id]
    oos: list[float] = []
    if inside and len(outside) >= needed:
        m_out = stats.ols(NAMES, [x[i] for i in outside], [y[i] for i in outside])
        oos = [m_out.predict(x[i])[0] - y[i] for i in inside]
    cv: list[float] = []
    for k in range(FOLDS):
        train = [i for i in range(len(data)) if i % FOLDS != k]
        m_k = stats.ols(NAMES, [x[i] for i in train], [y[i] for i in train])
        cv += [m_k.predict(x[i])[0] - y[i] for i in range(len(data)) if i % FOLDS == k]

    def ape(errs: list[float]) -> list[float]:
        # |real − predicho| / real, a partir del error en ln: predicho = real · e^error.
        return [abs(math.exp(e) - 1) * 100 for e in errs]

    means = {n: stats.mean([row[j] for row in x]) for j, n in enumerate(NAMES)}
    coefs = {c.name: c.value for c in model.coefs}
    average = math.exp(coefs["intercepto"] + sum(coefs[n] * means[n] for n in NAMES))

    by_name = {p.get("player_id"): (p, f) for p, f in data if p.get("player_id") is not None}
    oos_by_id = {data[i][0].get("player_id"): m_out_err for i, m_out_err in zip(inside, oos, strict=False)}
    entries = []
    for o in own:
        hit = by_name.get(o.get("player_id"))
        if hit is None:
            continue
        p, f = hit
        y_hat, low, high = model.predict([f[n] for n in NAMES])
        entries.append((o, p, f, y_hat, low, high, _performance(o)))

    # Segundo paso: ajuste por rendimiento con los jugadores propios (la liga no tiene sus estadísticas).
    # residuo_ln = a + b · índice de rendimiento. Se evalúa dejando a cada uno afuera.
    with_index = [
        (math.log(float(p["value_eur"])) - y_hat, float(perf["rendimiento_indice"] or 0), o.get("player_id"))
        for o, p, _, y_hat, _, _, perf in entries
        if perf.get("rendimiento_indice") is not None
    ]
    adjust: dict[str, Any] | None = None
    if len(with_index) >= MIN_ADJUST:
        stage = stats.ols(["indice"], [[i] for _, i, _ in with_index], [r for r, _, _ in with_index])
        a_, b_ = stage.coefs[0], stage.coefs[1]
        adjust = {"a": a_.value, "b": b_.value, "p_value": b_.p, "r2": stage.r2, "n": stage.n}
        # Error fuera de muestra con el ajuste: liga sin el club + ajuste sin el jugador.
        oos_adj = dict(oos_by_id)
        for j, (_, idx, pid) in enumerate(with_index):
            if pid not in oos_by_id:
                continue
            rest = [
                (oos_by_id[q] * -1, k) for (_, k, q) in with_index[:j] + with_index[j + 1 :] if q in oos_by_id
            ]
            if len(rest) < MIN_ADJUST - 1:
                continue
            loo = stats.ols(["indice"], [[k] for _, k in rest], [r for r, _ in rest])
            oos_adj[pid] = oos_by_id[pid] + loo.predict([idx])[0]
        oos = list(oos_adj.values())

    def shift(perf: Mapping[str, float | None]) -> float:
        idx = perf.get("rendimiento_indice")
        return adjust["a"] + adjust["b"] * float(idx) if adjust and idx is not None else 0.0

    predictions: list[dict[str, Any]] = []
    residuals: list[tuple[float, float]] = []  # (residuo del modelo de liga en ln, índice de rendimiento)
    for o, p, f, y_hat, low, high, perf in entries:
        actual = float(p["value_eur"])
        extra = shift(perf)
        predicted = math.exp(y_hat + extra)
        gap = (actual - predicted) / predicted * 100
        if perf.get("rendimiento_indice") is not None:
            residuals.append((math.log(actual) - y_hat, float(perf["rendimiento_indice"] or 0)))

        def closeness(q: Row, p: Row = p, y_hat: float = y_hat) -> float:
            # Misma posición, edad parecida y valor real cerca de lo que el modelo espera para él.
            age_gap = abs(float(q.get("age") or 0) - float(p.get("age") or 0))
            return age_gap / 3 + abs(math.log(float(q["value_eur"])) - y_hat)

        comparables = sorted(
            (
                q
                for q, _ in data
                if q.get("club_id") != club_id and q.get("position_group") == p.get("position_group")
            ),
            key=closeness,
        )[:N_COMPARABLES]
        effects = {n: math.exp(coefs[n] * (f[n] - means[n])) - 1 for n in NAMES if n not in ("edad", "edad2")}
        effects["edad"] = (
            math.exp(
                coefs["edad"] * (f["edad"] - means["edad"]) + coefs["edad2"] * (f["edad2"] - means["edad2"])
            )
            - 1
        )
        if adjust and perf.get("rendimiento_indice") is not None:
            effects["rendimiento"] = math.exp(extra) - 1
        predictions.append(
            {
                "player_id": o["player_id"],
                "actual_eur": round(actual),
                "predicted_eur": round(predicted),
                "low_eur": round(math.exp(low + extra)),
                "high_eur": round(math.exp(high + extra)),
                "residual_pct": round(gap, 1),
                "features": {n: round(f[n], 4) for n in NAMES},
                "detail": {
                    # Aporte de cada variable frente al jugador promedio de la liga: e^(β·(x − x̄)) − 1.
                    "average_eur": round(average),
                    "market_eur": round(math.exp(y_hat)),
                    "effects": {k: round(v, 4) for k, v in effects.items()},
                    "age": p.get("age"),
                    "contract_years": round(f["contrato"], 1),
                    "foreign": bool(f["extranjero"]),
                    "club_rest_eur": round(math.exp(f["ln_club"])),
                    "performance": perf,
                    "comparables": [
                        {
                            "name": q.get("name"),
                            "team": q.get("team"),
                            "age": q.get("age"),
                            "value_eur": q.get("value_eur"),
                        }
                        for q in comparables
                    ],
                },
            }
        )

    perf_test: dict[str, Any] | None = None
    if len(residuals) >= 6:
        r = stats.pearson([a for a, _ in residuals], [b for _, b in residuals])
        n = len(residuals)
        t = r * math.sqrt((n - 2) / max(1e-12, 1 - r * r))
        perf_test = {"r": r, "n": n, "t": t, "p_value": stats.t_two_sided_p(t, n - 2)}

    errors_in = [abs(math.exp(-e) - 1) * 100 for e in model.residuals]  # sobre el real, en muestra
    return {
        "run": {
            "model": "valor_mercado",
            "team_slug": team_slug,
            "status": "ok" if predictions else "sin_datos",
            "n": model.n,
            "metrics": {
                "r2": model.r2,
                "adj_r2": model.adj_r2,
                "rmse_log": model.rmse,
                "median_ape_in": statistics.median(errors_in),
                "median_ape_oos": statistics.median(ape(oos)) if oos else None,
                "mean_ape_oos": stats.mean(ape(oos)) if oos else None,
                "factor_oos": math.exp(statistics.median([abs(e) for e in oos])) if oos else None,
                "factor_cv": math.exp(statistics.median([abs(e) for e in cv])),
                "n_oos": len(oos),
                "average_eur": average,
                "means": means,
                "performance_test": perf_test,
                "performance_adjust": adjust,
            },
            "params": params,
            "message": None if predictions else "Ningún jugador del equipo tiene valor y datos completos.",
        },
        "predictions": predictions,
        "coefs": [
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
        ],
    }
