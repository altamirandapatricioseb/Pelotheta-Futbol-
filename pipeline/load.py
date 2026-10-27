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
    if not SUPABASE_URL_RE.match(url):
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


def send_batch(batch: dict[str, Any], url: str, key: str, client: httpx.Client | None = None) -> Any:
    return _rpc("load_batch", {"p_batch": batch}, url, key, client)


def log_failure(source: str, message: str, url: str, key: str, client: httpx.Client | None = None) -> None:
    _rpc("log_failure", {"p_source": source, "p_message": message[:500]}, url, key, client)


def send_weather(rows: list[WeatherRecord], url: str, key: str, client: httpx.Client | None = None) -> Any:
    """Clima por partido, en una función aparte de `load_batch` (se carga después del lote)."""
    return _rpc("load_weather", {"p_rows": [_dump(r) for r in rows]}, url, key, client)
