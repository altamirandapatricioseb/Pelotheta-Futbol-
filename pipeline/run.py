"""Corrida del pipeline: scraping de Promiedos -> validación -> carga en Supabase.

Uso (desde la raíz del repo):
    uv run python -m pipeline.run            # baja, valida y carga
    uv run python -m pipeline.run --dry-run  # baja y valida, sin cargar

Variables de entorno: SUPABASE_URL y SUPABASE_SECRET_KEY (en GitHub Actions vienen de
GitHub Secrets; en local, de `.env`, que git ignora).

Cómo encuentra los partidos de Boca: la página de Boca lista solo los últimos ~34 resultados.
Para llegar al inicio de la temporada se leen también las páginas de los rivales (cada una
lista sus propios partidos, entre ellos los que jugó con Boca) y el historial de cada partido.
Todo con el mismo cliente respetuoso (3 s entre requests, caché y User-Agent identificable).
"""

from __future__ import annotations

import argparse
import contextlib
import json
import os
import sys
import uuid
from collections import deque
from datetime import datetime
from pathlib import Path
from typing import Any

from pipeline import catalog, enrich, load
from pipeline.models import (
    CompetitionMetricRecord,
    LeagueResultRecord,
    PlayerProfileRecord,
    WeatherRecord,
)
from sources import bzzoiro as bz
from sources import nofluffpicks as nfp
from sources import openmeteo as om
from sources import promiedos as pd
from sources import scoutingstats as ss
from sources import statshub as sh
from sources import strikerapi as st
from sources import wikipedia as wp
from sources.http_client import ROOT, FetchError, PoliteClient, RetryableFetchError

SEASON_YEAR = 2026
LEAGUE_PATH = "/league/liga-profesional/hc"
MAX_TEAM_PAGES = 80  # tope de seguridad: nunca más de ~4 minutos de requests de equipos
MAX_GAME_PAGES = 120
MAX_LEAGUE_GAME_PAGES = 650  # una temporada completa de liga tiene ~480 partidos


def load_dotenv(path: Path = ROOT / ".env") -> None:
    """Lee `.env` local (KEY=valor) sin pisar variables ya definidas. Sin dependencias extra."""
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            key, value = line.split("=", 1)
            os.environ.setdefault(key.strip(), value.strip())


def secret_key() -> str:
    # Se acepta el nombre que eligió el dueño en GitHub Secrets además del documentado.
    return (os.environ.get("SUPABASE_SECRET_KEY") or os.environ.get("API_SUPABASE_SECRET_KEY", "")).strip()


def league_team_paths(league_data: dict[str, object]) -> list[str]:
    """Rutas de los equipos de la Liga Profesional a partir de las tablas de posiciones."""
    paths: set[str] = set()
    for group in league_data.get("tables_groups") or []:  # type: ignore[union-attr]
        for table in group.get("tables") or []:
            for row in table.get("table", {}).get("rows", []) or table.get("rows", []) or []:
                obj = (row.get("entity") or {}).get("object") or {}
                if obj.get("id") and obj.get("url_name") and obj["id"] != pd.BOCA_ID:
                    paths.add(f"/team/{obj['url_name']}/{obj['id']}")
    return sorted(paths)


