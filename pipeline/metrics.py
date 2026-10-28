"""Fórmulas de las métricas propias (secciones 5.6, 5.7 y 6), sin red ni base de datos.

Son funciones puras para poder probarlas con ejemplos a mano y con propiedades. El módulo
`pipeline.own_metrics` lee los datos de la base, aplica estas fórmulas y carga los resultados.
"""

from __future__ import annotations

import math
import statistics
from collections.abc import Iterable, Sequence
from datetime import date, timedelta
from typing import NamedTuple

# Parámetros de arranque de la sección 5.6 (configurables; se muestran en la web).
ELO_START = 1500.0
ELO_K = 20.0
ELO_HOME_ADVANTAGE = 100.0
# Goles máximos por equipo en la suma de Poisson: más allá, la probabilidad es despreciable.
MAX_GOALS = 20


class Game(NamedTuple):
    date: str
    home: str
    away: str
    home_goals: int
    away_goals: int


class TableRow(NamedTuple):
    played: int
    goals_for: int
    goals_against: int
    points: float


# --- Elo ---------------------------------------------------------------------------------


def elo_expected(own: float, rival: float, home_advantage: float = 0.0) -> float:
    """Resultado esperado (0 a 1): E = 1 / (1 + 10^((R_rival − R_propio − V) / 400))."""
    return 1 / (1 + 10 ** ((rival - own - home_advantage) / 400))


def elo_update(
    home: float,
    away: float,
    home_goals: int,
    away_goals: int,
    k: float = ELO_K,
    home_advantage: float = ELO_HOME_ADVANTAGE,
) -> tuple[float, float]:
    """Elo después del partido: R_nuevo = R + K × (S − E), con S = 1, 0,5 o 0."""
    expected = elo_expected(home, away, home_advantage)
    score = 1.0 if home_goals > away_goals else 0.5 if home_goals == away_goals else 0.0
    change = k * (score - expected)
    return home + change, away - change


def elo_run(
    games: Sequence[Game], k: float = ELO_K, home_advantage: float = ELO_HOME_ADVANTAGE
) -> list[tuple[float, float]]:
    """Elo de local y visitante ANTES de cada partido (sin datos del futuro), en orden de fecha."""
    ratings: dict[str, float] = {}
    before: list[tuple[float, float]] = []
    for g in games:
        home = ratings.get(g.home, ELO_START)
        away = ratings.get(g.away, ELO_START)
        before.append((home, away))
        ratings[g.home], ratings[g.away] = elo_update(
            home, away, g.home_goals, g.away_goals, k, home_advantage
        )
    return before


def outcome_probabilities(expected: float, draw_rate: float) -> tuple[float, float, float]:
    """Probabilidad de ganar, empatar y perder a partir del resultado esperado del Elo.

    El Elo da un solo número (E = P(gana) + P(empata) / 2). Para separar el empate se usa la
    tasa de empates de la liga, máxima cuando los equipos son parejos: P(E) = d × 4E(1 − E).
    Así se respeta E y las tres probabilidades suman 1.
    """
    draw = draw_rate * 4 * expected * (1 - expected)
    win = max(0.0, expected - draw / 2)
    loss = max(0.0, 1 - expected - draw / 2)
    total = win + draw + loss
    return win / total, draw / total, loss / total


def brier(probabilities: tuple[float, float, float], result: str) -> float:
    """Brier score de un pronóstico de tres resultados: Σ (p − o)², de 0 (perfecto) a 2."""
    observed = (result == "G", result == "E", result == "P")
    return sum((p - float(o)) ** 2 for p, o in zip(probabilities, observed, strict=True))


# --- Puntos esperados ----------------------------------------------------------------------


def _poisson(rate: float) -> list[float]:
    return [math.exp(-rate) * rate**k / math.factorial(k) for k in range(MAX_GOALS + 1)]


