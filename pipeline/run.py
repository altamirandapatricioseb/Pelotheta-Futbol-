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
import os
import sys
import uuid
from collections import deque
from datetime import datetime
from pathlib import Path

from pipeline import load
from sources import promiedos as pd
from sources.http_client import ROOT, FetchError, PoliteClient, RetryableFetchError

SEASON_YEAR = 2026
LEAGUE_PATH = "/league/liga-profesional/hc"
MAX_TEAM_PAGES = 80  # tope de seguridad: nunca más de ~4 minutos de requests de equipos
MAX_GAME_PAGES = 120


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
    return os.environ.get("SUPABASE_SECRET_KEY") or os.environ.get("API_SUPABASE_SECRET_KEY", "")


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


def crawl(client: PoliteClient, season_year: int) -> tuple[list[pd.ParsedGame], list, list, list[str]]:
    """Devuelve (partidos, jugadores del plantel, plantel, avisos)."""
    warnings: list[str] = []
    boca = pd.next_data(client.get(pd.BASE_URL + pd.BOCA_TEAM_PATH, use_cache=False).text())["data"]
    players, squad = pd.parse_squad(boca)

    pending: deque[pd.GameRef] = deque(pd.boca_game_refs(boca, season_year))
    team_queue: deque[str] = deque()
    try:
        league = pd.next_data(client.get(pd.BASE_URL + LEAGUE_PATH, use_cache=False).text())["data"]
        team_queue.extend(league_team_paths(league))
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
            except (FetchError, RetryableFetchError, ValueError, KeyError) as exc:
                warnings.append(f"Equipo {path}: {exc}")
    print(
        f"Páginas leídas: {team_pages} de equipos, {game_pages} de partidos. "
        f"Partidos cargables: {len(games)}."
    )
    games.sort(key=lambda g: g.match.kickoff_at)
    return games, players, squad, warnings


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Pipeline de Pelotheta: Promiedos -> Supabase")
    parser.add_argument("--dry-run", action="store_true", help="no carga en Supabase")
    args = parser.parse_args(argv)
    load_dotenv()
    url, key = os.environ.get("SUPABASE_URL", ""), secret_key()
    run_id = str(uuid.uuid4())
    started = datetime.now()
    try:
        with PoliteClient(source=pd.SOURCE) as client:
            games, players, squad, warnings = crawl(client, SEASON_YEAR)
    except (FetchError, RetryableFetchError, ValueError, KeyError) as exc:
        message = f"Fallo del scraping: {exc}"
        print(message, file=sys.stderr)
        if not args.dry_run:
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
    if args.dry_run:
        print(
            f"Dry run: {len(batch['matches'])} partidos, {len(batch['lineups'])} alineaciones, "
            f"{len(batch['events'])} eventos. No se cargó nada."
        )
        return 0
    result = load.send_batch(batch, url, key)
    seconds = (datetime.now() - started).total_seconds()
    print(f"Carga {status} en {seconds:.0f} s: {result}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
