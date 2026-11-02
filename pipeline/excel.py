"""Libros de Excel de Pelotheta Θ (sección 10): uno global y uno por competición.

Se arman con `xlsxwriter` a partir de las vistas `api` de Supabase (lo mismo que ve la web) y se
suben al bucket público `exports`, sobrescribiendo la versión anterior. Cada libro trae:

- `Índice` con enlaces a todas las hojas, `Metadatos`, `Tabla maestra` y `Catálogo`;
- `Comparador` y `Dispersión` interactivas (listas desplegables + `INDEX`/`MATCH` que alimentan
  gráficos nativos), `Comparación` (medias de equipo, líneas y posición por categoría);
- una hoja por gráfico de la tabla 9.4 con su tabla de datos, su gráfico nativo y el enlace
  «Ver datos de origen» (9.9); los que Excel no puede dibujar lo dicen en su hoja;
- `Equipo` (partido a partido) y, en el global, `Situaciones`.

Los textos se escriben siempre como texto (`write_string`): una celda que empiece con `=`, `+`,
`-` o `@` nunca se ejecuta como fórmula (14.3).
"""

from __future__ import annotations

import argparse
import io
import math
import os
import statistics
import sys
from collections.abc import Sequence
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any

import httpx
import xlsxwriter
from xlsxwriter.utility import xl_col_to_name, xl_rowcol_to_cell
from xlsxwriter.workbook import Workbook
from xlsxwriter.worksheet import Worksheet

from pipeline import projection as pj

TIMEOUT = 60
PAGE = 1000
BUCKET = "exports"
SYSTEM = "Pelotheta Θ"
FONT = "Montserrat"
# Paleta de la web (web/app/globals.css): verde principal, violeta secundario, rojo solo para lo
# negativo, azul y amarillo.
GREEN, GREEN_DARK, VIOLET, RED, BLUE, YELLOW = (
    "#64CC4F",
    "#328336",
    "#734F9A",
    "#A30310",
    "#2A78D6",
    "#EDA100",
)
ZEBRA = "#F1F8EC"
LINES = ("Arquero", "Defensor", "Mediocampista", "Delantero")
LINE_PLURAL = {
    "Arquero": "arqueros",
    "Defensor": "defensores",
    "Mediocampista": "mediocampistas",
    "Delantero": "delanteros",
}
MIN_MINUTES = 450  # mínimo para entrar en medias, percentiles y correlaciones


# --------------------------------------------------------------------------------------------
# Datos


@dataclass
class Stat:
    id: str
    name: str
    short: str
    description: str
    formula: str
    group: str
    unit: str
    level: str
    higher_is_better: bool
    estimated: bool
    per90: bool
    rule: str
    key: bool


@dataclass
class Player:
    id: int
    name: str
    line: str | None
    role: str | None
    matches: int
    minutes: int
    stats: dict[str, float]
    age: float | None = None


@dataclass
class Data:
    """Todo lo que lee un libro."""

    updated: str
    competitions: list[tuple[str, str]]
    stats: list[Stat]
    sets: list[tuple[str, str, list[str]]]
    players: dict[str, list[Player]]
    team: list[dict[str, Any]]
    situations: list[dict[str, Any]] = field(default_factory=list)
    # Detalle de las métricas de 6.1 por jugador: {player_id: {stat_id: {"value", "detail"}}}.
    projection: dict[int, dict[str, dict[str, Any]]] = field(default_factory=dict)


def _get(
    client: httpx.Client, url: str, key: str, view: str, select: str, **filters: str
) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for offset in range(0, 100_000, PAGE):
        params = {"select": select, "limit": str(PAGE), "offset": str(offset), **filters}
        response = client.get(
            f"{url.rstrip('/')}/rest/v1/{view}",
            params=params,
            headers={"apikey": key, "Authorization": f"Bearer {key}", "Accept-Profile": "api"},
        )
        response.raise_for_status()
        page = response.json()
        rows.extend(page)
        if len(page) < PAGE:
            return rows
    return rows


def fetch(url: str, key: str) -> Data:
    """Lee las vistas `api` que usan los libros."""
    with httpx.Client(timeout=TIMEOUT) as c:
        catalog = _get(c, url, key, "stat_catalog", "*", entity="eq.player", available="eq.true")
        sets = _get(
            c,
            url,
            key,
            "stat_set",
            "set_id,name_es,stat_ids,sort_order",
            entity="eq.player",
            order="sort_order",
        )
        comps = _get(c, url, key, "competition_filter", "code,name_es,sort_order", order="sort_order")
        positions = {p["player_id"]: p for p in _get(c, url, key, "player_position", "player_id,role,zone")}
        master = _get(
            c,
            url,
            key,
            "player_master",
            "player_id,competition_code,full_name,position_group,age,matches,minutes,stats",
        )
        details = _get(c, url, key, "stat_value_detail", "player_id,stat_id,value,detail")
        team = _get(
            c,
            url,
            key,
            "team_match_master",
            "match_id,match_date,competition_code,competition_name,opponent,boca_home,goals_for,goals_against,stats",
            order="kickoff_at",
        )
        status = _get(c, url, key, "system_status", "key,value,updated_at")
        situations = _get(
            c,
            url,
            key,
            "situational_result",
            "card_id,param_value,param_order,n,w,d,l,win_pct,ppg,delta,gf_avg,ga_avg",
        )
        cards = {
            r["card_id"]: r
            for r in _get(c, url, key, "situational_catalog", "card_id,category,title_es,sort_order")
        }
    zone_line = {
        "Arco": "Arquero",
        "Defensa": "Defensor",
        "Mediocampo": "Mediocampista",
        "Ataque": "Delantero",
    }
    stats = [
        Stat(
            id=r["stat_id"],
            name=r["name_es"],
            short=r["short_name"],
            description=r["description_es"] or "",
            formula=r["formula"] or "",
            group=r["stat_group"] or "",
            unit=r["unit"] or "",
            level=r["level"] or "",
            higher_is_better=bool(r["higher_is_better"]),
            estimated=bool(r["estimated"]),
            per90=bool(r["per90"]),
            rule=r["rule"],
            key=bool(r.get("key_stat")),
        )
        for r in catalog
        if r["rule"] not in ("perfil", "nd")
    ]
    players: dict[str, list[Player]] = {}
    for r in master:
        pos = positions.get(r["player_id"], {})
        line = r["position_group"] or zone_line.get(pos.get("zone") or "")
        players.setdefault(r["competition_code"], []).append(
            Player(
                id=r["player_id"],
                name=r["full_name"],
                line=line,
                role=pos.get("role"),
                matches=r["matches"] or 0,
                minutes=r["minutes"] or 0,
                stats={k: float(v) for k, v in (r["stats"] or {}).items() if isinstance(v, int | float)},
                age=r.get("age"),
            )
        )
    projection: dict[int, dict[str, dict[str, Any]]] = {}
    for d in details:
        projection.setdefault(d["player_id"], {})[d["stat_id"]] = {
            "value": d["value"],
            "detail": d["detail"] or {},
        }
    for rows in players.values():
        rows.sort(key=lambda p: -p.minutes)
    updated = next((s["updated_at"] for s in status if s["key"] == "ultima_actualizacion"), None) or next(
        (s["updated_at"] for s in status), ""
    )
    situ = []
    for r in situations:
        card = cards.get(r["card_id"])
        if card:
            situ.append(
                {**r, "category": card["category"], "title": card["title_es"], "order": card["sort_order"]}
            )
    situ.sort(key=lambda r: (r["order"], r["param_order"] or 0))
    return Data(
        updated=str(updated)[:16].replace("T", " "),
        competitions=[(c["code"], c["name_es"]) for c in comps],
        stats=stats,
        sets=[(s["set_id"], s["name_es"], list(s["stat_ids"] or [])) for s in sets],
        players=players,
        team=team,
        situations=situ,
        projection=projection,
    )


# --------------------------------------------------------------------------------------------
# Cálculos (puros, con tests)


def per90(player: Player, stat: Stat) -> float | None:
    """Valor por 90 minutos cuando la estadística lo admite; si no, el valor tal cual."""
    value = player.stats.get(stat.id)
    if value is None:
        return None
    if not stat.per90:
        return value
    return value * 90 / player.minutes if player.minutes > 0 else None


