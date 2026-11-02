"""Armado del lote y carga en Supabase por la Data API (HTTPS).

Por qué por HTTPS y no con una conexión directa a Postgres: la conexión directa de Supabase es
solo IPv6 y GitHub Actions usa IPv4. La función `ingest.load_batch` (SQL escrito a mano en
supabase/migrations) recibe el lote completo y lo carga en una sola transacción.

La clave secreta viaja solo en el header `apikey`: nunca en la URL ni en los mensajes de error.
"""

from __future__ import annotations

import re
from collections.abc import Iterable
from typing import Any

import httpx

from pipeline.models import PlayerRecord, Record, SquadRecord, WeatherRecord
from sources.promiedos import SOURCE, ParsedGame

SUPABASE_URL_RE = re.compile(r"^https://[a-z0-9]{1,40}\.supabase\.co/?$")
TIMEOUT_SECONDS = 60.0


class LoadError(RuntimeError):
    """Falla de carga, con un mensaje que nunca incluye la clave."""


def _dump(record: Record) -> dict[str, Any]:
    return record.model_dump(mode="json")


def _merge_players(records: Iterable[PlayerRecord]) -> list[dict[str, Any]]:
    """Une los datos de un mismo jugador que llegan de varias páginas.

    El primer valor no nulo de cada campo gana. Por eso el plantel (que trae fecha de
    nacimiento) se pasa primero y las alineaciones después.
    """
    merged: dict[str, dict[str, Any]] = {}
    for record in records:
        data = _dump(record)
        current = merged.setdefault(record.source_id, data)
        for key, value in data.items():
            if current.get(key) is None and value is not None:
                current[key] = value
    return list(merged.values())


def _unique(records: Iterable[Record], key: str) -> list[dict[str, Any]]:
    seen: dict[Any, dict[str, Any]] = {}
    for record in records:
        data = _dump(record)
        seen.setdefault(data[key], data)
    return list(seen.values())


def build_batch(
    games: list[ParsedGame],
    players: list[PlayerRecord],
    squad: list[SquadRecord],
    season_year: int,
    run_id: str | None = None,
    status: str = "ok",
    message: str | None = None,
) -> dict[str, Any]:
    """Lote con la forma que espera `ingest.load_batch`."""
    return {
        "source": SOURCE,
        "season_year": season_year,
        "run_id": run_id,
        "status": status,
        "message": message,
        "competitions": _unique((g.competition for g in games), "source_id"),
        "teams": _unique((t for g in games for t in g.teams), "source_id"),
        "players": _merge_players([*players, *(p for g in games for p in g.players)]),
        "squad": [_dump(s) for s in squad],
        "matches": [_dump(g.match) for g in games],
        "lineups": [_dump(lu) for g in games for lu in g.lineups],
        "events": [_dump(e) for g in games for e in g.events],
        "team_stats": [_dump(s) for g in games for s in g.team_stats],
        "player_stats": [_dump(s) for g in games for s in g.player_stats],
        "formations": [_dump(f) for g in games for f in g.formations],
        "shots": [_dump(s) for g in games for s in g.shots],
    }


def _check_target(url: str, key: str) -> None:
    # fullmatch y no match: con match, «$» acepta un salto de línea final (un secret mal pegado).
    if not SUPABASE_URL_RE.fullmatch(url):
        raise LoadError("SUPABASE_URL no tiene la forma https://<ref>.supabase.co")
    if not key.startswith("sb_secret_"):
        raise LoadError("La carga necesita la clave secreta (sb_secret_...), no la publicable")


def _rpc(function: str, payload: dict[str, Any], url: str, key: str, client: httpx.Client | None) -> Any:
    _check_target(url, key)
    own_client = client is None
    http = client or httpx.Client(timeout=TIMEOUT_SECONDS)
    try:
        response = http.post(
            f"{url.rstrip('/')}/rest/v1/rpc/{function}",
            json=payload,
            headers={"apikey": key, "Content-Profile": "ingest", "Content-Type": "application/json"},
        )
    except httpx.HTTPError as exc:
        raise LoadError(f"No se pudo conectar con Supabase ({type(exc).__name__})") from None
    finally:
        if own_client:
            http.close()
    if response.status_code >= 400:
        # El cuerpo de error de PostgREST trae el mensaje de SQL: útil y sin secretos.
        raise LoadError(f"Supabase respondió {response.status_code}: {response.text[:300]}")
    return response.json() if response.content else None


def count_rows(result: Any) -> int:
    """Filas cargadas en una corrida: suma de los conteos enteros que devuelven las funciones de carga."""
    if isinstance(result, bool):
        return 0
    if isinstance(result, int):
        return max(result, 0)
    if isinstance(result, dict):
        return sum(count_rows(v) for v in result.values())
    if isinstance(result, list):
        return sum(count_rows(v) for v in result)
    return 0


def log_run(metrics: dict[str, Any], url: str, key: str, client: httpx.Client | None = None) -> None:
    """Una fila en core.pipeline_run_metrics (16.5); el tamaño de la base lo mide el servidor."""
    _rpc("log_run", {"p_run": metrics}, url, key, client)


