"""Datos y funciones compartidas de los notebooks (16.3 y 16.4).

Leen la API pública de solo lectura (la misma de /api-docs) con la clave publicable, así corren en
CI sin secretos. Las fórmulas son las del pipeline (pipeline.metrics): los notebooks validan lo que
publica el sitio, no una copia.
"""

from __future__ import annotations

import math
import os
import sys
from pathlib import Path

import httpx

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from pipeline import metrics as m  # noqa: E402

URL = os.environ.get("SUPABASE_URL") or "https://ymnbuywcpkynikudybth.supabase.co"
# Clave publicable: pública por diseño (solo lectura con RLS), la misma que muestra /api-docs.
KEY = os.environ.get("SUPABASE_PUBLISHABLE_KEY") or "sb_publishable_Fyd88fp5p4sEXCFDNPXysQ_1uCtQUnm"
RESULTS = ("G", "E", "P")


def api(view: str, select: str = "*", **filters: str) -> list[dict]:
    """Todas las filas de una vista de api, de a 1000 (el tope de la Data API)."""
    rows: list[dict] = []
    headers = {"apikey": KEY, "Accept-Profile": "api"}
    with httpx.Client(timeout=60, headers=headers) as client:
        while True:
            params = {"select": select, "limit": "1000", "offset": str(len(rows)), **filters}
            page = client.get(f"{URL}/rest/v1/{view}", params=params).raise_for_status().json()
            rows += page
            if len(page) < 1000:
                return rows


def league_games(season: int = 2026, source: str = "strikerapi") -> list[m.Game]:
    """Partidos de la liga en orden de fecha (una sola fuente para no duplicar)."""
    rows = api(
        "league_result",
        "match_date,home_team,away_team,home_goals,away_goals",
        season=f"eq.{season}",
        source=f"eq.{source}",
        order="match_date",
    )
    return [
        m.Game(r["match_date"], r["home_team"], r["away_team"], r["home_goals"], r["away_goals"])
        for r in rows
        if r["home_goals"] is not None and r["away_goals"] is not None
    ]


def result(g: m.Game) -> str:
    """Resultado desde el local: G, E o P."""
    return "G" if g.home_goals > g.away_goals else "E" if g.home_goals == g.away_goals else "P"


def log_loss(probabilities: tuple[float, float, float], outcome: str) -> float:
    return -math.log(max(probabilities[RESULTS.index(outcome)], 1e-12))


def elo_probabilities(
    games: list[m.Game], k: float, v: float, draw_rate: float
) -> list[tuple[float, float, float]]:
    """Probabilidad pre-partido (G, E, P del local) con el Elo del pipeline, sin datos del futuro."""
    return [
        m.outcome_probabilities(m.elo_expected(home, away, v), draw_rate)
        for home, away in m.elo_run(games, k, v)
    ]