def percentile(values: Sequence[float], value: float, higher_is_better: bool) -> float:
    """Porcentaje del grupo que queda peor que el valor (100 = el mejor)."""
    if not values:
        return 0.0
    worse = sum(1 for v in values if (v < value if higher_is_better else v > value))
    equal = sum(1 for v in values if v == value)
    return round((worse + equal / 2) / len(values) * 100, 1)


def media(players: Sequence[Player], stat: Stat) -> float | None:
    vals = [v for p in players if (v := per90(p, stat)) is not None]
    return sum(vals) / len(vals) if vals else None


def pearson(x: Sequence[float], y: Sequence[float]) -> float | None:
    if len(x) < 3:
        return None
    mx, my = statistics.fmean(x), statistics.fmean(y)
    sx = math.sqrt(sum((a - mx) ** 2 for a in x))
    sy = math.sqrt(sum((b - my) ** 2 for b in y))
    if sx == 0 or sy == 0:
        return None
    return sum((a - mx) * (b - my) for a, b in zip(x, y, strict=True)) / (sx * sy)


def safe_text(value: str) -> str:
    """Texto que empieza como fórmula: se le antepone un apóstrofo (14.3)."""
    return f"'{value}" if value[:1] in ("=", "+", "-", "@", "\t", "\r") else value


def sheet_name(name: str) -> str:
    return "".join(ch for ch in name if ch not in "[]:*?/\\")[:31]


# --------------------------------------------------------------------------------------------
# Libro


class Book:
    """Un libro con los formatos de la casa y el registro de hojas para el índice."""

    def __init__(self, title: str, scope: str, updated: str) -> None:
        self.buffer = io.BytesIO()
        self.wb: Workbook = xlsxwriter.Workbook(self.buffer, {"in_memory": True, "nan_inf_to_errors": True})
        self.wb.set_calc_mode("auto")
        self.wb.set_properties({"title": f"{SYSTEM} · {title}", "author": SYSTEM, "company": SYSTEM})
        self.title, self.scope, self.updated = title, scope, updated
        self.sheets: list[tuple[str, str]] = []
        base = {"font_name": FONT, "font_size": 10}
        f = self.wb.add_format
        self.text = f(base)
        self.title_fmt = f({**base, "bold": True, "font_size": 16, "font_color": GREEN_DARK})
        self.sub = f({**base, "italic": True, "font_color": "#555B55"})
        self.head = f(
            {
                **base,
                "bold": True,
                "bg_color": GREEN_DARK,
                "font_color": "#FFFFFF",
                "text_wrap": True,
                "valign": "vcenter",
                "border": 1,
                "border_color": "#E6E8E6",
            }
        )
        self.cell = f({**base, "num_format": "#,##0.00"})
        self.zebra = f({**base, "num_format": "#,##0.00", "bg_color": ZEBRA})
        self.int = f({**base, "num_format": "#,##0"})
        self.pct = f({**base, "num_format": '0.0" %"'})
        self.nd = f({**base, "font_color": "#9AA09A", "align": "right"})
        self.link = f({**base, "font_color": GREEN_DARK, "underline": 1})
        self.bold = f({**base, "bold": True})
        self.input = f({**base, "bold": True, "bg_color": "#FFF7D6", "border": 1, "border_color": YELLOW})
        self.note = f({**base, "font_color": "#555B55", "text_wrap": True, "valign": "top"})

    def sheet(self, name: str, description: str) -> Worksheet:
        ws = self.wb.add_worksheet(sheet_name(name))
        ws.set_column(0, 0, 28, self.text)
        self.sheets.append((ws.get_name(), description))
        return ws

    def header(self, ws: Worksheet, title: str, source: str) -> int:
        """Título, fuente, fecha y enlace al índice arriba de cada hoja. Devuelve la primera fila libre."""
        ws.write_string(0, 0, f"{SYSTEM} · {title}", self.title_fmt)
        ws.write_string(1, 0, f"{self.scope} · actualizado {self.updated} · fuente: {source}", self.sub)
        ws.write_url(2, 0, "internal:'Índice'!A1", self.link, string="Volver al índice")
        ws.set_row(0, 24)
        return 4

    def write(self, ws: Worksheet, row: int, col: int, value: Any, fmt: Any = None) -> None:
        if value is None or (isinstance(value, float) and math.isnan(value)):
            ws.write_string(row, col, "n/d", self.nd)
        elif isinstance(value, bool):
            ws.write_string(row, col, "sí" if value else "no", fmt or self.text)
        elif isinstance(value, int | float):
            ws.write_number(row, col, value, fmt or self.cell)
        else:
            ws.write_string(row, col, safe_text(str(value)), fmt or self.text)

    def table(
        self,
        ws: Worksheet,
        row: int,
        head: Sequence[str],
        rows: Sequence[Sequence[Any]],
        widths: Sequence[float] | None = None,
        formats: Sequence[Any] | None = None,
        freeze: bool = True,
    ) -> tuple[int, int]:
        """Tabla con encabezado verde, zebra, autofiltro y paneles congelados.

        Devuelve la primera y la última fila de datos.
        """
        for c, h in enumerate(head):
            ws.write_string(row, c, h, self.head)
        ws.set_row(row, 30)
        for r, values in enumerate(rows, start=row + 1):
            for c, v in enumerate(values):
                fmt = formats[c] if formats and c < len(formats) and formats[c] is not None else None
                if fmt is None and isinstance(v, int | float) and not isinstance(v, bool):
                    fmt = self.zebra if (r - row) % 2 == 0 else self.cell
                self.write(ws, r, c, v, fmt)
        last = row + max(1, len(rows))
        ws.autofilter(row, 0, last, len(head) - 1)
        if freeze:
            ws.freeze_panes(row + 1, 1)
        for c, w in enumerate(widths or []):
            ws.set_column(c, c, w)
        return row + 1, last

    def finish(self) -> bytes:
        idx = self.wb.get_worksheet_by_name("Índice")
        if idx is not None:
            for r, (name, description) in enumerate(self.sheets, start=4):
                if name == "Índice":
                    continue
                idx.write_url(r, 0, f"internal:'{name}'!A1", self.link, string=name)
                idx.write_string(r, 1, description, self.note)
        self.wb.close()
        return self.buffer.getvalue()


def chart_sheet(
    book: Book, name: str, title: str, source_sheet: str | None, note: str
) -> tuple[Worksheet, int]:
    ws = book.sheet(name, title)
    row = book.header(ws, title, "vistas api de Supabase")
    if source_sheet:
        ws.write_url(2, 2, f"internal:'{source_sheet}'!A1", book.link, string="Ver datos de origen")
    ws.write_string(3, 0, note, book.note)
    return ws, row + 1


def style_chart(chart: Any, title: str, x: str | None = None, y: str | None = None) -> None:
    chart.set_title({"name": title, "name_font": {"name": FONT, "size": 12, "bold": True}})
    chart.set_legend({"position": "bottom", "font": {"name": FONT, "size": 9}})
    chart.set_chartarea({"border": {"none": True}})
    chart.set_size({"width": 760, "height": 400})
    if x is not None:
        chart.set_x_axis(
            {"name": x, "num_font": {"name": FONT, "size": 9}, "name_font": {"name": FONT, "size": 9}}
        )
    if y is not None:
        chart.set_y_axis(
            {
                "name": y,
                "num_font": {"name": FONT, "size": 9},
                "name_font": {"name": FONT, "size": 9},
                "major_gridlines": {"visible": True, "line": {"color": "#E6E8E6"}},
            }
        )


