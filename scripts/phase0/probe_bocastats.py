"""Sonda de Fase 0 para BocaStats (https://bocastats.com), sitio de hinchas no oficial.

Por qué esta sonda es tan corta:
- BocaStats no publica términos de uso ni aviso legal (se buscaron /terminos/, /aviso-legal/ y
  /terminos-y-condiciones/: 404). El pie dice "Todos los derechos reservados". Sin permiso
  explícito de reutilización, la consigna es mirar poco: robots.txt y como máximo 4 páginas.
- Su robots.txt deja a cualquier bot no listado ("*") todo salvo /admin/, /api/ y /preview/,
  así que solo se piden páginas públicas fuera de esas rutas.
- El propio changelog dice que el sitio se arma con "scrapers" de fuentes que no nombra: es un
  dato derivado de procedencia desconocida, útil a lo sumo para validar a mano.

Qué pide (en orden, todas con el cliente compartido):
1. robots.txt (no cuenta como dato).
2. /temporada/2026/: partidos 2026 por competición, agregados del equipo y goleadores.
3. /plantel/: tarjetas del plantel (dorsal, posición, PJ, goles).
4. /tabla-posiciones/: si trae a los demás equipos de la liga.
5. La ficha del máximo goleador 2026, tomada del enlace de la página de temporada (no se adivina
   la URL): datos personales y, si los enlaza, partidos individuales.

El informe guarda la FORMA de los datos (secciones, encabezados, etiquetas, conteos), no los
datos: como mucho 2 o 3 valores para confirmar que la página es de Boca 2026.

Ejecutar desde la raíz del repo:
    uv run python -m scripts.phase0.probe_bocastats
"""

from __future__ import annotations

import json
import re
from collections import Counter
from datetime import UTC, datetime
from typing import Any
from urllib.parse import urljoin, urlsplit

from bs4 import BeautifulSoup, Tag

from scripts.phase0.common import json_paths, write_report
from sources.http_client import (
    MANIFEST_PATH,
    ROOT,
    USER_AGENT,
    FetchError,
    FetchResult,
    PoliteClient,
    RetryableFetchError,
)

SOURCE = "bocastats"
# El sitemap del robots.txt apunta al dominio sin "www", así que usamos ese como canónico.
BASE = "https://bocastats.com"
HOST = "bocastats.com"
ROBOTS_URL = f"{BASE}/robots.txt"
# Tope de la consigna para esta fuente: 4 páginas (robots.txt aparte).
MAX_DATA_REQUESTS = 4
# BocaStats es un sitio chico de hinchas: una pausa más larga que el piso de 3 s es más amable.
MIN_DELAY = 5.0

SEASON_URL = f"{BASE}/temporada/2026/"
SQUAD_URL = f"{BASE}/plantel/"
STANDINGS_URL = f"{BASE}/tabla-posiciones/"

# Señales de un desafío anti-bots. No se intenta evadir: solo se detecta y se registra.
CHALLENGE_MARKERS = (
    "just a moment",
    "cf-chl",
    "challenge-platform",
    "captcha",
    "attention required",
)

# Palabras que indican qué entidades ofrece cada página. Se cuentan, no se copian.
KEYWORDS = (
    "titular",
    "suplente",
    "alineación",
    "formación",
    "minutos",
    "minuto",
    "gol",
    "asistencia",
    "penal",
    "amarilla",
    "roja",
    "cambio",
    "ingresó",
    "salió",
    "posesión",
    "remates",
    "tiros",
    "pases",
    "xg",
    "córner",
    "nacimiento",
    "nació",
    "edad",
    "años",
    "altura",
    "peso",
    "pie",
    "posición",
    "nacionalidad",
    "dorsal",
    "contrato",
    "valor",
    "debut",
)
# Minutos tipo 45' o 90+3' (comilla recta o tipográfica).
MINUTE_RE = re.compile(r"\b(\d{1,3})(?:\s*\+\s*(\d{1,2}))?\s*['’′]")
YEAR_RE = re.compile(r"\b(19|20)\d{2}\b")
RECORD_RE = re.compile(r"(\d+)G\s+(\d+)E\s+(\d+)P")
UPDATED_RE = re.compile(r"Act:\s*(\d{4}-\d{2}-\d{2})")

