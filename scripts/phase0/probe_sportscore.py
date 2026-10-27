"""Sonda de Fase 0 para SportScore (API gratuita sin clave, https://sportscore.com/developers/).

Qué hace y por qué:

- La documentación oficial y su cliente de Python (sportscore-py, cuyo `api_base` por defecto es
  https://sportscore.com) ubican todos los endpoints de datos bajo `/api/widget/` y su alias
  `/api/v1/`. No existe un host aparte tipo api.sportscore.com en la documentación oficial.
- Antes de pedir datos se lee robots.txt con el cliente compartido. Si robots.txt prohíbe la
  ruta para nuestro User-Agent, la request NO se hace: se registra como "omitido_por_robots".
  A propósito no se usa `check_robots=False`: saltear robots.txt va contra la regla del
  proyecto aunque la documentación del sitio invite a usar la API. Esa contradicción es una
  decisión para el dueño del proyecto (por ejemplo, pedir permiso por escrito a SportScore).
- También se leen, con el mismo cliente y solo si robots.txt lo permite, dos páginas de
  documentación (términos para desarrolladores y la especificación OpenAPI) porque WebFetch
  recibió 403 en ellas. De la especificación se extrae solo la FORMA (rutas, parámetros y
  nombres de campos); de los términos, solo qué temas tocan. No se copian textos ni datos.
- No se usa el cliente oficial porque manda telemetría (un POST a /api/mcp/ping/ al crearse).

Ejecutar desde la raíz del repo:
    uv run python -m scripts.phase0.probe_sportscore
"""

from __future__ import annotations

import json
import re
import sys
import urllib.robotparser
from collections import Counter
from datetime import UTC, datetime
from typing import Any
from urllib.parse import urlencode

from bs4 import BeautifulSoup

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

SOURCE = "sportscore"
SITE = "https://sportscore.com"
ROBOTS_URL = f"{SITE}/robots.txt"

# Tope total para esta fuente: 1 robots.txt + 2 páginas de documentación + 7 de datos = 10.
MAX_DATA_REQUESTS = 7
DOC_PAGES: dict[str, str] = {
    "terminos_desarrolladores": f"{SITE}/developers/terms/",
    "openapi": f"{SITE}/developers/openapi.yaml",
}

SPORT = "football"
# Slugs tomados de URLs públicas encontradas con un buscador (no de la API):
# - sportscore.com/football/team/boca-juniors/z8yomo4hj31q0j6/  -> slug "boca-juniors".
# - La liga aparece rotulada "Argentine Division 1"; el slug de API es una SUPOSICIÓN que
#   sigue el patrón de otras ligas del sitio (spanish-la-liga, brazilian-serie-a).
BOCA_SLUG = "boca-juniors"
LEAGUE_SLUG_GUESS = "argentine-division-1"
PLACEHOLDER = "SIN_DATO_PREVIO"

# Palabras que delatan entidades interesantes en nombres de campos (vocabulario, no datos).
FIELD_HINTS: dict[str, str] = {
    "minuto": r"minute|\bmin\b|elapsed|time",
    "alineacion": r"lineup|starter|starting|bench|substitut|formation",
    "evento": r"incident|event|goal|card|penalt|assist",
    "estadistica": r"stat|shot|possession|pass|xg|corner|foul",
    "datos_personales": r"birth|age|height|weight|nationality|position|foot",
    "tabla": r"standing|rank|position|points|played|won|drawn|lost",
}

# Temas que interesan en los términos (se anota si aparecen, no el texto).
TERMS_TOPICS: dict[str, str] = {
    "atribucion": r"attribution|powered by sportscore|dofollow|backlink",
    "limite_requests": r"rate limit|requests per|requests / ?24|per ip|fair[- ]use",
    "cache_almacenamiento": r"cache|caching|store|storage|retain",
    "descarga_en_bloque": r"bulk|mirror|dump|database|archive",
    "automatizacion_scraping": r"scrap|crawl|robot|automated|bot",
    "uso_comercial": r"commercial|white[- ]label|resell|sublicens",
    "redistribucion": r"redistribut|republish|share|third part",
    "terminacion": r"terminat|suspend|revoke|block",
}

