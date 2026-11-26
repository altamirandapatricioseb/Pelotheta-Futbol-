"""Temporadas de liga en Wikipedia en español (etapa 5j-7): resultados fecha por fecha.

Por qué esta fuente: Bolivia no está en Promiedos, Bzzoiro ni ScoutingStats, y la API de la FBF
publica muy pocos partidos de primera. El artículo de cada temporada en Wikipedia trae una tabla por
fecha (local, resultado, visitante, estadio, día y hora). Se lee el wikitexto con
`/wiki/<título>?action=raw`, que robots.txt permite; el contenido es CC BY-SA y se cita «Wikipedia».
Sirve igual para temporadas pasadas (etapa 9).
"""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass
from datetime import date

SOURCE = "wikipedia"
BASE_URL = "https://es.wikipedia.org"

MONTHS = {
    "enero": 1, "febrero": 2, "marzo": 3, "abril": 4, "mayo": 5, "junio": 6, "julio": 7,
    "agosto": 8, "septiembre": 9, "setiembre": 9, "octubre": 10, "noviembre": 11, "diciembre": 12,
}  # fmt: skip
TABLE_RE = re.compile(r"^\{\|(.*?)^\|\}", re.S | re.M)
ROUND_RE = re.compile(r"\bFecha\s+(\d+)\b")
SCORE_RE = re.compile(r"^(\d+)\s*[-–—:]\s*(\d+)")
DATE_RE = re.compile(r"(\d{1,2})\s+de\s+([a-záéíóú]+)(?:\s+de\s+(\d{4}))?", re.I)
ROWSPAN_RE = re.compile(r"rowspan\s*=\s*\"?(\d+)", re.I)


@dataclass(frozen=True)
class WikiGame:
    round: int | None
    match_date: date
    home_team: str
    away_team: str
    home_goals: int
    away_goals: int
    venue: str | None


def _norm(text: str) -> str:
    plain = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode()
    return re.sub(r"\s+", " ", plain).strip().lower()


def _split_top(text: str, sep: str) -> list[str]:
    """Parte en `sep` fuera de [[…]] y {{…}} (los separadores internos son de enlaces y plantillas)."""
    parts, depth, start, i = [], 0, 0, 0
    while i < len(text):
        two = text[i : i + 2]
        if two in ("[[", "{{"):
            depth, i = depth + 1, i + 2
            continue
        if two in ("]]", "}}"):
            depth, i = max(depth - 1, 0), i + 2
            continue
        if depth == 0 and text.startswith(sep, i):
            parts.append(text[start:i])
            i += len(sep)
            start = i
            continue
        i += 1
    parts.append(text[start:])
    return parts


def clean(text: str) -> str:
    """Texto visible de una celda de wikitexto."""
    text = re.sub(r"<ref[^>]*/>|<ref[^>]*>.*?</ref>", "", text, flags=re.S)
    text = re.sub(r"\{\{(?:nowrap|small|nobr)\|([^{}]*)\}\}", r"\1", text, flags=re.I)
    while "{{" in text and (stripped := re.sub(r"\{\{[^{}]*\}\}", "", text)) != text:
        text = stripped
    text = re.sub(r"\[\[(?:Archivo|File|Imagen|Image):[^\]]*\]\]", "", text, flags=re.I)
    text = re.sub(r"\[\[(?:[^\]|]*\|)?([^\]]*)\]\]", r"\1", text)
    text = re.sub(r"\[https?://\S+\s+([^\]]*)\]", r"\1", text)  # [url 1 – 2] → 1 – 2
    text = re.sub(r"<[^>]+>|'{2,}", "", text)
    return re.sub(r"\s+", " ", text).strip()


def _cell(raw: str) -> tuple[str, int]:
    """(texto, rowspan) de una celda: lo que va antes del primer «|» suelto son atributos."""
    parts = _split_top(raw, "|")
    attrs, content = (parts[0], "|".join(parts[1:])) if len(parts) > 1 and "=" in parts[0] else ("", raw)
    span = ROWSPAN_RE.search(attrs)
    return clean(content), int(span.group(1)) if span else 1


