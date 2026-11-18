"""Predictor de partidos: goles de cada equipo como Poisson independientes.

Modelo (el clásico de Maher, 1982, en su versión de momentos):
    λ_local     = μ_local     × ataque_local(L)     × defensa_visitante(V)
    λ_visitante = μ_visitante × ataque_visitante(V) × defensa_local(L)
con μ el promedio de goles de la liga como local y como visitante, y ataque / defensa el cociente
entre lo que el equipo convierte / recibe por partido y ese promedio. La media muestral es el
estimador de máxima verosimilitud de λ en una Poisson. Con pocos partidos se encoge
hacia 1 (el promedio de la liga) sumando `SHRINK_GAMES` partidos «promedio».

Usa hasta `MAX_SEASONS` temporadas, cada partido pesado por su antigüedad: 0,5^(días / vida media).
Un partido de hace `HALF_LIFE_DAYS` días pesa la mitad que uno de hoy. La vida media se eligió por
backtest (la de menor Brier sobre la temporada actual): en la liga argentina los planteles cambian
mucho entre torneos, así que lo viejo informa poco pero ayuda en los primeros partidos del año.

Goles independientes ⇒ P(L = i, V = j) = P(L = i) × P(V = j): la matriz de marcadores
es la función de probabilidad conjunta y P(gana), P(empata), P(pierde) salen de sumar sus celdas.
Una simulación de Monte Carlo repite el partido 10.000 veces para mostrar
que da lo mismo que la cuenta exacta.

No se muestran cuotas: probabilidades en porcentaje (anti-referencia del producto: sitios de apuestas).
"""

from __future__ import annotations

import math
import random
import statistics
from collections import Counter, defaultdict
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import date
from typing import Any

from pipeline import metrics as m
from pipeline import stats

MAX_GOALS = 6  # matriz de 0 a 6 goles por equipo; la masa de 7 o más es despreciable en esta liga
SHRINK_GAMES = 3.0
SIMULATIONS = 10_000
MIN_TRAIN = 60  # partidos de liga previos para empezar el backtest
SEED = 2026
MAX_SEASONS = 3  # la temporada actual y las dos anteriores
HALF_LIFE_DAYS = 180.0


def norm(name: str) -> str:
    """Nombre comparable entre fuentes (sin tildes, minúsculas, alias de cada fuente)."""
    return m.team_key(name)


@dataclass(frozen=True)
class Strength:
    team: str
    home_games: int
    away_games: int
    attack_home: float
    defense_home: float
    attack_away: float
    defense_away: float
    goals_for: int
    goals_against: int


@dataclass(frozen=True)
class Model:
    mu_home: float
    mu_away: float
    teams: dict[str, Strength]  # clave: nombre normalizado


def weight(game_date: str, ref: date, half_life: float | None) -> float:
    """Peso de un partido según su antigüedad respecto de `ref` (1 sin vida media)."""
    if half_life is None:
        return 1.0
    return float(0.5 ** ((ref - date.fromisoformat(game_date)).days / half_life))