TERMS_REVIEWED: list[dict[str, str]] = [
    {
        "url": "https://bocastats.com/robots.txt",
        "resumen": (
            "Leído también por la sonda. Permite buscadores y bots de búsqueda/citación de IA; "
            "bloquea bots de entrenamiento (GPTBot, Claude-Web, anthropic-ai, CCBot, etc.). "
            "Para '*' solo prohíbe /admin/, /api/ y /preview/. Declara sitemap_index.xml."
        ),
    },
    {
        "url": "https://bocastats.com/privacidad/",
        "resumen": (
            "Política de privacidad (actualizada 2026-10-25): solo trata cookies, navegación y "
            "publicidad. No menciona reutilización, scraping, descarga masiva ni atribución. "
            "Operado por 'el equipo de BocaStats'; sin relación oficial con el club. Pie: "
            "'© BocaStats - Todos los derechos reservados'."
        ),
    },
    {
        "url": "https://bocastats.com/metodologia/",
        "resumen": (
            "Base propia de historial 'verificada partido a partido' desde 1905; no nombra "
            "fuentes externas ni licencia; pide consultar boca.com.ar o AFA para lo oficial."
        ),
    },
    {
        "url": "https://bocastats.com/changelog/",
        "resumen": (
            "v1.0 (ene-2026) con 'scrapers' de fixture, historial y plantel; cruce de 'dos "
            "fuentes de datos' sin nombrarlas; fichas /partido/ del archivo histórico desde "
            "jul-2026, con publicación gradual. No menciona API ni términos."
        ),
    },
    {
        "url": "https://bocastats.com/terminos/ , /aviso-legal/ , /terminos-y-condiciones/",
        "resumen": "HTTP 404 en las tres: no hay términos de uso publicados.",
    },
]


# --- utilidades de HTML -----------------------------------------------------------------------
def attr(tag: Tag, name: str) -> str:
    """Devuelve un atributo como texto ('' si no está); `class` viene como lista."""
    value = tag.get(name)
    if value is None:
        return ""
    if isinstance(value, str):
        return value
    return " ".join(value)


def text(tag: Tag | None) -> str:
    return tag.get_text(" ", strip=True) if tag is not None else ""


def section_of(href: str, page_url: str) -> str | None:
    """Primera parte de la ruta de un enlace interno (/partido/, /historial/...) o None."""
    parts = urlsplit(urljoin(page_url, href))
    if (parts.hostname or "").removeprefix("www.") != HOST:
        return None
    return parts.path.strip("/").split("/")[0] or "(inicio)"


def path_pattern(href: str) -> str:
    """Convierte /plantel/jugador/miguel-merentiel/ en /plantel/jugador/<slug>/."""
    segments = [s for s in urlsplit(href).path.split("/") if s]
    if len(segments) > 1:
        segments[-1] = "<slug>"
    return "/" + "/".join(segments) + "/"


def describe_table(table: Tag) -> dict[str, Any]:
    """Forma de una tabla: encabezados, filas de datos y cantidad de columnas."""
    header_cells: list[Tag] = list(table.select("thead th"))
    if not header_cells:  # tablas sin <thead>: la primera fila hace de encabezado
        first = table.select_one("tr")
        header_cells = list(first.select("th")) if first is not None else []
    rows = [tr for tr in table.select("tr") if tr.find_parent("thead") is None and tr.select("td")]
    widths = Counter(len(tr.select("td")) for tr in rows)
    return {
        "id": attr(table, "id"),
        "encabezados": [text(th) for th in header_cells],
        "filas": len(rows),
        "columnas_por_fila": dict(widths),
    }