def build(data: Data, code: str, scope: str) -> bytes:
    """Arma el libro de una competición (o 'todas')."""
    book = Book(scope, scope, data.updated)
    players = data.players.get(code, [])
    # En competiciones cortas nadie llega a 450 minutos: el mínimo baja al 40 % del que más jugó.
    threshold = min(MIN_MINUTES, int(0.4 * max((p.minutes for p in players), default=0)))
    eligible = [p for p in players if p.minutes >= threshold]
    stats = data.stats
    by_id = {s.id: s for s in stats}
    team = data.team if code == "todas" else [m for m in data.team if m["competition_code"] == code]

    # Índice y metadatos.
    idx = book.sheet("Índice", "Todas las hojas del libro")
    book.header(idx, "Índice", "este libro")
    idx.set_column(1, 1, 90)
    meta = book.sheet("Metadatos", "Fuente, fecha de actualización, filtros y notas")
    r = book.header(meta, "Metadatos", "vistas api de Supabase (las mismas de la web)")
    rows = [
        ("Sistema", SYSTEM),
        ("Alcance", scope),
        ("Actualizado", data.updated),
        ("Generado", datetime.now(UTC).strftime("%Y-%m-%d %H:%M UTC")),
        ("Jugadores", len(players)),
        ("Partidos de Boca", len(team)),
        ("Mínimo para medias y percentiles", f"{threshold} minutos"),
        ("Valores", "Por 90 minutos cuando la estadística lo admite; porcentajes y promedios, tal cual."),
        ("n/d", "Sin dato en la fuente: se ve en gris y no cuenta en medias ni percentiles."),
        (
            "Tipografía",
            "Montserrat. Si no está instalada, Excel la reemplaza por otra; los datos no cambian.",
        ),
        ("Fórmulas", "Comparador y Dispersión se recalculan al abrir el libro y al cambiar las listas."),
    ]
    book.table(meta, r, ["Dato", "Valor"], rows, widths=[34, 90], freeze=False)

    # Tabla maestra.
    master = book.sheet(
        "Tabla maestra", "Jugadores en filas y estadísticas en columnas (por 90 cuando corresponde)"
    )
    r = book.header(master, "Tabla maestra", "player_master")
    head = [
        "Jugador",
        "Línea",
        "Posición",
        "Partidos",
        "Minutos",
        *[s.name + (" (est.)" if s.estimated else "") for s in stats],
    ]
    body = [[p.name, p.line, p.role, p.matches, p.minutes, *[per90(p, s) for s in stats]] for p in players]
    first, last = book.table(master, r, head, body, widths=[26, 14, 22, 9, 9])
    master.set_column(5, 4 + len(stats), 12)
    for c, s in enumerate(stats, start=5):
        # Formato condicional por percentil: verde lo mejor, rojo lo peor (según el sentido).
        good, bad = (GREEN, "#F4B6B0") if s.higher_is_better else ("#F4B6B0", GREEN)
        master.conditional_format(
            first,
            c,
            last,
            c,
            {"type": "3_color_scale", "min_color": bad, "mid_color": "#FFFFFF", "max_color": good},
        )

    # Catálogo.
    cat = book.sheet("Catálogo", "Cada estadística con su descripción y su fórmula")
    r = book.header(cat, "Catálogo", "stat_catalog")
    book.table(
        cat,
        r,
        [
            "Estadística",
            "Id",
            "Grupo",
            "Descripción",
            "Fórmula",
            "Unidad",
            "Nivel",
            "Más es mejor",
            "Estimada",
        ],
        [
            [
                s.name,
                s.id,
                s.group,
                s.description,
                s.formula,
                s.unit,
                s.level,
                s.higher_is_better,
                s.estimated,
            ]
            for s in stats
        ],
        widths=[28, 22, 20, 70, 40, 12, 7, 12, 10],
    )

    # Datos ocultos para las hojas interactivas: percentiles y valores por nombre (jugadores y medias).
    refs: list[tuple[str, list[Player]]] = [
        ("Media del equipo (sin arqueros)", [p for p in eligible if p.line != "Arquero"])
    ]
    refs += [(f"Media de {LINE_PLURAL[line]}", [p for p in eligible if p.line == line]) for line in LINES]
    pct = book.sheet("Datos comparador", "Percentiles y valores que usan Comparador y Dispersión (oculta)")
    names = [p.name for p in players] + [name for name, _ in refs]
    pct.write_string(0, 0, "Nombre", book.head)
    for c, s in enumerate(stats, start=1):
        pct.write_string(0, c, s.id, book.head)
        pct.write_string(0, c + len(stats), s.name, book.head)
    groups = {s.id: [v for p in eligible if (v := per90(p, s)) is not None] for s in stats}
    for i, p in enumerate(players, start=1):
        pct.write_string(i, 0, safe_text(p.name))
        for c, s in enumerate(stats, start=1):
            v = per90(p, s)
            if v is not None:
                pct.write_number(i, c, percentile(groups[s.id], v, s.higher_is_better))
                pct.write_number(i, c + len(stats), v)
    for j, (name, members) in enumerate(refs, start=len(players) + 1):
        pct.write_string(j, 0, name)
        for c, s in enumerate(stats, start=1):
            v = media(members, s)
            if v is not None:
                pct.write_number(j, c, percentile(groups[s.id], v, s.higher_is_better))
                pct.write_number(j, c + len(stats), v)
    pct.hide()
    n_names = len(names)
    names_range = f"='Datos comparador'!$A$2:$A${n_names + 1}"
    last_col = xl_col_to_name(len(stats))
    pct_block = f"'Datos comparador'!$B$2:${last_col}${n_names + 1}"
    id_row = f"'Datos comparador'!$B$1:${last_col}$1"
    val_first = xl_col_to_name(len(stats) + 1)
    val_last = xl_col_to_name(2 * len(stats))
    val_block = f"'Datos comparador'!${val_first}$2:${val_last}${n_names + 1}"
    name_row = f"'Datos comparador'!${val_first}$1:${val_last}$1"

    # Conjuntos: fila por conjunto con hasta 8 estadísticas (ids y nombres).
    sets_ws = book.sheet("Conjuntos", "Conjuntos de estadísticas del Comparador (oculta)")
    usable_sets = []
    for _set_id, set_name, ids in data.sets:
        ids8 = [i for i in ids if i in by_id][:8]
        if len(ids8) >= 3:
            usable_sets.append((set_name, ids8))
    for i, (set_name, ids8) in enumerate(usable_sets):
        sets_ws.write_string(i, 0, set_name)
        for c, sid in enumerate(ids8, start=1):
            sets_ws.write_string(i, c, sid)
            sets_ws.write_string(i, c + 8, by_id[sid].short)
    sets_ws.hide()

    # Comparador: 2 a 4 nombres y un conjunto; radar de percentiles y barras de valores.
    comp = book.sheet(
        "Comparador", "Elegí de 2 a 4 jugadores o medias y un conjunto: el radar y las barras cambian"
    )
    r = book.header(comp, "Comparador", "player_master (percentiles entre jugadores con 450 minutos o más)")
    comp.write_string(
        r, 0, "Elegí en las celdas amarillas (listas desplegables). Vacía = no se dibuja.", book.note
    )
    picks = [players[i].name if i < len(players) else "" for i in range(2)] + [
        "Media del equipo (sin arqueros)",
        "",
    ]
    for i in range(4):
        comp.write_string(r + 1 + i, 0, f"Jugador o media {i + 1}", book.bold)
        comp.write_string(r + 1 + i, 1, picks[i], book.input)
        comp.data_validation(
            r + 1 + i, 1, r + 1 + i, 1, {"validate": "list", "source": names_range, "ignore_blank": True}
        )
    set_row = r + 6
    comp.write_string(set_row, 0, "Conjunto", book.bold)
    comp.write_string(set_row, 1, usable_sets[0][0] if usable_sets else "", book.input)
    comp.data_validation(
        set_row,
        1,
        set_row,
        1,
        {"validate": "list", "source": f"=Conjuntos!$A$1:$A${max(1, len(usable_sets))}"},
    )
    comp.set_column(1, 1, 34)
    grid = set_row + 2
    comp.write_string(grid, 0, "Estadística", book.head)
    comp.write_string(grid, 1, "Id", book.head)
    set_cell = xl_rowcol_to_cell(set_row, 1, row_abs=True, col_abs=True)

    def pick_cell(i: int) -> str:
        return xl_rowcol_to_cell(r + 1 + i, 1, row_abs=True, col_abs=True)

    for i in range(4):
        comp.write_formula(
            grid,
            2 + i,
            f'=IF({pick_cell(i)}="","—",{pick_cell(i)})',
            book.head,
        )
        comp.write_formula(grid, 6 + i, f"={xl_rowcol_to_cell(grid, 2 + i, row_abs=True)}", book.head)
    comp.write_string(grid - 1, 2, "Percentil (0 a 100)", book.bold)
    comp.write_string(grid - 1, 6, "Valor (por 90 cuando corresponde)", book.bold)
    sets_rows = f"Conjuntos!$A$1:$A${max(1, len(usable_sets))}"
    set_ids = f"Conjuntos!$B$1:$I${max(1, len(usable_sets))}"
    set_names = f"Conjuntos!$J$1:$Q${max(1, len(usable_sets))}"
    for k in range(8):
        row = grid + 1 + k
        comp.write_formula(
            row,
            1,
            f'=IFERROR(INDEX({set_ids},MATCH({set_cell},{sets_rows},0),{k + 1}),"")',
        )
        comp.write_formula(
            row,
            0,
            f'=IFERROR(INDEX({set_names},MATCH({set_cell},{sets_rows},0),{k + 1}),"")',
        )
        sid = xl_rowcol_to_cell(row, 1, col_abs=True)
        for i in range(4):
            who = xl_rowcol_to_cell(r + 1 + i, 1, row_abs=True, col_abs=True)
            comp.write_formula(
                row,
                2 + i,
                f'=IF(OR({who}="",{sid}=""),NA(),IFERROR(INDEX({pct_block},MATCH({who},{names_range[1:]},0),MATCH({sid},{id_row},0)),NA()))',
            )
            comp.write_formula(
                row,
                6 + i,
                f'=IF(OR({who}="",{sid}=""),NA(),IFERROR(INDEX({val_block},MATCH({who},{names_range[1:]},0),MATCH({sid},{id_row},0)),NA()))',
                book.cell,
            )
    colors = [GREEN_DARK, VIOLET, BLUE, YELLOW]
    radar = book.wb.add_chart({"type": "radar", "subtype": "filled"})
    bars = book.wb.add_chart({"type": "bar"})
    for i in range(4):
        cats = ["Comparador", grid + 1, 0, grid + 8, 0]
        radar.add_series(
            {
                "name": ["Comparador", grid, 2 + i],
                "categories": cats,
                "values": ["Comparador", grid + 1, 2 + i, grid + 8, 2 + i],
                "line": {"color": colors[i], "width": 2},
                "fill": {"color": colors[i], "transparency": 80},
            }
        )
        bars.add_series(
            {
                "name": ["Comparador", grid, 6 + i],
                "categories": cats,
                "values": ["Comparador", grid + 1, 6 + i, grid + 8, 6 + i],
                "fill": {"color": colors[i]},
                "gap": 60,
            }
        )
    style_chart(radar, "Percentiles del conjunto elegido")
    radar.set_y_axis({"min": 0, "max": 100, "major_unit": 25})
    style_chart(bars, "Valores del conjunto elegido")
    comp.insert_chart(grid + 11, 0, radar)
    comp.insert_chart(grid + 11, 6, bars)
    comp.write_string(
        grid + 10,
        0,
        "Verde: el primero; violeta: el segundo; azul y amarillo: el tercero y el cuarto.",
        book.note,
    )

    # Dispersión: eje X y eje Y a elección.
    disp = book.sheet("Dispersión", "Elegí la estadística del eje X y la del eje Y: la dispersión cambia")
    r = book.header(disp, "Dispersión", "player_master")
    stat_names = f"'Datos comparador'!${val_first}$1:${val_last}$1"
    disp.write_string(r, 0, "Eje X", book.bold)
    disp.write_string(
        r, 1, by_id["pases_clave"].name if "pases_clave" in by_id else stats[0].name, book.input
    )
    disp.write_string(r + 1, 0, "Eje Y", book.bold)
    disp.write_string(r + 1, 1, by_id["xg"].name if "xg" in by_id else stats[1].name, book.input)
    for k in (0, 1):
        disp.data_validation(r + k, 1, r + k, 1, {"validate": "list", "source": f"={stat_names}"})
    disp.set_column(1, 1, 34)
    t = r + 3
    for c, h in enumerate(["Jugador", "Línea", "Minutos", "X", "Y"]):
        disp.write_string(t, c, h, book.head)
    xc = xl_rowcol_to_cell(r, 1, row_abs=True, col_abs=True)
    yc = xl_rowcol_to_cell(r + 1, 1, row_abs=True, col_abs=True)
    for i, p in enumerate(eligible, start=t + 1):
        disp.write_string(i, 0, safe_text(p.name))
        disp.write_string(i, 1, p.line or "n/d")
        disp.write_number(i, 2, p.minutes, book.int)
        who = xl_rowcol_to_cell(i, 0, col_abs=True)
        for col, axis in ((3, xc), (4, yc)):
            disp.write_formula(
                i,
                col,
                f"=IFERROR(INDEX({val_block},MATCH({who},{names_range[1:]},0),MATCH({axis},{name_row},0)),NA())",
                book.cell,
            )
    scatter = book.wb.add_chart({"type": "scatter"})
    if eligible:
        scatter.add_series(
            {
                "name": f"Jugadores ({threshold} minutos o más)",
                "categories": ["Dispersión", t + 1, 3, t + len(eligible), 3],
                "values": ["Dispersión", t + 1, 4, t + len(eligible), 4],
                "marker": {
                    "type": "circle",
                    "size": 7,
                    "fill": {"color": GREEN_DARK},
                    "border": {"color": "#FFFFFF"},
                },
            }
        )
    style_chart(scatter, "Dispersión", "Eje X (elegido arriba)", "Eje Y (elegido arriba)")
    if eligible:
        disp.insert_chart(r, 7, scatter)

    # Comparación: medias por categoría (equipo, líneas).
    cmpw = book.sheet("Comparación", "Medias del equipo y de cada línea, por categoría (9.7)")
    r = book.header(cmpw, "Comparación", "player_master")
    groups_order: dict[str, list[Stat]] = {}
    for s in stats:
        groups_order.setdefault(s.group or "Otras", []).append(s)
    for group, list_ in groups_order.items():
        cmpw.write_string(r, 0, group, book.bold)
        _, end = book.table(
            cmpw,
            r + 1,
            ["Estadística", *[name for name, _ in refs]],
            [[s.name, *[media(m, s) for _, m in refs]] for s in list_],
            widths=[30, 18, 16, 16, 16, 16],
            freeze=False,
        )
        cmpw.autofilter(0, 0, 0, 0)
        r = end + 2

    # Equipo: partido a partido (datos de origen de varios gráficos).
    team_ws = book.sheet("Equipo", "Boca partido a partido (datos de origen de los gráficos del equipo)")
    r = book.header(team_ws, "Equipo partido a partido", "team_match_master")
    keys = [
        ("xg", "xG"),
        ("xg_against", "xG en contra"),
        ("shots_total", "Remates"),
        ("possession_pct", "Posesión %"),
        ("eq_xpts", "xPts"),
    ]
    team_rows = []
    points_acc = 0
    for m in team:
        gf, ga = m["goals_for"] or 0, m["goals_against"] or 0
        pts = 3 if gf > ga else 1 if gf == ga else 0
        points_acc += pts
        st = m["stats"] or {}
        team_rows.append(
            [
                m["match_date"],
                m["competition_name"],
                m["opponent"],
                "Local" if m["boca_home"] else "Visitante",
                gf,
                ga,
                pts,
                points_acc,
                *[st.get(k) for k, _ in keys],
            ]
        )
    t_first, t_last = book.table(
        team_ws,
        r,
        [
            "Fecha",
            "Competición",
            "Rival",
            "Localía",
            "GF",
            "GC",
            "Puntos",
            "Puntos acumulados",
            *[n for _, n in keys],
        ],
        team_rows,
        widths=[11, 26, 22, 10, 6, 6, 8, 10, 8, 10, 9, 10, 8],
    )

    def add_note_sheet(name: str, title: str, note: str) -> None:
        chart_sheet(book, name, title, None, note)

    # 3. Ranking: un gráfico por conjunto (los 10 primeros en la primera estadística del conjunto).
    rank_ws, r = chart_sheet(
        book,
        "G03 Ranking",
        "Ranking por conjunto (los 10 primeros)",
        "Tabla maestra",
        "Barras nativas: los 10 primeros de la primera estadística de cada conjunto"
        " (por 90 cuando corresponde, con el mínimo de minutos).",
    )
    row_at = r
    for set_name, ids8 in usable_sets[:6]:
        s = by_id[ids8[0]]
        ranked = sorted(
            ((p.name, v) for p in eligible if (v := per90(p, s)) is not None),
            key=lambda x: -x[1] if s.higher_is_better else x[1],
        )[:10]
        if not ranked:
            continue
        rank_ws.write_string(row_at, 0, f"{set_name}: {s.name}", book.bold)
        f0, l0 = book.table(rank_ws, row_at + 1, ["Jugador", s.name], ranked, widths=[26, 14], freeze=False)
        ch = book.wb.add_chart({"type": "bar"})
        ch.add_series(
            {
                "name": s.name,
                "categories": [rank_ws.get_name(), f0, 0, l0, 0],
                "values": [rank_ws.get_name(), f0, 1, l0, 1],
                "fill": {"color": GREEN_DARK},
                "gap": 50,
            }
        )
        style_chart(ch, f"{set_name}: {s.name}")
        ch.set_y_axis({"reverse": True})
        ch.set_size({"width": 620, "height": 300})
        rank_ws.insert_chart(row_at, 3, ch)
        row_at += 17
    rank_ws.autofilter(0, 0, 0, 0)

    # 4. Distribución: columnas por intervalos de la calificación y tabla de cuartiles.
    dist_ws, r = chart_sheet(
        book,
        "G04 Distribución",
        "Distribución de la calificación",
        "Tabla maestra",
        "Columnas por intervalos y tabla de cuartiles (Excel no tiene caja y bigotes nativo).",
    )
    rating = by_id.get("calificacion")
    vals = sorted(v for p in eligible if rating and (v := per90(p, rating)) is not None)
    if len(vals) >= 4:
        k = 6
        lo, hi = vals[0], vals[-1]
        width = (hi - lo) / k or 1
        bins = [
            [
                f"{lo + i * width:.2f} a {lo + (i + 1) * width:.2f}",
                sum(
                    1 for v in vals if lo + i * width <= v < lo + (i + 1) * width or (i == k - 1 and v == hi)
                ),
            ]
            for i in range(k)
        ]
        f0, l0 = book.table(dist_ws, r, ["Intervalo", "Jugadores"], bins, widths=[18, 10], freeze=False)
        ch = book.wb.add_chart({"type": "column"})
        ch.add_series(
            {
                "name": "Jugadores",
                "categories": [dist_ws.get_name(), f0, 0, l0, 0],
                "values": [dist_ws.get_name(), f0, 1, l0, 1],
                "fill": {"color": GREEN_DARK},
                "gap": 30,
            }
        )
        style_chart(ch, "Calificación: cantidad de jugadores por intervalo", "Calificación", "Jugadores")
        dist_ws.insert_chart(r, 3, ch)
        q = statistics.quantiles(vals, n=4)
        book.table(
            dist_ws,
            l0 + 3,
            ["Cuartil", "Calificación"],
            [["Mínimo", vals[0]], ["Q1", q[0]], ["Mediana", q[1]], ["Q3", q[2]], ["Máximo", vals[-1]]],
            freeze=False,
        )

    # 5. Evolución por fecha (xG con media móvil de 5), 6. Forma, 8. xG a favor y en contra.
    def team_chart(
        name: str, title: str, note: str, series: list[tuple[int, str, str, str]], kind: str, y: str
    ) -> None:
        ws, rr = chart_sheet(book, name, title, "Equipo", note)
        ch = book.wb.add_chart({"type": kind})
        for col, label, color, sub in series:
            spec: dict[str, Any] = {
                "name": label,
                "categories": ["Equipo", t_first, 0, t_last, 0],
                "values": ["Equipo", t_first, col, t_last, col],
            }
            if kind == "line":
                spec["line"] = {
                    "color": color,
                    "width": 2.25,
                    **({"dash_type": "dash"} if sub == "dash" else {}),
                }
            else:
                spec["fill"] = {"color": color}
            ch.add_series(spec)
        style_chart(ch, title, "Partido", y)
        ws.insert_chart(rr, 0, ch)

    if team:
        # Media móvil de 5 del xG, calculada en el pipeline (columna nueva al lado de la tabla).
        xg_col = 8
        roll_col = 8 + len(keys)
        team_ws.write_string(r, roll_col, "xG (media móvil de 5)", book.head)
        for i in range(len(team_rows)):
            window = [
                v for v in (x[xg_col] for x in team_rows[max(0, i - 4) : i + 1]) if isinstance(v, int | float)
            ]
            book.write(team_ws, t_first + i, roll_col, sum(window) / len(window) if window else None)
        team_chart(
            "G05 Evolución",
            "xG por partido y media móvil de 5",
            "Líneas nativas.",
            [(xg_col, "xG", GREEN_DARK, ""), (roll_col, "Media móvil de 5", VIOLET, "dash")],
            "line",
            "xG",
        )
        forma_ws, rr = chart_sheet(
            book,
            "G06 Forma",
            "Forma del equipo: puntos por partido y acumulados",
            "Equipo",
            "Gráfico combinado nativo: columnas de puntos y línea de puntos acumulados.",
        )
        col_ch = book.wb.add_chart({"type": "column"})
        col_ch.add_series(
            {
                "name": "Puntos",
                "categories": ["Equipo", t_first, 0, t_last, 0],
                "values": ["Equipo", t_first, 6, t_last, 6],
                "fill": {"color": GREEN_DARK},
            }
        )
        line_ch = book.wb.add_chart({"type": "line"})
        line_ch.add_series(
            {
                "name": "Puntos acumulados",
                "categories": ["Equipo", t_first, 0, t_last, 0],
                "values": ["Equipo", t_first, 7, t_last, 7],
                "line": {"color": VIOLET, "width": 2.25},
                "y2_axis": True,
            }
        )
        col_ch.combine(line_ch)
        style_chart(col_ch, "Forma del equipo", "Partido", "Puntos")
        forma_ws.insert_chart(rr, 0, col_ch)
        team_chart(
            "G08 xG",
            "xG a favor y en contra por partido",
            "Líneas nativas: en contra en rojo (lo negativo).",
            [(8, "xG a favor", GREEN_DARK, ""), (9, "xG en contra", RED, "")],
            "line",
            "xG",
        )

        # 7. Goles por tramo de minutos.
        tramo_ws, rr = chart_sheet(
            book,
            "G07 Tramos",
            "Goles por tramo de minutos",
            "Equipo",
            "Columnas agrupadas nativas: a favor en verde y en contra en rojo.",
        )
        tramos = ["00_15", "16_30", "31_45", "46_60", "61_75", "76_90"]
        tr_rows = [
            [
                t.replace("_", "-"),
                sum((m["stats"] or {}).get(f"goals_for_{t}", 0) or 0 for m in team),
                sum((m["stats"] or {}).get(f"goals_against_{t}", 0) or 0 for m in team),
            ]
            for t in tramos
        ]
        f0, l0 = book.table(tramo_ws, rr, ["Tramo", "A favor", "En contra"], tr_rows, freeze=False)
        ch = book.wb.add_chart({"type": "column"})
        ch.add_series(
            {
                "name": "A favor",
                "categories": [tramo_ws.get_name(), f0, 0, l0, 0],
                "values": [tramo_ws.get_name(), f0, 1, l0, 1],
                "fill": {"color": GREEN_DARK},
            }
        )
        ch.add_series(
            {
                "name": "En contra",
                "categories": [tramo_ws.get_name(), f0, 0, l0, 0],
                "values": [tramo_ws.get_name(), f0, 2, l0, 2],
                "fill": {"color": RED},
            }
        )
        style_chart(ch, "Goles por tramo de minutos", "Minutos", "Goles")
        tramo_ws.insert_chart(rr, 4, ch)

        # 9. Puntos reales frente a esperados.
        pe_ws, rr = chart_sheet(
            book,
            "G09 Puntos esperados",
            "Puntos reales frente a esperados (xPts)",
            "Equipo",
            "Dispersión nativa con una serie diagonal de referencia (puntos = xPts).",
        )
        sc = book.wb.add_chart({"type": "scatter"})
        sc.add_series(
            {
                "name": "Partidos",
                "categories": ["Equipo", t_first, 12, t_last, 12],
                "values": ["Equipo", t_first, 6, t_last, 6],
                "marker": {"type": "circle", "size": 7, "fill": {"color": GREEN_DARK}},
            }
        )
        pe_ws.write_row(rr, 0, ["Diagonal xPts", "Puntos"], book.head)
        pe_ws.write_row(rr + 1, 0, [0, 0])
        pe_ws.write_row(rr + 2, 0, [3, 3])
        sc.add_series(
            {
                "name": "Puntos = xPts",
                "categories": [pe_ws.get_name(), rr + 1, 0, rr + 2, 0],
                "values": [pe_ws.get_name(), rr + 1, 1, rr + 2, 1],
                "line": {"color": VIOLET, "dash_type": "dash"},
                "marker": {"type": "none"},
            }
        )
        style_chart(sc, "Puntos reales frente a xPts", "xPts", "Puntos")
        pe_ws.insert_chart(rr, 3, sc)

    # 10 y 11: no se pueden reproducir en Excel; la hoja lo dice.
    add_note_sheet(
        "G10 Tabla",
        "Evolución de la tabla",
        "No disponible: la fuente solo da la tabla de posiciones actual, sin su historia fecha a fecha.",
    )
    add_note_sheet(
        "G11 Mapa de tiros",
        "Mapa de tiros",
        "No se exporta como gráfico nativo: Excel no admite una imagen de cancha de fondo."
        " Se descarga como PNG desde la web.",
    )

    # 12. Minutos (apiladas: como titular y como suplente).
    min_ws, rr = chart_sheet(
        book,
        "G12 Minutos",
        "Minutos por jugador: como titular y desde el banco",
        "Tabla maestra",
        "Columnas apiladas nativas. La línea de carga queda en la web: tiene otra escala"
        " y Excel la pondría en un segundo eje.",
    )
    sub_stat = by_id.get("minutos_como_suplente")
    mrows = [
        [
            p.name,
            p.minutes - (p.stats.get("minutos_como_suplente", 0) if sub_stat else 0),
            p.stats.get("minutos_como_suplente", 0),
        ]
        for p in players[:25]
    ]
    f0, l0 = book.table(
        min_ws, rr, ["Jugador", "Como titular", "Desde el banco"], mrows, widths=[26, 12, 12], freeze=False
    )
    ch = book.wb.add_chart({"type": "column", "subtype": "stacked"})
    ch.add_series(
        {
            "name": "Como titular",
            "categories": [min_ws.get_name(), f0, 0, l0, 0],
            "values": [min_ws.get_name(), f0, 1, l0, 1],
            "fill": {"color": GREEN_DARK},
        }
    )
    ch.add_series(
        {
            "name": "Desde el banco",
            "categories": [min_ws.get_name(), f0, 0, l0, 0],
            "values": [min_ws.get_name(), f0, 2, l0, 2],
            "fill": {"color": VIOLET},
        }
    )
    style_chart(ch, "Minutos por jugador", None, "Minutos")
    min_ws.insert_chart(rr, 4, ch)

    # 13. Métricas propias (NR por jugador, positivos y negativos en dos series).
    nr = by_id.get("nr")
    met_ws, rr = chart_sheet(
        book,
        "G13 Métricas propias",
        "NR por jugador (positivos y negativos)",
        "Tabla maestra",
        "Barras con dos series para colorear por signo: verde positivo, rojo negativo.",
    )
    nrows = sorted(
        ([p.name, v] for p in eligible if nr and (v := per90(p, nr)) is not None), key=lambda x: -x[1]
    )
    f0, l0 = book.table(
        met_ws,
        rr,
        ["Jugador", "NR positivo", "NR negativo"],
        [[n, v if v >= 0 else None, v if v < 0 else None] for n, v in nrows],
        widths=[26, 12, 12],
        freeze=False,
    )
    ch = book.wb.add_chart({"type": "bar", "subtype": "stacked"})
    ch.add_series(
        {
            "name": "Positivo",
            "categories": [met_ws.get_name(), f0, 0, l0, 0],
            "values": [met_ws.get_name(), f0, 1, l0, 1],
            "fill": {"color": GREEN_DARK},
        }
    )
    ch.add_series(
        {
            "name": "Negativo",
            "categories": [met_ws.get_name(), f0, 0, l0, 0],
            "values": [met_ws.get_name(), f0, 2, l0, 2],
            "fill": {"color": RED},
        }
    )
    style_chart(ch, "NR por jugador")
    ch.set_y_axis({"reverse": True})
    met_ws.insert_chart(rr, 4, ch)

    # 14. Correlación entre estadísticas clave (tabla con escala de color).
    corr_ws, rr = chart_sheet(
        book,
        "G14 Correlación",
        "Correlación entre estadísticas clave",
        "Tabla maestra",
        "Tabla con formato condicional de escala de color (Excel no tiene mapa de calor nativo)."
        " Pearson entre jugadores con el mínimo de minutos.",
    )
    key_stats = [s for s in stats if s.key][:12]
    matrix = []
    for a in key_stats:
        row_vals: list[Any] = [a.name]
        for b in key_stats:
            pairs = [
                (x, y) for p in eligible if (x := per90(p, a)) is not None and (y := per90(p, b)) is not None
            ]
            row_vals.append(pearson([x for x, _ in pairs], [y for _, y in pairs]) if pairs else None)
        matrix.append(row_vals)
    f0, l0 = book.table(corr_ws, rr, ["", *[s.short for s in key_stats]], matrix, widths=[26], freeze=False)
    corr_ws.conditional_format(
        f0,
        1,
        l0,
        len(key_stats),
        {
            "type": "3_color_scale",
            "min_color": "#F4B6B0",
            "mid_color": "#FFFFFF",
            "max_color": GREEN,
            "min_type": "num",
            "min_value": -1,
            "mid_type": "num",
            "mid_value": 0,
            "max_type": "num",
            "max_value": 1,
        },
    )

    # Proyección (6.1) con fórmulas vivas: solo en el global (las métricas son de toda la temporada).
    if code == "todas" and data.projection:
        projection_sheets(book, players, data.projection)

    # Situaciones (solo en el global: las tarjetas mezclan competiciones).
    if code == "todas" and data.situations:
        si = book.sheet(
            "Situaciones", "Una fila por fila de tarjeta: n, % de victorias y diferencia contra la base"
        )
        r = book.header(si, "Situaciones", "situational_result")
        book.table(
            si,
            r,
            [
                "Categoría",
                "Tarjeta",
                "Fila",
                "Partidos",
                "G",
                "E",
                "P",
                "% victorias",
                "Dif. vs base (pp)",
                "Puntos por partido",
                "GF",
                "GC",
            ],
            [
                [
                    s["category"],
                    s["title"],
                    s["param_value"],
                    s["n"],
                    s["w"],
                    s["d"],
                    s["l"],
                    s["win_pct"],
                    s["delta"],
                    s["ppg"],
                    s["gf_avg"],
                    s["ga_avg"],
                ]
                for s in data.situations
            ],
            widths=[18, 50, 22, 9, 5, 5, 5, 10, 12, 10, 7, 7],
        )

    # Índice primero.
    book.wb.worksheets_objs.sort(key=lambda w: 0 if w.get_name() == "Índice" else 1)
    idx.activate()
    return book.finish()


