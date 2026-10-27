"""Sonda de Fase 0 para FBref (Sports Reference): qué devuelve hoy la página de Boca 2026.

Por qué esta sonda es tan corta en requests:
- La política de bots de Sports Reference limita FBref a 10 requests por minuto y "encarcela"
  la sesión hasta un día si se pasa. Usamos `min_delay=6` (≤ 10 por minuto) y, además, un tope
  propio de 2 requests de datos (más robots.txt).
- Los términos de uso prohíben el acceso automatizado que perjudique el rendimiento del sitio y
  armar una base que compita con ellos. Una sonda de 2 páginas no hace ninguna de las dos cosas,
  pero no hay que insistir: si aparece un 403, 429 o un desafío anti-bots, se registra y se corta.

Qué mira:
1. robots.txt: reglas para "*" y si nuestras dos URLs están permitidas.
2. La página del dueño (Boca 2026, todas las competiciones): ids de cada <table> (también las que
   FBref esconde dentro de comentarios HTML) y sus columnas (`data-stat`), con cuántas filas traen
   valor. Así se ve si las columnas avanzadas (xG, xA, progresivos) siguen o desaparecieron.
3. Un "Match Report" de la Liga Profesional (el más reciente con informe): alineaciones, eventos
   con minuto, estadísticas de equipo y tablas por jugador.

El informe guarda la FORMA de los datos (ids, columnas, conteos), no los datos: como mucho dos o
tres valores para confirmar que la página es de Boca 2026.
"""

from __future__ import annotations

import json
import re
from collections import Counter
from datetime import UTC, datetime
from typing import Any

from bs4 import BeautifulSoup, Comment, Tag

from scripts.phase0.common import write_report
from sources.http_client import (
    MANIFEST_PATH,
    ROOT,
    USER_AGENT,
    FetchError,
    FetchResult,
    PoliteClient,
    RetryableFetchError,
)

SOURCE = "fbref"
BASE = "https://fbref.com"
ROBOTS_URL = f"{BASE}/robots.txt"
BOCA_SQUAD_ID = "795ca75e"
SQUAD_URL = f"{BASE}/en/squads/{BOCA_SQUAD_ID}/2026/all_comps/Boca-Juniors-Stats-All-Competitions"
# FBref pide como máximo 10 requests por minuto: 6 s de pausa deja exactamente ese ritmo.
MIN_DELAY = 6.0
# Tope propio de la Fase 0 para FBref (sin contar robots.txt).
MAX_DATA_REQUESTS = 2

# Columnas que dependían de Opta y que FBref retiró el 20-ene-2026. Si aparecen, se reporta
# si están vacías o con valores.
ADVANCED_RE = re.compile(r"(^|_)(xg|npxg|xa|xag|sca|gca)(_|$)|progressive|prgc|prgp|prgr", re.I)
# Señales de un desafío anti-bots (Cloudflare u otro). No se intenta evadir: solo se detecta.
CHALLENGE_MARKERS = (
    "just a moment",
    "cf-chl",
    "challenge-platform",
    "captcha",
    "attention required",
)
# Filas de <tbody> que FBref usa como separadores o encabezados repetidos, no como datos.
SKIP_ROW_CLASSES = frozenset({"thead", "over_header", "spacer"})
MINUTE_RE = re.compile(r"(\d{1,3})(?:\s*\+\s*(\d{1,2}))?\s*[’']")
FORMATION_RE = re.compile(r"\((\d(?:-\d){2,4})\)")

