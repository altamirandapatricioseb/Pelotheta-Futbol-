"""Sección 6.1 aplicada a los datos: tasas por jugador, percentiles por posición y las cuatro
métricas de evolución y proyección, «a la fecha» del último partido cargado.

Las tasas son agregadas (suma sobre suma): un partido de 10 minutos no pesa como uno de 90.
La distribución de referencia es siempre la de temporada de los jugadores de la misma posición
con al menos `MIN_MINUTES`; al comparar bloques se usa esa misma referencia, para que la
diferencia refleje el cambio del jugador y no el del grupo.
"""

from __future__ import annotations

import statistics
from collections import defaultdict
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from typing import Any

from pipeline import projection as pj

MIN_MINUTES = 450  # mínimo para entrar en la distribución de referencia (configurable)
MIN_GROUP = 8  # con menos jugadores en la posición, se usa el resto de los jugadores de campo

Games = Sequence[dict[str, float]]


@dataclass(frozen=True)
class Rate:
    """Una estadística como tasa sobre un grupo de partidos."""

    name: str
    compute: Callable[[Games], float | None]
    higher_is_better: bool = True


def _sum(games: Games, key: str) -> float | None:
    values = [g[key] for g in games if key in g]
    return sum(values) if values else None


def _minutes(games: Games) -> float:
    return sum(g.get("minutes", 0) for g in games)


def per90(key: str) -> Callable[[Games], float | None]:
    def rate(games: Games) -> float | None:
        # Solo los minutos de los partidos donde la fuente publicó la clave.
        covered = [g for g in games if key in g]
        mins = _minutes(covered)
        total = _sum(covered, key)
        return total * 90 / mins if total is not None and mins > 0 else None

    return rate


def ratio(num: str, den: str, min_attempts: float = 10) -> Callable[[Games], float | None]:
    def rate(games: Games) -> float | None:
        both = [g for g in games if num in g and den in g]
        attempts = sum(g[den] for g in both)
        return sum(g[num] for g in both) / attempts * 100 if attempts >= min_attempts else None

    return rate


def average(key: str) -> Callable[[Games], float | None]:
    def rate(games: Games) -> float | None:
        values = [g[key] for g in games if key in g]
        return sum(values) / len(values) if values else None

    return rate


def difference_per90(a: str, b: str) -> Callable[[Games], float | None]:
    def rate(games: Games) -> float | None:
        both = [g for g in games if a in g and b in g]
        mins = _minutes(both)
        return (sum(g[a] for g in both) - sum(g[b] for g in both)) * 90 / mins if mins > 0 else None

    return rate


def sum_per90(*keys: str) -> Callable[[Games], float | None]:
    def rate(games: Games) -> float | None:
        complete = [g for g in games if all(k in g for k in keys)]
        mins = _minutes(complete)
        return sum(g[k] for g in complete for k in keys) * 90 / mins if mins > 0 else None

    return rate


# 6.1.1: estadísticas de cada componente (por 90 salvo los porcentajes). Los pases progresivos
# no tienen fuente: el componente C se arma con lo que hay.
COMPONENTS: dict[str, list[Rate]] = {
    "A": [
        Rate("npg_90", per90("npg")),
        Rate("npxg_90", per90("npxg")),
        Rate("sot_90", per90("shots_on_target")),
        Rate("goals_per_shot", ratio("goals", "shots_total", 5)),
    ],
    "C": [
        Rate("assists_90", per90("assists")),
        Rate("key_passes_90", per90("key_passes")),
        Rate("chances_90", per90("big_chances_created")),
        Rate("xa_90", per90("xa")),
    ],
    "D": [
        Rate("tackles_won_90", per90("tackles_won")),
        Rate("interceptions_90", per90("interceptions")),
        Rate("clearances_90", per90("clearances")),
        Rate("aerial_pct", ratio("aerials_won", "aerials_total")),
        Rate("recoveries_90", per90("recoveries")),
    ],
    "E": [
        Rate("rating", average("rating")),
        Rate("goals_minus_xg_90", difference_per90("goals", "xg")),
        Rate("pass_pct", ratio("passes_accurate", "passes", 50)),
    ],
    "G": [
        Rate("save_pct", ratio("saves", "shots_on_target_faced")),
        Rate("prevented_90", difference_per90("xgot_faced", "goals_conceded")),
        Rate("conceded_90", per90("goals_conceded"), higher_is_better=False),
    ],
}
GOALKEEPER_C = [Rate("pass_pct", ratio("passes_accurate", "passes", 50))]