def crawl(
    client: PoliteClient, season_year: int
) -> tuple[list[pd.ParsedGame], list, list, list[str], dict[str, Any], list[LeagueResultRecord]]:
    """Devuelve (partidos de Boca, jugadores, plantel, avisos, página de liga, partidos de la liga).

    Los partidos de toda la liga salen de las mismas páginas de equipo que ya se recorren: cada
    una lista sus partidos. Se lee cada partido una sola vez (después queda en caché).
    """
    warnings: list[str] = []
    league: dict[str, Any] = {}
    league_ids: set[str] = set()
    league_refs: dict[str, pd.GameRef] = {}
    league_games: list[LeagueResultRecord] = []
    boca = pd.next_data(client.get(pd.BASE_URL + pd.BOCA_TEAM_PATH, use_cache=False).text())["data"]
    players, squad = pd.parse_squad(boca)

    pending: deque[pd.GameRef] = deque(pd.boca_game_refs(boca, season_year))
    team_queue: deque[str] = deque()
    try:
        league = pd.next_data(client.get(pd.BASE_URL + LEAGUE_PATH, use_cache=False).text())["data"]
        team_queue.extend(league_team_paths(league))
        league_ids = {path.rsplit("/", 1)[1] for path in league_team_paths(league)} | {pd.BOCA_ID}
    except (FetchError, RetryableFetchError, ValueError, KeyError) as exc:
        warnings.append(f"Tabla de la liga no disponible: {exc}")

    seen_games: set[str] = set()
    seen_teams: set[str] = {pd.BOCA_TEAM_PATH}
    games: list[pd.ParsedGame] = []
    team_pages = game_pages = 0
    while pending or team_queue:
        if pending:
            ref = pending.popleft()
            if ref.game_id in seen_games or game_pages >= MAX_GAME_PAGES:
                continue
            seen_games.add(ref.game_id)
            game_pages += 1
            try:
                raw = pd.next_data(client.get(pd.BASE_URL + ref.path).text())["initialData"]["game"]
                if (raw.get("status") or {}).get("enum") != 3:
                    # Puede estar en caché de antes de terminar: se pide de nuevo.
                    raw = pd.next_data(client.get(pd.BASE_URL + ref.path, use_cache=False).text())[
                        "initialData"
                    ]["game"]
                parsed = pd.parse_game(raw)
            except (FetchError, RetryableFetchError, ValueError, KeyError) as exc:
                warnings.append(f"Partido {ref.game_id}: {exc}")
                continue
            pending.extend(pd.head_to_head_refs(raw, season_year))
            league_game = pd.parse_league_game(raw, season_year)
            if league_game is not None:
                league_games.append(league_game)
            team_queue.extend(p for p in pd.opponent_paths(raw) if p not in seen_teams)
            if parsed is not None:
                games.append(parsed)
        else:
            path = team_queue.popleft()
            if path in seen_teams or team_pages >= MAX_TEAM_PAGES:
                continue
            seen_teams.add(path)
            team_pages += 1
            try:
                data = pd.next_data(client.get(pd.BASE_URL + path, use_cache=False).text())["data"]
                pending.extend(pd.boca_game_refs(data, season_year))
                league_refs.update({r.game_id: r for r in pd.league_game_refs(data, season_year, league_ids)})
            except (FetchError, RetryableFetchError, ValueError, KeyError) as exc:
                warnings.append(f"Equipo {path}: {exc}")
    league_pages = 0
    for ref in league_refs.values():
        if ref.game_id in seen_games or league_pages >= MAX_LEAGUE_GAME_PAGES:
            continue
        league_pages += 1
        try:
            raw = pd.next_data(client.get(pd.BASE_URL + ref.path).text())["initialData"]["game"]
        except (FetchError, RetryableFetchError, ValueError, KeyError) as exc:
            warnings.append(f"Partido de liga {ref.game_id}: {exc}")
            continue
        league_game = pd.parse_league_game(raw, season_year)
        if league_game is not None:
            league_games.append(league_game)
    print(
        f"Páginas leídas: {team_pages} de equipos, {game_pages} de partidos de Boca, "
        f"{league_pages} de otros partidos. Partidos de Boca: {len(games)}; de la liga: {len(league_games)}."
    )
    games.sort(key=lambda g: g.match.kickoff_at)
    pd.split_league_tournaments(games)
    return games, players, squad, warnings, league, league_games