TERMS_REVIEWED: list[dict[str, str]] = [
    {
        "url": "https://fbref.com/robots.txt",
        "resumen": "Leído por la sonda con el cliente compartido (ver sección robots).",
    },
    {
        "url": "https://www.sports-reference.com/bot-traffic.html",
        "resumen": (
            "WebFetch devolvió 403; contenido conocido por buscador: FBref y Stathead limitan a "
            "10 requests/minuto (otros sitios SR a 20), sin importar el tipo de bot; quien se "
            "pasa queda bloqueado hasta un día. No ofrecen descarga ni API porque los datos son "
            "licenciados a terceros."
        ),
    },
    {
        "url": "https://www.sports-reference.com/termsofuse.html",
        "resumen": (
            "WebFetch devolvió 403; leído vía copia de tostracker.app (captura 2026-04-17, "
            "pie 'Last Updated: May 19, 2023'). Sección 5: prohibido usar medios automatizados "
            "sin permiso escrito 'in a manner that adversely impacts site performance or "
            "access'; prohibido crear bases que compitan o sustituyan a SRL; prohibido usar el "
            "material para entrenar, ajustar, hacer prompting o instruir modelos de IA; se "
            "permite compartir/reusar datos de páginas individuales (comercial o no) "
            "acreditando a SRL como fuente 'to the maximum extent possible'."
        ),
    },
    {
        "url": "https://www.sports-reference.com/data_use.html",
        "resumen": "WebFetch devolvió 403; no verificado.",
    },
    {
        "url": "https://faq.sports-reference.com/portal/en/kb/articles/sports-r",
        "resumen": (
            "FAQ 'Sports Reference and Data Use': solo enlaza data_use.html, bot-traffic.html "
            "y termsofuse.html; menciona venta de datasets a medida."
        ),
    },
]


# --- utilidades de HTML -----------------------------------------------------------------------
def attr(tag: Tag, name: str) -> str:
    """Devuelve un atributo como texto ('' si no está); `class` y similares vienen como lista."""
    value = tag.get(name)
    if value is None:
        return ""
    if isinstance(value, str):
        return value
    return " ".join(value)


def classes(tag: Tag) -> list[str]:
    return [str(c) for c in tag.get_attribute_list("class") if c]


def text(tag: Tag | None) -> str:
    return tag.get_text(" ", strip=True) if tag is not None else ""


def cell(row: Tag, stat: str) -> Tag | None:
    return row.select_one(f'[data-stat="{stat}"]')


def all_tables(soup: BeautifulSoup) -> list[tuple[Tag, str]]:
    """Tablas visibles y tablas escondidas en comentarios HTML (FBref las "despliega" con JS)."""
    found: list[tuple[Tag, str]] = [(t, "html") for t in soup.select("table")]
    for node in soup.descendants:
        if isinstance(node, Comment) and "<table" in node:
            inner = BeautifulSoup(str(node), "html.parser")
            found.extend((t, "comentario") for t in inner.select("table"))
    return found


def all_links(soup: BeautifulSoup) -> list[tuple[str, str]]:
    """(href, texto) de todos los enlaces, incluidos los que viven dentro de comentarios."""
    links = [(attr(a, "href"), text(a)) for a in soup.select("a[href]")]
    for node in soup.descendants:
        if isinstance(node, Comment) and "<a " in node:
            inner = BeautifulSoup(str(node), "html.parser")
            links.extend((attr(a, "href"), text(a)) for a in inner.select("a[href]"))
    return links


def body_rows(table: Tag) -> list[Tag]:
    rows: list[Tag] = list(table.select("tbody > tr"))
    if not rows:  # tablas sin <tbody> explícito
        rows = [tr for tr in table.select("tr") if tr.find_parent("thead") is None]
    return [tr for tr in rows if not SKIP_ROW_CLASSES & set(classes(tr))]


def describe_table(table: Tag, origin: str) -> dict[str, Any]:
    """Forma de una tabla: id, encabezados, filas y cuántas filas tienen valor por columna."""
    head_rows = table.select("thead > tr")
    groups: list[str] = []
    if len(head_rows) > 1:  # la primera fila es el "over_header" (Performance, Expected, ...)
        for th in head_rows[0].select("th"):
            try:
                span = int(attr(th, "colspan") or "1")
            except ValueError:
                span = 1
            groups.extend([text(th)] * span)
    header = head_rows[-1].select("th") if head_rows else []

    rows = body_rows(table)
    filled: Counter[str] = Counter()
    for tr in rows:
        for c in tr.select("th, td"):
            stat = attr(c, "data-stat")
            if stat and c.get_text(strip=True):
                filled[stat] += 1

    columns: list[dict[str, Any]] = []
    for i, th in enumerate(header):
        stat = attr(th, "data-stat")
        columns.append(
            {
                "data_stat": stat,
                "etiqueta": text(th),
                "grupo": groups[i] if i < len(groups) else "",
                "filas_con_valor": filled.get(stat, 0),
            }
        )
    advanced = [c for c in columns if ADVANCED_RE.search(c["data_stat"]) or ADVANCED_RE.search(c["etiqueta"])]
    caption = table.select_one("caption")
    return {
        "id": attr(table, "id"),
        "origen": origin,
        "titulo": text(caption),
        "filas": len(rows),
        "tiene_tfoot": table.select_one("tfoot") is not None,
        "columnas": columns,
        "columnas_avanzadas": [
            {"data_stat": c["data_stat"], "filas_con_valor": c["filas_con_valor"]} for c in advanced
        ],
    }