# 6.1.2: set de Mejoría α por posición (la calificación vale doble).
RATING = Rate("rating", average("rating"))
ALPHA_SETS: dict[str | None, list[tuple[Rate, float]]] = {
    "Delantero": [
        (Rate("npxg_xa_90", sum_per90("npxg", "xa")), 1),
        (Rate("sot_90", per90("shots_on_target")), 1),
        (Rate("dribble_pct", ratio("dribbles_successful", "dribbles_attempted")), 1),
        (RATING, 2),
    ],
    "Mediocampista": [
        (Rate("key_passes_90", per90("key_passes")), 1),
        (Rate("pass_pct", ratio("passes_accurate", "passes", 50)), 1),
        (Rate("recoveries_90", per90("recoveries")), 1),
        (Rate("tackle_pct", ratio("tackles_won", "tackles_attempted")), 1),
        (RATING, 2),
    ],
    "Defensor": [
        (Rate("def_actions_90", sum_per90("interceptions", "clearances", "blocks")), 1),
        (Rate("aerial_pct", ratio("aerials_won", "aerials_total")), 1),
        (Rate("tackle_pct", ratio("tackles_won", "tackles_attempted")), 1),
        (Rate("fouls_90", per90("fouls_committed"), higher_is_better=False), 1),
        (RATING, 2),
    ],
    "Arquero": [
        (Rate("save_pct", ratio("saves", "shots_on_target_faced")), 1),
        (Rate("prevented_90", difference_per90("xgot_faced", "goals_conceded")), 1),
        (Rate("conceded_90", per90("goals_conceded"), higher_is_better=False), 1),
        (RATING, 2),
    ],
}
ALPHA_SETS[None] = ALPHA_SETS["Mediocampista"]


@dataclass
class PlayerSeason:
    player_id: int
    position: str | None
    age: int | None
    games: list[dict[str, float]]  # partidos con minutos, en orden de fecha

    @property
    def minutes(self) -> float:
        return _minutes(self.games)


def _reference(players: Sequence[PlayerSeason], position: str | None) -> list[PlayerSeason]:
    eligible = [p for p in players if p.minutes >= MIN_MINUTES]
    same = [p for p in eligible if p.position == position]
    if len(same) >= MIN_GROUP or position == "Arquero":
        return same or [p for p in players if p.position == position]
    return [p for p in eligible if p.position != "Arquero"]


def _distribution(reference: Sequence[PlayerSeason], rate: Rate) -> list[float]:
    return [v for p in reference if (v := rate.compute(p.games)) is not None]


def _component_values(games: Games, rates: Sequence[Rate], reference: Sequence[PlayerSeason]) -> float | None:
    percentiles = [
        pj.percentile(value, _distribution(reference, rate), rate.higher_is_better)
        for rate in rates
        if (value := rate.compute(games)) is not None and len(_distribution(reference, rate)) >= 2
    ]
    return sum(percentiles) / len(percentiles) if percentiles else None


def index_for(
    games: Games,
    player: PlayerSeason,
    reference: Sequence[PlayerSeason],
    share: float | None,
    shares: list[float],
    components_out: dict[str, float | None] | None = None,
) -> tuple[float | None, float]:
    """Índice de rendimiento de un grupo de partidos frente a la referencia de temporada.

    Si se pasa `components_out`, se completa con los componentes (percentiles de A, C, D, E y P):
    son el radar del gráfico 81.
    """
    goalkeeper = player.position == "Arquero"
    weights = pj.WEIGHTS.get(player.position, pj.WEIGHTS[None])
    components: dict[str, float | None] = {}
    for comp in weights:
        if comp == "P":
            components["P"] = (
                pj.percentile(share, shares, True) if share is not None and len(shares) >= 2 else None
            )
        elif comp == "C" and goalkeeper:
            components["C"] = _component_values(games, GOALKEEPER_C, reference)
        else:
            components[comp] = _component_values(games, COMPONENTS[comp], reference)
    if components_out is not None:
        components_out.update(components)
    return pj.performance_index(components, weights)


def _sigma(rate: Rate, player: PlayerSeason, group: Sequence[PlayerSeason]) -> float | None:
    """σ de la tasa de temporada en la posición; con menos de 5, la de sus propios partidos."""
    season = [v for p in group if p.minutes >= 90 and (v := rate.compute(p.games)) is not None]
    if len(season) >= 5:
        sigma = statistics.stdev(season)
    else:
        own = [v for g in player.games if (v := rate.compute([g])) is not None]
        sigma = statistics.stdev(own) if len(own) >= 2 else 0.0
    return sigma if sigma > 0 else None


