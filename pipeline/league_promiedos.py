"""Promiedos para cualquier liga que publique (etapa 5j-4): resultados con minutos de gol, tablas,
líderes, próximos partidos, situaciones y estadísticas de equipo por partido (5k-1) de cada club.

Mismo recorrido que la Liga Profesional en `pipeline.run.crawl`: página de la liga (tabla, ids y
nombres) → página de cada equipo (sus últimos partidos y los próximos) → página de cada partido, y el
«historial» de cada partido suma los anteriores entre los mismos equipos hasta completar la temporada.
Promiedos permite compartir sus datos citando la fuente: todo esto es público.
"""

from __future__ import annotations

from collections import deque
from typing import Any

from pipeline import league_situations
from pipeline.league_team_match import team_match_rows
from sources import promiedos as pd
from sources.http_client import FetchError, PoliteClient, RetryableFetchError

# Ligas del sistema que publica Promiedos (la Liga Profesional sale de la corrida diaria por Supabase).
LEAGUES = {
    # La Liga Profesional ya trae resultados y tablas desde Supabase: de acá solo sale
    # `league_team_match` (las estadísticas de los 30 clubes, que la base guarda solo de Boca).
    "arg-liga-profesional-argentina": ("/league/liga-profesional/hc", "hc"),
    "arg-primera-nacional": ("/league/primera-nacional/ebj", "ebj"),
    "arg-primera-b": ("/league/primera-b-metropolitana/fahh", "fahh"),
    "arg-federal-a": ("/league/federal-a/fahi", "fahi"),
    "bra-serie-a": ("/league/brasileirao-serie-a/bbd", "bbd"),
    "uru-primera": ("/league/uruguayan-championship/gbh", "gbh"),
    "par-primera": ("/league/copa-de-primera/gcb", "gcb"),
    "chi-primera": ("/league/campeonato-nacional/bdf", "bdf"),
    "col-primera-a": ("/league/liga-betplay/gca", "gca"),
}
ERRORS = (FetchError, RetryableFetchError, ValueError, KeyError)


def _teams(league: dict[str, Any]) -> list[dict[str, Any]]:
    teams = []
    for group in league.get("tables_groups") or []:
        for table in group.get("tables") or []:
            for row in table.get("table", {}).get("rows", []) or table.get("rows", []) or []:
                obj = (row.get("entity") or {}).get("object") or {}
                if obj.get("id"):
                    teams.append(obj)
    return teams


def collect(
    client: PoliteClient,
    path: str,
    league_id: str,
    season_year: int,
    max_new: int | None = None,
    report: dict[str, int] | None = None,
) -> dict[str, list[dict[str, Any]]]:
    """Tablas de la liga para la temporada. `max_new`: tope de páginas de partido nuevas por corrida."""
    league = pd.next_data(client.get(pd.BASE_URL + path, use_cache=False).text())["data"]
    teams = _teams(league)
    names = {t["id"]: t["name"] for t in teams if t.get("name")}
    ids = set(names)
    refs: dict[str, pd.GameRef] = {}
    fixtures: dict[str, dict[str, Any]] = {}
    for t in {t["id"]: t for t in teams if t.get("url_name")}.values():
        try:
            url = f"{pd.BASE_URL}/team/{t['url_name']}/{t['id']}"
            data = pd.next_data(client.get(url, use_cache=False).text())["data"]
        except ERRORS:
            continue
        refs.update({r.game_id: r for r in pd.league_game_refs(data, season_year, ids)})
        fixtures.update({g["ext_id"]: g for g in pd.upcoming_league_games(data, names)})
    queue, seen, games = deque(refs.values()), set(), []
    team_stats: dict[str, dict[str, dict[str, float]]] = {}
    new = pending = 0
    while queue:
        ref = queue.popleft()
        if ref.game_id in seen:
            continue
        seen.add(ref.game_id)
        if max_new is not None and new >= max_new and not client.is_cached(pd.BASE_URL + ref.path):
            pending += 1
            continue
        try:
            result = client.get(pd.BASE_URL + ref.path)
            raw = pd.next_data(result.text())["initialData"]["game"]
        except ERRORS:
            continue
        new += 0 if result.from_cache else 1
        queue.extend(pd.league_head_to_head_refs(raw, season_year, league_id))
        game = pd.parse_league_game(raw, season_year, names, league_id)
        if game is not None:
            games.append(game)
            team_stats[game.ext_id] = {names[t]: v for t, v in pd.parse_team_stats(raw).items() if t in names}
    if report is not None:
        report.update({"partidos": len(games), "pendientes": pending, "consultas_nuevas": new})
    return {
        "league_result": [g.model_dump(mode="json") for g in games],
        "league_standing": [r.model_dump(mode="json") for r in pd.parse_standings(league, season_year)],
        "league_leader": [
            r.model_dump(mode="json") for r in pd.parse_league_leaders(league, season_year, names)
        ],
        "league_fixture": sorted(fixtures.values(), key=lambda g: g["kickoff_at"]),
        "league_situation": league_situations.situations(games, season_year),
        "league_team_match": team_match_rows(games, team_stats),
    }