def fit(games: Sequence[m.Game], as_of: str | None = None, half_life: float | None = HALF_LIFE_DAYS) -> Model:
    """Fuerzas de ataque y defensa de cada equipo, separadas por localía y pesadas por antigüedad.

    Partidos y goles de cada `Strength` son solo los de la temporada de `as_of` (lo que se muestra).
    """
    if not games:
        raise ValueError("sin partidos de liga")
    ref = date.fromisoformat(as_of or max(g.date for g in games))
    ws = [weight(g.date, ref, half_life) for g in games]
    total = sum(ws)
    mu_home = sum(w * g.home_goals for w, g in zip(ws, games, strict=True)) / total
    mu_away = sum(w * g.away_goals for w, g in zip(ws, games, strict=True)) / total
    acc: dict[str, dict[str, float]] = defaultdict(lambda: defaultdict(float))
    names: dict[str, str] = {}
    season = str(ref.year)
    for w, g in sorted(zip(ws, games, strict=True), key=lambda x: x[1].date):
        h, a = norm(g.home), norm(g.away)
        names[h], names[a] = g.home, g.away  # el nombre más reciente
        acc[h]["hg"] += w
        acc[h]["hs"] += w * g.home_goals
        acc[h]["hc"] += w * g.away_goals
        acc[a]["ag"] += w
        acc[a]["as"] += w * g.away_goals
        acc[a]["ac"] += w * g.home_goals
        if g.date[:4] == season:
            acc[h]["n_hg"] += 1
            acc[a]["n_ag"] += 1
            acc[h]["gf"] += g.home_goals
            acc[h]["ga"] += g.away_goals
            acc[a]["gf"] += g.away_goals
            acc[a]["ga"] += g.home_goals

    def ratio(goals: float, played: float, mu: float) -> float:
        # Encogido hacia el promedio: (goles + K·μ) / (partidos + K) / μ.
        return (goals + SHRINK_GAMES * mu) / (played + SHRINK_GAMES) / mu if mu > 0 else 1.0

    teams = {
        key: Strength(
            team=names[key],
            home_games=int(v["n_hg"]),
            away_games=int(v["n_ag"]),
            attack_home=ratio(v["hs"], v["hg"], mu_home),
            defense_home=ratio(v["hc"], v["hg"], mu_away),
            attack_away=ratio(v["as"], v["ag"], mu_away),
            defense_away=ratio(v["ac"], v["ag"], mu_home),
            goals_for=int(v["gf"]),
            goals_against=int(v["ga"]),
        )
        for key, v in acc.items()
    }
    return Model(mu_home, mu_away, teams)


def lambdas(model: Model, home: str, away: str) -> tuple[float, float]:
    neutral = Strength("", 0, 0, 1.0, 1.0, 1.0, 1.0, 0, 0)
    h = model.teams.get(norm(home), neutral)
    a = model.teams.get(norm(away), neutral)
    return model.mu_home * h.attack_home * a.defense_away, model.mu_away * a.attack_away * h.defense_home


def score_matrix(lam_home: float, lam_away: float) -> list[list[float]]:
    """P(local = i, visitante = j) para i, j de 0 a MAX_GOALS, normalizada para sumar 1."""
    ph = [stats.poisson_pmf(i, lam_home) for i in range(MAX_GOALS + 1)]
    pa = [stats.poisson_pmf(j, lam_away) for j in range(MAX_GOALS + 1)]
    cells = [[x * y for y in pa] for x in ph]
    total = sum(map(sum, cells))
    return [[c / total for c in row] for row in cells]


def outcome_probs(matrix: list[list[float]]) -> tuple[float, float, float]:
    """(P local gana, P empate, P visitante gana): sumas de la conjunta."""
    n = len(matrix)
    home = sum(matrix[i][j] for i in range(n) for j in range(n) if i > j)
    draw = sum(matrix[i][i] for i in range(n))
    return home, draw, 1 - home - draw


def _poisson_sample(rng: random.Random, lam: float) -> int:
    # Algoritmo de Knuth: multiplica uniformes hasta bajar de e^(−λ). Sirve para λ chicos.
    limit, k, p = math.exp(-lam), 0, 1.0
    while True:
        p *= rng.random()
        if p <= limit:
            return k
        k += 1


def simulate(lam_home: float, lam_away: float, n: int = SIMULATIONS, seed: int = SEED) -> dict[str, Any]:
    """Monte Carlo: n partidos simulados. Frecuencias y medias muestrales."""
    rng = random.Random(seed)  # noqa: S311 (simulación reproducible, no criptografía)
    results: Counter[str] = Counter()
    goals_home = goals_away = 0
    for _ in range(n):
        h, a = _poisson_sample(rng, lam_home), _poisson_sample(rng, lam_away)
        goals_home += h
        goals_away += a
        results["home" if h > a else "draw" if h == a else "away"] += 1
    return {
        "n": n,
        "p_home": results["home"] / n,
        "p_draw": results["draw"] / n,
        "p_away": results["away"] / n,
        "mean_home": goals_home / n,
        "mean_away": goals_away / n,
    }