# Términos y documentación leídos a mano antes de pedir datos (regla 1). Se completa con lo
# que se pudo leer de verdad; lo que no se pudo leer se marca "no verificado".
TERMS_REVIEWED: list[dict[str, str]] = [
    {
        "url": f"{SITE}/robots.txt",
        "resumen": (
            "Leído (200). 'User-agent: *' tiene 'Disallow: /api/' (además /admin/, /auth/, "
            "/cdn-cgi/, /voting/, /favourites/, /other/settings/ y parámetros ?page=, "
            "?season_id=, ?round=, ?date=, etc.). Permite /static/, /media/, imágenes, CSS y JS. "
            "Permite a buscadores de IA (Claude-User, ChatGPT-User...) y bloquea CCBot, "
            "Bytespider y otros. Ningún comentario exceptúa la API para desarrolladores."
        ),
    },
    {
        "url": f"{SITE}/developers/",
        "resumen": (
            "WebFetch: 403 (muro anti-bots). Contenido visto solo por resúmenes de buscador: "
            "API gratis, CORS abierto, sin clave para proyectos open source y con atribución; "
            "~10.000 requests/24 h por IP; caché de 60 s en el borde; parámetro opcional src= "
            "para identificar la app."
        ),
    },
    {
        "url": f"{SITE}/developers/terms/",
        "resumen": (
            "WebFetch: 403. PoliteClient (2026-10-27): 403 con desafío de Cloudflare "
            "('Just a moment...'); no se insistió. Texto de los términos NO verificado."
        ),
    },
    {
        "url": f"{SITE}/developers/api/",
        "resumen": "WebFetch: 403. No verificado.",
    },
    {
        "url": f"{SITE}/developers/openapi.yaml",
        "resumen": (
            "WebFetch: 403. PoliteClient (2026-10-27): 403 con desafío de Cloudflare. "
            "Esquema de respuestas NO verificado."
        ),
    },
    {
        "url": f"{SITE}/terms/",
        "resumen": "Términos generales del sitio. WebFetch: 403. No verificado.",
    },
    {
        "url": "https://pypi.org/project/sportscore/ y github.com/Backspace-me/sportscore-py",
        "resumen": (
            "Cliente oficial 0.2.0 (MIT solo para el código). api_base https://sportscore.com; "
            "rutas /api/widget/{matches,match,team,standings,topscorers,player,bracket,"
            "tracker}/ con sport, slug, limit, stat, id. Telemetría: POST a /api/mcp/ping/ al "
            "instanciarse (opt-out SPORTSCORE_NO_TELEMETRY=1). Gratis ~10.000 req/24 h por IP; "
            "exige enlace visible dofollow 'Powered by SportScore'; sin atribución solo con "
            "acuerdo comercial (api@sportscore.com)."
        ),
    },
    {
        "url": "https://github.com/Backspace-me/sportscore-mcp (README)",
        "resumen": (
            "Mismos 8 endpoints. Indica ~1.000 requests/24 h por IP en el plan gratis y caché "
            "de 60 s; uso en bloque, producción o alto volumen: contactar api@sportscore.com. "
            "La atribución debe quedar visible en todo lo que vea el usuario final."
        ),
    },
]

# Hallazgos de buscador (snippets de páginas públicas del sitio): NO los verificó la sonda.
WEB_HINTS_UNVERIFIED: dict[str, Any] = {
    "boca_pagina_publica": "/football/team/boca-juniors/z8yomo4hj31q0j6/",
    "boca_id_en_url": "z8yomo4hj31q0j6",
    "libertadores_id_en_url": ("v2y8m4zhe6ql074 (/football/competition/world/conmebol-copa-libertadores/)"),
    "liga_rotulo": "Argentine Division 1 (con etapa Clausura 2026 en páginas de partidos)",
    "liga_url_competicion": "no encontrada",
    "nota": (
        "Snippets de un buscador muestran a Boca en la tabla de 'Argentine Division 1' y "
        "páginas de partido con alineaciones y H2H. No es una verificación de la API."
    ),
}


# --- presupuesto de requests ------------------------------------------------------------
class Budget:
    """Cuenta requests de datos PLANIFICADAS (aunque salgan de caché).

    Contar también los aciertos de caché hace que la sonda decida lo mismo en cada corrida,
    así una re-ejecución nunca pide URLs nuevas que la primera no pidió.
    """

    def __init__(self, limit: int) -> None:
        self.limit = limit
        self.used = 0

    def take(self) -> bool:
        if self.used >= self.limit:
            return False
        self.used += 1
        return True


# --- utilidades -----------------------------------------------------------------------------
def say(text: str) -> None:
    """Imprime sin romperse en la consola de Windows (cp1252 no tiene todos los caracteres)."""
    encoding = sys.stdout.encoding or "utf-8"
    print(text.encode(encoding, errors="replace").decode(encoding))