def check_connection(url: str, key: str, client: httpx.Client | None = None) -> None:
    """Lectura mínima con la clave secreta antes de empezar: si el destino está mal, se sabe en
    segundos y no después de media hora de scraping (cuando ni el fallo se puede registrar)."""
    _check_target(url, key)
    own_client = client is None
    http = client or httpx.Client(timeout=TIMEOUT_SECONDS)
    try:
        response = http.get(
            f"{url.rstrip('/')}/rest/v1/system_status",
            params={"select": "key", "limit": "1"},
            headers={"apikey": key, "Accept-Profile": "api"},
        )
    except httpx.HTTPError as exc:
        raise LoadError(f"No se pudo conectar con Supabase ({type(exc).__name__})") from None
    finally:
        if own_client:
            http.close()
    if response.status_code >= 400:
        raise LoadError(f"Supabase respondió {response.status_code}: {response.text[:300]}")


def send_batch(batch: dict[str, Any], url: str, key: str, client: httpx.Client | None = None) -> Any:
    return _rpc("load_batch", {"p_batch": batch}, url, key, client)


def send_catalog(payload: dict[str, Any], url: str, key: str, client: httpx.Client | None = None) -> Any:
    """Catálogo de estadísticas y conjuntos de columnas (`data/stat_catalog.csv` y `stat_sets.csv`)."""
    return _rpc("load_catalog", {"p_stats": payload["stats"], "p_sets": payload["sets"]}, url, key, client)


def send_charts(payload: dict[str, Any], url: str, key: str, client: httpx.Client | None = None) -> Any:
    """Catálogo de gráficos y mapa de origen (`data/chart_catalog.csv` y `chart_source_map.csv`)."""
    body = {"p_charts": payload["charts"], "p_sources": payload["sources"]}
    return _rpc("load_charts", body, url, key, client)


def send_situations(
    cards: list[dict[str, Any]], url: str, key: str, client: httpx.Client | None = None
) -> Any:
    """Catálogo de tarjetas de Situaciones (`data/situational_catalog.csv`)."""
    return _rpc("load_situations", {"p_cards": cards}, url, key, client)


def send_conclusions(
    rules: list[dict[str, Any]], url: str, key: str, client: httpx.Client | None = None
) -> Any:
    """Reglas de las conclusiones (`data/conclusion_catalog.csv`); la base recalcula al cargarlas."""
    return _rpc("load_conclusions", {"p_rules": rules}, url, key, client)


def send_stat_values(
    stat_ids: list[str],
    values: list[dict[str, Any]],
    match_values: list[dict[str, Any]],
    url: str,
    key: str,
    client: httpx.Client | None = None,
) -> Any:
    """Métricas propias por ventana y por partido; reemplaza las anteriores de esos ids."""
    payload = {"p_stat_ids": stat_ids, "p_values": values, "p_match_values": match_values}
    return _rpc("load_stat_values", payload, url, key, client)


def refresh_stats(url: str, key: str, client: httpx.Client | None = None) -> None:
    """Recalcula las tablas maestras materializadas (valores por partido y por ventana)."""
    _rpc("refresh_stats", {}, url, key, client)


def log_failure(source: str, message: str, url: str, key: str, client: httpx.Client | None = None) -> None:
    _rpc("log_failure", {"p_source": source, "p_message": message[:500]}, url, key, client)


def send_weather(rows: list[WeatherRecord], url: str, key: str, client: httpx.Client | None = None) -> Any:
    """Clima por partido, en una función aparte de `load_batch` (se carga después del lote)."""
    return _rpc("load_weather", {"p_rows": [_dump(r) for r in rows]}, url, key, client)


def build_extras(
    games: list[ParsedGame],
    *,
    standings: list[Any],
    leaders: list[Any],
    league_results: list[Any],
    ratings: list[Any],
    club_stats: list[Any],
    profiles: list[Any],
) -> dict[str, Any]:
    """Lote de `ingest.load_extras`: bajas y momentum de los partidos, y datos de liga y perfiles."""
    return {
        "match_ids": [g.match.source_id for g in games],
        "absences": [_dump(a) for g in games for a in g.absences],
        "momentum": [_dump(m) for g in games for m in g.momentum],
        "standings": [_dump(r) for r in standings],
        "leaders": [_dump(r) for r in leaders],
        "league_results": [_dump(r) for r in league_results],
        "ratings": [_dump(r) for r in ratings],
        "club_stats": [_dump(r) for r in club_stats],
        "profiles": [_dump(r) for r in profiles],
    }


def send_extras(extras: dict[str, Any], url: str, key: str, client: httpx.Client | None = None) -> Any:
    return _rpc("load_extras", {"p_extras": extras}, url, key, client)


def send_competition_metrics(rows: list[Any], url: str, key: str, client: httpx.Client | None = None) -> Any:
    return _rpc("load_competition_metrics", {"p_rows": [_dump(r) for r in rows]}, url, key, client)


def send_player_foot(
    rows: list[dict[str, str]], url: str, key: str, client: httpx.Client | None = None
) -> Any:
    return _rpc("load_player_foot", {"p_rows": rows}, url, key, client)


def send_player_stats(
    rows: list[dict[str, Any]], url: str, key: str, client: httpx.Client | None = None, chunk: int = 5000
) -> int:
    """Estadísticas por jugador en bloques (después de `load_batch`, que borra las del partido)."""
    # Primero se borran solo los pares (partido, fuente) que llegan: una fuente que falló en esta
    # corrida conserva sus datos anteriores.
    pairs = sorted({(r.get("match_source_id"), r.get("source")) for r in rows})
    _rpc(
        "clear_player_stats",
        {"p_pairs": [{"match_source_id": m, "source": s} for m, s in pairs]},
        url,
        key,
        client,
    )
    total = 0
    for start in range(0, len(rows), chunk):
        total += int(
            _rpc("load_player_stats", {"p_rows": rows[start : start + chunk]}, url, key, client) or 0
        )
    return total