def predict(home: str, away: str, lam_h: float, lam_a: float, simulate_it: bool = True) -> dict[str, Any]:
    matrix = score_matrix(lam_h, lam_a)
    p_home, p_draw, p_away = outcome_probs(matrix)
    cells = sorted(
        ((matrix[i][j], i, j) for i in range(MAX_GOALS + 1) for j in range(MAX_GOALS + 1)), reverse=True
    )
    return {
        "home_team": home,
        "away_team": away,
        "lambda_home": lam_h,
        "lambda_away": lam_a,
        "p_home": p_home,
        "p_draw": p_draw,
        "p_away": p_away,
        "top_scores": [{"home": i, "away": j, "p": p} for p, i, j in cells[:5]],
        "score_matrix": [[round(c, 5) for c in row] for row in matrix],
        "sim": simulate(lam_h, lam_a) if simulate_it else None,
    }


def _result(home_goals: int, away_goals: int) -> int:
    return 0 if home_goals > away_goals else 1 if home_goals == away_goals else 2


# --- Modelo con más variables: Poisson con enlace log (GLM) ------------------------------------
#
# ln λ = β₀ + β₁·ln(ataque propio) + β₂·ln(defensa del rival) + β₃·ln(valor propio / valor rival)
#        + β₄·(Elo propio − Elo rival)/400 + β₅·(forma propia − forma rival) + β₆·local
# Cada partido da dos filas (los goles de cada equipo). Ataque y defensa son los de Maher (con los
# partidos anteriores, pesados por antigüedad); el valor del plantel es la suma de valores de mercado
# (transfermarkt-datasets) y sirve también para rivales de otras ligas. Qué variables entran lo
# decide el backtest: se prueban varias combinaciones y queda la de menor Brier.

VARIABLES: dict[str, tuple[str, str]] = {
    "ataque": ("Ataque propio", "Goles que hace el equipo contra el promedio de la liga (en ln)."),
    "defensa": ("Defensa del rival", "Goles que recibe el rival contra el promedio de la liga (en ln)."),
    "valor": ("Valor del plantel", "Cuántas veces más vale el plantel propio que el del rival (en ln)."),
    "elo": ("Elo", "Diferencia de Elo antes del partido, dividida por 400."),
    "forma": ("Forma", "Puntos por partido en los últimos 5 menos los del rival."),
    "local": ("Localía", "1 si juega en su cancha; 0 de visitante o en cancha neutral."),
}
CANDIDATES: dict[str, list[str]] = {
    "goles": ["ataque", "defensa", "local"],
    "goles + valor": ["ataque", "defensa", "valor", "local"],
    "goles + valor + Elo": ["ataque", "defensa", "valor", "elo", "local"],
    "goles + valor + forma": ["ataque", "defensa", "valor", "forma", "local"],
    "todas": ["ataque", "defensa", "valor", "elo", "forma", "local"],
}
REFIT_EVERY = 30  # partidos evaluados entre reajustes del GLM en el backtest
MIN_GLM_TRAIN = 30  # partidos ya preparados antes de evaluar con el GLM
FORM_GAMES = 5
DEFAULT_FORM = 1.35  # puntos por partido de un equipo promedio


@dataclass(frozen=True)
class Side:
    """Variables de un equipo en un partido, desde su punto de vista."""

    ataque: float
    defensa: float
    valor: float
    elo: float
    forma: float
    local: float

    def row(self, names: Sequence[str]) -> list[float]:
        return [float(getattr(self, n)) for n in names]


def irls(
    rows: Sequence[Sequence[float]], y: Sequence[float], ridge: float = 1e-3, iters: int = 30
) -> list[float]:
    """Poisson con enlace log por mínimos cuadrados reponderados. β[0] es el intercepto.

    Un poco de ridge en los β (no en el intercepto) evita que diverja con pocas filas.
    """
    x = [[1.0, *r] for r in rows]
    p = len(x[0])
    beta = [math.log(max(stats.mean(list(y)), 1e-6))] + [0.0] * (p - 1)
    for _ in range(iters):
        eta = [sum(b * v for b, v in zip(beta, r, strict=True)) for r in x]
        mu = [math.exp(min(e, 5.0)) for e in eta]
        z = [e + (t - u) / u for e, t, u in zip(eta, y, mu, strict=True)]
        xtwx = [
            [
                sum(r[i] * u * r[j] for r, u in zip(x, mu, strict=True)) + (ridge if i == j and i else 0.0)
                for j in range(p)
            ]
            for i in range(p)
        ]
        xtwz = [sum(r[i] * u * t for r, u, t in zip(x, mu, z, strict=True)) for i in range(p)]
        new = [sum(a * b for a, b in zip(row, xtwz, strict=True)) for row in stats.inverse(xtwx)]
        done = max(abs(a - b) for a, b in zip(new, beta, strict=True)) < 1e-9
        beta = new
        if done:
            break
    return beta


