"""Sonda de Fase 0 para Wikidata y Wikipedia (datos de apoyo, no estadísticas).

Qué hace y por qué:

- Wikidata (CC0) puede aportar ids estables, datos personales básicos del plantel (fecha de
  nacimiento, altura, posición, nacionalidad) y coordenadas de estadios. Wikipedia (CC BY-SA)
  puede aportar resultados, planteles y tablas de la temporada, pero hay que citarla.
- Todas las requests pasan por el cliente compartido `PoliteClient`, que respeta robots.txt,
  la pausa por host, la caché y el manifiesto con SHA-256. Si robots.txt no permite una URL,
  el cliente la rechaza SIN tocar la red y la sonda lo registra como bloqueo: no se evade.
- El informe describe la FORMA de los datos y cuenta cobertura (cuántos jugadores tienen fecha
  de nacimiento, etc.), pero no copia datos de terceros. Los datos de personas son datos
  personales (Ley 25.326): por minimización, en el informe solo van conteos, nunca valores.

Ejecutar desde la raíz del repo:
    uv run python -m scripts.phase0.probe_wikidata_wikipedia
"""

from __future__ import annotations

import json
import re
import urllib.robotparser
from collections import Counter
from datetime import UTC, datetime
from typing import Any
from urllib.parse import quote

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
    mask_url,
)

SOURCE = "wikidata_wikipedia"

SPARQL_ORIGIN = "https://query.wikidata.org"
SPARQL_ENDPOINT = f"{SPARQL_ORIGIN}/sparql"
WIKIDATA_ORIGIN = "https://www.wikidata.org"
ENTITY_DATA = f"{WIKIDATA_ORIGIN}/wiki/Special:EntityData/"
ES_ORIGIN = "https://es.wikipedia.org"
EN_ORIGIN = "https://en.wikipedia.org"

# Q170703 es el candidato para Boca Juniors; la sonda lo verifica con la etiqueta del ítem.
BOCA_QID = "Q170703"
SEASON_YEAR = 2026

MAX_DATA_REQUESTS = 10  # tope total de requests de datos para esta fuente (robots.txt no cuenta)
MAX_SPARQL_REQUESTS = 4  # tope pedido para el servicio SPARQL dentro del total

# Páginas de Wikipedia elegidas a mano (títulos encontrados con un buscador web, no con la API).
# Se piden como /wiki/Título, que es la forma que la política de robots de Wikimedia recomienda
# (HTML cacheable); /w/api.php y /api/ están bloqueados en robots.txt para User-agent: *.
WIKIPEDIA_PAGES: list[tuple[str, str, str]] = [
    ("temporada_boca_es", ES_ORIGIN, "Anexo:Temporada_2026_del_Club_Atlético_Boca_Juniors"),
    ("temporada_boca_en", EN_ORIGIN, "2026_Club_Atlético_Boca_Juniors_season"),
    ("campeonato_2026_es", ES_ORIGIN, "Campeonato_de_Primera_División_2026_(Argentina)"),
    ("clausura_2026_es", ES_ORIGIN, "Anexo:Torneo_Clausura_2026_(Argentina)"),
]

# Consultas SPARQL planificadas (≤ 4). Se guardan en el informe aunque no se puedan ejecutar,
# para que la decisión sobre robots.txt se tome con las consultas exactas a la vista.
SPARQL_QUERIES: dict[str, str] = {
    "verificar_boca": """
SELECT ?item ?itemLabel ?itemDescription ?venue ?venueLabel ?coord ?league ?leagueLabel WHERE {
  VALUES ?item { wd:BOCA }
  OPTIONAL { ?item wdt:P115 ?venue . OPTIONAL { ?venue wdt:P625 ?coord . } }
  OPTIONAL { ?item wdt:P118 ?league . }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "es,en". }
}""",
    "jugadores_P54_2026": """
SELECT ?player ?start ?end ?birth ?height ?position ?nationality WHERE {
  ?player p:P54 ?membership .
  ?membership ps:P54 wd:BOCA .
  OPTIONAL { ?membership pq:P580 ?start . }
  OPTIONAL { ?membership pq:P582 ?end . }
  FILTER(!BOUND(?end) || YEAR(?end) >= 2026)
  FILTER(!BOUND(?start) || YEAR(?start) <= 2026)
  OPTIONAL { ?player wdt:P569 ?birth . }
  OPTIONAL { ?player p:P2048/psn:P2048/wikibase:quantityAmount ?height . }
  OPTIONAL { ?player wdt:P413 ?position . }
  OPTIONAL { ?player wdt:P27 ?nationality . }
}""",
    "estadios_de_la_liga": """
SELECT ?team ?venue ?coord WHERE {
  wd:BOCA wdt:P118 ?league .
  ?team wdt:P118 ?league ;
        wdt:P115 ?venue .
  OPTIONAL { ?venue wdt:P625 ?coord . }
}""",
}