def describe_fetch(result: FetchResult) -> dict[str, Any]:
    """Metadatos de la descarga (sin el cuerpo)."""
    return {
        "url": result.url,
        "status": result.status,
        "content_type": result.content_type,
        "bytes": len(result.body),
        "sha256": result.sha256,
        "from_cache": result.from_cache,
        "fetched_at": result.fetched_at,
    }


def looks_like_challenge(result: FetchResult) -> bool:
    """Detecta una página de desafío anti-bots (Cloudflare u otro) para no confundirla con datos."""
    text = result.text()[:4000].lower()
    markers = ("just a moment", "cf-chl", "challenge-platform", "attention required", "captcha")
    return any(marker in text for marker in markers)


def field_hints(paths: list[str]) -> dict[str, list[str]]:
    """Agrupa rutas de campos por tipo de entidad según su nombre (solo nombres)."""
    hints: dict[str, list[str]] = {}
    for label, pattern in FIELD_HINTS.items():
        regex = re.compile(pattern, re.IGNORECASE)
        hits = [p for p in paths if regex.search(p.rsplit(".", 1)[-1])]
        if hits:
            hints[label] = hits[:25]
    return hints


def first_value_in_lists(data: Any, key: str, must_mention: str) -> str | None:
    """Busca en las listas del JSON el primer objeto que tenga `key` y mencione un texto.

    Solo mira objetos DENTRO de listas para no confundir el objeto raíz (que puede describir
    al propio equipo) con un partido o un jugador.
    """
    stack: list[Any] = [data]
    while stack:
        node = stack.pop(0)
        if isinstance(node, dict):
            stack.extend(node.values())
        elif isinstance(node, list):
            for item in node:
                if isinstance(item, dict) and item.get(key) not in (None, ""):
                    blob = json.dumps(item, ensure_ascii=False).lower()
                    if must_mention in blob:
                        return str(item[key])
            stack.extend(node)
    return None


# --- robots.txt -----------------------------------------------------------------------------
def robots_groups(lines: list[str]) -> dict[str, list[str]]:
    """Agrupa las reglas (Allow, Disallow, Crawl-delay) por User-agent.

    Un grupo de robots.txt son una o más líneas User-agent seguidas de sus reglas.
    """
    groups: dict[str, list[str]] = {}
    current: list[str] = []
    in_rules = False
    for raw in lines:
        line = raw.split("#", 1)[0].strip()
        if ":" not in line:
            continue
        field, value = (part.strip() for part in line.split(":", 1))
        name = field.lower()
        if name == "user-agent":
            if in_rules:  # empieza un grupo nuevo
                current, in_rules = [], False
            current.append(value)
            groups.setdefault(value, [])
        elif name in {"allow", "disallow", "crawl-delay"}:
            in_rules = True
            for agent in current:
                groups[agent].append(f"{field}: {value}")
    return groups


def robots_summary(client: PoliteClient, urls_to_check: dict[str, str]) -> dict[str, Any]:
    """Lee robots.txt con el mismo cliente (queda en caché y el cliente lo reutiliza)."""
    try:
        result = client.get(ROBOTS_URL, check_robots=False)
    except (FetchError, RetryableFetchError) as exc:
        return {"url": ROBOTS_URL, "estado": "error", "error": str(exc)}
    lines = result.text().splitlines()
    parser = urllib.robotparser.RobotFileParser(ROBOTS_URL)
    parser.parse(lines)
    groups = robots_groups(lines)
    return {
        **describe_fetch(result),
        "grupo_que_nos_aplica": "*",
        "reglas_user_agent_asterisco": groups.get("*", []),
        "agentes_con_grupo_propio": sorted(a for a in groups if a != "*"),
        "crawl_delay_para_nuestro_ua": parser.crawl_delay(USER_AGENT),
        # urllib.robotparser no entiende comodines en medio de la ruta (/*?page=), pero
        # "/api/" es un prefijo simple, así que el resultado para la API no depende de eso.
        "permitido_para_nuestro_ua": {
            name: parser.can_fetch(USER_AGENT, url) for name, url in urls_to_check.items()
        },
    }