def glm_inference(
    rows: Sequence[Sequence[float]], y: Sequence[float], beta: Sequence[float]
) -> list[dict[str, float]]:
    """Error estándar de cada β (inversa de la información de Fisher), z y p (normal)."""
    x = [[1.0, *r] for r in rows]
    p = len(x[0])
    mu = [math.exp(sum(b * v for b, v in zip(beta, r, strict=True))) for r in x]
    # El mismo ridge que el ajuste: una variable sin variación (todos los valores iguales) no rompe la cuenta.
    info = [
        [
            sum(r[i] * u * r[j] for r, u in zip(x, mu, strict=True)) + (1e-3 if i == j and i else 0.0)
            for j in range(p)
        ]
        for i in range(p)
    ]
    cov = stats.inverse(info)
    out = []
    for i, b in enumerate(beta):
        se = math.sqrt(max(cov[i][i], 0.0))
        z = b / se if se else 0.0
        out.append({"coef": b, "std_err": se, "z": z, "p_value": stats.t_two_sided_p(z, 1e6)})
    return out


def lam(beta: Sequence[float], row: Sequence[float]) -> float:
    return math.exp(beta[0] + sum(b * v for b, v in zip(beta[1:], row, strict=True)))


def _form(prior: Sequence[m.Game], key: str) -> float:
    pts: list[int] = []
    for g in reversed(prior):
        if norm(g.home) == key:
            pts.append(3 if g.home_goals > g.away_goals else 1 if g.home_goals == g.away_goals else 0)
        elif norm(g.away) == key:
            pts.append(3 if g.away_goals > g.home_goals else 1 if g.home_goals == g.away_goals else 0)
        if len(pts) == FORM_GAMES:
            break
    return stats.mean([float(p) for p in pts]) if pts else DEFAULT_FORM


def sides(
    model: Model,
    home: str,
    away: str,
    values: dict[str, float],
    elo_h: float,
    elo_a: float,
    form_h: float,
    form_a: float,
    neutral: bool = False,
) -> tuple[Side, Side]:
    """Las dos filas de un partido. En cancha neutral, ataque y defensa promedian local y visitante."""
    zero = Strength("", 0, 0, 1.0, 1.0, 1.0, 1.0, 0, 0)
    h, a = model.teams.get(norm(home), zero), model.teams.get(norm(away), zero)
    if neutral:
        att_h, att_a = math.sqrt(h.attack_home * h.attack_away), math.sqrt(a.attack_home * a.attack_away)
        def_h, def_a = math.sqrt(h.defense_home * h.defense_away), math.sqrt(a.defense_home * a.defense_away)
    else:
        att_h, att_a, def_h, def_a = h.attack_home, a.attack_away, h.defense_home, a.defense_away
    v_ratio = math.log(values[norm(home)] / values[norm(away)])
    at_home = 0.0 if neutral else 1.0
    return (
        Side(math.log(att_h), math.log(def_a), v_ratio, (elo_h - elo_a) / 400, form_h - form_a, at_home),
        Side(math.log(att_a), math.log(def_h), -v_ratio, (elo_a - elo_h) / 400, form_a - form_h, 0.0),
    )


@dataclass(frozen=True)
class Prepared:
    game: m.Game
    home: Side
    away: Side
    maher: tuple[float, float]