# --------------------------------------------------------------------------------------------
# Proyección (6.1): parámetros y cálculo paso a paso con fórmulas vivas

COMPONENTS = ("A", "C", "D", "E", "P", "G")
COMPONENT_NAMES = {
    "A": "Ataque",
    "C": "Creación",
    "D": "Defensa",
    "E": "Eficiencia",
    "P": "Participación",
    "G": "Portería",
}
RATE_SLOTS = 6
NO_LINE = "Sin posición"


def projection_sheets(
    book: Book, players: Sequence[Player], projection: dict[int, dict[str, dict[str, Any]]]
) -> None:
    """`Parámetros` y `Proyección`: el cálculo de R, Mejoría α y los Potenciales en fórmulas que leen
    los parámetros, para auditar cada número sin abrir el código. Al lado, el valor del pipeline."""
    wb = book.wb
    # Parámetros con nombre (las fórmulas los usan por nombre).
    par = book.sheet("Parámetros", "Parámetros de 6.1 que usan las fórmulas de la hoja Proyección")
    r = book.header(par, "Parámetros de la proyección (6.1)", "pipeline/projection.py")
    params = [
        ("MIN_COB", pj.MIN_COVERAGE, "Cobertura mínima de los pesos para calcular R"),
        ("K_REL", pj.K_RELIABILITY, "K de la confiabilidad w de la Mejoría α (minutos)"),
        ("Z_CLIP", pj.Z_CLIP, "Tope de cada z (más o menos)"),
        ("ALFA_ESC", pj.ALPHA_SCALE, "Escala de la Mejoría α (50 + escala × w × Z)"),
        ("K_NIVEL", pj.K_LEVEL, "K de la reducción por muestra chica (minutos)"),
        ("PICO", pj.PEAK_AGE, "Edad pico de un jugador de campo"),
        ("PICO_ARQ", pj.PEAK_AGE_GOALKEEPER, "Edad pico de un arquero"),
        ("G_ANUAL", pj.GROWTH_PER_YEAR, "Crecimiento por año hasta el pico (puntos)"),
        ("LAMBDA", pj.TREND_WEIGHT, "Peso de la tendencia (λ)"),
        ("INCERT", pj.UNCERTAINTY, "Margen de incertidumbre del Potencial α (más o menos)"),
        ("BETA_N", 0.60, "Peso del nivel (R*) en el Potencial β"),
        ("BETA_T", 0.25, "Peso de la tendencia (T) en el Potencial β"),
        ("BETA_E", 0.15, "Peso de la edad en el Potencial β"),
        ("F_MAYOR", pj.AGE_FACTOR_OLDER, "Factor de edad después de la última banda"),
    ]
    first, _ = book.table(
        par, r, ["Nombre", "Valor", "Qué es"], [list(p) for p in params], widths=[14, 10, 60], freeze=False
    )
    for i, (name, _, _) in enumerate(params):
        wb.define_name(name, f"='Parámetros'!$B${first + i + 1}")
    wr = first + len(params) + 2
    par.write_string(wr, 0, "Pesos por línea (se reescalan entre los componentes con dato)", book.bold)
    lines = [*LINES[::-1], None]
    rows = [[line or NO_LINE, *[pj.WEIGHTS[line].get(c, 0.0) for c in COMPONENTS]] for line in lines]
    wf, wl = book.table(par, wr + 1, ["Línea", *[COMPONENT_NAMES[c] for c in COMPONENTS]], rows, freeze=False)
    wb.define_name("LINEAS", f"='Parámetros'!$A${wf + 1}:$A${wl + 1}")
    wb.define_name("PESOS", f"='Parámetros'!$B${wf + 1}:$G${wl + 1}")
    br = wl + 3
    par.write_string(br, 0, "Factor de edad (arqueros: la edad se corre 2 años)", book.bold)
    bands = [[f"Menos de {limit + 1} años", limit + 1, factor] for limit, factor in pj.AGE_BANDS]
    bf, bl = book.table(par, br + 1, ["Banda", "Edad menor que", "Factor"], bands, freeze=False)
    par.autofilter(0, 0, 0, 0)

    # Datos (oculta): una fila por jugador con lo que guardó el pipeline.
    rows_data: list[list[Any]] = []
    for p in players:
        det = projection.get(p.id, {})
        if "rendimiento_indice" not in det:
            continue
        comp = det["rendimiento_indice"]["detail"].get("componentes", {})
        alpha = det.get("mejoria_alpha", {})
        alpha_det = alpha.get("detail", {})
        rates = list(alpha_det.get("tasas", []))[:RATE_SLOTS]
        flat: list[Any] = []
        for k in range(RATE_SLOTS):
            t = rates[k] if k < len(rates) else None
            flat += (
                [t["tasa"], t["r"], t["b"], t["sigma"], t["peso"], 1 if t["mas_es_mejor"] else -1]
                if t
                else [None] * 6
            )
        rows_data.append(
            [
                p.name,
                p.line or NO_LINE,
                p.age,
                p.minutes,
                1 if p.line == "Arquero" else 0,
                *[comp.get(c) for c in COMPONENTS],
                det["rendimiento_indice"]["value"],
                alpha.get("value"),
                alpha_det.get("w"),
                alpha_det.get("min_r"),
                alpha_det.get("min_b"),
                det.get("potencial_alpha", {}).get("detail", {}).get("nivel_pct"),
                det.get("potencial_alpha", {}).get("value"),
                det.get("mejoria_beta", {}).get("value"),
                det.get("potencial_beta", {}).get("value"),
                *flat,
            ]
        )
    if not rows_data:
        return
    raw = book.sheet("Datos proyección", "Lo que guardó el pipeline por jugador (oculta)")
    for i, values in enumerate(rows_data, start=1):
        for c, v in enumerate(values):
            if isinstance(v, int | float) and not isinstance(v, bool):
                raw.write_number(i, c, v)
            elif v is not None:
                raw.write_string(i, c, safe_text(str(v)))
    raw.hide()
    n = len(rows_data)

    def col(c: int) -> str:
        letter = xl_col_to_name(c)
        return f"'Datos proyección'!${letter}$2:${letter}${n + 1}"

    # Proyección: lista desplegable del jugador y el cálculo en cuatro bloques.
    ws = book.sheet(
        "Proyección", "Elegí un jugador: R, Mejoría α y los Potenciales paso a paso, con fórmulas vivas"
    )
    r = book.header(ws, "Proyección paso a paso (6.1)", "stat_value_detail + hoja Parámetros")
    ws.set_column(0, 0, 30)
    ws.set_column(1, 7, 14)
    ws.write_string(r, 0, "Jugador (elegí en la lista)", book.bold)
    ws.write_string(r, 1, rows_data[0][0], book.input)
    ws.data_validation(r, 1, r, 1, {"validate": "list", "source": f"={col(0)}"})
    ws.write_string(r, 3, "Fila", book.note)
    ws.write_formula(r, 4, f"=MATCH($B${r + 1},{col(0)},0)")
    fila = f"$E${r + 1}"

    def pick(c: int) -> str:
        return f'IF(INDEX({col(c)},{fila})="","",INDEX({col(c)},{fila}))'

    def cell(row: int, c: int) -> str:
        return xl_rowcol_to_cell(row, c, row_abs=True, col_abs=True)

    info = r + 1
    for k, (label, c) in enumerate([("Línea", 1), ("Edad", 2), ("Minutos", 3), ("Arquero (1 = sí)", 4)]):
        ws.write_string(info + k, 0, label)
        ws.write_formula(info + k, 1, f"={pick(c)}")
    line_c, age_c, min_c, gk_c = (cell(info + k, 1) for k in range(4))

    # 1. Índice de rendimiento.
    a = info + 6
    ws.write_string(a, 0, "1. Índice de rendimiento (R)", book.title_fmt)
    head = ["Componente", "Percentil", "Peso de su línea", "Tiene dato", "Peso efectivo", "Aporte"]
    for c, h in enumerate(head):
        ws.write_string(a + 1, c, h, book.head)
    for k, comp in enumerate(COMPONENTS):
        row = a + 2 + k
        ws.write_string(row, 0, COMPONENT_NAMES[comp])
        ws.write_formula(row, 1, f"={pick(5 + k)}", book.cell)
        ws.write_formula(row, 2, f"=INDEX(PESOS,MATCH({line_c},LINEAS,0),{k + 1})", book.cell)
        ws.write_formula(row, 3, f"=IF(ISNUMBER(B{row + 1}),1,0)", book.int)
        ws.write_formula(row, 4, f"=C{row + 1}*D{row + 1}", book.cell)
        ws.write_formula(row, 5, f"=IF(D{row + 1}=1,B{row + 1}*C{row + 1},0)", book.cell)
    last = a + 2 + len(COMPONENTS)
    ws.write_string(last, 0, "Cobertura (suma de pesos con dato)", book.bold)
    ws.write_formula(last, 1, f"=SUM(E{a + 3}:E{last})", book.cell)
    ws.write_string(last + 1, 0, "R = suma de aportes / cobertura", book.bold)
    ws.write_formula(
        last + 1, 1, f'=IF(B{last + 1}<MIN_COB,"n/d",SUM(F{a + 3}:F{last})/B{last + 1})', book.cell
    )
    ws.write_string(last + 1, 3, "Pipeline:", book.note)
    ws.write_formula(last + 1, 4, f"={pick(11)}", book.cell)
    r_cell = cell(last + 1, 1)

    # 2. Mejoría α.
    b = last + 4
    ws.write_string(b, 0, "2. Mejoría α (últimos 5 partidos contra el resto)", book.title_fmt)
    head = ["Tasa", "Últimos 5 (R)", "Resto (B)", "σ", "Peso", "Sentido", "z"]
    for c, h in enumerate(head):
        ws.write_string(b + 1, c, h, book.head)
    for k in range(RATE_SLOTS):
        row = b + 2 + k
        base = 20 + k * 6
        for j in range(6):
            ws.write_formula(row, j, f"={pick(base + j)}", book.text if j == 0 else book.cell)
        ws.write_formula(
            row,
            6,
            f'=IF(A{row + 1}="","",MAX(-Z_CLIP,MIN(Z_CLIP,F{row + 1}*(B{row + 1}-C{row + 1})/D{row + 1})))',
            book.cell,
        )
    zf, zl = b + 3, b + 2 + RATE_SLOTS
    m = zl + 1
    rows_b = [
        ("Estadísticas con dato", f"=COUNT(G{zf}:G{zl})"),
        (
            "Z (promedio ponderado)",
            f'=IF(B{m + 1}=0,"",SUMPRODUCT(G{zf}:G{zl},E{zf}:E{zl})'
            f"/SUMPRODUCT(--ISNUMBER(G{zf}:G{zl}),E{zf}:E{zl}))",
        ),
        ("Minutos últimos 5", f"={pick(14)}"),
        ("Minutos resto", f"={pick(15)}"),
        (
            "w = mín / (mín + K)",
            f"=IF(MIN(B{m + 3},B{m + 4})>0,MIN(B{m + 3},B{m + 4})/(MIN(B{m + 3},B{m + 4})+K_REL),0)",
        ),
        (
            "Mejoría α = 50 + escala × w × Z",
            f'=IF(B{m + 1}<3,"n/d",MAX(0,MIN(100,50+ALFA_ESC*B{m + 5}*B{m + 2})))',
        ),
    ]
    for k, (label, formula) in enumerate(rows_b):
        ws.write_string(m + k, 0, label, book.bold if k == len(rows_b) - 1 else book.text)
        ws.write_formula(m + k, 1, formula, book.cell)
    alpha_cell = cell(m + len(rows_b) - 1, 1)
    ws.write_string(m + len(rows_b) - 1, 3, "Pipeline:", book.note)
    ws.write_formula(m + len(rows_b) - 1, 4, f"={pick(12)}", book.cell)

    # 3. Potencial α.
    c3 = m + len(rows_b) + 2
    ws.write_string(c3, 0, "3. Potencial α", book.title_fmt)
    rows_c = [
        ("Nivel (percentil medio)", f"={pick(16)}"),
        (
            "N = 50 + (nivel − 50) × Min / (Min + K)",
            f'=IF(ISNUMBER(B{c3 + 2}),50+(B{c3 + 2}-50)*{min_c}/({min_c}+K_NIVEL),"n/d")',
        ),
        ("Edad pico", f"=IF({gk_c}=1,PICO_ARQ,PICO)"),
        ("Años hasta el pico", f"=IF(ISNUMBER({age_c}),MAX(0,B{c3 + 4}-{age_c}),0)"),
        ("Tendencia = (Mejoría α − 50) / 50", f"=IF(ISNUMBER({alpha_cell}),({alpha_cell}-50)/50,0)"),
        (
            "Potencial α = mín(100, N + G × años × (1 + λ × tendencia))",
            f'=IF(ISNUMBER(B{c3 + 3}),MIN(100,B{c3 + 3}+G_ANUAL*B{c3 + 5}*(1+LAMBDA*B{c3 + 6})),"n/d")',
        ),
        ("Mínimo", f'=IF(ISNUMBER(B{c3 + 7}),MAX(0,B{c3 + 7}-INCERT),"n/d")'),
        ("Máximo", f'=IF(ISNUMBER(B{c3 + 7}),MIN(100,B{c3 + 7}+INCERT),"n/d")'),
    ]
    for k, (label, formula) in enumerate(rows_c):
        ws.write_string(c3 + 1 + k, 0, label, book.bold if k == 5 else book.text)
        ws.write_formula(c3 + 1 + k, 1, formula, book.cell)
    ws.write_string(c3 + 6, 3, "Pipeline:", book.note)
    ws.write_formula(c3 + 6, 4, f"={pick(17)}", book.cell)

    # 4. Potencial β.
    d4 = c3 + len(rows_c) + 3
    ws.write_string(d4, 0, "4. Potencial β", book.title_fmt)
    lims = [f"'Parámetros'!$B${bf + 1 + i}" for i in range(bl - bf + 1)]
    facs = [f"'Parámetros'!$C${bf + 1 + i}" for i in range(bl - bf + 1)]
    factor = "F_MAYOR"
    for lim, fac in zip(reversed(lims), reversed(facs), strict=True):
        factor = f"IF(B{d4 + 5}<{lim},{fac},{factor})"
    rows_d = [
        ("R (bloque 1)", f"={r_cell}"),
        (
            "R* = 50 + (R − 50) × Min / (Min + K)",
            f'=IF(ISNUMBER(B{d4 + 2}),50+(B{d4 + 2}-50)*{min_c}/({min_c}+K_NIVEL),"n/d")',
        ),
        ("Mejoría β (pipeline)", f"={pick(18)}"),
        ("Edad usada (arqueros −2)", f'=IF(ISNUMBER({age_c}),{age_c}-IF({gk_c}=1,2,0),"")'),
        ("Factor de edad", f"={factor}"),
        (
            "T = R* + Mejoría β (entre 0 y 100)",
            f"=IF(ISNUMBER(B{d4 + 4}),MAX(0,MIN(100,B{d4 + 3}+B{d4 + 4})),B{d4 + 3})",
        ),
        ("Nivel: 0,60 × R*", f'=IF(ISNUMBER(B{d4 + 3}),BETA_N*B{d4 + 3},"n/d")'),
        ("Tendencia: 0,25 × T", f'=IF(ISNUMBER(B{d4 + 7}),BETA_T*B{d4 + 7},"n/d")'),
        ("Edad: 0,15 × 100 × factor", f"=BETA_E*100*B{d4 + 6}"),
        (
            "Potencial β = mín(100, suma)",
            f'=IF(ISNUMBER(B{d4 + 8}),MIN(100,B{d4 + 8}+B{d4 + 9}+B{d4 + 10}),"n/d")',
        ),
    ]
    for k, (label, formula) in enumerate(rows_d):
        ws.write_string(d4 + 1 + k, 0, label, book.bold if k == len(rows_d) - 1 else book.text)
        ws.write_formula(d4 + 1 + k, 1, formula, book.cell)
    ws.write_string(d4 + len(rows_d), 3, "Pipeline:", book.note)
    ws.write_formula(d4 + len(rows_d), 4, f"={pick(19)}", book.cell)

    # Tabla del plantel (valores del pipeline).
    t = d4 + len(rows_d) + 3
    ws.write_string(t - 1, 0, "Plantel: valores que guardó el pipeline", book.bold)
    book.table(
        ws,
        t,
        ["Jugador", "Línea", "Edad", "Minutos", "R", "Mejoría α", "Mejoría β", "Potencial α", "Potencial β"],
        [[v[0], v[1], v[2], v[3], v[11], v[12], v[18], v[17], v[19]] for v in rows_data],
        freeze=False,
    )
    ws.autofilter(0, 0, 0, 0)