def crawl_nofluffpicks(
    client: PoliteClient, warnings: list[str]
) -> list[tuple[nfp.Fixture, dict[str, tuple[float, float]]]]:
    """xG y estadísticas de los partidos de Boca en la Liga Profesional (NoFluffPicks).

    Una página con el calendario completo y una página por partido jugado de Boca. Si la fuente
    falla, se sigue sin xG: el resto de la carga no depende de ella.
    """
    try:
        league_html = client.get(nfp.BASE_URL + nfp.LEAGUE_PATH, use_cache=False).text()
    except (FetchError, RetryableFetchError) as exc:
        warnings.append(f"NoFluffPicks no disponible: {exc}")
        return []
    result = []
    for fixture in nfp.boca_fixtures(nfp.parse_fixtures(league_html)):
        try:
            stats = nfp.parse_game_stats(client.get(nfp.BASE_URL + fixture.path).text())
        except (FetchError, RetryableFetchError) as exc:
            warnings.append(f"NoFluffPicks {fixture.slug}: {exc}")
            continue
        result.append((fixture, stats))
    return result


def crawl_scoutingstats(client: PoliteClient, warnings: list[str]) -> list[ss.ParsedMatch]:
    """Estadísticas avanzadas de equipo y jugador de cada partido jugado de Boca (ScoutingStats).

    Una página con la lista de partidos del club y una por partido. Si la fuente falla, se sigue
    sin estos datos: el resto de la carga no depende de ella.
    """
    try:
        club_html = client.get(ss.BASE_URL + ss.BOCA_MATCHES_PATH, use_cache=False).text()
    except (FetchError, RetryableFetchError) as exc:
        warnings.append(f"ScoutingStats no disponible: {exc}")
        return []
    result = []
    for match_id in ss.match_ids(club_html):
        url = f"{ss.BASE_URL}/match/{match_id}"
        try:
            parsed = ss.parse_match(client.get(url).text())
            if parsed is None:
                # Puede estar en caché de antes de jugarse: se pide de nuevo.
                parsed = ss.parse_match(client.get(url, use_cache=False).text())
        except (FetchError, RetryableFetchError) as exc:
            warnings.append(f"ScoutingStats partido {match_id}: {exc}")
            continue
        if parsed is not None:
            result.append(parsed)
    return result


def crawl_statshub(client: PoliteClient, warnings: list[str]) -> list[sh.MatchLines]:
    """Una consulta: rendimiento por partido de todo el plantel de Boca en la temporada."""
    try:
        payload = json.loads(
            client.get(sh.BASE_URL + sh.performance_path(SEASON_YEAR), use_cache=False).text()
        )
    except (FetchError, RetryableFetchError, ValueError) as exc:
        warnings.append(f"Statshub no disponible: {exc}")
        return []
    return sh.parse_performance(payload)


def crawl_bzzoiro(
    warnings: list[str],
) -> tuple[list[tuple[bz.Event, list[tuple[str, dict[str, float]]]]], dict[str, str]]:
    """Estadísticas por jugador de cada partido de Boca de la temporada (Bzzoiro, con clave).

    Una consulta por la lista de partidos y dos por cada partido nuevo (estadísticas y
    alineación); los partidos terminados quedan en caché.
    """
    key = os.environ.get("BZZOIRO_API_KEY", "")
    if not key:
        warnings.append("Bzzoiro sin clave (BZZOIRO_API_KEY)")
        return [], {}
    client = bz.BzzoiroClient(api_key=key)
    result = []
    player_ids: dict[int, str] = {}
    feet: dict[str, str] = {}
    try:
        listing = client.get(
            "/api/v2/events/",
            {
                "team_id": bz.BOCA_TEAM_ID,
                "status": "finished",
                "date_from": f"{SEASON_YEAR}-01-01",
                "limit": 200,
            },
        )
        for event in bz.parse_events(listing, SEASON_YEAR):
            stats = client.get(
                f"/api/v2/events/{event.event_id}/player-stats/", cache_key=f"ps_{event.event_id}"
            )
            lineups = client.get(
                f"/api/v2/events/{event.event_id}/lineups/", cache_key=f"lu_{event.event_id}"
            )
            result.append((event, bz.parse_player_stats(stats, lineups)))
            player_ids.update(bz.boca_player_ids(lineups))
        # Pie hábil de la ficha de cada jugador (en caché: casi no cambia).
        for player_id, name in player_ids.items():
            value = bz.foot(client.get(f"/api/v2/players/{player_id}/", cache_key=f"pl_{player_id}"))
            if value:
                feet[name] = value
    except bz.BzzoiroError as exc:
        warnings.append(f"Bzzoiro no disponible: {exc}")
    return result, feet