def keyword_snippets(soup: BeautifulSoup, keywords: list[str], width: int = 70) -> dict[str, Any]:
    """Cuenta menciones de palabras clave del sitio (avisos, pie) y guarda un fragmento corto."""
    page_text = soup.get_text(" ", strip=True)
    out: dict[str, Any] = {}
    for kw in keywords:
        hits = [m.start() for m in re.finditer(re.escape(kw), page_text, re.I)]
        snippet = ""
        if hits:
            start = max(0, hits[0] - width)
            snippet = page_text[start : hits[0] + len(kw) + width]
        out[kw] = {"menciones": len(hits), "primer_fragmento": snippet}
    return out


# --- robots.txt y bloqueos --------------------------------------------------------------------
def summarize_robots(body: str) -> dict[str, Any]:
    """Resume robots.txt: reglas del grupo '*', agentes nombrados y crawl-delay."""
    groups: list[tuple[list[str], list[str]]] = []
    agents: list[str] = []
    rules: list[str] = []
    for raw in body.splitlines():
        line = raw.split("#", 1)[0].strip()
        if not line or ":" not in line:
            continue
        key, value = (part.strip() for part in line.split(":", 1))
        key = key.lower()
        if key == "user-agent":
            if rules:  # empieza un grupo nuevo
                groups.append((agents, rules))
                agents, rules = [], []
            agents.append(value)
        elif key in {"allow", "disallow", "crawl-delay"}:
            rules.append(f"{key}: {value}")
        elif key == "sitemap":
            continue
    if agents or rules:
        groups.append((agents, rules))
    star_rules = [r for ags, rs in groups if "*" in ags for r in rs]
    named = sorted({a for ags, _ in groups for a in ags if a != "*"})
    return {
        "lineas": len(body.splitlines()),
        "reglas_para_asterisco": star_rules,
        "agentes_con_grupo_propio": named,
        "nombra_a_nuestro_bot": any("pelotheta" in a.lower() for a in named),
    }


def detect_block(result: FetchResult) -> str | None:
    """Describe el bloqueo (código HTTP y, si lo hay, el tipo de desafío) o None si no hay."""
    page = result.body.decode("utf-8", errors="replace").lower()
    # Una página real de FBref trae tablas; solo si no las trae buscamos señales de desafío
    # (así un script de reCAPTCHA del login no se confunde con un bloqueo).
    marker = None
    if "<table" not in page:
        marker = next((m for m in CHALLENGE_MARKERS if m in page), None)
    challenge = f"desafío anti-bots ('{marker}')" if marker else ""
    if result.status >= 400:
        return f"HTTP {result.status} {challenge}".strip()
    return challenge or None


def block_details(result: FetchResult) -> dict[str, Any]:
    """Qué devolvió el sitio al bloquear: título de la página y si menciona a Cloudflare.

    Sirve para distinguir un límite de ritmo propio de Sports Reference (su "jail") de un
    desafío de JavaScript de Cloudflare, que un cliente sin navegador nunca puede pasar.
    """
    soup = BeautifulSoup(result.body.decode("utf-8", errors="replace"), "html.parser")
    lowered = result.body.decode("utf-8", errors="replace").lower()
    return {
        "status": result.status,
        "content_type": result.content_type,
        "titulo": text(soup.select_one("title")),
        "menciona_cloudflare": "cloudflare" in lowered,
        "pide_javascript_y_cookies": "enable javascript and cookies" in lowered,
        "bloqueo": detect_block(result),
    }


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
    """Requests reales a FBref según el manifiesto (la caché no escribe en él)."""
    if not MANIFEST_PATH.exists():
        return 0
    total = 0
    for line in MANIFEST_PATH.read_text(encoding="utf-8").splitlines():
        if line.strip() and json.loads(line).get("source") == SOURCE:
            total += 1
    return total