def prepare(games: Sequence[m.Game], values: dict[str, float]) -> list[Prepared]:
    """Variables de cada partido con solo lo anterior (Maher, Elo y forma sin mirar el futuro)."""
    ordered = sorted(games, key=lambda g: g.date)
    elos = m.elo_run(ordered)
    out = []
    for idx, g in enumerate(ordered):
        prior = [x for x in ordered[:idx] if x.date < g.date]
        if len(prior) < MIN_TRAIN:
            continue
        model = fit(prior, as_of=g.date)
        eh, ea = elos[idx]
        h, a = sides(
            model, g.home, g.away, values, eh, ea, _form(prior, norm(g.home)), _form(prior, norm(g.away))
        )
        out.append(Prepared(g, h, a, lambdas(model, g.home, g.away)))
    return out


def evaluate(prepared: Sequence[Prepared], names: Sequence[str] | None, season: str) -> dict[str, Any]:
    """Backtest de una combinación de variables (None = Maher solo) sobre la temporada `season`."""
    brier = log_loss = brier_base = log_base = 0.0
    bins: dict[int, list[int]] = defaultdict(lambda: [0, 0])
    rows: list[tuple[Prepared, tuple[float, float]]] = []
    beta: list[float] | None = None
    n = 0
    for idx, pr in enumerate(prepared):
        if pr.game.date[:4] != season:
            continue
        train = [x for x in prepared[:idx] if x.game.date < pr.game.date]
        if len(train) < MIN_GLM_TRAIN:  # lo mismo para todas las combinaciones: se comparan igual
            continue
        if names is None:
            lams = pr.maher
        else:
            if beta is None or n % REFIT_EVERY == 0:
                beta = irls(
                    [s.row(names) for x in train for s in (x.home, x.away)],
                    [float(goals) for x in train for goals in (x.game.home_goals, x.game.away_goals)],
                )
            lams = (lam(beta, pr.home.row(names)), lam(beta, pr.away.row(names)))
        probs = outcome_probs(score_matrix(*lams))
        counts = Counter(_result(x.game.home_goals, x.game.away_goals) for x in train)
        base = [counts[i] / max(1, len(train)) for i in range(3)]
        actual = _result(pr.game.home_goals, pr.game.away_goals)
        brier += sum((p - (i == actual)) ** 2 for i, p in enumerate(probs))
        brier_base += sum((p - (i == actual)) ** 2 for i, p in enumerate(base))
        log_loss -= math.log(max(probs[actual], 1e-12))
        log_base -= math.log(max(base[actual], 1e-12))
        for i, p in enumerate(probs):
            b = min(9, int(p * 10))
            bins[b][0] += 1
            bins[b][1] += int(i == actual)
        rows.append((pr, lams))
        n += 1
    return {
        "evaluated": n,
        "brier": brier / n if n else None,
        "brier_base": brier_base / n if n else None,
        "log_loss": log_loss / n if n else None,
        "log_loss_base": log_base / n if n else None,
        "calibration": [
            {"bin": b / 10, "predicted": k, "observed": hits / k if k else None}
            for b, (k, hits) in sorted(bins.items())
        ],
        "rows": rows,
    }


# --- Pruebas e intervalos para el panel «Probabilidad» ------------------


def poisson_gof(goals: Sequence[int]) -> dict[str, Any]:
    """Bondad de ajuste de una Poisson(λ = media) a goles por partido.

    Las clases del final se juntan hasta que la frecuencia esperada sea al menos 5 (la regla
    habitual para que la aproximación χ² valga); la última clase es «k o más».
    """
    n = len(goals)
    lam = stats.mean(goals)
    top = max(goals)
    counts = Counter(goals)
    ks = list(range(top + 1))
    observed = [float(counts[k]) for k in ks]
    expected = [n * stats.poisson_pmf(k, lam) for k in ks]
    expected[-1] = n - sum(expected[:-1])  # la última clase se lleva la cola P(X ≥ top)
    while len(ks) > 2 and expected[-1] < 5:
        ks.pop()
        last_o, last_e = (
            observed.pop(),
            expected.pop(),
        )  # pop antes de sumar: x[-2] += x.pop() suma en el lugar equivocado
        observed[-1] += last_o
        expected[-1] += last_e
    stat, df, p = stats.chi2_gof(observed, expected, estimated=1)
    labels = [str(k) for k in ks[:-1]] + [f"{ks[-1]}+"]
    return {
        "lambda": lam,
        "n": n,
        "statistic": stat,
        "df": df,
        "p_value": p,
        "labels": labels,
        "observed": observed,
        "expected": [round(e, 3) for e in expected],
    }