def crawl_ss_performance(client: PoliteClient, warnings: list[str]) -> list[CompetitionMetricRecord]:
    """Métricas de Boca por competición (PPDA, Field Tilt, goles evitados...) con promedio y puesto."""
    rows: list[CompetitionMetricRecord] = []
    for (season, competition), path in ss.PERFORMANCE_PAGES.items():
        try:
            html = client.get(ss.BASE_URL + path, use_cache=False).text()
        except (FetchError, RetryableFetchError) as exc:
            warnings.append(f"ScoutingStats rendimiento {competition} {season}: {exc}")
            continue
        rows.extend(ss.parse_competition_metrics(html, season, competition))
    return rows


def crawl_strikerapi(
    warnings: list[str],
) -> tuple[list[st.GameLine], list[st.Shot], dict[str, list[Any]], dict[str, dict[str, dict[str, float]]]]:
    """Tiros ubicados y datos por jugador de la Liga Profesional (StrikerAPI, con clave).

    Créditos (500 por mes): la lista de partidos cuesta 2 por corrida; cada partido nuevo 5 una
    sola vez (queda en caché); los dos mapas de tiros 10 cada uno, solo si hubo un partido nuevo.
    Sin clave o si la API falla, se sigue sin estos datos.
    """
    key = os.environ.get("STRIKER_API_KEY", "")
    if not key:
        warnings.append("StrikerAPI sin clave (STRIKER_API_KEY): sin tiros ubicados")
        return [], [], {}, {}
    client = st.StrikerClient(api_key=key)
    try:
        listing = client.call(
            "list_games", {"season": SEASON_YEAR, "team": st.BOCA_ID, "status": "final", "limit": 200}
        )
        ids = st.final_game_ids(listing)
        lines = []
        for game_id in ids:
            line = st.parse_game(client.call("get_game", {"game_id": game_id}, cache_key=f"game_{game_id}"))
            if line is not None:
                lines.append(line)
        latest = ids[0] if ids else "none"
        shots = []
        for against in (False, True):
            payload = client.call(
                "get_shot_map",
                {"season": SEASON_YEAR, "team": st.BOCA_ID, "against": against, "include_shots": True},
                cache_key=f"shots_{SEASON_YEAR}_{'against' if against else 'for'}_{latest}",
            )
            shots.extend(st.parse_shots(payload, boca=not against))
    except st.StrikerError as exc:
        warnings.append(f"StrikerAPI no disponible: {exc}")
        return [], [], {}, {}
    league = crawl_striker_league(client, latest, warnings)
    # Primero los partidos con penales (dan penales cometidos y provocados), después el resto.
    with_penalty = {shot.game_id for shot in shots if shot.penalty}
    events = crawl_striker_events(client, sorted(ids, key=lambda g: g not in with_penalty), warnings)
    print(
        f"StrikerAPI: {len(lines)} partidos, {len(shots)} tiros, eventos de {len(events)} partidos, "
        f"{client.credits_used} créditos usados."
    )
    return lines, shots, league, events


def crawl_striker_events(
    client: st.StrikerClient, game_ids: list[str], warnings: list[str]
) -> dict[str, dict[str, dict[str, float]]]:
    """xA, penales cometidos y provocados de cada partido (10 créditos por partido, una sola vez).

    Los partidos ya bajados salen de la caché. Los nuevos se piden mientras queden más créditos
    que la reserva del mes; el resto se completa en la corrida siguiente.
    """
    events: dict[str, dict[str, dict[str, float]]] = {}
    pending = 0
    for game_id in game_ids:
        cache_key = f"events_{game_id}"
        cached = (client.cache_dir / f"{cache_key}.json").exists()
        low = (
            client.credits_remaining is not None and client.credits_remaining - 10 < st.EVENTS_CREDIT_RESERVE
        )
        if not cached and low:
            pending += 1
            continue
        try:
            payload = client.call(
                "get_events", {"game_id": game_id, "kind": "all", "limit": 500}, cache_key=cache_key
            )
        except st.StrikerError as exc:
            warnings.append(f"StrikerAPI eventos {game_id}: {exc}")
            continue
        events[game_id] = st.boca_event_stats(payload)
    if pending:
        print(
            f"StrikerAPI: eventos de {pending} partidos quedan para la próxima corrida (reserva de créditos)."
        )
    return events


