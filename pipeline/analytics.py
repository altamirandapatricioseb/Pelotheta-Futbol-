"""Paso de modelos del pipeline: valor de mercado, alternativas (K-means) y predictor de partidos.

Corre después de las métricas propias, con todo lo ya cargado:
1. Baja los valores de mercado abiertos (transfermarkt-datasets, CC0): los de los jugadores propios
   van a `player_market_value` y los de otros clubes a `player_pool` (nombre, club, posición, edad,
   valor; sus estadísticas se completan cuando haya fuente). También lee el CSV manual, si hay.
2. Lee las vistas públicas, calcula en Python (`pipeline.stats`, sin dependencias nuevas) y
   reemplaza los resultados del equipo con `ingest.load_models` en una sola transacción.

Cada tabla lleva `team_slug` (el de web/config/teams.ts): otro equipo se suma en `TEAMS`.
Uso suelto: `uv run python -m pipeline.analytics [--dry-run]`.
"""

from __future__ import annotations

import argparse
import os
import sys
from collections import Counter
from collections.abc import Callable, Sequence
from datetime import date
from typing import Any

import httpx

from pipeline import load, market_value, match_predictor, similarity
from pipeline import own_metrics as om
from pipeline.enrich import match_player
from pipeline.models import MarketValueRecord
from sources import market_values
from sources import transfermarkt_datasets as tmd
from sources.http_client import FetchError, PoliteClient, RetryableFetchError
from sources.promiedos import player_key

# Equipos con estadísticas propias: slug del selector → nombre en la liga e id de club en el dataset.
TEAMS: dict[str, dict[str, str]] = {"boca-juniors": {"name": "Boca Juniors", "club_id": "189"}}


def fetch_players(url: str, key: str, client: httpx.Client) -> list[dict[str, Any]]:
    return om._fetch(
        "player_master",
        "player_id,known_as,full_name,position_group,age,minutes,matches,stats",
        url,
        key,
        client,
        {"competition_code": "eq.todas"},
    )


def fetch_values(url: str, key: str, client: httpx.Client, team_slug: str) -> dict[int, float]:
    """Último valor de mercado de cada jugador del equipo, en euros enteros (columnas bigint)."""
    rows = om._fetch(
        "player_market_value",
        "player_id,as_of,value_eur",
        url,
        key,
        client,
        {"team_slug": f"eq.{team_slug}", "order": "as_of"},
    )
    return {r["player_id"]: int(r["value_eur"]) for r in rows}  # el orden deja el más reciente


def pool_row(r: dict[str, Any]) -> dict[str, Any]:
    return {
        "name": r["player_name"],
        "team": r["team_name"],
        "club_id": r["club_ext_id"],
        "position_group": r["position_group"],
        "age": r["age"],
        "minutes": r.get("minutes"),
        "stats": r.get("stats") or {},
        "value_eur": r["value_eur"],
    }


def fetch_pool(url: str, key: str, client: httpx.Client) -> list[dict[str, Any]]:
    """Jugadores de otros clubes, con la misma forma que los propios (sin player_id)."""
    rows = om._fetch(
        "player_pool",
        "player_name,team_name,club_ext_id,position_group,age,minutes,stats,value_eur",
        url,
        key,
        client,
    )
    return [pool_row(r) for r in rows]


def fetch_games(url: str, key: str, client: httpx.Client) -> list[Any]:
    """Partidos de liga de la última temporada cargada, sin repetir entre fuentes."""
    rows = om._fetch(
        "league_result",
        "source,season,match_date,home_team,away_team,home_goals,away_goals",
        url,
        key,
        client,
    )
    if not rows:
        return []
    season = max(r["season"] for r in rows)
    current = [r for r in rows if r["season"] == season]
    # Una sola fuente: Promiedos y StrikerAPI nombran distinto a los clubes («Instituto» e «Instituto
    # (Córdoba)») y mezcladas parten a un equipo en dos. Se usa la que trae más partidos.
    counts = Counter(r["source"] for r in current)
    best = max(counts, key=lambda s: counts[s])
    return om.dedupe_games([r for r in current if r["source"] == best])


def player_matcher(players: Sequence[dict[str, Any]]) -> Callable[[str], int | None]:
    """Función nombre → player_id con la misma regla de nombres que el resto del pipeline."""
    keys: dict[str, int] = {}
    for p in players:
        for name in (p.get("known_as"), p.get("full_name")):
            if name:
                keys.setdefault(player_key(name), p["player_id"])
    candidates = list(keys)

    def match(name: str) -> int | None:
        found = match_player(name, candidates)
        return keys[found] if found else None

    return match