# --- análisis de la página del plantel ---------------------------------------------------------
def analyze_squad(html: str) -> dict[str, Any]:
    soup = BeautifulSoup(html, "html.parser")
    tables = all_tables(soup)
    described = [describe_table(t, o) for t, o in tables]

    links = all_links(soup)
    comps: dict[str, str] = {}
    squads: set[str] = set()
    seasons: set[str] = set()
    for href, label in links:
        if m := re.search(r"/en/comps/(\d+)/", href):
            comps.setdefault(m.group(1), label)
        if m := re.search(r"/en/squads/([0-9a-f]{8})/", href):
            squads.add(m.group(1))
        if m := re.search(rf"/en/squads/{BOCA_SQUAD_ID}/(\d{{4}}(?:-\d{{4}})?)/", href):
            seasons.add(m.group(1))

    matchlogs = next((t for t, _ in tables if attr(t, "id").startswith("matchlogs")), None)
    matches: dict[str, Any] = {"encontrada": matchlogs is not None}
    candidates: list[dict[str, str]] = []
    if matchlogs is not None:
        rows = body_rows(matchlogs)
        dates = sorted(text(cell(r, "date")) for r in rows if text(cell(r, "date")))
        played = [r for r in rows if text(cell(r, "result"))]
        comp_counter = Counter(text(cell(r, "comp")) for r in rows)
        venue_counter = Counter(text(cell(r, "venue")) for r in rows)
        for r in played:
            link = r.select_one('[data-stat="match_report"] a[href]')
            if link is not None and "/en/matches/" in attr(link, "href"):
                candidates.append(
                    {
                        "date": text(cell(r, "date")),
                        "comp": text(cell(r, "comp")),
                        "href": attr(link, "href"),
                    }
                )
        sample = [
            {
                "fecha": text(cell(r, "date")),
                "competicion": text(cell(r, "comp")),
                "rival": text(cell(r, "opponent")),
            }
            for r in played[:2]
        ]
        matches.update(
            {
                "id": attr(matchlogs, "id"),
                "filas": len(rows),
                "jugados_con_resultado": len(played),
                "con_match_report": len(candidates),
                "fecha_min": dates[0] if dates else "",
                "fecha_max": dates[-1] if dates else "",
                "partidos_por_competicion": dict(comp_counter),
                "localia_valores": dict(venue_counter),
                "muestra_confirmacion": sample,
            }
        )

    # Tablas de posiciones de la liga (FBref las nombra "results<temporada><comp>...").
    standings = []
    for t, o in tables:
        tid = attr(t, "id")
        if tid.startswith("results") or "standings" in tid:
            teams = [text(cell(r, "team")) for r in body_rows(t)]
            standings.append(
                {
                    "id": tid,
                    "origen": o,
                    "equipos": len([x for x in teams if x]),
                    "incluye_boca": any("Boca" in x for x in teams),
                }
            )

    h1 = soup.select_one("h1")
    title = soup.select_one("title")
    return {
        "titulo_pagina": text(title),
        "h1": text(h1),
        "tablas": described,
        "ids_tablas": [d["id"] for d in described],
        "tablas_en_comentarios": [d["id"] for d in described if d["origen"] == "comentario"],
        "columnas_avanzadas_encontradas": {
            d["id"]: d["columnas_avanzadas"] for d in described if d["columnas_avanzadas"]
        },
        "partidos": matches,
        "tablas_de_posiciones": standings,
        "competiciones_enlazadas": comps,
        "squad_ids_enlazados": len(squads),
        "temporadas_de_boca_enlazadas": sorted(seasons),
        "avisos_del_sitio": keyword_snippets(soup, ["Opta", "advanced", "provided by"]),
        "_candidatos_match_report": candidates,
    }


