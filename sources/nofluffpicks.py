"""Adaptador de NoFluffPicks (xG por partido de la Liga Profesional).

Por qué esta fuente: es la única revisada que publica goles esperados (xG) por partido de la
Liga Profesional 2026 y cuyos términos permiten leer el sitio de forma automatizada (prohíben
republicar partes sustanciales, quitar la atribución y saltear controles de acceso; ver
docs/security/compliance_register.md). Sus datos de partido provienen de FootyStats.

Qué se toma: solo números por partido y equipo (xG, ataques peligrosos) para calcular
estadísticas propias (xG por remate, goles − xG, puntos esperados). No se republican sus
textos ni sus tablas, y la web cita «NoFluffPicks (datos de FootyStats)».
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta, timezone

from bs4 import BeautifulSoup

SOURCE = "nofluffpicks"
BASE_URL = "https://nofluffpicks.com"
LEAGUE_PATH = "/argentina/primera-division"
BOCA_ID = 705
AR_TZ = timezone(timedelta(hours=-3))

# Cada partido de la liga viene como objeto JSON dentro del payload de Next.js. Se buscan los
# objetos que empiezan con "matchId" y terminan en "over25Potential" (la forma observada en la
# Fase 0) en lugar de interpretar todo el payload, que no es JSON válido por sí solo.
FIXTURE_RE = re.compile(r'\{"matchId":\d+,.*?"over25Potential":[\d.]+\}')

# Etiqueta en la página del partido -> clave interna (misma convención que Promiedos).
STAT_LABELS = {
    "xG": "xg",
    "Dangerous attacks": "dangerous_attacks",
    "Possession (%)": "possession_pct",
    "Shots": "shots_total",
    "Shots on target": "shots_on_target",
    "Corners": "corners",
    "Fouls": "fouls",
}


@dataclass(frozen=True)
class Fixture:
    match_id: int
    slug: str
    kickoff_utc: datetime
    complete: bool
    home_id: int
    away_id: int
    home_goals: int | None
    away_goals: int | None

    @property
    def local_date(self) -> date:
        return self.kickoff_utc.astimezone(AR_TZ).date()

    @property
    def path(self) -> str:
        return f"/match/{self.slug}"


def parse_fixtures(html: str) -> list[Fixture]:
    """Partidos de la liga a partir del payload de la página de la competición."""
    unescaped = html.replace('\\"', '"')
    fixtures: dict[int, Fixture] = {}
    for raw in FIXTURE_RE.findall(unescaped):
        try:
            data = json.loads(raw)
            kickoff = datetime.fromisoformat(data["iso"].replace("Z", "+00:00")).astimezone(UTC)
            fixture = Fixture(
                match_id=int(data["matchId"]),
                slug=str(data["slug"]),
                kickoff_utc=kickoff,
                complete=data.get("status") == "complete" and bool(data.get("hasMatchPage", True)),
                home_id=int(data["homeId"]),
                away_id=int(data["awayId"]),
                home_goals=data.get("homeGoals"),
                away_goals=data.get("awayGoals"),
            )
        except (ValueError, KeyError, TypeError):
            continue  # un objeto con otra forma no corta la carga del resto
        if re.fullmatch(r"[a-z0-9-]+", fixture.slug):
            fixtures.setdefault(fixture.match_id, fixture)
    return list(fixtures.values())


def boca_fixtures(fixtures: list[Fixture]) -> list[Fixture]:
    return [f for f in fixtures if f.complete and BOCA_ID in (f.home_id, f.away_id)]


def _number(text: str) -> float | None:
    try:
        return float(text.replace("%", "").replace(",", ".").strip())
    except ValueError:
        return None


def parse_game_stats(html: str) -> dict[str, tuple[float, float]]:
    """Estadísticas del partido: {clave: (local, visitante)}. Vacío si el partido no tiene datos."""
    soup = BeautifulSoup(html, "html.parser")
    stats: dict[str, tuple[float, float]] = {}
    for row in soup.select("div.py-3 > div"):
        spans = row.find_all("span", recursive=False)
        if len(spans) != 3:
            continue
        key = STAT_LABELS.get(spans[1].get_text(strip=True))
        home, away = _number(spans[0].get_text()), _number(spans[2].get_text())
        if key and home is not None and away is not None and key not in stats:
            stats[key] = (home, away)
    return stats
