"""Ligas que solo publica Wikipedia (etapa 5j-7): resultados, tabla calculada y situaciones.

Hoy Bolivia. La tabla es cálculo propio sobre los resultados (3 puntos por victoria; desempate por
puntos, victorias, diferencia y goles): si la liga descuenta puntos por sanción, no se refleja.
Wikipedia es CC BY-SA: todo esto es público con la cita.
"""

from __future__ import annotations

import re
from collections import Counter, defaultdict
from typing import Any
from urllib.parse import quote

from pipeline import league_situations
from pipeline.models import LeagueResultRecord, StandingRecord
from sources import wikipedia_league as wl
from sources.http_client import FetchError, PoliteClient, RetryableFetchError

# Liga del sistema → título del artículo de cada temporada en Wikipedia en español.
LEAGUES = {"bol-primera": "Primera División de Bolivia {year}"}
ERRORS = (FetchError, RetryableFetchError, ValueError)


def _key(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", wl._norm(name)).strip("-")


def canonical_names(games: list[wl.WikiGame]) -> dict[str, str]:
    """Grafía más usada de cada club («Bolivar» y «Bolívar» son el mismo)."""
    counts: dict[str, Counter[str]] = defaultdict(Counter)
    for g in games:
        for name in (g.home_team, g.away_team):
            counts[_key(name)][name] += 1
    return {name: c.most_common(1)[0][0] for c in counts.values() for name in c}


def standings(games: list[LeagueResultRecord], season_year: int, table_name: str) -> list[StandingRecord]:
    rows: dict[str, list[int]] = defaultdict(lambda: [0, 0, 0, 0, 0])  # G, E, P, GF, GC
    for g in games:
        for team, gf, ga in (
            (g.home_team, g.home_goals, g.away_goals),
            (g.away_team, g.away_goals, g.home_goals),
        ):
            r = rows[team]
            r[0 if gf > ga else 1 if gf == ga else 2] += 1
            r[3], r[4] = r[3] + gf, r[4] + ga
    order = sorted(
        rows.items(), key=lambda kv: (-(3 * kv[1][0] + kv[1][1]), -kv[1][0], kv[1][4] - kv[1][3], -kv[1][3])
    )
    return [
        StandingRecord(
            source=wl.SOURCE,
            season=season_year,
            table_name=table_name,
            rank=rank,
            team_name=team,
            played=w + d + lo,
            won=w,
            drawn=d,
            lost=lo,
            goals_for=gf,
            goals_against=ga,
            points=3 * w + d,
        )
        for rank, (team, (w, d, lo, gf, ga)) in enumerate(order, start=1)
    ]


def tables(games: list[wl.WikiGame], league_uid: str, season_year: int) -> dict[str, list[dict[str, Any]]]:
    names = canonical_names(games)
    records = [
        LeagueResultRecord(
            source=wl.SOURCE,
            ext_id=f"wp-{league_uid}-{season_year}-{g.round}-{_key(g.home_team)}-{_key(g.away_team)}",
            season=season_year,
            stage=f"Fecha {g.round}" if g.round else None,
            match_date=g.match_date,
            home_team=names[g.home_team],
            away_team=names[g.away_team],
            home_goals=g.home_goals,
            away_goals=g.away_goals,
        )
        for g in games
    ]
    return {
        "league_result": [r.model_dump(mode="json") for r in records],
        "league_standing": [
            r.model_dump(mode="json") for r in standings(records, season_year, "Tabla general")
        ],
        "league_situation": league_situations.situations(records, season_year, minutes_known=False),
    }


def collect(client: PoliteClient, league_uid: str, season_year: int) -> dict[str, list[dict[str, Any]]]:
    title = LEAGUES[league_uid].format(year=season_year).replace(" ", "_")
    text = client.get(f"{wl.BASE_URL}/wiki/{quote(title)}?action=raw", use_cache=False).text()
    return tables(wl.parse_games(text, season_year), league_uid, season_year)
