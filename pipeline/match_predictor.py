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


def predict(model: Model, home: str, away: str, simulate_it: bool = True) -> dict[str, Any]:
    lam_h, lam_a = lambdas(model, home, away)
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


def backtest(
    games: Sequence[m.Game], team: str, half_life: float | None = HALF_LIFE_DAYS
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    """Predicción de cada partido de la temporada actual con solo los partidos anteriores
    (sin mirar el futuro); las temporadas pasadas solo entrenan.

    Métricas sobre toda la liga (más partidos, más estables): Brier y log-loss del modelo contra
    la línea de base «frecuencias de local, empate y visitante», y la tabla de
    calibración: de lo que se predijo con ~40 %, ¿cuánto pasó?
    """
    ordered = sorted(games, key=lambda g: g.date)
    rows: list[dict[str, Any]] = []
    brier = log_loss = brier_base = log_base = 0.0
    bins: dict[int, list[int]] = defaultdict(lambda: [0, 0])
    evaluated = 0
    key = norm(team)
    season = max(g.date for g in ordered)[:4]
    for idx, g in enumerate(ordered):
        if g.date[:4] != season:
            continue
        train = [x for x in ordered[:idx] if x.date < g.date]
        if len(train) < MIN_TRAIN:
            continue
        model = fit(train, as_of=g.date, half_life=half_life)
        probs = outcome_probs(score_matrix(*lambdas(model, g.home, g.away)))
        counts = Counter(_result(x.home_goals, x.away_goals) for x in train)
        base = [counts[i] / len(train) for i in range(3)]
        actual = _result(g.home_goals, g.away_goals)
        brier += sum((p - (i == actual)) ** 2 for i, p in enumerate(probs))
        brier_base += sum((p - (i == actual)) ** 2 for i, p in enumerate(base))
        log_loss -= math.log(max(probs[actual], 1e-12))
        log_base -= math.log(max(base[actual], 1e-12))
        for i, p in enumerate(probs):
            b = min(9, int(p * 10))
            bins[b][0] += 1
            bins[b][1] += int(i == actual)
        evaluated += 1
        if key in (norm(g.home), norm(g.away)):
            rows.append(
                {
                    **predict(model, g.home, g.away, simulate_it=False),
                    "match_date": g.date,
                    "actual_home": g.home_goals,
                    "actual_away": g.away_goals,
                }
            )
    metrics = {
        "evaluated": evaluated,
        "brier": brier / evaluated if evaluated else None,
        "brier_base": brier_base / evaluated if evaluated else None,
        "log_loss": log_loss / evaluated if evaluated else None,
        "log_loss_base": log_base / evaluated if evaluated else None,
        "calibration": [
            {"bin": b / 10, "predicted": n, "observed": hits / n if n else None}
            for b, (n, hits) in sorted(bins.items())
        ],
    }
    return rows, metrics


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


def run(games: Sequence[m.Game], team: str, team_slug: str) -> dict[str, Any]:
    """Run del predictor: escenarios contra cada rival, backtest, fuerzas y pruebas."""
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
    model = fit(games)
    key = norm(team)
    season = max(g.date for g in games)[:4]
    current = {norm(t) for g in games if g.date[:4] == season for t in (g.home, g.away)}
    rivals = sorted(s.team for k, s in model.teams.items() if k != key and k in current)
    scenarios = []
    for rival in rivals:
        scenarios.append({**predict(model, team, rival), "kind": "escenario"})
        scenarios.append({**predict(model, rival, team), "kind": "escenario"})
    rows, metrics = backtest(games, team)
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
        }
        for k, s in model.teams.items()
        if k in current
    ]
    return {
        "run": {
            "model": "predictor_partido",
            "team_slug": team_slug,
            "status": "ok" if key in model.teams else "sin_datos",
            "n": len(games),
            "metrics": {"mu_home": model.mu_home, "mu_away": model.mu_away, **metrics},
            "params": {
                "max_goals": MAX_GOALS,
                "shrink_games": SHRINK_GAMES,
                "simulations": SIMULATIONS,
                "min_train": MIN_TRAIN,
                "team_name": team,
                "max_seasons": MAX_SEASONS,
                "half_life_days": HALF_LIFE_DAYS,
                "seasons": sorted({g.date[:4] for g in games}),
            },
            "message": None if key in model.teams else f"{team} no aparece en los resultados de la liga.",
        },
        "predictions": scenarios + [{**r, "kind": "backtest"} for r in rows],
        "strengths": strengths,
        "tests": stat_tests([g for g in games if g.date[:4] == season], team),
    }