def table_rows(body: str) -> tuple[list[str], list[list[str]]]:
    """Encabezados (todas las celdas «!») y filas de datos con los rowspan ya repartidos."""
    headers: list[str] = []
    rows: list[list[str]] = []
    carry: dict[int, tuple[int, str]] = {}  # columna → (filas que faltan, valor)
    for chunk in re.split(r"^\|-.*$", body, flags=re.M):
        cells: list[tuple[str, int]] = []
        is_header = False
        for line in chunk.splitlines():
            if line.startswith("!"):
                is_header = True
                cells += [_cell(c) for c in _split_top(line[1:], "!!")]
            elif line.startswith("|") and not line.startswith(("|+", "|}")):
                cells += [_cell(c) for c in _split_top(line[1:], "||")]
        if not cells:
            continue
        if is_header:
            headers += [c for c, _ in cells]
            continue
        row: list[str] = []
        pending = iter(cells)
        while True:
            col = len(row)
            if col in carry:
                left, value = carry.pop(col)
                if left > 1:
                    carry[col] = (left - 1, value)
                row.append(value)
                continue
            nxt = next(pending, None)
            if nxt is None:
                break
            value, span = nxt
            if span > 1:
                carry[col] = (span - 1, value)
            row.append(value)
        rows.append(row)
    return headers, rows


def _date(text: str, season_year: int) -> date | None:
    m = DATE_RE.search(text)
    month = MONTHS.get(_norm(m.group(2))) if m else None
    if not m or month is None:
        return None
    try:
        return date(int(m.group(3) or season_year), month, int(m.group(1)))
    except ValueError:
        return None


def parse_games(wikitext: str, season_year: int) -> list[WikiGame]:
    """Partidos jugados de las tablas por fecha (columnas Local, Resultado, Visitante y Fecha)."""
    games = []
    for body in TABLE_RE.findall(wikitext):
        headers, rows = table_rows(body)
        names = [_norm(h) for h in headers]
        # Lo anterior a «Local» es el título de la tabla («Fecha 3»).
        cols = names[names.index("local") :] if "local" in names else []
        if not {"local", "resultado", "visitante", "fecha"} <= set(cols):
            continue
        title = ROUND_RE.search(" ".join(headers))
        idx = {name: cols.index(name) for name in ("local", "resultado", "visitante", "fecha")}
        venue_col = cols.index("estadio") if "estadio" in cols else None
        for row in rows:
            if len(row) <= max(idx.values()):
                continue
            score = SCORE_RE.match(row[idx["resultado"]])
            day = _date(row[idx["fecha"]], season_year)
            if not score or day is None:
                continue  # sin jugar, suspendido o sin fecha legible
            games.append(
                WikiGame(
                    round=int(title.group(1)) if title else None,
                    match_date=day,
                    home_team=row[idx["local"]],
                    away_team=row[idx["visitante"]],
                    home_goals=int(score.group(1)),
                    away_goals=int(score.group(2)),
                    venue=row[venue_col] if venue_col is not None and venue_col < len(row) else None,
                )
            )
    return games


# --- Tablas oficiales de la Wikipedia en inglés (módulo «Sports table», etapa 5j-12) ---------------
# Perú, Venezuela y Brasil B no tienen tabla en Promiedos ni resultados por fecha en la Wikipedia en
# español; el artículo en inglés de cada temporada trae la tabla con victorias, empates, derrotas,
# goles y descuentos de puntos (`adjust_points_X`), copiada de la web oficial de cada liga.
EN_BASE_URL = "https://en.wikipedia.org"
SPORTS_TABLE_RE = re.compile(r"\{\{\s*#invoke:\s*Sports table\s*\|", re.I)
HEADING_RE = re.compile(r"^(=+)\s*(.*?)\s*\1\s*$", re.M)
# Títulos de sección que no dicen de qué tabla se trata.
GENERIC_HEADINGS = {"standings", "league table", "table", "results"}
# Nombres de tabla en castellano para la web (el resto del título queda como está: «Apertura»).
TABLE_WORDS = {
    "Aggregate table": "Tabla acumulada",
    "Regular stage": "Fase regular",
    "Final stages": "Fase final",
    "First stage": "Primera fase",
    "Second stage": "Segunda fase",
    "Group": "Grupo",
}


