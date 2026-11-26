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