def choose_match(candidates: list[dict[str, str]]) -> dict[str, str] | None:
    """El partido de Liga más reciente con informe; si no hay de Liga, el más reciente de todos."""
    liga = [c for c in candidates if "Liga" in c["comp"] or "Primera" in c["comp"]]
    pool = liga or candidates
    return max(pool, key=lambda c: c["date"]) if pool else None


# --- análisis del Match Report ----------------------------------------------------------------
def analyze_lineup(div: Tag) -> dict[str, Any]:
    table = div.select_one("table")
    if table is None:
        return {"tabla": False}
    starters = bench = 0
    in_bench = False
    formation = False
    for tr in table.select("tr"):
        th = tr.select_one("th")
        if th is not None and tr.select_one("td") is None:
            label = text(th)
            if FORMATION_RE.search(label):
                formation = True
            if label.lower().startswith(("bench", "suplentes")):
                in_bench = True
            continue
        if tr.select_one('a[href*="/en/players/"]') is None:
            continue
        if in_bench:
            bench += 1
        else:
            starters += 1
    return {"titulares": starters, "suplentes": bench, "trae_formacion": formation}


def analyze_events(soup: BeautifulSoup) -> dict[str, Any]:
    wrap = soup.select_one("#events_wrap")
    if wrap is None:
        return {"encontrado": False}
    types: Counter[str] = Counter()
    with_minute = with_stoppage = with_assist = 0
    events = wrap.select("div.event")
    for ev in events:
        icon = ev.select_one(".event_icon")
        kind = " ".join(c for c in classes(icon) if c != "event_icon") if icon else "sin_icono"
        types[kind or "sin_icono"] += 1
        m = MINUTE_RE.search(text(ev))
        if m:
            with_minute += 1
            if m.group(2):
                with_stoppage += 1
        if "Assist:" in text(ev):
            with_assist += 1
    return {
        "encontrado": True,
        "eventos": len(events),
        "por_tipo": dict(types),
        "con_minuto": with_minute,
        "con_minuto_de_descuento": with_stoppage,
        "goles_con_asistente": with_assist,
    }


def analyze_team_stats(soup: BeautifulSoup) -> dict[str, Any]:
    main_labels: list[str] = []
    box = soup.select_one("#team_stats table")
    if box is not None:
        main_labels = [text(th) for th in box.select("th") if attr(th, "colspan") == "2"]
    extra_labels: list[str] = []
    for div in soup.select("#team_stats_extra div > div"):
        if "th" in classes(div) or div.select_one("div") is not None:
            continue
        label = text(div)
        if label and not re.search(r"\d", label):
            extra_labels.append(label)
    return {"principales": main_labels, "extra": extra_labels}


def analyze_match(html: str) -> dict[str, Any]:
    soup = BeautifulSoup(html, "html.parser")
    scorebox = soup.select_one("div.scorebox")
    teams = [text(a) for a in soup.select("div.scorebox strong a[href*='/en/squads/']")][:2]
    meta = text(soup.select_one("div.scorebox_meta"))
    date_tag = soup.select_one("span.venuetime")
    tables = [describe_table(t, o) for t, o in all_tables(soup)]
    return {
        "titulo_pagina": text(soup.select_one("title")),
        "muestra_confirmacion": {
            "equipos": teams,
            "fecha": attr(date_tag, "data-venue-date") if date_tag else "",
        },
        "scorebox": {
            "encontrado": scorebox is not None,
            "trae_marcador": len(soup.select("div.scorebox div.score")) == 2,
            "trae_dt": "Manager" in text(scorebox),
            "trae_capitan": "Captain" in text(scorebox),
            "trae_estadio": "Venue" in meta,
            "trae_asistencia": "Attendance" in meta,
            "trae_arbitros": "Officials" in meta,
            "trae_hora": date_tag is not None,
        },
        "alineaciones": {
            attr(div, "id") or f"lineup_{i}": analyze_lineup(div)
            for i, div in enumerate(soup.select("div.lineup"))
        },
        "eventos": analyze_events(soup),
        "estadisticas_equipo": analyze_team_stats(soup),
        "tablas": tables,
        "ids_tablas": [t["id"] for t in tables],
        "tablas_en_comentarios": [t["id"] for t in tables if t["origen"] == "comentario"],
        "columnas_avanzadas_encontradas": {
            t["id"]: t["columnas_avanzadas"] for t in tables if t["columnas_avanzadas"]
        },
    }