def crawl_striker_league(client: st.StrikerClient, latest: str, warnings: list[str]) -> dict[str, list[Any]]:
    """Datos de toda la liga: resultados, Elo, promedios por club y rankings de jugadores.

    Se refrescan solo cuando Boca jugó un partido nuevo (la caché usa su último partido); la
    temporada anterior de Boca no cambia y queda en caché para siempre. Unos 30 créditos.
    """
    extras: dict[str, list[Any]] = {"league_results": [], "ratings": [], "club_stats": [], "leaders": []}
    try:
        offset: int | None = 0
        pages = 0
        while offset is not None and pages < 10:
            payload = client.call(
                "list_games",
                {"season": SEASON_YEAR, "status": "final", "limit": 200, "offset": offset},
                cache_key=f"league_games_{SEASON_YEAR}_{latest}_{offset}",
            )
            extras["league_results"].extend(st.parse_results(payload))
            offset = (payload.get("data") or {}).get("next_offset")
            pages += 1
        previous = client.call(
            "list_games",
            {"season": SEASON_YEAR - 1, "team": st.BOCA_ID, "status": "final", "limit": 200},
            cache_key=f"boca_games_{SEASON_YEAR - 1}",
        )
        extras["league_results"].extend(st.parse_results(previous))
        ratings = client.call("get_ratings", {"limit": 60}, cache_key=f"ratings_{latest}")
        extras["ratings"] = st.parse_ratings(ratings)
        for season, cache_key in (
            (SEASON_YEAR, f"team_stats_{SEASON_YEAR}_{latest}"),
            (SEASON_YEAR - 1, f"team_stats_{SEASON_YEAR - 1}"),
        ):
            stats = client.call("get_team_stats", {"season": season}, cache_key=cache_key)
            extras["club_stats"].extend(st.parse_team_stats(stats))
        for stat in ("goals", "assists", "xg"):
            leaders = client.call(
                "get_leaders",
                {"stat": stat, "season": SEASON_YEAR, "limit": 50},
                cache_key=f"leaders_{stat}_{SEASON_YEAR}_{latest}",
            )
            extras["leaders"].extend(st.parse_leaders(leaders))
    except st.StrikerError as exc:
        warnings.append(f"StrikerAPI (datos de liga) no disponible: {exc}")
    return extras


def crawl_wikipedia(known_players: list[str], warnings: list[str]) -> list[PlayerProfileRecord]:
    """Perfil público de los jugadores de Boca: nacionalidad, peso, club formador y selección.

    Una página del club (siempre fresca) y una por jugador (en caché: el peso casi no cambia).
    """
    profiles: list[PlayerProfileRecord] = []
    with PoliteClient(source=wp.SOURCE) as client:
        try:
            squad = wp.parse_squad(client.get(wp.BASE_URL + wp.CLUB_PATH, use_cache=False).text())
        except (FetchError, RetryableFetchError) as exc:
            warnings.append(f"Wikipedia no disponible: {exc}")
            return []
        for entry in squad:
            key = enrich.match_player(entry.name, known_players)
            if key is None:
                continue
            try:
                weight = wp.parse_weight(client.get(wp.BASE_URL + wp.article_path(entry.article)).text())
            except (FetchError, RetryableFetchError):
                weight = None
            profiles.append(
                PlayerProfileRecord(
                    player_source_id=key,
                    nationality=entry.nationality,
                    weight_kg=weight,
                    youth_club=entry.youth_club,
                    academy=entry.academy,
                    national_team=entry.national_team,
                    source=wp.SOURCE,
                )
            )
    return profiles