def projection_rows(players: Sequence[PlayerSeason], team_matches: int) -> list[dict[str, Any]]:
    """Filas de `core.stat_value` (ventana 'todas') con las métricas de 6.1 de cada jugador."""
    rows: list[dict[str, Any]] = []
    shares = {p.player_id: p.minutes / (90 * team_matches) * 100 for p in players if team_matches}

    def row(stat_id: str, pid: int, value: float | None, **extra: Any) -> None:
        if value is not None:
            rows.append(
                {
                    "entity": "player",
                    "entity_id": pid,
                    "competition_code": "todas",
                    "stat_id": stat_id,
                    "value": round(value, 4),
                    **extra,
                }
            )

    for player in players:
        reference = _reference(players, player.position)
        ref_shares = [shares[p.player_id] for p in reference if p.player_id in shares]
        components: dict[str, float | None] = {}
        r_season, coverage = index_for(
            player.games, player, reference, shares.get(player.player_id), ref_shares, components
        )
        row(
            "rendimiento_indice",
            player.player_id,
            r_season,
            coverage=round(coverage, 4),
            detail={"componentes": {k: round(v, 2) for k, v in components.items() if v is not None}},
        )
        row("rendimiento_cobertura", player.player_id, coverage)

        # Mejoría β: últimas 10 apariciones contra las 10 anteriores (6 y 450 min por bloque).
        mej_beta = None
        recent, previous = player.games[-10:], player.games[-20:-10]
        if len(recent) >= 6 and len(previous) >= 6:
            low = min(_minutes(recent), _minutes(previous))
            if low >= 0.6 * MIN_MINUTES:
                r_recent, _ = index_for(recent, player, reference, None, ref_shares)
                r_prev, _ = index_for(previous, player, reference, None, ref_shares)
                if r_recent is not None and r_prev is not None:
                    mej_beta = pj.mejoria_beta(r_recent, r_prev)
                    row("mejoria_beta", player.player_id, mej_beta, detail={"provisional": low < MIN_MINUTES})

        # Mejoría α: últimos 5 partidos (R) contra el resto de la temporada (B, mínimo 10).
        mej_alpha = None
        window_r, window_b = player.games[-5:], player.games[:-5]
        group = [p for p in players if p.position == player.position]
        alpha_set = ALPHA_SETS.get(player.position, ALPHA_SETS[None])
        if len(window_r) >= 5 and len(window_b) >= 10:
            zs: list[tuple[float, float]] = []
            # Insumos de cada z para la hoja Proyección del Excel (fórmulas vivas).
            rates: list[dict[str, Any]] = []
            for rate, weight in alpha_set:
                rate_r, rate_b, sigma = (
                    rate.compute(window_r),
                    rate.compute(window_b),
                    _sigma(rate, player, group),
                )
                if rate_r is not None and rate_b is not None and sigma:
                    zs.append((pj.z_change(rate_r, rate_b, sigma, rate.higher_is_better), weight))
                    rates.append(
                        {
                            "tasa": rate.name,
                            "r": round(rate_r, 5),
                            "b": round(rate_b, 5),
                            "sigma": round(sigma, 5),
                            "peso": weight,
                            "mas_es_mejor": rate.higher_is_better,
                        }
                    )
            min_r, min_b = _minutes(window_r), _minutes(window_b)
            w = pj.reliability(min_r, min_b)
            mej_alpha = pj.mejoria_alpha(zs, w)
            row(
                "mejoria_alpha",
                player.player_id,
                mej_alpha,
                detail={
                    "w": round(w, 3),
                    "estadisticas": len(zs),
                    "min_r": min_r,
                    "min_b": min_b,
                    "tasas": rates,
                },
            )

        if player.age is None:
            continue
        goalkeeper = player.position == "Arquero"
        # Potencial α: nivel con reducción por muestra chica + margen por edad y tendencia.
        level_pcts = [
            pj.percentile(v, dist, rate.higher_is_better)
            for rate, _ in alpha_set
            if (v := rate.compute(player.games)) is not None
            and len(dist := _distribution(reference, rate)) >= 2
        ]
        if level_pcts:
            level_raw = sum(level_pcts) / len(level_pcts)
            level = pj.shrink(level_raw, player.minutes)
            value, low_r, high_r = pj.potencial_alpha(level, player.age, mej_alpha, goalkeeper)
            row(
                "potencial_alpha",
                player.player_id,
                value,
                low=round(low_r, 4),
                high=round(high_r, 4),
                detail={"nivel_pct": round(level_raw, 3)},
            )
        # Potencial β: nivel (R*), tendencia (Mejoría β) y edad.
        if r_season is not None:
            r_star = pj.shrink(r_season, player.minutes)
            parts = pj.potencial_beta_parts(r_star, mej_beta, player.age, goalkeeper)
            row(
                "potencial_beta",
                player.player_id,
                pj.potencial_beta(r_star, mej_beta, player.age, goalkeeper),
                detail={"partes": {k: round(v, 2) for k, v in parts.items()}},
            )
    return rows


def seasons_from(
    player_values: dict[tuple[int, int], dict[str, float]],
    match_dates: dict[int, str],
    positions: dict[int, tuple[str | None, int | None]],
) -> list[PlayerSeason]:
    """Partidos con minutos de cada jugador, en orden de fecha."""
    games: dict[int, list[tuple[str, dict[str, float]]]] = defaultdict(list)
    for (pid, mid), values in player_values.items():
        if mid in match_dates and values.get("minutes", 0) > 0:
            games[pid].append((match_dates[mid], values))
    return [
        PlayerSeason(pid, *positions.get(pid, (None, None)), [v for _, v in sorted(g, key=lambda t: t[0])])
        for pid, g in games.items()
    ]