# --- documentación ------------------------------------------------------------------------
def fetch_doc(client: PoliteClient, url: str) -> tuple[dict[str, Any], FetchResult | None]:
    """Pide una página de documentación si robots.txt la permite (no cuenta como dato)."""
    entry: dict[str, Any] = {"url": url}
    if not client.robots_allows(url):
        entry["estado"] = "omitido_por_robots"
        return entry, None
    try:
        result = client.get(url)
    except (FetchError, RetryableFetchError) as exc:
        entry["estado"] = "error"
        entry["error"] = str(exc)
        return entry, None
    entry.update(describe_fetch(result))
    entry["parece_desafio_antibots"] = looks_like_challenge(result)
    if result.status != 200:
        blocked = result.status in {401, 403, 429}
        entry["estado"] = "bloqueado" if blocked else f"http_{result.status}"
        return entry, None
    entry["estado"] = "leido"
    return entry, result


def terms_summary(result: FetchResult) -> dict[str, Any]:
    """Qué temas tocan los términos (sí/no). Las frases se muestran por consola, no se guardan."""
    text = BeautifulSoup(result.text(), "html.parser").get_text(" ", strip=True)
    sentences = re.split(r"(?<=[.!?])\s+", text)
    topics: dict[str, bool] = {}
    say("--- Términos: frases relevantes (solo consola, para resumir a mano) ---")
    shown = 0
    for label, pattern in TERMS_TOPICS.items():
        regex = re.compile(pattern, re.IGNORECASE)
        matching = [s for s in sentences if regex.search(s)]
        topics[label] = bool(matching)
        for sentence in matching[:4]:
            if shown < 40:
                say(f"[{label}] {sentence[:300]}")
                shown += 1
    return {"caracteres_texto": len(text), "temas_mencionados": topics}


def openapi_summary(result: FetchResult) -> dict[str, Any]:
    """Extrae rutas, parámetros y nombres de campos de la especificación (solo la forma).

    No se usa una librería YAML (el proyecto no la tiene y la regla prohíbe YAML inseguro):
    un recorrido por indentación alcanza para listar claves. Si viene en JSON, se usa JSON.
    """
    text = result.text()
    try:
        spec = json.loads(text)
    except ValueError:
        spec = None
    if isinstance(spec, dict):
        paths_obj = spec.get("paths", {})
        return {
            "formato": "json",
            "servers": [s.get("url") for s in spec.get("servers", []) if isinstance(s, dict)],
            "rutas": sorted(paths_obj) if isinstance(paths_obj, dict) else [],
            "forma": json_paths(spec, max_depth=4),
        }
    return {"formato": "yaml", **yaml_shape(text)}


KEY_RE = re.compile(r"^['\"]?([A-Za-z_][\w\-]*)['\"]?\s*:")


def yaml_shape(text: str) -> dict[str, Any]:
    """Recorrido por indentación de un YAML de OpenAPI: rutas, parámetros y propiedades."""
    servers: list[str] = []
    paths: dict[str, list[str]] = {}
    properties: set[str] = set()
    section = ""
    path_indent = -1
    current_path: str | None = None
    # Pila de bloques "properties:": [indentación del bloque, indentación de sus hijos].
    prop_stack: list[list[int]] = []
    for raw in text.splitlines():
        stripped = raw.strip()
        if not stripped or stripped.startswith("#"):
            continue
        indent = len(raw) - len(raw.lstrip(" "))
        if indent == 0:
            section = stripped.rstrip(":")
            current_path, path_indent = None, -1
            prop_stack.clear()
            continue
        if section == "servers":
            match = re.match(r"-?\s*url:\s*['\"]?([^'\"\s]+)", stripped)
            if match:
                servers.append(match.group(1))
        if section == "paths":
            if path_indent == -1:
                path_indent = indent
            if indent == path_indent and stripped.startswith(("/", "'/", '"/')):
                current_path = stripped.rstrip(":").strip("'\"")
                paths[current_path] = []
            match = re.match(r"-\s*name:\s*['\"]?([\w\-\[\]]+)", stripped)
            if match and current_path is not None:
                paths[current_path].append(match.group(1))
        while prop_stack and indent <= prop_stack[-1][0]:
            prop_stack.pop()
        if prop_stack:
            top = prop_stack[-1]
            if top[1] == -1:
                top[1] = indent
            if indent == top[1]:
                key = KEY_RE.match(stripped)
                if key:
                    properties.add(key.group(1))
        if stripped == "properties:":
            prop_stack.append([indent, -1])
    lowered = text.lower()
    return {
        "servers": servers,
        "rutas_y_parametros": {p: sorted(set(v)) for p, v in sorted(paths.items())},
        "n_rutas": len(paths),
        "nombres_de_campos": sorted(properties),
        "pistas_por_entidad": field_hints(sorted(properties)),
        "menciona": {
            "powered_by_sportscore": "powered by sportscore" in lowered,
            "lineups": "lineup" in lowered,
            "incidents": "incident" in lowered,
            "minute": "minute" in lowered,
            "xg": "xg" in lowered,
            "robots": "robots" in lowered,
            "rate_limit": "rate" in lowered and "limit" in lowered,
        },
    }