# --------------------------------------------------------------------------------------------
# Subida


def upload(name: str, content: bytes, url: str, key: str, client: httpx.Client) -> None:
    response = client.post(
        f"{url.rstrip('/')}/storage/v1/object/{BUCKET}/{name}",
        content=content,
        headers={
            "apikey": key,
            "Authorization": f"Bearer {key}",
            "x-upsert": "true",
            "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        },
    )
    if response.status_code >= 400:
        raise RuntimeError(f"Storage respondió {response.status_code}: {response.text[:200]}")


def file_name(code: str) -> str:
    return "pelotheta-global.xlsx" if code == "todas" else f"pelotheta-{code}.xlsx"


def main(argv: list[str] | None = None) -> int:
    from pipeline.run import load_dotenv, secret_key

    parser = argparse.ArgumentParser(description="Libros de Excel de Pelotheta Θ")
    parser.add_argument("--out", help="carpeta local donde guardar los libros en vez de subirlos")
    args = parser.parse_args(argv)
    load_dotenv()
    url, key = os.environ.get("SUPABASE_URL", "").strip(), secret_key()
    if not (url and key):
        print("Faltan SUPABASE_URL o la clave secreta.", file=sys.stderr)
        return 2
    data = fetch(url, key)
    scopes = [
        ("todas", "Todas las competiciones"),
        *[(c, n) for c, n in data.competitions if c in data.players],
    ]
    with httpx.Client(timeout=TIMEOUT) as client:
        for code, scope in scopes:
            content = build(data, code, scope)
            name = file_name(code)
            if args.out:
                os.makedirs(args.out, exist_ok=True)
                with open(os.path.join(args.out, name), "wb") as handle:
                    handle.write(content)
            else:
                upload(name, content, url, key, client)
            print(f"{name}: {len(content) // 1024} KB")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