def json_ld_shapes(soup: BeautifulSoup) -> list[dict[str, Any]]:
    """Tipos y forma de los bloques JSON-LD (el changelog menciona 'schema SEO')."""
    shapes: list[dict[str, Any]] = []
    for script in soup.select('script[type="application/ld+json"]'):
        raw = script.string or script.get_text()
        try:
            data = json.loads(raw)
        except json.JSONDecodeError:
            shapes.append({"error": "JSON-LD inválido"})
            continue
        items: list[Any]
        if isinstance(data, list):
            items = data
        elif isinstance(data, dict):
            items = data.get("@graph", [data])
        else:
            items = []
        types = sorted({str(i.get("@type")) for i in items if isinstance(i, dict) and "@type" in i})
        shapes.append({"tipos": types, "campos": json_paths(data, max_depth=4)[:80]})
    return shapes


def keyword_counts(page_text: str) -> dict[str, int]:
    lowered = page_text.lower()
    return {kw: lowered.count(kw) for kw in KEYWORDS if kw in lowered}


def analyze_generic(soup: BeautifulSoup, page_url: str) -> dict[str, Any]:
    """Descripción genérica de cualquier página del sitio (forma, no datos)."""
    main = soup.select_one("main") or soup.body
    page_text = text(main)
    sections: Counter[str] = Counter()
    patterns: Counter[str] = Counter()
    for a in soup.select("a[href]"):
        href = attr(a, "href")
        sec = section_of(href, page_url)
        if sec is None:
            continue
        sections[sec] += 1
        patterns[path_pattern(urljoin(page_url, href))] += 1
    return {
        "titulo_pagina": text(soup.select_one("title")),
        "h1": text(soup.select_one("h1")),
        "next_js": soup.select_one("script#__NEXT_DATA__") is not None,
        "json_embebido": len(soup.select('script[type="application/json"]')),
        "subtitulos": [text(h) for h in (main.select("h2, h3") if main else [])][:40],
        "tablas": [describe_table(t) for t in soup.select("table")],
        "json_ld": json_ld_shapes(soup),
        "enlaces_internos_por_seccion": dict(sections.most_common()),
        "patrones_de_ruta": dict(patterns.most_common(25)),
        "enlaza_fichas_de_partido": sections.get("partido", 0) > 0,
        "palabras_clave": keyword_counts(page_text),
        "minutos_detectados": len(MINUTE_RE.findall(page_text)),
        "caracteres_texto_principal": len(page_text),
    }