def split_pool(
    pool: Sequence[tmd.PoolPlayerRecord], match: Callable[[str], int | None], today: date
) -> tuple[list[MarketValueRecord], list[tmd.PoolPlayerRecord]]:
    """Los jugadores de los equipos propios dan valores de mercado; el resto va al pool."""
    own = {t["club_id"]: slug for slug, t in TEAMS.items()}
    values, others = [], []
    for r in pool:
        slug = own.get(r.club_ext_id)
        if slug is None:
            others.append(r)
        elif r.value_eur and (player_id := match(r.player_name)) is not None:
            values.append(
                MarketValueRecord(
                    player_id=player_id,
                    team_slug=slug,
                    as_of=r.value_as_of or today,
                    value_eur=r.value_eur,
                    source=tmd.SOURCE,
                    source_url=r.source_url,
                )
            )
    return values, others


def own_rows(players: Sequence[dict[str, Any]], values: dict[int, float], team: str) -> list[dict[str, Any]]:
    return [
        {
            **p,
            "name": p.get("known_as") or p.get("full_name"),
            "team": team,
            "value_eur": values.get(p["player_id"]),
        }
        for p in players
    ]


def compute(
    players: Sequence[dict[str, Any]],
    values: dict[int, float],
    games: Sequence[Any],
    team_slug: str,
    others: Sequence[dict[str, Any]] = (),
) -> dict[str, Any]:
    """Lote de `ingest.load_models` para un equipo."""
    team = TEAMS[team_slug]
    rivals = [o for o in others if o.get("club_id") != team["club_id"]]
    mv = market_value.fit(players, values, team_slug, rivals)
    alt = similarity.fit(own_rows(players, values, team["name"]), rivals, team_slug)
    mp = match_predictor.run(games, team["name"], team_slug)
    return {
        "team_slug": team_slug,
        "runs": [mv["run"], alt["run"], mp["run"]],
        "market_predictions": mv["predictions"],
        "market_coefs": mv["coefs"],
        "styles": alt["styles"],
        "alternatives": alt["alternatives"],
        "match_predictions": mp["predictions"],
        "strengths": mp["strengths"],
        "tests": mp["tests"],
    }


def run(url: str, key: str, dry_run: bool = False) -> dict[str, Any]:
    warnings: list[str] = []
    summary: dict[str, Any] = {}
    today = date.today()
    with httpx.Client(timeout=60) as client:
        players = fetch_players(url, key, client)
        match = player_matcher(players)
        records = market_values.parse(market_values.CSV_PATH, match, warnings)
        try:
            with PoliteClient(source=tmd.SOURCE) as polite:
                dataset = tmd.fetch(polite, today)
        except (FetchError, RetryableFetchError, OSError, ValueError) as exc:
            warnings.append(f"transfermarkt-datasets no disponible: {exc}")
            dataset = []
        own_values, pool = split_pool(dataset, match, today)
        records += own_values
        summary["valores_propios"] = len(own_values)
        summary["jugadores_otros_clubes"] = len(pool)
        if not dry_run:
            if records:
                load.send_market_values(records, url, key)
            if pool:
                load.send_player_pool(tmd.dump(pool), url, key)
        games = fetch_games(url, key, client)
        for team_slug in TEAMS:
            if dry_run:
                values = {r.player_id: r.value_eur for r in records if r.team_slug == team_slug}
                others = [pool_row(r) for r in tmd.dump(pool)]
            else:
                values = fetch_values(url, key, client, team_slug)
                others = fetch_pool(url, key, client)
            payload = compute(players, values, games, team_slug, others)
            summary[team_slug] = {r["model"]: f"{r['status']} (n = {r['n']})" for r in payload["runs"]}
            if not dry_run:
                summary[f"{team_slug}_filas"] = load.send_models(payload, url, key)
    if warnings:
        summary["avisos"] = warnings
    return summary


def main(argv: list[str] | None = None) -> int:
    from pipeline.run import load_dotenv, secret_key

    parser = argparse.ArgumentParser(description="Modelos: valor de mercado, alternativas y predictor")
    parser.add_argument("--dry-run", action="store_true", help="calcula sin cargar nada")
    args = parser.parse_args(argv)
    load_dotenv()
    url, key = os.environ.get("SUPABASE_URL", "").strip(), secret_key()
    try:
        print(run(url, key, dry_run=args.dry_run))
    except load.LoadError as exc:
        print(f"Modelos: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