def crawl_weather(
    games: list[pd.ParsedGame], ss_matches: list[ss.ParsedMatch], warnings: list[str]
) -> list[WeatherRecord]:
    """Clima a la hora de cada partido (Open-Meteo), ubicado por la ciudad del estadio.

    La ciudad sale de ScoutingStats; los partidos sin ella (Copa Argentina) quedan sin clima.
    Las respuestas quedan en caché: solo los partidos nuevos generan consultas.
    """
    by_date = {g.match.match_date: g for g in games}
    client = om.OpenMeteoClient()
    rows: list[WeatherRecord] = []
    for found in ss_matches:
        parsed, city = by_date.get(found.local_date), om.city_from_venue(found.venue)
        if parsed is None or city is None:
            continue
        try:
            place = client.place(city)
            if place is None:
                warnings.append(f"Open-Meteo: no se ubicó «{city}»")
                continue
            weather = client.weather(*place, parsed.match.kickoff_at)
        except om.OpenMeteoError as exc:
            warnings.append(f"Open-Meteo no disponible: {exc}")
            break
        if weather:
            rows.append(
                WeatherRecord(
                    match_source_id=parsed.match.source_id,
                    latitude=place[0],
                    longitude=place[1],
                    place=city,
                    source=om.SOURCE,
                    **weather,
                )
            )
    return rows


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Pipeline de Pelotheta: Promiedos -> Supabase")
    parser.add_argument("--dry-run", action="store_true", help="no carga en Supabase")
    args = parser.parse_args(argv)
    load_dotenv()
    # strip: un secret pegado con un espacio o un salto de línea al final rompe la URL o la cabecera.
    url, key = os.environ.get("SUPABASE_URL", "").strip(), secret_key()
    if not args.dry_run:
        # Antes de media hora de scraping: sin destino válido no tiene sentido empezar.
        if not (url and key):
            print("Faltan SUPABASE_URL o la clave secreta (GitHub Secrets o .env).", file=sys.stderr)
            return 2
        try:
            load.check_connection(url, key)
        except load.LoadError as exc:
            print(f"El destino de la carga no responde bien: {exc}", file=sys.stderr)
            return 2
    try:
        return run_pipeline(dry_run=args.dry_run, url=url, key=key)
    except Exception as exc:
        # Un error no previsto queda en ingest_log (y se ve en /actualizar) y se relanza para que
        # el traceback completo quede en el log de GitHub Actions.
        if not args.dry_run:
            with contextlib.suppress(load.LoadError):
                load.log_failure(pd.SOURCE, f"Error inesperado ({type(exc).__name__}): {exc}", url, key)
        raise