@dataclass(frozen=True)
class WikiStanding:
    table_name: str
    rank: int
    team_name: str
    won: int
    drawn: int
    lost: int
    goals_for: int
    goals_against: int
    points: int


def _template_body(text: str, start: int) -> str:
    """Contenido de la plantilla que abre en `start` («{{»), con las llaves internas balanceadas."""
    depth, i = 0, start
    while i < len(text) - 1:
        if text.startswith("{{", i):
            depth, i = depth + 1, i + 2
        elif text.startswith("}}", i):
            depth, i = depth - 1, i + 2
            if depth == 0:
                return text[start + 2 : i - 2]
        else:
            i += 1
    return text[start + 2 :]


def _int(value: str | None) -> int | None:
    m = re.match(r"\s*([+−-]?\d+)", (value or "").replace("−", "-"))
    return int(m.group(1)) if m else None


def _heading_path(text: str, end: int) -> list[str]:
    """Títulos de las secciones que contienen la posición `end`, del más general al más chico."""
    path: dict[int, str] = {}
    for m in HEADING_RE.finditer(text, 0, end):
        level = len(m.group(1))
        path = {k: v for k, v in path.items() if k < level} | {level: clean(m.group(2))}
    return [path[k] for k in sorted(path)]


def parse_sports_tables(wikitext: str) -> list[WikiStanding]:
    """Todas las tablas «Sports table» con resultados cargados; las de grupos sin `win_` se saltean."""
    text = re.sub(r"<!--.*?-->", "", wikitext, flags=re.S)
    rows: list[WikiStanding] = []
    for m in SPORTS_TABLE_RE.finditer(text):
        params: dict[str, str] = {}
        for part in _split_top(_template_body(text, m.start()), "|")[1:]:
            key, sep, value = part.partition("=")
            if sep:
                params[key.strip()] = value.strip()
        # El orden viene en `team_order=A, B, …` o en `team1=A |team2=B …` (Brasil B).
        numbered = sorted((int(k[4:]), v) for k, v in params.items() if re.fullmatch(r"team\d+", k))
        order = (
            params.get("team_order", "").split(",") if "team_order" in params else [v for _, v in numbered]
        )
        codes = [c.strip() for c in order if c.strip()]
        if not codes or not any(f"win_{c}" in params for c in codes):
            continue
        path = [h for h in _heading_path(text, m.start()) if h.lower() not in GENERIC_HEADINGS]
        name = clean(params.get("section", "")) or " · ".join(path[-2:]) or "Tabla general"
        for en, es in TABLE_WORDS.items():
            name = name.replace(en, es)
        win_points = _int(params.get("win_points")) or 3
        for rank, code in enumerate(codes, start=1):
            w, d, lo, gf, ga = (
                _int(params.get(f"{k}_{code}")) or 0 for k in ("win", "draw", "loss", "gf", "ga")
            )
            extra = (_int(params.get(f"adjust_points_{code}")) or 0) + (
                _int(params.get(f"startpoints_{code}")) or 0
            )
            rows.append(
                WikiStanding(
                    table_name=name,
                    rank=rank,
                    team_name=clean(params.get(f"name_{code}", "")) or code,
                    won=w,
                    drawn=d,
                    lost=lo,
                    goals_for=gf,
                    goals_against=ga,
                    points=win_points * w + d + extra,
                )
            )
    return rows