# Páginas de términos, políticas y documentación leídas antes de pedir datos (regla 1).
TERMS_REVIEWED: list[dict[str, str]] = [
    {
        "url": "https://foundation.wikimedia.org/wiki/Policy:Wikimedia_Foundation_User-Agent_Policy",
        "resumen": (
            "Bots y scripts deben mandar un User-Agent descriptivo con contacto (sitio web, email "
            "o usuario wiki), formato recomendado '<cliente>/<versión> (<contacto>) <librería>', "
            "idealmente con la palabra 'bot'. No copiar el UA de un navegador ni usar UAs "
            "genéricos (curl, python-requests). Sin UA o con UA genérico: HTTP 403 o bloqueo sin "
            "aviso. No fija límites de tasa."
        ),
    },
    {
        "url": f"{SPARQL_ORIGIN}/robots.txt",
        "resumen": (
            "User-agent: * con 'Disallow: /sparql' y 'Disallow: /bigdata'. El endpoint SPARQL "
            "queda vedado para cualquier robot que respete robots.txt."
        ),
    },
    {
        "url": f"{WIKIDATA_ORIGIN}/robots.txt (mismo archivo que es/en.wikipedia.org/robots.txt)",
        "resumen": (
            "Para User-agent: * bloquea /w/ (Action API), /api/ (REST), /wiki/Special: y muchas "
            "páginas internas; permite /wiki/Título. Agrega 'Disallow: /wiki/Special:EntityData/' "
            "seguido de 'Allow: /wiki/Special:EntityData/*.' (los JSON de entidades con "
            "extensión quedan permitidos por la regla más larga, RFC 9309). Sin Crawl-delay "
            "para '*'. 33 robots nombrados con reglas propias."
        ),
    },
    {
        "url": "https://wikitech.wikimedia.org/wiki/Robot_policy",
        "resumen": (
            "Revisión del 16-03-2026. 'Honor every directive in our robots.txt file'. Preferir "
            "dumps a requests en vivo. /wiki/: concurrencia < 10 y < 20 req/s. REST sin auth: "
            "concurrencia 3 y < 5 req/s. Action API sin auth: concurrencia 1 y < 5 req/s. Pedir "
            "gzip, respetar Retry-After en 429. No menciona Wikidata Query Service."
        ),
    },
    {
        "url": "https://www.mediawiki.org/wiki/Wikidata_Query_Service/User_Manual",
        "resumen": (
            "Endpoint SPARQL: timeout 60 s; 60 s de cómputo por minuto por cliente (UA + IP); "
            "30 consultas con error por minuto; 5 consultas en paralelo por IP; 429 con "
            "Retry-After y ban temporal si se ignora. Exige User-Agent según la política. Para "
            "uso masivo describe montar una instancia propia desde los dumps RDF."
        ),
    },
    {
        "url": "https://www.wikidata.org/wiki/Wikidata:Licensing",
        "resumen": (
            "Datos estructurados (espacios principal, Property, Lexeme, EntitySchema) en CC0: "
            "sin obligación de atribución. El resto del texto del sitio en CC BY-SA 4.0."
        ),
    },
    {
        "url": "https://foundation.wikimedia.org/wiki/Policy:Terms_of_Use",
        "resumen": (
            "Texto de Wikipedia en CC BY-SA 4.0 (y GFDL): se permite reutilizar, también con "
            "fines comerciales, atribuyendo (enlace a la página o lista de autores), marcando "
            "los cambios y compartiendo igual. Prohíbe cargar de forma indebida APIs o sitios; "
            "incorpora por referencia las políticas de User-Agent, Robot y API:Etiquette."
        ),
    },
]

# --- patrones para describir páginas sin copiar datos ------------------------------------
# Minutos de partido como 23' o 90+2' (también con ’ o ′).
MINUTE_RE = re.compile(r"\b\d{1,3}(?:\s?\+\s?\d{1,2})?\s?['’′]")
MONTHS_EN = "January|February|March|April|May|June|July|August|September|October|November|December"
BIRTH_DATE_RE = re.compile(
    r"\b\d{1,2} de [a-záéíóú]+ de (?:19|20)\d{2}\b"  # 3 de abril de 2001
    rf"|\b\d{{1,2}} (?:{MONTHS_EN}) (?:19|20)\d{{2}}\b"  # 3 April 2001
    r"|\b(?:19|20)\d{2}-\d{2}-\d{2}\b"  # 2001-04-03
    r"|\(\s*(?:edad\s+)?\d{2}\s*años\s*\)|\(\s*aged?\s+\d{2}\s*\)",  # (24 años) / (age 24)
    re.IGNORECASE,
)
HEIGHT_RE = re.compile(r"\b[12][,.]\d{2}\s?m\b")

# Palabras de encabezado de columna que identifican qué trae cada columna de una tabla.
COLUMN_KINDS: dict[str, tuple[str, ...]] = {
    "jugador": ("jugador", "nombre", "player", "name"),
    "posicion": ("pos", "posición", "position"),
    "nacionalidad": ("nacionalidad", "nac.", "nation", "nat.", "país"),
    "nacimiento_o_edad": ("nacimiento", "edad", "born", "birth", "age"),
    "altura": ("altura", "estatura", "height"),
    "minutos": ("min", "minutos", "minutes", "mins"),
    "puntos": ("pts", "pts.", "puntos", "points"),
    "partidos_jugados": ("pj", "pld", "apps", "partidos", "j"),
}


