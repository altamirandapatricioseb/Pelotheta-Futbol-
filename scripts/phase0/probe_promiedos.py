"""Sonda de Fase 0 para Promiedos (promiedos.com.ar).

Qué hace y por qué:

- Promiedos publica en HTML (Next.js con `__NEXT_DATA__` renderizado en el servidor) la tabla,
  el plantel con fecha de nacimiento y altura, y por partido: alineaciones con formación,
  eventos con minuto (goles, tarjetas, cambios), estadísticas por equipo, árbitro y estadio.
- No tiene robots.txt (404): por el estándar RFC 9309 se asume permitido. Igual se respeta la
  pausa de 3 s, el User-Agent identificable y la caché.
- Solo se leen páginas públicas HTML; no se usa `api.promiedos.com.ar` (endpoints internos).
- Se describe la FORMA de los datos (rutas de campos), no los datos.

Uso (desde la raíz del repo):
    uv run python -m scripts.phase0.probe_promiedos
"""

from __future__ import annotations

import json
import re
from datetime import UTC, datetime
from typing import Any

from scripts.phase0.common import json_paths, write_report
from sources.http_client import ROOT, FetchError, PoliteClient, RetryableFetchError

SOURCE = "promiedos"
BASE_URL = "https://www.promiedos.com.ar"
TEAM_PATH = "/team/boca-juniors/igg"
LEAGUE_PATH = "/league/liga-profesional/hc"
NEXT_DATA_RE = re.compile(r'<script id="__NEXT_DATA__"[^>]*>(.*?)</script>', re.S)


def next_data(html: str) -> dict[str, Any]:
    """Extrae el JSON de `__NEXT_DATA__` de una página de Promiedos."""
    match = NEXT_DATA_RE.search(html)
    if match is None:
        raise ValueError("La página no trae __NEXT_DATA__")
    data: dict[str, Any] = json.loads(match.group(1))
    return data


def played_game_path(team_data: dict[str, Any]) -> str | None:
    """Ruta del último partido finalizado de Boca según la página del equipo."""
    for row in team_data.get("games", {}).get("last", {}).get("rows", []):
        game = row.get("game", {})
        if game.get("status", {}).get("enum") == 3:
            return f"/game/{game['url_name']}/{game['id']}"
    return None


def main() -> int:
    report: dict[str, Any] = {
        "source": SOURCE,
        "generated_at": datetime.now(UTC).isoformat(timespec="seconds"),
        "base_url": BASE_URL,
        "robots_txt": "404: sin robots.txt, permitido por RFC 9309",
        "terminos": "Página /legal sin texto en el HTML del servidor; atribución visible a Opta",
        "http_results": [],
        "pages": {},
    }
    status = "funciona"
    with PoliteClient(source=SOURCE) as client:
        try:
            league = client.get(f"{BASE_URL}{LEAGUE_PATH}")
            league_data = next_data(league.text())["props"]["pageProps"]["data"]
            report["pages"]["league"] = {"url": league.url, "fields": json_paths(league_data, max_depth=4)}

            team = client.get(f"{BASE_URL}{TEAM_PATH}")
            team_data = next_data(team.text())["props"]["pageProps"]["data"]
            report["pages"]["team"] = {
                "url": team.url,
                "fields": json_paths(team_data, max_depth=4),
                "partidos_jugados_listados": len(team_data["games"]["last"]["rows"]),
                "partidos_proximos_listados": len(team_data["games"]["next"]["rows"]),
            }

            game_path = played_game_path(team_data)
            if game_path is None:
                status = "funciona_parcial"
            else:
                game = client.get(f"{BASE_URL}{game_path}")
                game_data = next_data(game.text())["props"]["pageProps"]["initialData"]["game"]
                event_types = sorted(
                    {
                        event["type"]
                        for stage in game_data.get("events", [])
                        for row in stage.get("rows", [])
                        for event in row.get("events", [])
                    }
                )
                report["pages"]["game"] = {
                    "url": game.url,
                    "fields": json_paths(game_data, max_depth=5),
                    "estadisticas_equipo": [s["name"] for s in game_data.get("statistics", [])],
                    "tipos_de_evento": event_types,
                }
            for page in (league, team):
                report["http_results"].append(
                    {"url": page.url, "status": page.status, "from_cache": page.from_cache}
                )
        except (FetchError, RetryableFetchError, ValueError, KeyError) as exc:
            report["http_results"].append({"url": "-", "status": 0, "note": str(exc)[:200]})
            status = "error"
    report["access_status"] = status
    path = write_report(SOURCE, report)
    print(f"[{SOURCE}] {status}. Informe: {path.relative_to(ROOT).as_posix()}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