# --- análisis específicos ---------------------------------------------------------------------
def analyze_season(soup: BeautifulSoup) -> tuple[dict[str, Any], str | None]:
    """Partidos 2026 por competición y agregados del equipo. Devuelve también el enlace a la
    ficha del máximo goleador (la cuarta página que se pide)."""
    competitions: list[dict[str, Any]] = []
    sample: dict[str, str] = {}
    row_fields: Counter[str] = Counter()
    for h3 in soup.select("h3.tmp-torneo"):
        box = h3.find_next_sibling("div")
        rows = box.select(".tmp-res") if isinstance(box, Tag) else []
        months: Counter[str] = Counter()
        targets: Counter[str] = Counter()
        year_in_date = 0
        for r in rows:
            cond = text(r.select_one(".tmp-res-cond"))
            if cond:
                months[cond.split()[-1]] += 1
            if YEAR_RE.search(cond):
                year_in_date += 1
            if r.name == "a":
                targets[path_pattern(attr(r, "href"))] += 1
            for child in r.select("[class]"):
                row_fields[attr(child, "class")] += 1
        name = re.sub(r"\s*\(\d+\)\s*$", "", h3.get_text(" ", strip=True).split("(")[0]).strip()
        competitions.append(
            {
                "competicion": name,
                "partidos_listados": len(rows),
                "partidos_por_mes": dict(months),
                "filas_con_enlace": sum(targets.values()),
                "destino_de_los_enlaces": dict(targets),
                "fechas_con_anio_explicito": year_in_date,
            }
        )
        # Una sola fila de confirmación: el partido de Liga más reciente.
        if not sample and "Liga" in name and rows:
            first = rows[0]
            sample = {
                "competicion": name,
                "rival": text(first.select_one(".tmp-res-rival")),
                "condicion_y_fecha": text(first.select_one(".tmp-res-cond")),
                "marcador": text(first.select_one(".tmp-res-score")),
            }

    pos_lines = " ".join(text(p) for p in soup.select(".tmp-pos-line"))
    annual = RECORD_RE.search(pos_lines)
    liga_listed = sum(c["partidos_listados"] for c in competitions if "Liga" in c["competicion"])
    annual_pj = sum(int(x) for x in annual.groups()) if annual else None
    top_scorer = soup.select_one("a.tmp-gol-row[href]")
    return (
        {
            "partidos_declarados": text(soup.select_one(".sh-count")),
            "competiciones": competitions,
            "clases_de_cada_fila_de_partido": dict(row_fields),
            "interpretacion_de_campos_por_partido": {
                "tmp-res-badge": "resultado V/E/D",
                "tmp-res-rival": "rival",
                "tmp-res-cond": "localía + día y mes, sin año ni hora",
                "tmp-res-score": "marcador (goles de Boca primero)",
            },
            "etiquetas_de_agregados_del_equipo": [text(s) for s in soup.select(".tmp-rec-label")],
            "goleadores_listados": len(soup.select("a.tmp-gol-row")),
            "pj_liga_segun_tabla_anual": annual_pj,
            "pj_liga_listados": liga_listed,
            "liga_listado_incompleto": annual_pj is not None and liga_listed < annual_pj,
            "proximo_partido_mostrado": text(soup.select_one(".tmp-next-detail")),
            "muestra_confirmacion": sample,
        },
        attr(top_scorer, "href") if top_scorer is not None else None,
    )


def analyze_squad(soup: BeautifulSoup) -> dict[str, Any]:
    """Tarjetas del plantel: qué campos trae cada jugador (sin copiar nombres ni números)."""
    cards = soup.select("a.player-card")
    stat_labels: Counter[str] = Counter()
    for card in cards:
        for stat in card.select(".pc-stat"):
            label = stat.select_one("span")
            stat_labels[text(label)] += 1
    return {
        "jugadores": len(cards),
        "por_posicion": dict(Counter(text(c.select_one(".pc-pos")) for c in cards)),
        "sin_dorsal": sum(1 for c in cards if text(c.select_one(".pc-dorsal")) in {"", "-"}),
        "campos_de_tarjeta": sorted(
            {attr(x, "class") for c in cards[:3] for x in c.select("[class]")}
        ),
        "etiquetas_de_estadisticas": dict(stat_labels),
        "patron_enlace_jugador": sorted({path_pattern(attr(c, "href")) for c in cards}),
        "trae_nacimiento_o_altura_en_listado": any(
            kw in text(soup.select_one("main") or soup.body).lower()
            for kw in ("nacimiento", "altura", "edad")
        ),
    }


def analyze_standings(soup: BeautifulSoup) -> dict[str, Any]:
    """Tablas de posiciones: grupos, columnas, equipos y fecha de actualización."""
    tables: list[dict[str, Any]] = []
    for table in soup.select("table"):
        body = table.find_parent("div", class_="tabla-body")
        label = text(body.find(["h2", "h3", "span", "div"])) if isinstance(body, Tag) else ""
        teams = [text(td) for td in table.select("td.td-equipo-cell")]
        updated = UPDATED_RE.search(label)
        tables.append(
            {
                "id": attr(table, "id"),
                "grupo": label.split(" Act:")[0][:60],
                "actualizada": updated.group(1) if updated else "",
                "columnas": [text(th) for th in table.select("thead th")],
                "equipos": len(teams),
                "incluye_boca": any("Boca" in t for t in teams),
            }
        )
    return {
        "tablas": tables,
        "equipos_distintos_en_total": len({text(td) for td in soup.select("td.td-equipo-cell")}),
    }