def _decision(p: float, null_es: str) -> str:
    return (
        f"Con p = {p:.3f} < 0,05 se rechaza que {null_es}."
        if p < 0.05
        else f"Con p = {p:.3f} ≥ 0,05 no hay evidencia para rechazar que {null_es}."
    )


def stat_tests(games: Sequence[m.Game], team: str) -> list[dict[str, Any]]:
    key = norm(team)
    own = [g for g in games if key in (norm(g.home), norm(g.away))]
    tests: list[dict[str, Any]] = []
    if len(own) >= 8:
        gf = [g.home_goals if norm(g.home) == key else g.away_goals for g in own]
        ga = [g.away_goals if norm(g.home) == key else g.home_goals for g in own]
        for test_id, goals, label in (
            ("gof_goles_favor", gf, "a favor"),
            ("gof_goles_contra", ga, "en contra"),
        ):
            gof = poisson_gof(goals)
            tests.append(
                {
                    "test_id": test_id,
                    "title_es": f"¿Los goles {label} siguen una Poisson?",
                    "statistic": gof["statistic"],
                    "df": gof["df"],
                    "p_value": gof["p_value"],
                    "decision_es": _decision(gof["p_value"], f"los goles {label} por partido sean Poisson"),
                    "detail": gof,
                }
            )
        mean_gf, low, high = stats.mean_ci(gf)
        tests.append(
            {
                "test_id": "ic_goles_favor",
                "title_es": "Intervalo de confianza del 95 % para los goles a favor por partido",
                "statistic": mean_gf,
                "df": len(gf) - 1,
                "p_value": None,
                "decision_es": f"La media verdadera está entre {low:.2f} y {high:.2f} con 95 % de confianza.",
                "detail": {
                    "mean": mean_gf,
                    "low": low,
                    "high": high,
                    "n": len(gf),
                    "sd": math.sqrt(stats.variance(gf)),
                },
            }
        )
        table = [[0.0, 0.0, 0.0], [0.0, 0.0, 0.0]]
        for g in own:
            home = norm(g.home) == key
            mine, theirs = (g.home_goals, g.away_goals) if home else (g.away_goals, g.home_goals)
            table[0 if home else 1][_result(mine, theirs)] += 1
        if all(sum(r) > 0 for r in table) and all(sum(c) > 0 for c in zip(*table, strict=True)):
            stat, df, p, expected = stats.chi2_independence(table)
            played = sum(map(sum, table))
            tests.append(
                {
                    "test_id": "indep_localia_resultado",
                    "title_es": "¿El resultado es independiente de jugar de local?",
                    "statistic": stat,
                    "df": df,
                    "p_value": p,
                    "decision_es": _decision(p, "localía y resultado sean independientes"),
                    "detail": {
                        "rows": ["Local", "Visitante"],
                        "cols": ["Gana", "Empata", "Pierde"],
                        "observed": table,
                        "expected": [[round(e, 2) for e in r] for r in expected],
                        "p_win": sum(r[0] for r in table) / played,
                        "p_win_given_home": table[0][0] / sum(table[0]),
                        "p_win_given_away": table[1][0] / sum(table[1]),
                        "small_expected": any(e < 5 for r in expected for e in r),
                    },
                }
            )
    league_goals = [g.home_goals for g in games] + [g.away_goals for g in games]
    if len(league_goals) >= 30:
        gof = poisson_gof(league_goals)
        tests.append(
            {
                "test_id": "gof_goles_liga",
                "title_es": "Goles por equipo y partido en toda la liga contra una Poisson",
                "statistic": gof["statistic"],
                "df": gof["df"],
                "p_value": gof["p_value"],
                "decision_es": _decision(gof["p_value"], "los goles de la liga sean Poisson"),
                "detail": gof,
            }
        )
    return tests