# --- datos ----------------------------------------------------------------------------------
def data_url(path: str, params: dict[str, str]) -> str:
    return f"{SITE}{path}?{urlencode(params)}"


def call(
    client: PoliteClient,
    budget: Budget,
    log: list[dict[str, Any]],
    name: str,
    path: str,
    params: dict[str, str],
) -> Any:
    """Pide un endpoint de datos solo si robots.txt lo permite y queda presupuesto."""
    url = data_url(path, params)
    entry: dict[str, Any] = {"nombre": name, "ruta": path, "params": params}
    log.append(entry)
    if not client.robots_allows(url):
        # No se pide: el cliente compartido respeta robots.txt y la sonda no lo saltea.
        entry["estado"] = "omitido_por_robots"
        return None
    if PLACEHOLDER in params.values():
        entry["estado"] = "omitido_sin_dato_previo"
        return None
    if not budget.take():
        entry["estado"] = "omitido_por_presupuesto"
        return None
    try:
        result = client.get(url)
    except (FetchError, RetryableFetchError) as exc:
        entry["estado"] = "error"
        entry["error"] = str(exc)
        return None
    entry.update(describe_fetch(result))
    if result.status != 200:
        blocked = result.status in {401, 403, 429} or looks_like_challenge(result)
        entry["estado"] = "bloqueado" if blocked else f"http_{result.status}"
        return None
    try:
        data = result.json()
    except ValueError:
        entry["estado"] = "no_json"
        return None
    entry["estado"] = "con_datos"
    entry["forma"] = json_paths(data)
    entry["pistas_por_entidad"] = field_hints(entry["forma"])
    return data


def conclusion(robots: dict[str, Any], docs: dict[str, Any], log: list[dict[str, Any]]) -> dict[str, Any]:
    """Resume el estado de acceso a partir de lo que pasó de verdad en esta corrida."""
    states = Counter(str(e.get("estado")) for e in log)
    docs_blocked = [name for name, d in docs.items() if d.get("estado") == "bloqueado"]
    if log and set(states) == {"omitido_por_robots"}:
        access = "no_probado_por_terminos"
        text = (
            "robots.txt de sportscore.com prohíbe /api/ para 'User-agent: *' (nuestro grupo). "
            "No se pidió ningún dato. Usar la API exige permiso explícito de SportScore o una "
            "decisión del dueño del proyecto; la sonda no saltea robots.txt."
        )
    elif states.get("con_datos"):
        access = "funciona" if states["con_datos"] == len(log) else "funciona_parcial"
        text = "Hubo respuestas con datos; ver 'requests_datos'."
    elif states.get("bloqueado"):
        access = "bloqueado"
        text = "El sitio respondió 401/403/429 o un desafío anti-bots."
    else:
        access = "error"
        text = "Ninguna request de datos devolvió JSON útil."
    return {
        "access_status": access,
        "texto": text,
        "estados_requests_datos": dict(states),
        "robots_status": robots.get("status"),
        "documentacion_bloqueada_por_desafio": docs_blocked,
    }


def manifest_count() -> int:
    """Requests reales a esta fuente registradas en el manifiesto (todas las corridas)."""
    if not MANIFEST_PATH.exists():
        return 0
    count = 0
    for line in MANIFEST_PATH.read_text(encoding="utf-8").splitlines():
        if line.strip() and json.loads(line).get("source") == SOURCE:
            count += 1
    return count


