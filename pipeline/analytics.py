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
import re
import sys
import unicodedata
from collections.abc import Callable, Sequence
from datetime import date
from typing import Any

import httpx

from pipeline import load, market_value, match_predictor, similarity
from pipeline import own_metrics as om
from pipeline.enrich import match_player
from pipeline.metrics import team_key
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


def fetch_games(url: str, key: str, client: httpx.Client, extra: Sequence[dict[str, Any]] = ()) -> list[Any]:
    """Partidos de liga de las últimas `MAX_SEASONS` temporadas, de todas las fuentes, sin repetir.

    `extra` son filas con la misma forma que no están en la base (transfermarkt-datasets). Los
    nombres de club se unifican con `metrics.team_key`; un mismo partido se queda una sola vez.
    """
    rows = om._fetch(
        "league_result",
        "source,season,match_date,home_team,away_team,home_goals,away_goals",
        url,
        key,
        client,
    )
    rows = [*rows, *extra]
    if not rows:
        return []
    since = max(int(r["season"]) for r in rows) - match_predictor.MAX_SEASONS + 1
    return om.dedupe_games([r for r in rows if int(r["season"]) >= since])


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


_STOP = {"club", "de", "da", "do", "del", "la", "el", "y", "e"}


def _tokens(name: str) -> set[str]:
    plain = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode().lower()
    return {t for t in re.split(r"[^a-z0-9]+", plain) if t and t not in _STOP}


def club_value(name: str, values: dict[str, int]) -> int | None:
    """Valor del plantel de un club por su nombre corto («São Paulo» → «São Paulo Futebol Clube»).

    Primero por clave de club (alias incluidos); si no, el único club del dataset cuyo nombre contiene
    todas las palabras del buscado. Si hay más de uno o ninguno, None: mejor estimado que equivocado.
    """
    keyed = {team_key(k): v for k, v in values.items()}
    if (hit := keyed.get(team_key(name))) is not None:
        return hit
    want = _tokens(name)
    found = [v for k, v in values.items() if want and want <= _tokens(k)]
    return found[0] if len(found) == 1 else None


def league_rows(
    dataset: Sequence[tmd.PoolPlayerRecord],
    match: Callable[[str], int | None],
    club_id: str,
    values: dict[int, float],
) -> list[dict[str, Any]]:
    """Jugadores de la liga para el modelo de valor; los del club propio llevan su player_id (y el
    valor cargado en la base, si hay uno más nuevo o manual)."""
    rows = []
    for r in dataset:
        pid = match(r.player_name) if r.club_ext_id == club_id else None
        rows.append(
            {
                "name": r.player_name,
                "team": r.team_name,
                "club_id": r.club_ext_id,
                "age": r.age,
                "position_group": r.position_group,
                "contract_until": r.contract_until,
                "foreign": r.foreign,
                "value_eur": values.get(pid, r.value_eur) if pid is not None else r.value_eur,
                "player_id": pid,
            }
        )
    return rows


def compute(
    players: Sequence[dict[str, Any]],
    values: dict[int, float],
    games: Sequence[Any],
    team_slug: str,
    others: Sequence[dict[str, Any]] = (),
    league: Sequence[dict[str, Any]] = (),
    club_values: dict[str, int] | None = None,
    cups: Sequence[dict[str, Any]] = (),
    today: date | None = None,
) -> dict[str, Any]:
    """Lote de `ingest.load_models` para un equipo.

    `league`: jugadores de la liga para el modelo de valor (ver `league_rows`). `club_values`: valor
    del plantel por nombre de club (dataset abierto). `cups`: rivales de copas {name, competition}.
    """
    team = TEAMS[team_slug]
    rivals = [o for o in others if o.get("club_id") != team["club_id"]]
    mv = market_value.fit(league, players, team_slug, team["club_id"], today or date.today())
    alt = similarity.fit(own_rows(players, values, team["name"]), rivals, team_slug)
    club_values = club_values or {}
    keys = {match_predictor.norm(t) for g in games for t in (g.home, g.away)}
    team_values = {k: float(v) for k in keys if (v := club_value(k, club_values))}
    cup_rows = [{**c, "value_eur": club_value(c["name"], club_values)} for c in cups]
    mp = match_predictor.run(games, team["name"], team_slug, team_values, cup_rows)
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


def fetch_cups(url: str, key: str, client: httpx.Client, season: str) -> list[dict[str, Any]]:
    """Rivales de copas del equipo en la temporada (Libertadores, Sudamericana, Copa Argentina)."""
    rows = om._fetch(
        "team_match_master",
        "competition_code,opponent",
        url,
        key,
        client,
        {"match_date": f"gte.{season}-01-01"},
    )
    seen: dict[tuple[str, str], dict[str, Any]] = {}
    for r in rows:
        if r["competition_code"] in match_predictor.COMPETITIONS and r.get("opponent"):
            seen.setdefault(
                (r["opponent"], r["competition_code"]),
                {"name": r["opponent"], "competition": r["competition_code"]},
            )
    return list(seen.values())


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
                past_games = tmd.parse_games(
                    tmd.read_csv(polite, "games"), today.year - match_predictor.MAX_SEASONS + 1
                )
                club_vals = tmd.club_values(
                    tmd.read_csv(polite, "players"),
                    tmd.latest_valuations(tmd.read_csv(polite, "player_valuations")),
                    today.year - 1,
                )
        except (FetchError, RetryableFetchError, OSError, ValueError) as exc:
            warnings.append(f"transfermarkt-datasets no disponible: {exc}")
            dataset, past_games, club_vals = [], [], {}
        own_values, pool = split_pool(dataset, match, today)
        records += own_values
        summary["valores_propios"] = len(own_values)
        summary["jugadores_otros_clubes"] = len(pool)
        if not dry_run:
            if records:
                load.send_market_values(records, url, key)
            if pool:
                load.send_player_pool(tmd.dump(pool), url, key)
        games = fetch_games(url, key, client, past_games)
        summary["partidos_liga"] = len(games)
        cups = fetch_cups(url, key, client, max(g.date for g in games)[:4]) if games else []
        summary["rivales_de_copa"] = len(cups)
        for team_slug in TEAMS:
            if dry_run:
                values: dict[int, float] = {
                    r.player_id: r.value_eur for r in records if r.team_slug == team_slug
                }
                others = [pool_row(r) for r in tmd.dump(pool)]
            else:
                values = fetch_values(url, key, client, team_slug)
                others = fetch_pool(url, key, client)
            league = league_rows(dataset, match, TEAMS[team_slug]["club_id"], values)
            payload = compute(players, values, games, team_slug, others, league, club_vals, cups, today)
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