def analyze_player(soup: BeautifulSoup) -> dict[str, Any]:
    """Ficha de jugador: qué datos trae (etiquetas, no valores personales) y su tabla partido a
    partido, que es lo único que enlaza a fichas /partido/ de 2026."""
    # Ficha biográfica: primera columna de las tablas "jg-bio-table" (solo las etiquetas).
    bio_labels = [
        text(tr.select_one("td"))
        for table in soup.select("table.jg-bio-table")
        for tr in table.select("tr")
        if tr.select_one("td") is not None
    ]
    # Bloques de estadísticas: etiqueta y a qué recorte se refiere (el subtítulo dice "de
    # liga", "Clausura", etc.). El número no se copia.
    stat_blocks = [
        {
            "etiqueta": text(block.select_one(".jg-stat-lbl")),
            "aclaracion_de_recorte": re.sub(r"\d+", "N", text(block.select_one(".jg-stat-sub"))),
        }
        for block in soup.select(".jg-stat-block")
    ]
    # Tabla partido a partido: la que tiene la columna T/S (titular/suplente).
    match_table: dict[str, Any] = {"encontrada": False}
    for table in soup.select("table"):
        headers = [text(th) for th in table.select("thead th")]
        if "T/S" not in headers:
            continue
        rows = table.select("tbody tr")
        role = Counter(text(tr.select_one("td")) for tr in rows)
        links = [attr(a, "href") for a in table.select("a[href*='/partido/']")]
        dates = sorted(
            m.group(0) for h in links if (m := re.search(r"\d{4}-\d{2}-\d{2}", h)) is not None
        )
        section = table.find_parent("div", class_="jg-section")
        title = text(section.select_one(".jg-section-title")) if section is not None else ""
        match_table = {
            "encontrada": True,
            "titulo_seccion": re.sub(r"\d+", "N", title),
            "columnas": headers,
            "filas": len(rows),
            "titular_suplente": dict(role),
            "trae_columna_de_minutos": any("min" in h.lower() for h in headers),
            "trae_columna_de_fecha": any("fecha" in h.lower() for h in headers),
            "filas_con_enlace_a_ficha_de_partido": len(links),
            "patron_enlace_partido": "/partido/<local>-vs-<visitante>-<AAAA-MM-DD>/",
            "rango_fechas_de_las_fichas_enlazadas": [dates[0], dates[-1]] if dates else [],
        }
    note = soup.select_one(".jg-stat-nota")
    value_date = soup.select_one(".jg-valor-sub")
    return {
        "etiquetas_ficha_biografica": bio_labels,
        "json_ld_persona_trae": sorted(
            {
                key
                for shape in json_ld_shapes(soup)
                for path in shape.get("campos", [])
                for key in ("birthDate", "birthPlace", "height", "nationality")
                if path.endswith(f"mainEntity.{key}")
            }
        ),
        "bloques_de_estadisticas": stat_blocks,
        "nota_del_sitio_sobre_recortes": text(note)[:160],
        "trae_valor_de_mercado": soup.select_one(".jg-valor-num") is not None,
        "valor_de_mercado_tiene_fecha": bool(value_date and YEAR_RE.search(text(value_date))),
        "tabla_partido_a_partido": match_table,
        "muestra_confirmacion": {
            "h1": text(soup.select_one("h1")),
            "titulo": text(soup.select_one("title")),
        },
    }


