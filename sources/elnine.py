"""Adaptador de ELNINE (elnine.com.ar): DT de cada equipo, estadio y capacidad de cada partido.

Por qué esta fuente: la sugirió el dueño (2-nov-2026). Su robots.txt permite rastrear todo el sitio
(«User-agent: * Allow: /», con «ai-train=no»: acá no se entrena ningún modelo) y las páginas de
partido responden al User-Agent identificado del pipeline sin desafíos. Se piden solo dos páginas
por partido de Boca, con la pausa de PoliteClient.

Qué se toma: el DT de Boca y el del rival, el estadio con su capacidad, el árbitro y las
formaciones. Lo nuevo para el sistema es el DT por partido y la capacidad; árbitro y formación
sirven para validar contra Promiedos (regla 8b: una segunda fuente valida, no reemplaza).

Bloqueo: desde el 2-nov-2026 Cloudflare responde con un desafío («Just a moment...») a clientes
HTTP automáticos como el del pipeline. No se evade (sin imitar navegadores ni huellas TLS): si
aparece el desafío, la corrida lo registra como aviso y sigue sin esta fuente.

Cómo: la portada acepta `?d=AAAA-MM-DD` y lista los partidos de ese día con su id; se busca el de
Boca por el id de equipo y se lee la página del partido. Los datos vienen en el payload de Next.js
(JSON escapado dentro de la página), no en el HTML visible.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone

SOURCE = "elnine"
BASE_URL = "https://elnine.com.ar"
BOCA_TEAM_ID = "pHrfj0cwD8"
AR_TZ = timezone(timedelta(hours=-3))

DAY_MATCH_RE = re.compile(
    r'"id":"(?P<id>[A-Za-z0-9_-]{6,20})","homeTeam":\{"id":"(?P<home>[A-Za-z0-9_-]+)","name":"(?P<home_name>[^"]+)"'
    r'[^}]*\},"awayTeam":\{"id":"(?P<away>[A-Za-z0-9_-]+)","name":"(?P<away_name>[^"]+)"[^}]*\}'
    r'.{0,400}?"startTime":"(?P<start>[^"]+)"'
)


@dataclass(frozen=True)
class DayMatch:
    match_id: str
    home_id: str
    away_id: str
    home_name: str
    away_name: str
    start: datetime

    @property
    def boca_home(self) -> bool:
        return self.home_id == BOCA_TEAM_ID

    @property
    def path(self) -> str:
        return f"/partido/{self.match_id}"


class ChallengeError(RuntimeError):
    """Cloudflare pidió un desafío de navegador: la fuente no está disponible para el pipeline."""


def check_challenge(html: str) -> str:
    if "<title>Just a moment...</title>" in html[:2000] or "cf-chl" in html[:5000]:
        raise ChallengeError("ELNINE pide un desafío de Cloudflare a clientes automáticos; no se evade")
    return html


def day_path(day: date) -> str:
    return f"/?d={day.isoformat()}"


def _unescape(html: str) -> str:
    return html.replace('\\"', '"')


def parse_day(html: str) -> list[DayMatch]:
    """Partidos que lista la portada para un día (sin repetir)."""
    out: dict[str, DayMatch] = {}
    for m in DAY_MATCH_RE.finditer(_unescape(html)):
        try:
            start = datetime.fromisoformat(m["start"].replace("Z", "+00:00"))
        except ValueError:
            continue
        out.setdefault(
            m["id"], DayMatch(m["id"], m["home"], m["away"], m["home_name"], m["away_name"], start)
        )
    return list(out.values())


def boca_match(matches: list[DayMatch], day: date) -> DayMatch | None:
    """El partido de Boca de ese día (hora argentina). La portada también lista los de hoy."""
    return next(
        (
            m
            for m in matches
            if BOCA_TEAM_ID in (m.home_id, m.away_id) and m.start.astimezone(AR_TZ).date() == day
        ),
        None,
    )


def _value(text: str, key: str) -> object:
    """Primer valor JSON simple (texto, número o null) de una clave."""
    m = re.search(rf'"{key}":("(?:[^"\\]|\\.)*"|-?\d+(?:\.\d+)?|null)', text)
    return json.loads(m.group(1)) if m else None


def _lineup(text: str, side: str) -> tuple[str | None, str | None]:
    """Formación y nombre del DT de un lado ("home" o "away")."""
    start = text.find(f'"{side}Lineup":{{')
    if start < 0:
        return None, None
    chunk = text[start : start + 3000]
    formation = _value(chunk, "formation")
    coach_at = chunk.find('"coach":{')
    coach = _value(chunk[coach_at:], "nameFull") if coach_at >= 0 else None
    return (
        str(formation) if isinstance(formation, str) and formation else None,
        str(coach) if isinstance(coach, str) and coach else None,
    )


def parse_match(html: str) -> dict[str, object]:
    """Estadio, capacidad, árbitro y, de cada lado, formación y DT."""
    text = _unescape(html)
    capacity = _value(text, "capacity")
    home_formation, home_coach = _lineup(text, "home")
    away_formation, away_coach = _lineup(text, "away")
    stadium = _value(text, "stadium")
    referee = _value(text, "referee")
    return {
        "stadium": stadium if isinstance(stadium, str) and stadium else None,
        "capacity": capacity if isinstance(capacity, int) and 0 < capacity <= 200_000 else None,
        "referee": referee if isinstance(referee, str) and referee else None,
        "home_formation": home_formation,
        "away_formation": away_formation,
        "home_coach": home_coach,
        "away_coach": away_coach,
    }