# --- flujo principal ------------------------------------------------------------------------
def main() -> None:
    log: list[dict[str, Any]] = []
    budget = Budget(MAX_DATA_REQUESTS)
    report: dict[str, Any] = {
        "source": SOURCE,
        "generated_at": datetime.now(UTC).isoformat(timespec="seconds"),
        "api_base": SITE,
        "api_base_nota": (
            "Confirmado por el cliente oficial (api_base por defecto) y la documentación: "
            "https://sportscore.com con rutas /api/widget/... y alias /api/v1/.... "
            "'api.sportscore.com/v1/sports' no aparece en la documentación oficial (parece "
            "confundirse con 'sportscore1' de RapidAPI, otro producto con clave de RapidAPI)."
        ),
        "nota_clave": "Sin clave: la API gratuita no la pide. No se usó ninguna clave.",
        "nota_cliente_oficial": "No se usó sportscore-py: manda telemetría al instanciarse.",
        "terms_reviewed": TERMS_REVIEWED,
        "hallazgos_web_no_verificados": WEB_HINTS_UNVERIFIED,
    }

    # Rutas a consultar contra robots.txt (la de datos lleva parámetros de ejemplo).
    urls_to_check = {
        "api_widget_team": data_url("/api/widget/team/", {"sport": SPORT, "slug": BOCA_SLUG}),
        "api_v1_standings": data_url("/api/v1/standings/", {"sport": SPORT, "slug": LEAGUE_SLUG_GUESS}),
        "pagina_publica_equipo": f"{SITE}/football/team/{BOCA_SLUG}/z8yomo4hj31q0j6/",
        **DOC_PAGES,
    }

    with PoliteClient(source=SOURCE) as client:
        report["robots_txt"] = robots_summary(client, urls_to_check)

        # 1) Documentación (no cuenta como dato): términos y especificación OpenAPI.
        docs: dict[str, Any] = {}
        entry, terms = fetch_doc(client, DOC_PAGES["terminos_desarrolladores"])
        if terms is not None:
            entry.update(terms_summary(terms))
        docs["terminos_desarrolladores"] = entry
        entry, spec = fetch_doc(client, DOC_PAGES["openapi"])
        if spec is not None:
            entry.update(openapi_summary(spec))
        docs["openapi"] = entry
        report["documentacion"] = docs

        def step(name: str, path: str, params: dict[str, str]) -> Any:
            return call(client, budget, log, name, path, params)

        # 2) Partidos de Boca (pasados y próximos) por slug de equipo.
        team = step("partidos_boca", "/api/widget/team/", {"sport": SPORT, "slug": BOCA_SLUG, "limit": "30"})
        # 3) Tabla de la liga (para comparar Boca contra el resto).
        step("tabla_liga", "/api/widget/standings/", {"sport": SPORT, "slug": LEAGUE_SLUG_GUESS})
        # 4) Goleadores de la liga.
        scorers = step(
            "goleadores_liga",
            "/api/widget/topscorers/",
            {"sport": SPORT, "slug": LEAGUE_SLUG_GUESS, "limit": "20", "stat": "goals"},
        )
        # 5) Detalle de UN partido de Boca y su "tracker" (eventos en vivo), si hay slug/id.
        match_slug = first_value_in_lists(team, "slug", "boca") or PLACEHOLDER
        match_id = first_value_in_lists(team, "id", "boca") or PLACEHOLDER
        step("detalle_partido", "/api/widget/match/", {"sport": SPORT, "slug": match_slug})
        step("tracker_partido", "/api/widget/tracker/", {"sport": SPORT, "id": match_id})
        # 6) Ficha y estadísticas de un jugador de Boca que figure entre los goleadores.
        player_slug = first_value_in_lists(scorers, "slug", "boca") or PLACEHOLDER
        step("jugador", "/api/widget/player/", {"sport": SPORT, "slug": player_slug})

    report["requests_datos"] = log
    report["conclusion_automatica"] = conclusion(report["robots_txt"], docs, log)
    report["presupuesto"] = {
        "max_requests_datos": MAX_DATA_REQUESTS,
        "requests_datos_planificadas": budget.used,
        "requests_datos_omitidas_por_robots": sum(1 for e in log if e.get("estado") == "omitido_por_robots"),
        "desde_red_en_esta_corrida": sum(1 for e in log if e.get("from_cache") is False),
        "total_en_manifiesto_incluye_robots_y_docs": manifest_count(),
    }
    path = write_report(SOURCE, report)

    # Salida breve por consola: estado de cada paso, sin datos.
    say(
        f"robots.txt: {report['robots_txt'].get('status')} "
        f"permitido={report['robots_txt'].get('permitido_para_nuestro_ua')}"
    )
    for name, doc in docs.items():
        say(f"doc {name:<26} {doc.get('status', '-')!s:<4} {doc.get('estado')}")
    for item in log:
        say(f"dato {item['nombre']:<20} {item.get('status', '-')!s:<4} {item.get('estado')}")
    # Ruta relativa: la consola de Windows (cp1252) no puede imprimir la Θ de la carpeta.
    say(f"Informe: {path.relative_to(ROOT).as_posix()}")


if __name__ == "__main__":
    main()
