"""Situaciones de cada club de la liga (etapa 5h): cálculo propio sobre resultados y minutos de gol.

Por club: puntos por partido de local y de visitante, racha, vallas invictas, qué pasa cuando marca
primero o le marcan primero, cómo termina según el resultado al descanso (remontadas) y goles a
favor y en contra por tramo de 15 minutos. Las cuentas con minutos usan solo los partidos donde
los goles con minuto cierran con el marcador (`con_minutos`): el resto no se adivina.
(`pipeline/situations.py` es otra cosa: el catálogo de tarjetas de Boca que calcula la base.)
"""

from __future__ import annotations

from collections import defaultdict
from collections.abc import Iterable
from typing import Any

# Tramos de 15 minutos; el último incluye el descuento (91+).
BUCKETS = ((0, 15), (16, 30), (31, 45), (46, 60), (61, 75), (76, 200))
FORM_GAMES = 5

Played = tuple[str, bool, int, int, list[int] | None, list[int]]


def _points(gf: int, ga: int) -> int:
    return 3 if gf > ga else 1 if gf == ga else 0


def _ppp(points: list[int]) -> float | None:
    return round(sum(points) / len(points), 2) if points else None


def _bucket(minute: int) -> int:
    return next(i for i, (lo, hi) in enumerate(BUCKETS) if lo <= minute <= hi)


def situations(games: Iterable[Any], season_year: int) -> list[dict[str, Any]]:
    """Una fila por club. `games`: registros con match_date, home/away_team, home/away_goals y
    home/away_goal_minutes (vacías si los minutos no cierran con el marcador)."""
    per_team: dict[str, list[Played]] = defaultdict(list)
    for g in games:
        complete = len(g.home_goal_minutes) == g.home_goals and len(g.away_goal_minutes) == g.away_goals
        mins_h, mins_a = list(g.home_goal_minutes), list(g.away_goal_minutes)
        date = str(g.match_date)
        per_team[g.home_team].append(
            (date, True, g.home_goals, g.away_goals, mins_h if complete else None, mins_a)
        )
        per_team[g.away_team].append(
            (date, False, g.away_goals, g.home_goals, mins_a if complete else None, mins_h)
        )
    rows = []
    for team, played in per_team.items():
        played.sort(key=lambda p: p[0])
        pts = [_points(gf, ga) for _, _, gf, ga, _, _ in played]
        home = [_points(gf, ga) for _, h, gf, ga, _, _ in played if h]
        away = [_points(gf, ga) for _, h, gf, ga, _, _ in played if not h]
        first_for: list[int] = []
        first_against: list[int] = []
        at_half: dict[str, list[int]] = {"ganando": [], "empatando": [], "perdiendo": []}
        favor, contra = [0] * len(BUCKETS), [0] * len(BUCKETS)
        with_minutes = 0
        for _, _, gf, ga, own, rival in played:
            if own is None:
                continue
            with_minutes += 1
            p = _points(gf, ga)
            first = min([(m, "propio") for m in own] + [(m, "rival") for m in rival], default=None)
            if first is not None:
                (first_for if first[1] == "propio" else first_against).append(p)
            ht_own, ht_rival = sum(m <= 45 for m in own), sum(m <= 45 for m in rival)
            state = "ganando" if ht_own > ht_rival else "empatando" if ht_own == ht_rival else "perdiendo"
            at_half[state].append(p)
            for m in own:
                favor[_bucket(m)] += 1
            for m in rival:
                contra[_bucket(m)] += 1
        letters = {3: "G", 1: "E", 0: "P"}
        rows.append(
            {
                "team_name": team,
                "season_year": season_year,
                "partidos": len(played),
                "puntos": sum(pts),
                "ppp": _ppp(pts),
                "ppp_local": _ppp(home),
                "ppp_visitante": _ppp(away),
                "racha": "".join(letters[p] for p in pts[-FORM_GAMES:]),
                "vallas_invictas": sum(1 for _, _, _, ga, _, _ in played if ga == 0),
                "sin_marcar": sum(1 for _, _, gf, _, _, _ in played if gf == 0),
                "con_minutos": with_minutes,
                "marco_primero": len(first_for),
                "ppp_marco_primero": _ppp(first_for),
                "recibio_primero": len(first_against),
                "ppp_recibio_primero": _ppp(first_against),
                **{f"descanso_{k}": len(v) for k, v in at_half.items()},
                **{f"ppp_descanso_{k}": _ppp(v) for k, v in at_half.items()},
                # Perdía al descanso y no perdió el partido.
                "remontadas": sum(1 for p in at_half["perdiendo"] if p > 0),
                **{f"favor_{lo}_{min(hi, 90)}": n for (lo, hi), n in zip(BUCKETS, favor, strict=True)},
                **{f"contra_{lo}_{min(hi, 90)}": n for (lo, hi), n in zip(BUCKETS, contra, strict=True)},
            }
        )
    return sorted(rows, key=lambda r: r["team_name"])