# --- bloqueos y registro ----------------------------------------------------------------------
def detect_block(result: FetchResult) -> str | None:
    """Describe el bloqueo (código HTTP y, si lo hay, el tipo de desafío) o None si no hay."""
    page = result.body.decode("utf-8", errors="replace").lower()
    marker = next((m for m in CHALLENGE_MARKERS if m in page), None)
    # Una página real trae mucho texto; solo un HTML corto con un marcador cuenta como desafío
    # (así un reCAPTCHA del formulario de contacto no se confunde con un bloqueo).
    challenge = f"desafío anti-bots ('{marker}')" if marker and len(page) < 30_000 else ""
    if result.status >= 400:
        return f"HTTP {result.status} {challenge}".strip()
    return challenge or None


def log_entry(result: FetchResult, note: str) -> dict[str, Any]:
    return {
        "url_masked": result.url,
        "status": result.status,
        "content_type": result.content_type,
        "bytes": len(result.body),
        "sha256": result.sha256,
        "desde_cache": result.from_cache,
        "fecha": result.fetched_at,
        "nota": note,
    }


def count_manifest_requests() -> int:
    """Requests reales a BocaStats según el manifiesto (la caché no escribe en él)."""
    if not MANIFEST_PATH.exists():
        return 0
    total = 0
    for line in MANIFEST_PATH.read_text(encoding="utf-8").splitlines():
        if line.strip() and json.loads(line).get("source") == SOURCE:
            total += 1
    return total


def summarize_robots(body: str) -> dict[str, Any]:
    """Reglas del grupo '*' y agentes con grupo propio (sin copiar el archivo entero)."""
    star: list[str] = []
    named: set[str] = set()
    agents: list[str] = []
    in_rules = False
    sitemaps: list[str] = []
    for raw in body.splitlines():
        line = raw.split("#", 1)[0].strip()
        if ":" not in line:
            continue
        key, value = (p.strip() for p in line.split(":", 1))
        key = key.lower()
        if key == "sitemap":
            sitemaps.append(value)
        elif key == "user-agent":
            if in_rules:  # empieza un grupo nuevo
                agents, in_rules = [], False
            agents.append(value)
            if value != "*":
                named.add(value)
        elif key in {"allow", "disallow", "crawl-delay"}:
            in_rules = True
            if "*" in agents:
                star.append(f"{key}: {value}")
    return {
        "reglas_para_asterisco": star,
        "agentes_con_grupo_propio": sorted(named),
        "nombra_a_nuestro_bot": any("pelotheta" in a.lower() for a in named),
        "sitemaps": sitemaps,
    }


# --- flujo principal --------------------------------------------------------------------------
class Budget:
    """Lleva la cuenta de páginas pedidas para no pasar el tope de la consigna."""

    def __init__(self, limit: int) -> None:
        self.limit = limit
        self.used = 0

    def available(self) -> bool:
        return self.used < self.limit


def fetch_page(
    client: PoliteClient,
    url: str,
    note: str,
    budget: Budget,
    report: dict[str, Any],
) -> BeautifulSoup | None:
    """Pide una página si queda cupo y robots.txt la permite. Si hay bloqueo, lo registra."""
    pages: dict[str, Any] = report["paginas"]
    if not budget.available():
        pages[note] = {"motivo": "sin cupo de requests"}
        return None
    if not client.robots_allows(url):
        pages[note] = {"motivo": "robots.txt no lo permite"}
        return None
    try:
        result = client.get(url)
    except (FetchError, RetryableFetchError) as exc:
        pages[note] = {"motivo": f"error: {exc}"}
        return None
    budget.used += 1
    report["requests"].append(log_entry(result, note))
    block = detect_block(result)
    if block:
        pages[note] = {"motivo": f"bloqueado: {block}"}
        report["bloqueado"] = True
        return None
    soup = BeautifulSoup(result.text(), "html.parser")
    pages[note] = {"url": url, **analyze_generic(soup, url)}
    return soup