# --- flujo principal --------------------------------------------------------------------------
def main() -> int:
    report: dict[str, Any] = {
        "source": SOURCE,
        "generado": datetime.now(UTC).isoformat(timespec="seconds"),
        "user_agent": USER_AGENT,
        "min_delay_s": MIN_DELAY,
        "tope_requests_datos": MAX_DATA_REQUESTS,
        "terminos_revisados": TERMS_REVIEWED,
        "requests": [],
        "access_status": "error",
    }
    log: list[dict[str, Any]] = report["requests"]
    data_requests = 0

    with PoliteClient(source=SOURCE, min_delay=MIN_DELAY) as client:
        # 1) robots.txt: se pide explícito para registrar el código; el cliente lo reutiliza
        #    desde la caché cuando valida las URLs de datos, así que no se pide dos veces.
        try:
            robots = client.get(ROBOTS_URL, check_robots=False)
        except (FetchError, RetryableFetchError) as exc:
            report["robots"] = {"error": str(exc)}
            return finish(report)
        log.append(log_entry(robots, "robots.txt"))
        if robots.status == 200:
            report["robots"] = summarize_robots(robots.text())
        else:
            # robots.txt bloqueado o ilegible: el cliente lo trata como "no permitido" y no se
            # pide ningún dato (ante la duda, no scrapeamos). Se documenta qué respondió.
            report["robots"] = block_details(robots)
        report["robots"]["permite_url_plantel"] = client.robots_allows(SQUAD_URL)
        report["robots"]["permite_match_reports"] = client.robots_allows(
            f"{BASE}/en/matches/00000000/Ejemplo"
        )
        if not report["robots"]["permite_url_plantel"]:
            # Sin permiso de robots.txt (o robots.txt ilegible) no se pide ningún dato.
            report["access_status"] = "bloqueado"
            if robots.status == 200:
                report["motivo"] = "robots.txt no permite la URL del plantel"
            else:
                report["motivo"] = f"robots.txt respondió {detect_block(robots)}; no se insiste"
            report["no_verificado"] = (
                "Ids de tablas y columnas actuales de la página de Boca 2026 y de los Match "
                "Reports: no se pidió ningún dato porque el sitio bloqueó el primer request."
            )
            return finish(report)

        # 2) Página del dueño: Boca 2026, todas las competiciones.
        try:
            squad = client.get(SQUAD_URL)
        except (FetchError, RetryableFetchError) as exc:
            report["motivo"] = f"error al pedir la página del plantel: {exc}"
            return finish(report)
        data_requests += 1
        log.append(log_entry(squad, "página del plantel (all_comps 2026)"))
        block = detect_block(squad)
        if block:
            report["access_status"] = "bloqueado"
            report["motivo"] = f"página del plantel: {block}"
            return finish(report)
        squad_info = analyze_squad(squad.text())
        candidates = squad_info.pop("_candidatos_match_report")
        report["plantel_all_comps"] = squad_info
        report["access_status"] = "funciona_parcial"

        # 3) Un Match Report (alineaciones, eventos, box score). Solo si queda cupo.
        chosen = choose_match(candidates)
        if chosen is None:
            report["match_report"] = {"motivo": "no se encontró ningún enlace a Match Report"}
            return finish(report)
        match_url = BASE + chosen["href"] if chosen["href"].startswith("/") else chosen["href"]
        if data_requests >= MAX_DATA_REQUESTS:
            return finish(report)
        try:
            match = client.get(match_url)
        except (FetchError, RetryableFetchError) as exc:
            report["match_report"] = {"motivo": f"error: {exc}"}
            return finish(report)
        data_requests += 1
        log.append(log_entry(match, f"match report ({chosen['comp']}, {chosen['date']})"))
        block = detect_block(match)
        if block:
            report["match_report"] = {"motivo": f"bloqueado: {block}"}
            return finish(report)
        report["match_report"] = {"competicion": chosen["comp"], **analyze_match(match.text())}
        report["access_status"] = "funciona"

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