def run_pipeline(dry_run: bool, url: str, key: str) -> int:
    """Scraping de todas las fuentes, validación y carga (con el destino ya verificado)."""
    run_id = str(uuid.uuid4())
    started = datetime.now()
    try:
        with PoliteClient(source=pd.SOURCE) as client:
            games, players, squad, warnings, league_page, promiedos_league = crawl(client, SEASON_YEAR)
        # ScoutingStats va antes que NoFluffPicks: la primera fuente de cada clave gana.
        with PoliteClient(source=ss.SOURCE) as client:
            ss_matches = crawl_scoutingstats(client, warnings)
            with_ss = enrich.attach_scoutingstats(games, ss_matches, warnings)
            competition_metrics = crawl_ss_performance(client, warnings)
        print(f"Partidos con datos de ScoutingStats: {with_ss}.")
        # Statshub va antes que StrikerAPI: su xA cubre todas las competiciones con un solo modelo.
        with PoliteClient(source=sh.SOURCE) as client:
            with_sh = enrich.attach_statshub(games, crawl_statshub(client, warnings), warnings)
        print(f"Partidos con datos de Statshub: {with_sh}.")
        bz_matches, bz_feet = crawl_bzzoiro(warnings)
        with_bz = enrich.attach_bzzoiro(games, bz_matches, warnings)
        print(f"Partidos con datos de Bzzoiro: {with_bz}.")
        striker_lines, striker_shots, striker_league, striker_events = crawl_strikerapi(warnings)
        with_st = enrich.attach_strikerapi(games, striker_lines, striker_shots, warnings, striker_events)
        print(f"Partidos con datos de StrikerAPI: {with_st}.")
        with PoliteClient(source=nfp.SOURCE) as client:
            with_xg = enrich.attach_nofluffpicks(games, crawl_nofluffpicks(client, warnings), warnings)
        print(f"Partidos con datos de NoFluffPicks: {with_xg}.")
        weather = crawl_weather(games, ss_matches, warnings)
        print(f"Partidos con clima de Open-Meteo: {len(weather)}.")
        known = sorted(
            {p.source_id for p in players} | {lu.player_source_id for g in games for lu in g.lineups}
        )
        profiles = crawl_wikipedia(known, warnings)
        feet = [
            {"player_source_id": player_key, "foot": value, "source": bz.SOURCE}
            for name, value in bz_feet.items()
            if (player_key := enrich.match_player(name, known)) is not None
        ]
        print(f"Perfiles de Wikipedia: {len(profiles)}.")
        promiedos_leaders = pd.parse_league_leaders(league_page, SEASON_YEAR) if league_page else []
        extras = load.build_extras(
            games,
            standings=pd.parse_standings(league_page, SEASON_YEAR) if league_page else [],
            leaders=[*promiedos_leaders, *striker_league.get("leaders", [])],
            league_results=[*promiedos_league, *striker_league.get("league_results", [])],
            ratings=striker_league.get("ratings", []),
            club_stats=striker_league.get("club_stats", []),
            profiles=profiles,
        )
    except (FetchError, RetryableFetchError, ValueError, KeyError) as exc:
        message = f"Fallo del scraping: {exc}"
        print(message, file=sys.stderr)
        if not dry_run:
            with contextlib.suppress(load.LoadError):
                load.log_failure(pd.SOURCE, message, url, key)
        return 1
    if not games:
        print("Sin partidos: no se carga nada para no borrar datos buenos.", file=sys.stderr)
        return 1
    status = "parcial" if warnings else "ok"
    message = "; ".join(warnings)[:500] or None
    batch = load.build_batch(
        games, players, squad, SEASON_YEAR, run_id=run_id, status=status, message=message
    )
    for warning in warnings:
        print(f"Aviso: {warning}")
    if dry_run:
        print(
            f"Dry run: {len(batch['matches'])} partidos, {len(batch['lineups'])} alineaciones, "
            f"{len(batch['events'])} eventos, {len(batch['player_stats'])} estadísticas de "
            f"jugador. No se cargó nada."
        )
        return 0
    player_stats = batch.pop("player_stats")
    try:
        result = load.send_batch(batch, url, key)
        # El catálogo viaja en cada corrida: es la fuente de verdad de las tablas de la web.
        result["catalog"] = load.send_catalog(
            catalog.to_payload(catalog.load_catalog(), catalog.load_sets()), url, key
        )
        result["player_stats"] = load.send_player_stats(player_stats, url, key)
        if weather:
            result["weather"] = load.send_weather(weather, url, key)
        result.update(load.send_extras(extras, url, key) or {})
        if feet:
            result["feet"] = load.send_player_foot(feet, url, key)
        if competition_metrics:
            result["competition_metrics"] = load.send_competition_metrics(competition_metrics, url, key)
        # Al final: las tablas maestras de la web se recalculan con todo lo que se cargó.
        load.refresh_stats(url, key)
    except load.LoadError as exc:
        # El mensaje de LoadError nunca incluye la clave: se puede registrar en la base.
        print(f"Fallo de la carga: {exc}", file=sys.stderr)
        with contextlib.suppress(load.LoadError):
            load.log_failure(pd.SOURCE, f"Fallo de la carga: {exc}", url, key)
        return 1
    seconds = (datetime.now() - started).total_seconds()
    print(f"Carga {status} en {seconds:.0f} s: {result}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