# --- presupuesto de requests ------------------------------------------------------------
class Budget:
    """Cuenta requests de datos PLANIFICADAS (aunque salgan de caché o las frene robots.txt).

    Contarlas siempre hace que la sonda decida lo mismo en cada corrida: una re-ejecución nunca
    pide URLs nuevas que la primera no pidió.
    """

    def __init__(self, limit: int, sparql_limit: int) -> None:
        self.limit = limit
        self.sparql_limit = sparql_limit
        self.used = 0
        self.sparql_used = 0

    def take(self, *, sparql: bool = False) -> bool:
        if self.used >= self.limit:
            return False
        if sparql and self.sparql_used >= self.sparql_limit:
            return False
        self.used += 1
        if sparql:
            self.sparql_used += 1
        return True


# --- utilidades generales ---------------------------------------------------------------
def as_dict(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def as_list(value: Any) -> list[Any]:
    return value if isinstance(value, list) else []


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


def fetch(
    client: PoliteClient,
    budget: Budget,
    log: list[dict[str, Any]],
    name: str,
    url: str,
    params: dict[str, str] | None = None,
    *,
    sparql: bool = False,
) -> FetchResult | None:
    """Pide una URL de datos (si queda presupuesto) y registra qué pasó. Devuelve solo si es 200."""
    entry: dict[str, Any] = {"nombre": name}
    # Para SPARQL no se guarda la URL entera (la consulta va aparte, en `consultas_sparql`).
    entry["url_pedida"] = SPARQL_ENDPOINT if sparql else mask_url(url)
    log.append(entry)
    if not budget.take(sparql=sparql):
        entry["estado"] = "omitido_por_presupuesto"
        return None
    try:
        result = client.get(url, params=params)
    except FetchError as exc:
        # El cliente rechaza ANTES de tocar la red lo que robots.txt no permite: no se evade.
        entry["estado"] = "bloqueado_por_robots_txt" if "robots.txt" in str(exc) else "error"
        entry["error"] = str(exc)
        entry["llego_a_la_red"] = "robots.txt" not in str(exc)
        return None
    except RetryableFetchError as exc:
        entry["estado"] = "bloqueado_429" if "HTTP 429" in str(exc) else "error_transitorio"
        entry["error"] = str(exc)
        return None
    entry.update(describe_fetch(result))
    if sparql:
        entry["url"] = SPARQL_ENDPOINT
    if result.status == 200:
        entry["estado"] = "ok"
        return result
    entry["estado"] = "bloqueado" if result.status in (403, 429) else f"http_{result.status}"
    return None


def parse_json(result: FetchResult | None, entry: dict[str, Any]) -> Any:
    if result is None:
        return None
    try:
        return result.json()
    except ValueError:  # incluye JSONDecodeError y UnicodeDecodeError
        entry["json_invalido"] = True
        return None


# --- robots.txt ---------------------------------------------------------------------------
def robots_summary(client: PoliteClient, origin: str, probe_urls: dict[str, str]) -> dict[str, Any]:
    """Lee robots.txt con el mismo cliente (queda en caché y el cliente lo reutiliza).

    `probe_urls` son ejemplos de las URLs que la sonda querría pedir: se informa si nuestro
    User-Agent puede pedirlas según el parser de Python (que sigue el RFC 9309).
    """
    robots_url = f"{origin}/robots.txt"
    try:
        result = client.get(robots_url, check_robots=False)
    except (FetchError, RetryableFetchError) as exc:
        return {"url": robots_url, "estado": "error", "error": str(exc)}
    lines = result.text().splitlines()
    parser = urllib.robotparser.RobotFileParser(robots_url)
    parser.parse(lines)
    summary: dict[str, Any] = {
        **describe_fetch(result),
        "n_lineas": len(lines),
        "crawl_delay_para_nuestro_ua": parser.crawl_delay(USER_AGENT),
        "permitido_para_nuestro_ua": {
            name: parser.can_fetch(USER_AGENT, url) for name, url in probe_urls.items()
        },
    }
    if len(lines) <= 20:
        # Un robots.txt corto es política del sitio, no datos: se anota completo.
        summary["contenido"] = [ln for ln in lines if ln.strip()]
    return summary


# --- Wikidata: entidades JSON ---------------------------------------------------------------
def entity_from(data: Any, qid: str) -> dict[str, Any] | None:
    entities = as_dict(as_dict(data).get("entities"))
    if not entities:
        return None
    # Si el ítem fue fusionado, la clave es el Q-id de destino: se toma el único que venga.
    entity = entities.get(qid) or next(iter(entities.values()), None)
    return entity if isinstance(entity, dict) else None


def statements(entity: dict[str, Any], pid: str) -> list[dict[str, Any]]:
    """Declaraciones de una propiedad, sin las de rango 'deprecated' (marcadas como erróneas)."""
    claims = as_dict(entity.get("claims"))
    return [st for st in as_list(claims.get(pid)) if isinstance(st, dict) and st.get("rank") != "deprecated"]


def main_value(statement: dict[str, Any]) -> Any:
    return as_dict(as_dict(statement.get("mainsnak")).get("datavalue")).get("value")


def item_id(statement: dict[str, Any]) -> str | None:
    value = as_dict(main_value(statement)).get("id")
    return value if isinstance(value, str) else None


def item_ids(entity: dict[str, Any], pid: str) -> list[str]:
    return [qid for st in statements(entity, pid) if (qid := item_id(st)) is not None]


def qualifier_keys(statement: dict[str, Any]) -> list[str]:
    return sorted(str(k) for k in as_dict(statement.get("qualifiers")))


def text_value(entity: dict[str, Any], field: str, lang: str) -> str | None:
    """Etiqueta o descripción en un idioma."""
    value = as_dict(as_dict(entity.get(field)).get(lang)).get("value")
    return value if isinstance(value, str) else None


def entity_shape(entity: dict[str, Any], sample_pids: tuple[str, ...]) -> list[str]:
    """Forma del JSON de una entidad, recortada para que no liste cientos de idiomas."""
    claims = as_dict(entity.get("claims"))
    keep = [p for p in sample_pids if p in claims][:3] or list(claims)[:2]
    trimmed: dict[str, Any] = dict(entity)
    for field in ("labels", "descriptions", "aliases"):
        trimmed[field] = {k: v for k, v in as_dict(entity.get(field)).items() if k in ("es", "en")}
    trimmed["claims"] = {p: claims[p] for p in keep}
    trimmed["sitelinks"] = {
        k: v for k, v in as_dict(entity.get("sitelinks")).items() if k in ("eswiki", "enwiki")
    }
    return json_paths({"entities": {"<QID>": trimmed}}, max_depth=10)


def entity_overview(entity: dict[str, Any], interesting: tuple[str, ...]) -> dict[str, Any]:
    """Conteos de estructura de una entidad: idiomas, enlaces y propiedades presentes."""
    claims = as_dict(entity.get("claims"))
    props: dict[str, Any] = {}
    for pid in interesting:
        sts = statements(entity, pid)
        if sts:
            props[pid] = {
                "n_declaraciones": len(sts),
                "rangos": dict(Counter(str(st.get("rank")) for st in sts)),
                "calificadores": sorted({k for st in sts for k in qualifier_keys(st)}),
            }
    return {
        "qid": entity.get("id"),
        "etiqueta_es": text_value(entity, "labels", "es"),
        "etiqueta_en": text_value(entity, "labels", "en"),
        "n_idiomas_con_etiqueta": len(as_dict(entity.get("labels"))),
        "n_sitelinks": len(as_dict(entity.get("sitelinks"))),
        "n_propiedades": len(claims),
        "propiedades_presentes": sorted(claims),
        "propiedades_de_interes": props,
        "modified": entity.get("modified"),
        "lastrevid": entity.get("lastrevid"),
    }


def sitelink_title(entity: dict[str, Any], site: str) -> str | None:
    value = as_dict(as_dict(entity.get("sitelinks")).get(site)).get("title")
    return value if isinstance(value, str) else None


def boca_summary(entity: dict[str, Any]) -> dict[str, Any]:
    names = [text_value(entity, "labels", lang) or "" for lang in ("es", "en")]
    venues = [
        {"id": item_id(st), "rango": st.get("rank"), "calificadores": qualifier_keys(st)}
        for st in statements(entity, "P115")
    ]
    inception = [as_dict(main_value(st)).get("time") for st in statements(entity, "P571")]
    return {
        **entity_overview(entity, ("P31", "P17", "P115", "P118", "P571", "P625", "P54")),
        "descripcion_es": text_value(entity, "descriptions", "es"),
        "verificado_es_boca_juniors": any("Boca Juniors" in n for n in names),
        "instancia_de_P31": item_ids(entity, "P31"),
        "pais_P17": item_ids(entity, "P17"),
        "estadio_P115": venues,
        "liga_P118": item_ids(entity, "P118"),
        "fundacion_P571": inception,
        "sitelink_eswiki": sitelink_title(entity, "eswiki"),
        "sitelink_enwiki": sitelink_title(entity, "enwiki"),
        "forma": entity_shape(entity, ("P115", "P118", "P31")),
    }


def pick_venue(entity: dict[str, Any]) -> str | None:
    """Elige el estadio actual: rango 'preferred', o uno 'normal' sin fecha de fin (P582)."""
    sts = statements(entity, "P115")
    preferred = [st for st in sts if st.get("rank") == "preferred"]
    current = [st for st in sts if "P582" not in qualifier_keys(st)]
    for group in (preferred, current, sts):
        for st in group:
            qid = item_id(st)
            if qid is not None:
                return qid
    return None


def venue_summary(entity: dict[str, Any]) -> dict[str, Any]:
    coords: list[dict[str, Any]] = []
    for st in statements(entity, "P625"):
        value = as_dict(main_value(st))
        lat, lon = value.get("latitude"), value.get("longitude")
        if isinstance(lat, int | float) and isinstance(lon, int | float):
            # Coordenadas de un lugar público (no son datos personales): sirven de ejemplo.
            coords.append(
                {
                    "lat": round(float(lat), 5),
                    "lon": round(float(lon), 5),
                    "globo_tierra": value.get("globe") == "http://www.wikidata.org/entity/Q2",
                }
            )
    aliases = [str(as_dict(a).get("value", "")) for a in as_list(as_dict(entity.get("aliases")).get("es"))]
    names = [text_value(entity, "labels", lang) or "" for lang in ("es", "en")] + aliases
    return {
        **entity_overview(entity, ("P31", "P625", "P1083", "P131", "P466", "P571")),
        "es_la_bombonera": any("bombonera" in n.lower() or "armando" in n.lower() for n in names),
        "coordenadas_P625": coords,
        "forma": entity_shape(entity, ("P625", "P1083")),
    }


def season_summary(entity: dict[str, Any]) -> dict[str, Any]:
    """Qué modela Wikidata de la temporada 2026: participantes y, quizás, la tabla."""
    participants = statements(entity, "P1923")
    teams = {qid for st in participants if (qid := item_id(st)) is not None}
    return {
        **entity_overview(entity, ("P31", "P3450", "P1923", "P527", "P1346", "P580", "P582")),
        "instancia_de_P31": item_ids(entity, "P31"),
        "temporada_de_P3450": item_ids(entity, "P3450"),
        "partes_P527": item_ids(entity, "P527"),
        "n_equipos_participantes_P1923": len(teams),
        "boca_entre_participantes": BOCA_QID in teams,
        # Si P1923 trae calificadores como P1352 (puesto) o P1351 (puntos), hay tabla.
        "calificadores_usados_en_P1923": dict(Counter(k for st in participants for k in qualifier_keys(st))),
        "forma": entity_shape(entity, ("P1923", "P3450", "P31")),
    }


# --- Wikidata: resultados SPARQL (solo si el endpoint fuera accesible) ------------------------
def sparql_rows(data: Any) -> list[dict[str, str]]:
    rows: list[dict[str, str]] = []
    for binding in as_list(as_dict(as_dict(data).get("results")).get("bindings")):
        row = {str(var): str(as_dict(cell).get("value", "")) for var, cell in as_dict(binding).items()}
        rows.append(row)
    return rows


def players_summary(rows: list[dict[str, str]]) -> dict[str, Any]:
    """Cobertura por jugador (conteos, sin nombres ni valores: son datos personales)."""
    fields: dict[str, set[str]] = {}
    no_end: set[str] = set()
    end_2026_plus: set[str] = set()
    start_bucket: dict[str, str] = {}
    for row in rows:
        player = row.get("player", "")
        fields.setdefault(player, set()).update(
            k for k in ("birth", "height", "position", "nationality") if row.get(k)
        )
        if row.get("end"):
            end_2026_plus.add(player)
        else:
            no_end.add(player)
        start = row.get("start", "")
        year = int(start[:4]) if start[:4].isdigit() else None
        start_bucket[player] = (
            "sin_inicio" if year is None else ("desde_2020" if year >= 2020 else "antes_2020")
        )
    return {
        "n_filas": len(rows),
        "n_jugadores": len(fields),
        "con_fecha_nacimiento_P569": sum("birth" in f for f in fields.values()),
        "con_altura_P2048": sum("height" in f for f in fields.values()),
        "con_posicion_P413": sum("position" in f for f in fields.values()),
        "con_nacionalidad_P27": sum("nationality" in f for f in fields.values()),
        "sin_fecha_de_fin": len(no_end),
        "con_fin_2026_o_despues": len(end_2026_plus),
        "inicio_de_membresia": dict(Counter(start_bucket.values())),
    }


def stadiums_summary(rows: list[dict[str, str]]) -> dict[str, Any]:
    teams = {r.get("team", "") for r in rows}
    with_coord = {r.get("team", "") for r in rows if r.get("coord")}
    return {
        "n_filas": len(rows),
        "n_equipos": len(teams),
        "equipos_con_coordenadas": len(with_coord),
    }


# --- Wikipedia: describir una página sin copiar su contenido ----------------------------------
def clean(text: str) -> str:
    return " ".join(text.split())


def tag_text(tag: Tag | None) -> str:
    return clean(tag.get_text(" ", strip=True)) if tag is not None else ""


def row_cells(row: Tag) -> list[Tag]:
    return [c for c in row.find_all(["th", "td"], recursive=False) if isinstance(c, Tag)]


def table_headers(table: Tag) -> list[str]:
    """Encabezados de la primera fila que tiene solo <th> (nombres de columna, no datos)."""
    for row in table.find_all("tr"):
        if not isinstance(row, Tag):
            continue
        cells = row_cells(row)
        if cells and all(c.name == "th" for c in cells):
            return [tag_text(c)[:40] for c in cells]
    return []


def data_rows(table: Tag) -> list[Tag]:
    return [r for r in table.find_all("tr") if isinstance(r, Tag) and r.find("td") is not None]


def column_kinds(headers: list[str]) -> dict[str, int]:
    """Asocia cada tipo de columna (posición, altura, etc.) con su índice en la tabla."""
    found: dict[str, int] = {}
    for index, header in enumerate(headers):
        low = header.lower()
        words = re.split(r"[\s/()]+", low)
        for kind, keys in COLUMN_KINDS.items():
            if kind in found:
                continue
            # Las claves cortas ("j", "pos", "min") se comparan por palabra para no confundir.
            if any((k in words) if len(k) <= 4 else (k in low) for k in keys):
                found[kind] = index
    return found


def has_flag(tag: Tag) -> bool:
    return tag.select_one(".flagicon, img[src*='Flag_of']") is not None


def table_type(kinds: dict[str, int]) -> str:
    if "puntos" in kinds and "partidos_jugados" in kinds:
        return "tabla_posiciones"
    if "jugador" in kinds and ("posicion" in kinds or "nacimiento_o_edad" in kinds):
        return "plantel"
    if "jugador" in kinds:
        return "estadisticas_o_lista_de_jugadores"
    return "otra"


def describe_table(table: Tag, index: int) -> dict[str, Any]:
    headers = table_headers(table)
    kinds = column_kinds(headers)
    rows = data_rows(table)
    heading = table.find_previous(["h2", "h3", "h4"])
    caption = table.find("caption")
    summary: dict[str, Any] = {
        "indice": index,
        "tipo": table_type(kinds),
        "seccion": tag_text(heading if isinstance(heading, Tag) else None)[:80],
        "caption": tag_text(caption if isinstance(caption, Tag) else None)[:80],
        "encabezados": headers[:20],
        "n_filas_datos": len(rows),
        "n_filas_con_boca": sum("Boca" in r.get_text() for r in rows),
        "n_minutos_en_texto": len(MINUTE_RE.findall(table.get_text(" "))),
    }
    if summary["tipo"] in ("plantel", "estadisticas_o_lista_de_jugadores"):
        # Cobertura por columna: filas alineadas con el encabezado que traen algo en la celda.
        aligned = [row_cells(r) for r in rows if len(row_cells(r)) == len(headers)]
        coverage = {kind: sum(1 for cells in aligned if tag_text(cells[idx])) for kind, idx in kinds.items()}
        summary["filas_alineadas_con_encabezado"] = len(aligned)
        summary["filas_con_valor_por_columna"] = coverage
        # Respaldo por patrones (por si la tabla usa colspan o plantillas raras).
        summary["filas_con_bandera"] = sum(has_flag(r) for r in rows)
        summary["filas_con_patron_fecha_o_edad"] = sum(
            bool(BIRTH_DATE_RE.search(r.get_text(" "))) for r in rows
        )
        summary["filas_con_patron_altura"] = sum(bool(HEIGHT_RE.search(r.get_text(" "))) for r in rows)
    return summary


def icon_kind(src: str) -> str | None:
    """Clasifica íconos por el nombre del archivo: tarjetas, goles, cambios, banderas."""
    name = src.rsplit("/", 1)[-1].lower()
    if "flag_of" in name or "bandera" in name:
        return "banderas"
    if "card" in name or "tarjeta" in name:
        return "tarjetas"
    if "ball" in name or "balón" in name or "balon" in name or "gol" in name:
        return "goles"
    if "sub" in name or "cambio" in name or "arrow" in name or "flecha" in name:
        return "cambios"
    return None


def footballbox_summary(root: Tag) -> dict[str, Any]:
    """Cajas de partido de en.wikipedia (plantilla Football box): fecha, local, goles, árbitro."""
    boxes = [b for b in root.select("div.footballbox") if isinstance(b, Tag)]
    boca = [b for b in boxes if "Boca" in tag_text(b.select_one(".fhome")) + tag_text(b.select_one(".faway"))]
    dates = sorted(tag_text(b.select_one(".fdate")) for b in boca)
    return {
        "n_cajas": len(boxes),
        "n_cajas_de_boca": len(boca),
        "con_goles_y_minuto": sum(bool(MINUTE_RE.search(tag_text(b.select_one(".fgoals")))) for b in boca),
        "con_estadio_o_asistencia_o_arbitro": sum(
            bool(re.search(r"Attendance|Referee|Stadium|Estadio|Árbitro", tag_text(b.select_one(".fright"))))
            for b in boca
        ),
        # Dos valores de ejemplo (primera y última fecha) para confirmar que es la temporada 2026.
        "ejemplo_primera_fecha": dates[0] if dates else None,
        "ejemplo_ultima_fecha": dates[-1] if dates else None,
    }


def wikipedia_summary(result: FetchResult) -> dict[str, Any]:
    soup = BeautifulSoup(result.text(), "html.parser")
    title = tag_text(soup.select_one("#firstHeading"))
    lastmod = tag_text(soup.select_one("#footer-info-lastmod"))
    license_text = tag_text(soup.select_one("#footer-info-copyright"))
    wikibase = soup.select_one("#t-wikibase a")
    wikidata_qid = None
    if wikibase is not None:
        match = re.search(r"Q\d+", str(wikibase.get("href", "")))
        wikidata_qid = match.group(0) if match else None

    found = soup.select_one("#mw-content-text .mw-parser-output")
    root: Tag = found if found is not None else soup
    # Se sacan los enlaces "[editar]" y las llamadas a notas para no ensuciar encabezados.
    for junk in root.select(".mw-editsection, sup.reference, style"):
        junk.decompose()

    headings = [tag_text(h)[:80] for h in root.select("h2, h3")]
    tables = [t for t in root.select("table.wikitable") if isinstance(t, Tag)]
    described = [describe_table(t, i) for i, t in enumerate(tables)]
    text = root.get_text(" ")
    icons = Counter(
        kind for img in root.select("img") if (kind := icon_kind(str(img.get("src", "")))) is not None
    )
    infobox = root.select_one("table.infobox")
    keywords = (
        "Alineación",
        "Titulares",
        "Suplentes",
        "Cambios",
        "Árbitro",
        "Estadio",
        "Asistencia",
        "Lineup",
        "Starting",
        "Substitutes",
        "Referee",
        "Attendance",
        "penal",
        "penalty",
        "Goleadores",
        "Top scorers",
        "Disciplin",
        "xG",
    )
    return {
        "titulo": title,
        "ultima_edicion": lastmod[:120],
        "licencia_en_pie": "CC BY-SA" in license_text or "Creative Commons" in license_text,
        "wikidata_qid_de_la_pagina": wikidata_qid,
        "n_secciones": len(headings),
        "secciones": headings[:60],
        "n_tablas_wikitable": len(tables),
        "tablas_por_tipo": dict(Counter(t["tipo"] for t in described)),
        "tablas": described[:40],
        "infobox_campos": [tag_text(th)[:40] for th in (infobox.select("th") if infobox else [])][:30],
        "cajas_de_partido_en": footballbox_summary(root),
        "n_elementos_vevent": len(root.select(".vevent")),
        "n_minutos_en_texto": len(MINUTE_RE.findall(text)),
        "iconos_por_tipo": dict(icons),
        "palabras_clave": {k: text.count(k) for k in keywords if text.count(k)},
    }


# --- manifiesto -------------------------------------------------------------------------------
def manifest_count() -> int:
    """Requests reales a esta fuente registradas en el manifiesto (todas las corridas)."""
    if not MANIFEST_PATH.exists():
        return 0
    count = 0
    for line in MANIFEST_PATH.read_text(encoding="utf-8").splitlines():
        if line.strip() and json.loads(line).get("source") == SOURCE:
            count += 1
    return count


def wiki_url(origin: str, title: str) -> str:
    # Forma canónica de MediaWiki: espacios como "_", ":" y paréntesis literales, UTF-8 en %XX.
    return f"{origin}/wiki/{quote(title, safe=':()_,')}"


# --- flujo principal ----------------------------------------------------------------------
def main() -> None:
    log: list[dict[str, Any]] = []
    budget = Budget(MAX_DATA_REQUESTS, MAX_SPARQL_REQUESTS)
    queries = {name: q.replace("wd:BOCA", f"wd:{BOCA_QID}").strip() for name, q in SPARQL_QUERIES.items()}
    report: dict[str, Any] = {
        "source": SOURCE,
        "generated_at": datetime.now(UTC).isoformat(timespec="seconds"),
        "user_agent": USER_AGENT,
        "licencias": {
            "wikidata": "CC0 (datos estructurados): sin obligación de atribución",
            "wikipedia": "CC BY-SA 4.0: atribuir con enlace a la página y compartir igual",
        },
        "terms_reviewed": TERMS_REVIEWED,
        "consultas_sparql": queries,
        "privacidad": (
            "Datos de personas (Ley 25.326): el informe solo trae conteos de cobertura. Las "
            "respuestas completas quedan en la caché local (data/raw/cache/, fuera de git)."
        ),
    }
    summaries: dict[str, Any] = {}
    ids: dict[str, Any] = {"boca_qid_candidato": BOCA_QID}
    boca_entity_url = f"{ENTITY_DATA}{BOCA_QID}.json"

    with PoliteClient(source=SOURCE) as client:
        report["robots_txt"] = {
            "query.wikidata.org": robots_summary(
                client, SPARQL_ORIGIN, {"sparql": f"{SPARQL_ENDPOINT}?format=json&query=x"}
            ),
            "www.wikidata.org": robots_summary(
                client,
                WIKIDATA_ORIGIN,
                {
                    "entitydata_json": boca_entity_url,
                    "pagina_item": f"{WIKIDATA_ORIGIN}/wiki/{BOCA_QID}",
                    "action_api": f"{WIKIDATA_ORIGIN}/w/api.php?action=wbgetentities",
                },
            ),
            "es.wikipedia.org": robots_summary(
                client,
                ES_ORIGIN,
                {
                    "articulo": wiki_url(ES_ORIGIN, WIKIPEDIA_PAGES[0][2]),
                    "rest_api": f"{ES_ORIGIN}/api/rest_v1/page/html/Boca_Juniors",
                },
            ),
            "en.wikipedia.org": robots_summary(
                client, EN_ORIGIN, {"articulo": wiki_url(EN_ORIGIN, WIKIPEDIA_PAGES[1][2])}
            ),
        }

        # 1) SPARQL: primero la consulta de verificación. Si robots.txt la frena, las demás
        #    también quedarían frenadas (mismo host y ruta): no se intentan.
        first = fetch(
            client,
            budget,
            log,
            "sparql_verificar_boca",
            SPARQL_ENDPOINT,
            {"format": "json", "query": queries["verificar_boca"]},
            sparql=True,
        )
        if first is not None:
            summaries["sparql_verificar_boca"] = {
                "filas": len(sparql_rows(parse_json(first, log[-1]))),
                "forma": json_paths(parse_json(first, log[-1])),
            }
            players = fetch(
                client,
                budget,
                log,
                "sparql_jugadores_P54_2026",
                SPARQL_ENDPOINT,
                {"format": "json", "query": queries["jugadores_P54_2026"]},
                sparql=True,
            )
            summaries["sparql_jugadores"] = players_summary(sparql_rows(parse_json(players, log[-1])))
            stadiums = fetch(
                client,
                budget,
                log,
                "sparql_estadios_de_la_liga",
                SPARQL_ENDPOINT,
                {"format": "json", "query": queries["estadios_de_la_liga"]},
                sparql=True,
            )
            summaries["sparql_estadios"] = stadiums_summary(sparql_rows(parse_json(stadiums, log[-1])))
        else:
            for name in ("jugadores_P54_2026", "estadios_de_la_liga"):
                log.append(
                    {
                        "nombre": f"sparql_{name}",
                        "url_pedida": SPARQL_ENDPOINT,
                        "estado": "no_intentado_mismo_bloqueo_que_la_primera",
                    }
                )

        # 2) Entidad JSON de Boca (Special:EntityData, permitido por robots.txt).
        boca_result = fetch(client, budget, log, "entidad_boca", boca_entity_url)
        boca = entity_from(parse_json(boca_result, log[-1]), BOCA_QID)
        venue_qid: str | None = None
        if boca is not None:
            summaries["entidad_boca"] = boca_summary(boca)
            ids["boca_qid_verificado"] = summaries["entidad_boca"]["verificado_es_boca_juniors"]
            ids["liga_P118"] = summaries["entidad_boca"]["liga_P118"]
            venue_qid = pick_venue(boca)
            ids["estadio_P115_elegido"] = venue_qid

        # 3) Entidad JSON del estadio (coordenadas P625).
        if venue_qid is not None:
            venue_result = fetch(client, budget, log, "entidad_estadio", f"{ENTITY_DATA}{venue_qid}.json")
            venue = entity_from(parse_json(venue_result, log[-1]), venue_qid)
            if venue is not None:
                summaries["entidad_estadio"] = venue_summary(venue)

        # 4) Páginas de Wikipedia (HTML de /wiki/Título).
        page_qids: dict[str, str | None] = {}
        for name, origin, title in WIKIPEDIA_PAGES:
            page = fetch(client, budget, log, f"wikipedia_{name}", wiki_url(origin, title))
            if page is not None:
                summaries[f"wikipedia_{name}"] = wikipedia_summary(page)
                page_qids[name] = summaries[f"wikipedia_{name}"]["wikidata_qid_de_la_pagina"]
        ids["wikidata_qid_de_paginas_wikipedia"] = page_qids

        # 5) Entidad JSON de la temporada 2026 de la liga (si Wikipedia la enlaza): muestra si
        #    Wikidata modela participantes y tabla.
        season_qid = page_qids.get("campeonato_2026_es")
        if season_qid:
            season_result = fetch(
                client, budget, log, "entidad_temporada_2026", f"{ENTITY_DATA}{season_qid}.json"
            )
            season = entity_from(parse_json(season_result, log[-1]), season_qid)
            if season is not None:
                summaries["entidad_temporada_2026"] = season_summary(season)

    report["ids"] = ids
    report["requests"] = log
    report["resumenes"] = summaries
    report["presupuesto"] = {
        "max_requests_datos": MAX_DATA_REQUESTS,
        "max_requests_sparql": MAX_SPARQL_REQUESTS,
        "requests_datos_planificadas": budget.used,
        "requests_sparql_planificadas": budget.sparql_used,
        "desde_red_en_esta_corrida": sum(1 for e in log if e.get("from_cache") is False),
        "desde_cache_en_esta_corrida": sum(1 for e in log if e.get("from_cache") is True),
        "total_en_manifiesto_incluye_robots": manifest_count(),
    }
    path = write_report(SOURCE, report)

    # Salida breve por consola: estado de cada request, sin datos.
    for entry in log:
        print(
            f"{entry['nombre']:<34} {entry.get('status', '-')!s:<4} {entry.get('estado')}"
            f"  cache={entry.get('from_cache', '-')}  bytes={entry.get('bytes', '-')}"
        )
    # Ruta relativa: la consola de Windows (cp1252) no puede imprimir la Θ de la carpeta.
    print(f"Informe: {path.relative_to(ROOT).as_posix()}")


if __name__ == "__main__":
    main()