LOWER_DIVISION = "Rival de Primera Nacional"
LOWER_DIVISION_SHARE = 0.4  # supuesto: un plantel de la segunda vale el 40 % del más barato de Primera
COMPETITIONS = {
    "copa_argentina": "Copa Argentina",
    "conmebol_copa_libertadores": "Copa Libertadores",
    "conmebol_copa_sudamericana": "Copa Sudamericana",
}


def _elo_final(games: Sequence[m.Game]) -> dict[str, float]:
    ratings: dict[str, float] = {}
    for g in sorted(games, key=lambda x: x.date):
        h, a = norm(g.home), norm(g.away)
        ratings[h], ratings[a] = m.elo_update(
            ratings.get(h, m.ELO_START), ratings.get(a, m.ELO_START), g.home_goals, g.away_goals
        )
    return ratings


def run(
    games: Sequence[m.Game],
    team: str,
    team_slug: str,
    values: dict[str, float] | None = None,
    cups: Sequence[dict[str, Any]] = (),
) -> dict[str, Any]:
    """Run del predictor: escenarios (liga y copas), backtest por combinación de variables, fuerzas y pruebas.

    `values`: valor del plantel por clave de club (`norm`). `cups`: rivales de copas de la temporada,
    {name, competition, value_eur | None}; sin valor se estima por competición y se marca.
    """
    if len(games) < MIN_TRAIN:
        return {
            "run": {
                "model": "predictor_partido",
                "team_slug": team_slug,
                "status": "sin_datos",
                "n": len(games),
                "metrics": {},
                "params": {"min_train": MIN_TRAIN},
                "message": f"Hay {len(games)} partidos de liga y {MIN_TRAIN} hacen falta.",
            },
            "predictions": [],
            "strengths": [],
            "tests": stat_tests(games, team),
        }
    key = norm(team)
    season = max(g.date for g in games)[:4]
    current = {norm(t) for g in games if g.date[:4] == season for t in (g.home, g.away)}
    every = {norm(t) for g in games for t in (g.home, g.away)}
    known = {k: float(v) for k, v in (values or {}).items() if v and v > 0}
    league_values = sorted(known[k] for k in current if k in known)
    median = statistics.median(league_values) if league_values else 1.0
    vals = {k: known.get(k, median) for k in every}

    prepared = prepare(games, vals)
    tried = {label: evaluate(prepared, names, season) for label, names in CANDIDATES.items()}
    maher = evaluate(prepared, None, season)
    best = min(tried, key=lambda label: tried[label]["brier"] or math.inf)
    names = CANDIDATES[best]
    rows = [s.row(names) for p in prepared for s in (p.home, p.away)]
    goals = [float(x) for p in prepared for x in (p.game.home_goals, p.game.away_goals)]
    beta = irls(rows, goals)
    inference = glm_inference(rows, goals, beta)

    model = fit(games)
    elo = _elo_final(games)
    league_elo = stats.mean([elo[k] for k in current if k in elo]) if current else m.ELO_START
    forms = {k: _form(games, k) for k in every}

    def scenario(home: str, away: str, neutral: bool, competition: str) -> dict[str, Any]:
        h, a = norm(home), norm(away)
        sh, sa = sides(
            model,
            home,
            away,
            vals,
            elo.get(h, league_elo),
            elo.get(a, league_elo),
            forms.get(h, DEFAULT_FORM),
            forms.get(a, DEFAULT_FORM),
            neutral,
        )
        return {
            **predict(home, away, lam(beta, sh.row(names)), lam(beta, sa.row(names))),
            "kind": "escenario",
            "competition": competition,
            "neutral": neutral,
        }

    names_by_key = {k: s.team for k, s in model.teams.items()}
    rivals = sorted(names_by_key[k] for k in current if k != key and k in names_by_key)
    scenarios = [
        s for r in rivals for s in (scenario(team, r, False, "liga"), scenario(r, team, False, "liga"))
    ]
    cup_rows: list[dict[str, Any]] = []
    done: set[tuple[str, str]] = set()
    lowest = league_values[0] if league_values else median
    for c in [*cups, {"name": LOWER_DIVISION, "competition": "copa_argentina", "value_eur": None}]:
        k = norm(c["name"])
        if k == key or (k, c["competition"]) in done:
            continue
        done.add((k, c["competition"]))
        estimated = not c.get("value_eur") and k not in known
        if c.get("value_eur"):
            vals[k] = float(c["value_eur"])
        elif k not in known:
            vals[k] = lowest * LOWER_DIVISION_SHARE if c["competition"] == "copa_argentina" else median
        neutral = c["competition"] == "copa_argentina"
        if neutral:
            scenarios.append(scenario(team, c["name"], True, c["competition"]))
        else:
            scenarios += [
                scenario(team, c["name"], False, c["competition"]),
                scenario(c["name"], team, False, c["competition"]),
            ]
        if k in current or any(r["team_name"] == c["name"] for r in cup_rows):
            continue  # ya tiene su fila (club de la liga o de otra copa)
        cup_rows.append(
            {
                "team_name": c["name"],
                "home_games": 0,
                "away_games": 0,
                "attack_home": 1.0,
                "defense_home": 1.0,
                "attack_away": 1.0,
                "defense_away": 1.0,
                "goals_for": 0,
                "goals_against": 0,
                "squad_value_eur": round(vals[k]),
                "competition": c["competition"],
                "estimated": estimated,
            }
        )

    chosen = tried[best]
    backtest_rows = [
        {
            **predict(pr.game.home, pr.game.away, lams[0], lams[1], simulate_it=False),
            "kind": "backtest",
            "match_date": pr.game.date,
            "actual_home": pr.game.home_goals,
            "actual_away": pr.game.away_goals,
            "competition": "liga",
            "neutral": False,
        }
        for pr, lams in chosen["rows"]
        if key in (norm(pr.game.home), norm(pr.game.away))
    ]
    strengths = [
        {
            "team_name": s.team,
            "home_games": s.home_games,
            "away_games": s.away_games,
            "attack_home": s.attack_home,
            "defense_home": s.defense_home,
            "attack_away": s.attack_away,
            "defense_away": s.defense_away,
            "goals_for": s.goals_for,
            "goals_against": s.goals_against,
            "squad_value_eur": round(vals[k]),
            "competition": "liga",
            "estimated": k not in known,
        }
        for k, s in model.teams.items()
        if k in current
    ] + cup_rows
    metrics = {key2: v for key2, v in chosen.items() if key2 != "rows"}
    return {
        "run": {
            "model": "predictor_partido",
            "team_slug": team_slug,
            "status": "ok" if key in model.teams else "sin_datos",
            "n": len(games),
            "metrics": {
                "mu_home": model.mu_home,
                "mu_away": model.mu_away,
                **metrics,
                "chosen": best,
                "variables": [
                    {
                        "label": label,
                        "names": CANDIDATES[label],
                        "brier": r["brier"],
                        "log_loss": r["log_loss"],
                    }
                    for label, r in tried.items()
                ]
                + [
                    {
                        "label": "solo Maher (sin GLM)",
                        "names": [],
                        "brier": maher["brier"],
                        "log_loss": maher["log_loss"],
                    }
                ],
                "coefs": [
                    {"id": n, "label": VARIABLES[n][0] if n in VARIABLES else "Intercepto", **c}
                    for n, c in zip(["intercepto", *names], inference, strict=True)
                ],
                "league_value_median": median,
            },
            "params": {
                "max_goals": MAX_GOALS,
                "shrink_games": SHRINK_GAMES,
                "simulations": SIMULATIONS,
                "min_train": MIN_TRAIN,
                "team_name": team,
                "max_seasons": MAX_SEASONS,
                "half_life_days": HALF_LIFE_DAYS,
                "seasons": sorted({g.date[:4] for g in games}),
                "variables": [{"id": k, "label": v[0], "help": v[1]} for k, v in VARIABLES.items()],
                "competitions": COMPETITIONS,
                "lower_division_share": LOWER_DIVISION_SHARE,
            },
            "message": None if key in model.teams else f"{team} no aparece en los resultados de la liga.",
        },
        "predictions": scenarios + backtest_rows,
        "strengths": strengths,
        "tests": stat_tests([g for g in games if g.date[:4] == season], team),
    }
