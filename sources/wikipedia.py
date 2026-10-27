"""Adaptador de Wikipedia en español: perfil público de los jugadores del plantel.

Por qué esta fuente: Promiedos no publica nacionalidad, peso ni club formador, y ninguna otra
fuente permitida los trae. Wikipedia permite leer sus artículos (robots.txt solo cierra páginas
especiales y la API) y su contenido es CC BY-SA: la web cita «Wikipedia» con enlace. Se toma lo
mínimo (Ley 25.326): nacionalidad, peso, club formador y nivel de selección; nada de vida privada.

Dónde está cada dato:
- El artículo del club arma el plantel con la plantilla «Jugador de fútbol»; su JSON (Parsoid)
  queda en el HTML y trae nacionalidad (código FIFA), club formador y selección.
- La ficha de cada jugador (infobox) trae el peso.
"""

from __future__ import annotations

import html as html_lib
import json
import re
from dataclasses import dataclass

SOURCE = "wikipedia"
BASE_URL = "https://es.wikipedia.org"
CLUB_PATH = "/wiki/Club_Atl%C3%A9tico_Boca_Juniors"

TEMPLATE_RE = re.compile(
    r'\{"template":\{"target":\{"wt":"Jugador de fútbol"[^{}]*\},"params":(\{.*?\}\}),"i":\d+\}\}'
)
LINK_RE = re.compile(r"\[\[([^\]|]+)(?:\|([^\]]+))?\]\]")
WEIGHT_RE = re.compile(r"<th[^>]*>\s*Peso\s*</th>\s*<td[^>]*>(.*?)</td>", re.S)
KG_RE = re.compile(r"(\d{2,3})(?:[.,](\d))?\s*kg")
NATIONALITY_RE = re.compile(r"^[A-Z]{3}$")


@dataclass(frozen=True)
class SquadEntry:
    name: str
    article: str
    nationality: str | None
    youth_club: str | None
    academy: bool
    national_team: str | None


def _wikitext(params: dict[str, dict[str, str]], key: str) -> str:
    return str((params.get(key) or {}).get("wt") or "")


def _last_link(text: str) -> tuple[str, str] | None:
    """Último enlace [[Artículo|Texto]] de un valor (el primero suele ser la bandera)."""
    links = LINK_RE.findall(text)
    if not links:
        return None
    article, label = links[-1]
    return article.strip(), (label or article).strip()


def parse_squad(page_html: str) -> list[SquadEntry]:
    """Jugadores del plantel desde la plantilla «Jugador de fútbol» del artículo del club."""
    entries = []
    for raw in TEMPLATE_RE.findall(html_lib.unescape(page_html)):
        try:
            params = json.loads(raw)
        except ValueError:
            continue
        name_link = _last_link(_wikitext(params, "nombre"))
        if name_link is None:
            continue
        article, name = name_link
        nationality = _wikitext(params, "nac").strip().upper()
        youth = _last_link(_wikitext(params, "formativo"))
        national = _last_link(_wikitext(params, "internacional"))
        entries.append(
            SquadEntry(
                name=name,
                article=article,
                nationality=nationality if NATIONALITY_RE.match(nationality) else None,
                youth_club=youth[1] if youth else None,
                academy=bool(youth and "Boca Juniors" in youth[0]),
                national_team=national[1] if national else None,
            )
        )
    return entries


def article_path(article: str) -> str:
    return "/wiki/" + article.replace(" ", "_")


def parse_weight(page_html: str) -> float | None:
    """Peso en kg de la ficha del jugador, o None si la ficha no lo trae."""
    cell = WEIGHT_RE.search(page_html)
    if cell is None:
        return None
    match = KG_RE.search(re.sub(r"<[^>]+>", " ", cell.group(1)))
    if match is None:
        return None
    return float(f"{match.group(1)}.{match.group(2) or 0}")