def expected_points(xg_for: float, xg_against: float) -> float:
    """xPts = 3 × P(gana) + P(empata), con goles de Poisson independientes (estimado, 5.7)."""
    mine, theirs = _poisson(xg_for), _poisson(xg_against)
    win = sum(p * q for i, p in enumerate(mine) for j, q in enumerate(theirs) if i > j)
    draw = sum(p * q for p, q in zip(mine, theirs, strict=True))
    return 3 * win + draw


# --- Pitagórico ----------------------------------------------------------------------------


def pythagorean_share(goals_for: float, goals_against: float, x: float) -> float:
    """Parte de los puntos esperada: GF^x / (GF^x + GC^x)."""
    if goals_for == 0 and goals_against == 0:
        return 0.5
    share: float = goals_for**x / (goals_for**x + goals_against**x)
    return share


def calibrate_pythagorean(table: Iterable[TableRow]) -> float:
    """Exponente x que minimiza Σ (puntos reales − pitagóricos)² en la tabla de la liga.

    Por qué una búsqueda en grilla de 0,5 a 3 con paso 0,01: es mínimos cuadrados de un solo
    parámetro y se explica en una línea; no hace falta un optimizador.
    """
    rows = [r for r in table if r.played > 0]
    best_x, best_error = 1.35, math.inf
    for step in range(50, 301):
        x = step / 100
        error = sum(
            (r.points - 3 * r.played * pythagorean_share(r.goals_for, r.goals_against, x)) ** 2 for r in rows
        )
        if error < best_error:
            best_x, best_error = x, error
    return best_x


# --- Rachas, forma, concentración y estabilidad ----------------------------------------------


def longest_streak(results: Sequence[str], accepted: set[str]) -> int:
    """Mayor cantidad de elementos seguidos que están en `accepted` (por ejemplo, {'G', 'E'})."""
    best = current = 0
    for r in results:
        current = current + 1 if r in accepted else 0
        best = max(best, current)
    return best


def herfindahl(goals: Sequence[float]) -> float | None:
    """Concentración: Σ (goles del jugador / goles del equipo)². 1 = un solo goleador."""
    total = sum(goals)
    return sum((g / total) ** 2 for g in goals) if total > 0 else None


def jaccard(a: set[int], b: set[int]) -> float:
    """Titulares en común sobre titulares distintos en total."""
    union = a | b
    return len(a & b) / len(union) if union else 1.0


def stdev(values: Sequence[float]) -> float | None:
    """Desvío estándar muestral; con menos de dos valores no hay desvío."""
    return statistics.stdev(values) if len(values) >= 2 else None


def minutes_in_last_days(played: Sequence[tuple[str, float]], days: int) -> float:
    """Minutos de los últimos `days` días contados hasta el último partido (incluido)."""
    if not played:
        return 0.0
    last = max(date.fromisoformat(d) for d, _ in played)
    start = last - timedelta(days=days)
    return sum(minutes for d, minutes in played if date.fromisoformat(d) > start)


# --- NR, EWA y ELA (sección 6) -------------------------------------------------------------


def win_share(goals: float, league_goals: float, x: float) -> float:
    """P(a) = a^x / (a^x + L^x): parte de victorias esperada con `a` goles cada 90 minutos."""
    return pythagorean_share(goals, league_goals, x)


def ewa(minutes: float, gf_on: float, gf_rep: float, league_goals: float, x: float) -> float:
    """Expected Wins Added = (Min / 90) × [P(GF_on) − P(GF_rep)]."""
    return minutes / 90 * (win_share(gf_on, league_goals, x) - win_share(gf_rep, league_goals, x))


def ela(minutes: float, ga_on: float, ga_rep: float, league_goals: float, x: float) -> float:
    """Expected Losses Added = (Min / 90) × [Q(GA_on) − Q(GA_rep)]. Negativo = evita derrotas."""
    return minutes / 90 * (win_share(ga_on, league_goals, x) - win_share(ga_rep, league_goals, x))
