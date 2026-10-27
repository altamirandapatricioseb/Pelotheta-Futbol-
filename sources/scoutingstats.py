"""Adaptador de ScoutingStats (estadísticas avanzadas por partido, de equipo y de jugador).

Por qué esta fuente: es la única revisada que publica, gratis y en HTML público, estadísticas
por jugador y partido de Boca 2026 (calificación, pases, pases clave, entradas, intercepciones,
duelos y regates) y métricas de equipo que no trae nadie más (xG al arco, xG de jugada y de
pelota parada, ocasiones claras, puntos esperados, pases largos, centros). Sus términos no
prohíben el acceso automatizado y su robots.txt permite las páginas de partido; las páginas de
jugador están detrás de un desafío de Cloudflare y NO se piden (no se evade ninguna protección).
Los datos son de Sportmonks. Ver docs/source_audit.md (tercera ronda).

Qué se toma: solo números por partido para calcular estadísticas propias. No se republican sus
textos, previas ni predicciones, y la web cita «ScoutingStats (datos de Sportmonks)».
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import UTC, date, datetime, timedelta, timezone

from bs4 import BeautifulSoup, Tag

SOURCE = "scoutingstats"
BASE_URL = "https://scoutingstats.ai"
BOCA_MATCHES_PATH = "/clubs/587/boca-juniors/matches"
BOCA_ID = 587
AR_TZ = timezone(timedelta(hours=-3))

MATCH_LINK_RE = re.compile(r'href="/match/(\d+)\?from=club-hub"')
CREST_ID_RE = re.compile(r"/teams/\d+/(\d+)\.png")
FORMATION_RE = re.compile(r"\d(?:-\d){2,4}")
# Estados de un partido terminado: en 90 minutos, con alargue o definido por penales.
FINISHED_RE = re.compile(r"(Full time|After extra time|Penalties\b)")

# Etiqueta en la página del partido -> clave interna (misma convención que Promiedos).
TEAM_STAT_LABELS = {
    "Expected goals (xG)": "xg",
    "xG on target": "xgot",
    "Non-penalty xG": "npxg",
    "xG open play": "xg_open_play",
    "xG set pieces": "xg_set_pieces",
    "Expected points": "expected_points",
    "Big chances": "big_chances",
    "Big chances missed": "big_chances_missed",
    "Shots": "shots_total",
    "On target": "shots_on_target",
    "Off target": "shots_off_target",
    "Blocked": "shots_blocked",
    "Inside the box": "shots_inside_box",
    "Outside the box": "shots_outside_box",
    "Attacks": "attacks",
    "Dangerous attacks": "dangerous_attacks",
    "Key passes": "key_passes",
    "Crosses": "crosses",
    "Accurate crosses": "crosses_accurate",
    "Dribbles": "dribbles",
    "Successful dribbles": "dribbles_successful",
    "Offsides": "offsides",
    "Passes": "passes",
    "Accurate passes": "passes_accurate",
    "Pass accuracy": "pass_accuracy_pct",
    "Long passes": "long_passes",
    "Accurate long passes": "long_passes_accurate",
    "Long pass accuracy": "long_pass_accuracy_pct",
    "Tackles": "tackles",
    "Interceptions": "interceptions",
    "Duels won": "duels_won",
    "Saves": "saves",
    "Fouls": "fouls",
    "Yellow cards": "yellow_cards",
    "Free kicks": "free_kicks",
    "Corners": "corners",
    "Possession": "possession_pct",
}

# Atributo data-* de la fila del jugador -> clave interna. Minutos, goles y asistencias no se
# toman: los calcula Promiedos a partir de las alineaciones y los eventos.
PLAYER_STAT_ATTRS = {
    "data-r": "rating",
    "data-sh": "shots_total",
    "data-kp": "key_passes",
    "data-ps": "passes",
    "data-tk": "tackles",
    "data-in": "interceptions",
    "data-du": "duels_won",
    "data-dr": "dribbles_successful",
}


@dataclass(frozen=True)
class PlayerLine:
    name: str
    position: str | None
    stats: dict[str, float]


@dataclass
class ParsedMatch:
    kickoff_utc: datetime
    boca_home: bool
    team_stats: dict[str, tuple[float, float]]
    formations: tuple[str, str] | None
    boca_players: list[PlayerLine] = field(default_factory=list)

    @property
    def local_date(self) -> date:
        return self.kickoff_utc.astimezone(AR_TZ).date()


def match_ids(club_html: str) -> list[int]:
    """Ids de los partidos listados en la página de partidos del club, sin repetir."""
    return list(dict.fromkeys(int(i) for i in MATCH_LINK_RE.findall(club_html)))


def _number(text: str) -> float | None:
    try:
        return float(text.replace("%", "").replace(",", ".").strip())
    except ValueError:
        return None


def _crest_id(node: Tag | None) -> int | None:
    img = node.find("img") if node else None
    match = CREST_ID_RE.search(str(img.get("src", ""))) if isinstance(img, Tag) else None
    return int(match.group(1)) if match else None


def _team_stats(soup: BeautifulSoup) -> dict[str, tuple[float, float]]:
    stats: dict[str, tuple[float, float]] = {}
    for row in soup.select("div.mr8-sr-top"):
        label, home, away = row.select_one("span.l"), row.select_one("span.v.h"), row.select_one("span.v.a")
        if not (label and home and away):
            continue
        key = TEAM_STAT_LABELS.get(label.get_text(strip=True))
        h, a = _number(home.get_text()), _number(away.get_text())
        if key and h is not None and a is not None and key not in stats:
            stats[key] = (h, a)
    return stats


def _formations(soup: BeautifulSoup) -> tuple[str, str] | None:
    head = soup.select_one("div.mr8-lu-head")
    if head is None:
        return None
    home, away = head.select_one("span.h i"), head.select_one("span.a i")
    if not (home and away):
        return None
    pair = (home.get_text(strip=True), away.get_text(strip=True))
    return pair if all(FORMATION_RE.fullmatch(f) for f in pair) else None


def _player_line(row: Tag) -> PlayerLine:
    stats: dict[str, float] = {}
    for attr, key in PLAYER_STAT_ATTRS.items():
        value = _number(str(row.get(attr, "")))
        if value is not None:
            stats[key] = value
    # Remates al arco y precisión de pase solo están en el texto de la celda: «3 (1)», «28 86%».
    cells = row.find_all("td")
    if len(cells) >= 8:
        on_target = re.search(r"\((\d+)\)", cells[5].get_text())
        if on_target:
            stats["shots_on_target"] = float(on_target.group(1))
        accuracy = re.search(r"(\d+)%", cells[7].get_text())
        if accuracy:
            stats["pass_accuracy_pct"] = float(accuracy.group(1))
        xg = _number(cells[4].get_text())  # «–» cuando la fuente no tiene xG por jugador
        if xg is not None:
            stats["xg"] = xg
    position = row.select_one("span.ps")
    return PlayerLine(
        name=str(row.get("data-name", "")).strip(),
        position=position.get_text(strip=True) if position else None,
        stats=stats,
    )


def _boca_side(soup: BeautifulSoup) -> str | None:
    """'h' o 'a' según el lado de Boca, por el escudo. None si Boca no jugó el partido.

    Primero el bloque de alineaciones; algunos partidos no lo traen y entonces se usa el escudo
    de las filas de la tabla de jugadores.
    """
    head = soup.select_one("div.mr8-lu-head")
    if head is not None:
        for side in ("h", "a"):
            if _crest_id(head.select_one(f"span.{side}")) == BOCA_ID:
                return side
    for row in soup.select("table.mr8-rt tr[data-side]"):
        if _crest_id(row.select_one("th")) == BOCA_ID and row.get("data-side") in ("h", "a"):
            return str(row["data-side"])
    return None


def parse_match(html: str) -> ParsedMatch | None:
    """Datos de un partido terminado de Boca. None si el partido no terminó o no es de Boca."""
    soup = BeautifulSoup(html, "html.parser")
    state = soup.select_one("div.mr8-state")
    when = soup.select_one("time[datetime]")
    if state is None or not FINISHED_RE.match(state.get_text(strip=True)) or when is None:
        return None
    boca_side = _boca_side(soup)
    if boca_side is None:
        return None
    kickoff = datetime.fromisoformat(str(when["datetime"]).replace("Z", "+00:00")).astimezone(UTC)
    players = [
        _player_line(row)
        for row in soup.select("table.mr8-rt tr[data-side]")
        if row.get("data-side") == boca_side and row.get("data-name")
    ]
    return ParsedMatch(
        kickoff_utc=kickoff,
        boca_home=boca_side == "h",
        team_stats=_team_stats(soup),
        formations=_formations(soup),
        boca_players=players,
    )