def main() -> int:
    report: dict[str, Any] = {
        "source": SOURCE,
        "generado": datetime.now(UTC).isoformat(timespec="seconds"),
        "user_agent": USER_AGENT,
        "min_delay_s": MIN_DELAY,
        "tope_requests_datos": MAX_DATA_REQUESTS,
        "terminos_revisados": TERMS_REVIEWED,
        "requests": [],
        "paginas": {},
        "access_status": "error",
    }
    pages: dict[str, Any] = report["paginas"]
    budget = Budget(MAX_DATA_REQUESTS)

    with PoliteClient(source=SOURCE, min_delay=MIN_DELAY) as client:
        # 1) robots.txt: se pide explícito para registrar el código; el cliente lo reutiliza
        #    desde la caché al validar las páginas, así que no se pide dos veces.
        try:
            robots = client.get(ROBOTS_URL, check_robots=False)
        except (FetchError, RetryableFetchError) as exc:
            report["robots"] = {"error": str(exc)}
            return finish(report)
        report["requests"].append(log_entry(robots, "robots.txt"))
        if robots.status != 200:
            report["robots"] = {"status": robots.status, "bloqueo": detect_block(robots)}
            report["access_status"] = "bloqueado"
            report["motivo"] = "robots.txt no se pudo leer: ante la duda no se piden datos"
            return finish(report)
        report["robots"] = summarize_robots(robots.text())
        report["robots"]["permite"] = {
            "temporada": client.robots_allows(SEASON_URL),
            "plantel": client.robots_allows(SQUAD_URL),
            "tabla": client.robots_allows(STANDINGS_URL),
            "ficha_jugador": client.robots_allows(f"{BASE}/plantel/jugador/ejemplo/"),
            "ficha_partido": client.robots_allows(f"{BASE}/partido/ejemplo/"),
            "api": client.robots_allows(f"{BASE}/api/ejemplo"),
        }

        # 2) Temporada 2026.
        player_href: str | None = None
        soup = fetch_page(client, SEASON_URL, "temporada_2026", budget, report)
        if soup is not None:
            season, player_href = analyze_season(soup)
            pages["temporada_2026"]["especifico"] = season

        # 3) Plantel.
        if not report.get("bloqueado"):
            soup = fetch_page(client, SQUAD_URL, "plantel", budget, report)
            if soup is not None:
                pages["plantel"]["especifico"] = analyze_squad(soup)

        # 4) Tabla de posiciones.
        if not report.get("bloqueado"):
            soup = fetch_page(client, STANDINGS_URL, "tabla_posiciones", budget, report)
            if soup is not None:
                pages["tabla_posiciones"]["especifico"] = analyze_standings(soup)

        # 5) Ficha del máximo goleador 2026 (enlace real de la página de temporada).
        if not report.get("bloqueado") and player_href:
            player_url = urljoin(BASE, player_href)
            soup = fetch_page(client, player_url, "ficha_jugador", budget, report)
            if soup is not None:
                pages["ficha_jugador"]["especifico"] = analyze_player(soup)

    if report.get("bloqueado"):
        report["access_status"] = "bloqueado"
    else:
        ok = [p for p in pages.values() if "motivo" not in p]
        report["access_status"] = "funciona" if len(ok) == len(pages) else "funciona_parcial"
    return finish(report)


def finish(report: dict[str, Any]) -> int:
    report["requests_reales_en_manifiesto"] = count_manifest_requests()
    path = write_report(SOURCE, report)
    # Ruta relativa: la consola de Windows (cp1252) no puede imprimir la Θ del nombre del repo.
    print(f"Informe: {path.relative_to(ROOT).as_posix()}")
    print(f"Estado de acceso: {report['access_status']}")
    for entry in report["requests"]:
        origen = "caché" if entry["desde_cache"] else "red"
        print(f"  {entry['status']} [{origen}] {entry['url_masked']} ({entry['bytes']} bytes)")
    if "motivo" in report:
        print(f"Motivo: {report['motivo']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
