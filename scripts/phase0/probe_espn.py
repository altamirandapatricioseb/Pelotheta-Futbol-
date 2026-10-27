"""Sonda de Fase 0 para ESPN (equipo 5 = Boca Juniors, liga "arg.1" en las URLs de ESPN).

Qué hace y por qué:

1. Deja registrado qué dicen los términos de uso de ESPN/Disney y los robots.txt revisados.
2. Pide con el cliente compartido los robots.txt de los tres hosts de ESPN que nos interesan,
   para saber qué recibe de verdad nuestro User-Agent. Leer robots.txt no es pedir datos: es el
   mecanismo que el propio sitio ofrece para decirle a los bots qué pueden hacer.
3. NO pide datos por defecto. Los Términos de Uso de Disney (el pie de www.espn.com enlaza a
   ellos) prohíben en la sección 2.B(x) acceder, copiar o extraer contenido con robots, scripts u
   otros medios automatizados, incluido el armado de bases de datos, salvo autorización expresa
   por escrito. Una sonda es exactamente un script automatizado, así que sin ese permiso no
   corresponde correrla contra la API. Si el dueño del proyecto consigue el permiso por escrito,
   puede habilitar los pedidos con la variable de entorno PELOTHETA_ESPN_PERMISO_ESCRITO=si.
4. Aun con permiso, el cliente compartido se niega a pedir datos a un host cuyo robots.txt no se
   puede leer (por ejemplo, si devuelve 403): ante la duda, no scrapeamos.

Ejecutar desde la raíz del repo:
    uv run python -m scripts.phase0.probe_espn
"""

from __future__ import annotations

import os
from datetime import UTC, datetime
from typing import Any

from scripts.phase0.common import json_paths, write_report
from sources.http_client import (
    ROOT,
    USER_AGENT,
    FetchError,
    PoliteClient,
    RetryableFetchError,
)

SOURCE = "espn"
BOCA_TEAM_ID = "5"
LEAGUE_SLUG = "arg.1"
SEASON = "2026"
MAX_DATA_REQUESTS = 8  # tope de la consigna para esta fuente
PERMISSION_ENV = "PELOTHETA_ESPN_PERMISO_ESCRITO"

SITE_API = f"https://site.api.espn.com/apis/site/v2/sports/soccer/{LEAGUE_SLUG}"
STANDINGS_API = f"https://site.api.espn.com/apis/v2/sports/soccer/{LEAGUE_SLUG}"

ROBOTS_ORIGINS = (
    "https://www.espn.com",
    "https://espndeportes.espn.com",
    "https://site.api.espn.com",
)

# Pedidos de datos planeados (solo se hacen con permiso escrito). El summary necesita el id de
# un partido jugado, que sale del calendario; acá va un id de relleno solo para robots.txt.
PLANNED_DATA_URLS: dict[str, str] = {
    "equipo": f"{SITE_API}/teams/{BOCA_TEAM_ID}",
    "plantel": f"{SITE_API}/teams/{BOCA_TEAM_ID}/roster",
    "calendario_2026": f"{SITE_API}/teams/{BOCA_TEAM_ID}/schedule?season={SEASON}",
    "tabla": f"{STANDINGS_API}/standings?season={SEASON}",
    "summary_partido": f"{SITE_API}/summary?event=0",
}

# Páginas HTML que muestran los mismos datos que la API. No se piden: solo se preguntan al
# robots.txt para saber qué opina ESPN de que un bot lea alineaciones y estadísticas de partido.
HTML_EQUIVALENTS = (
    f"https://www.espn.com/soccer/team/_/id/{BOCA_TEAM_ID}",
    "https://www.espn.com/soccer/lineups/_/gameId/0",
    "https://www.espn.com/soccer/matchstats/_/gameId/0",
    "https://www.espn.com/soccer/commentary/_/gameId/0",
    f"https://espndeportes.espn.com/futbol/equipo/_/id/{BOCA_TEAM_ID}",
    "https://espndeportes.espn.com/futbol/alineacion/_/juegoId/0",
    "https://espndeportes.espn.com/futbol/numeritos/_/juegoId/0",
)

# Nombres de campo que nos interesan para los datos crudos mínimos: si aparecen en la forma del
# JSON, el informe los marca (sin copiar valores).
INTERESTING_FIELDS = frozenset(
    {
        "starter",
        "subbedIn",
        "subbedOut",
        "subbedInFor",
        "subbedOutFor",
        "clock",
        "keyEvents",
        "plays",
        "rosters",
        "boxscore",
        "statistics",
        "stats",
        "formation",
        "possessionPct",
        "totalShots",
        "shotsOnTarget",
        "expectedGoals",
        "dateOfBirth",
        "age",
        "height",
        "weight",
        "position",
        "jersey",
        "standings",
        "venue",
        "attendance",
    }
)

# Términos revisados a mano antes de escribir la sonda (resumen propio, no copia del texto).
TERMS_REVIEWED: list[dict[str, str]] = [
    {
        "url": "https://disneytermsofuse.com/spanish-latin-american/",
        "resumen": (
            "Versión latinoamericana enlazada desde el pie de www.espn.com ('Condiciones para el "
            "uso'), actualizada en mayo de 2024. Sección 2: licencia limitada solo para uso "
            "personal y no comercial, sin derecho a reproducir, distribuir ni comunicar al "
            "público. "
            "Restricciones adicionales: prohíbe acceder, vigilar, copiar o extraer contenido con "
            "robots, arañas, scripts u otros medios automatizados para minería de datos, web "
            "scraping, bases de datos o herramientas de IA sin autorización expresa por escrito. "
            "Única excepción: arañas de buscadores públicos para crear índices, si robots.txt "
            "no lo impide. No menciona API, RSS ni feeds. Ley aplicable: Nueva York, salvo "
            "norma local."
        ),
    },
    {
        "url": "https://disneytermsofuse.com/english/",
        "resumen": (
            "Texto general en inglés (última actualización 24/05/2024). Nombra a ESPN entre las "
            "marcas cubiertas. 2.A: licencia personal y no comercial. 2.B(ii): no copiar salvo "
            "permiso expreso. 2.B(vi): no quitar avisos de propiedad ni hacer framing/mirroring. "
            "2.B(vii) y 3.H: no usar los productos ni las marcas de modo que sugiera asociación o "
            "con fines comerciales. 2.B(x): prohíbe acceso o extracción automatizada (robots, "
            "spiders, scripts) para data mining, scraping o armar datasets, sin excepción para "
            "uso personal o investigación; solo se exceptúan buscadores públicos."
        ),
    },
    {
        "url": "https://disneytermsofuse.com/",
        "resumen": "Página índice: solo títulos de secciones; remite al texto completo.",
    },
]

ROBOTS_REVIEWED_MANUALLY: list[dict[str, str]] = [
    {
        "url": "https://www.espn.com/robots.txt",
        "resumen": (
            "Para User-agent * no menciona /apis/ ni JSON, pero prohíbe /soccer/matchstats, "
            "/soccer/lineups, /soccer/commentary y /soccer/video (justo las páginas de "
            "estadísticas, alineaciones y relato de partido). Bloquea por completo a GPTBot, "
            "CCBot, anthropic-ai, Google-Extended y otros bots de IA."
        ),
    },
    {
        "url": "https://espndeportes.espn.com/robots.txt",
        "resumen": (
            "Para User-agent * prohíbe /soccer/*, /futbol/alineacion, /futbol/numeritos, "
            "/futbol/comentario, /futbol/video, fichas de jugador (bio, stats, splits, game logs) "
            "y bloquea GPTBot y Google-Extended. No menciona /apis/."
        ),
    },
    {
        "url": "https://site.api.espn.com/robots.txt",
        "resumen": (
            "Con WebFetch respondió HTTP 403 y con el cliente compartido también (página 'Access "
            "Denied' del CDN): no hay reglas legibles, así que el cliente trata todo el host "
            "como prohibido."
        ),
    },
]

# Lo que esta sonda no pudo comprobar sin pedir datos. Se deja escrito para no inventar campos.
NOT_VERIFIED: list[str] = [
    "Forma real de los JSON de equipo, plantel, calendario 2026, tabla y summary de partido.",
    "Si el summary trae alineaciones con minutos de entrada y salida, eventos con minuto y "
    "estadísticas por jugador y por equipo (xG incluido).",
    "Slugs de competiciones que aparecen en el calendario de Boca 2026 (se suponen arg.1, "
    "arg.copa, conmebol.libertadores o conmebol.sudamericana, pero nada de eso se vio).",
    "Límites de uso (rate limit) de site.api.espn.com.",
    "Robots.txt de otros hosts de la API (site.web.api.espn.com, sports.core.api.espn.com): no "
    "se revisaron porque los términos ya prohíben el acceso automatizado.",
]

# Advertencia sobre el propio control de robots.txt: urllib.robotparser compara prefijos y no
# entiende comodines dentro de la ruta, así que reglas como "Disallow: /soccer/*" (espndeportes)
# o "Disallow: */platform/*" (www.espn.com) pueden no aplicarse en las decisiones de abajo.
ROBOTS_PARSER_CAVEAT = (
    "urllib.robotparser (usado por el cliente compartido) no interpreta comodines '*' dentro de "
    "las rutas; las decisiones calculadas pueden ser más permisivas que el robots.txt real."
)


def dig(node: Any, *keys: str | int) -> Any:
    """Navega un JSON sin romper si falta un nivel (ESPN no documenta su formato)."""
    current = node
    for key in keys:
        if isinstance(key, int) and isinstance(current, list) and 0 <= key < len(current):
            current = current[key]
        elif isinstance(key, str) and isinstance(current, dict):
            current = current.get(key)
        else:
            return None
    return current


def collect_values(node: Any, wanted_key: str) -> set[str]:
    """Junta todos los valores de texto de una clave, a cualquier profundidad del JSON."""
    found: set[str] = set()
    if isinstance(node, dict):
        for key, value in node.items():
            if key == wanted_key and isinstance(value, str):
                found.add(value)
            found |= collect_values(value, wanted_key)
    elif isinstance(node, list):
        for item in node:
            found |= collect_values(item, wanted_key)
    return found


def pick_played_event(schedule: Any) -> str | None:
    """Devuelve el id del partido terminado más reciente del calendario, si hay alguno."""
    events = dig(schedule, "events")
    if not isinstance(events, list):
        return None
    played: list[tuple[str, str]] = []
    for event in events:
        completed = dig(event, "competitions", 0, "status", "type", "completed")
        if completed is None:
            completed = dig(event, "status", "type", "completed")
        event_id = dig(event, "id")
        date = dig(event, "date")
        if completed is True and isinstance(event_id, str) and isinstance(date, str):
            played.append((date, event_id))
    if not played:
        return None
    return max(played)[1]  # las fechas ISO 8601 se ordenan bien como texto


def describe_json(data: Any) -> dict[str, Any]:
    """Describe la FORMA de una respuesta JSON, sin copiar datos de terceros."""
    paths = json_paths(data)
    interesting = sorted(p for p in paths if p.rsplit(".", 1)[-1].removesuffix("[]") in INTERESTING_FIELDS)
    top_keys = sorted(data.keys()) if isinstance(data, dict) else []
    return {
        "claves_de_primer_nivel": top_keys,
        "campos_de_interes": interesting,
        "rutas_json": paths,
    }


def check_robots(client: PoliteClient) -> tuple[dict[str, Any], set[str], int]:
    """Pide los robots.txt con el cliente compartido.

    Devuelve el informe, los orígenes cuyo robots.txt se pudo leer y cuántos pedidos salieron.
    """
    report: dict[str, Any] = {}
    readable: set[str] = set()
    network = 0
    for origin in ROBOTS_ORIGINS:
        url = f"{origin}/robots.txt"
        try:
            # Es el mismo pedido que hace el cliente por dentro; así también queda el código HTTP.
            result = client.get(url, check_robots=False)
        except (FetchError, RetryableFetchError) as exc:
            network += 1
            report[url] = {"estado": "error", "detalle": str(exc)}
            continue
        if not result.from_cache:
            network += 1
        ok = 200 <= result.status < 300 or result.status == 404
        if ok:
            readable.add(origin)
        report[url] = {
            "http": result.status,
            "content_type": result.content_type,
            "bytes": len(result.body),
            "sha256": result.sha256,
            "desde_cache": result.from_cache,
            "pedido_a_la_red_en": result.fetched_at,  # fecha real del pedido, aunque venga de caché
            "legible_para_el_cliente": ok,
        }
    return report, readable, network


def robots_decisions(client: PoliteClient, readable: set[str]) -> dict[str, str]:
    """Pregunta al robots.txt (ya en caché) si nuestro User-Agent puede pedir cada URL."""
    decisions: dict[str, str] = {}
    for url in (*HTML_EQUIVALENTS, *PLANNED_DATA_URLS.values()):
        origin = "/".join(url.split("/", 3)[:3])
        if origin not in readable:
            # Si no lo pudimos leer, el cliente lo trata como prohibido; no volvemos a pedirlo.
            decisions[url] = "prohibido (robots.txt ilegible: el cliente no pide datos)"
        else:
            decisions[url] = "permitido" if client.robots_allows(url) else "prohibido"
    return decisions


def fetch_json(client: PoliteClient, url: str) -> tuple[dict[str, Any], Any, bool]:
    """Pide una URL de datos y devuelve (descripción, JSON o None, si salió a la red)."""
    try:
        result = client.get(url)
    except (FetchError, RetryableFetchError) as exc:
        return {"url": url, "estado": "error", "detalle": str(exc)}, None, True
    info: dict[str, Any] = {
        "url": result.url,
        "http": result.status,
        "content_type": result.content_type,
        "bytes": len(result.body),
        "sha256": result.sha256,
        "desde_cache": result.from_cache,
    }
    if result.status != 200:
        info["estado"] = "bloqueado" if result.status in (401, 403, 429) else "error"
        return info, None, not result.from_cache
    try:
        data = result.json()
    except ValueError:
        info["estado"] = "no_es_json"
        return info, None, not result.from_cache
    info["estado"] = "ok"
    info.update(describe_json(data))
    return info, data, not result.from_cache


def run_data_requests(client: PoliteClient) -> tuple[dict[str, Any], int]:
    """Pide equipo, plantel, calendario, tabla y el summary de un partido (máximo 8 pedidos)."""
    responses: dict[str, Any] = {}
    network = 0
    schedule: Any = None
    for name in ("equipo", "plantel", "calendario_2026", "tabla"):
        if network >= MAX_DATA_REQUESTS:
            break
        info, data, went_out = fetch_json(client, PLANNED_DATA_URLS[name])
        network += int(went_out)
        responses[name] = info
        if name == "calendario_2026":
            schedule = data

    # Las competiciones aparecen como slugs con punto (por ejemplo "arg.1"); se listan sin datos.
    if schedule is not None:
        slugs = sorted(s for s in collect_values(schedule, "slug") if "." in s)
        responses["competiciones_en_calendario"] = slugs

    event_id = pick_played_event(schedule)
    if event_id is None:
        responses["summary_partido"] = {"estado": "sin partido jugado en el calendario"}
    elif network < MAX_DATA_REQUESTS:
        info, _, went_out = fetch_json(client, f"{SITE_API}/summary?event={event_id}")
        network += int(went_out)
        responses["summary_partido"] = info
    return responses, network


def main() -> int:
    has_permission = os.environ.get(PERMISSION_ENV, "").strip().lower() == "si"
    report: dict[str, Any] = {
        "fuente": SOURCE,
        "generado_en": datetime.now(UTC).isoformat(timespec="seconds"),
        "user_agent": USER_AGENT,
        "ids": {"boca_team_id": BOCA_TEAM_ID, "liga_slug": LEAGUE_SLUG, "temporada": SEASON},
        "terminos_revisados": TERMS_REVIEWED,
        "robots_revisados_a_mano": ROBOTS_REVIEWED_MANUALLY,
        "pedidos_de_datos_planeados": PLANNED_DATA_URLS,
    }

    with PoliteClient(source=SOURCE) as client:
        robots_report, readable, network = check_robots(client)
        report["robots_con_cliente_compartido"] = robots_report
        report["decisiones_robots"] = robots_decisions(client, readable)

        report["advertencia_robotparser"] = ROBOTS_PARSER_CAVEAT

        api_robots_readable = "https://site.api.espn.com" in readable
        if has_permission:
            responses, data_network = run_data_requests(client)
            report["respuestas"] = responses
            report["pedidos_de_datos_a_la_red"] = data_network
            report["estado_acceso"] = "probado_con_permiso_escrito"
        else:
            report["pedidos_de_datos_a_la_red"] = 0
            report["estado_acceso"] = "no_probado_por_terminos"
            reason = (
                "Los Términos de Uso de Disney (cubren ESPN) prohíben en la sección 2.B(x) el "
                "acceso o la extracción con scripts o medios automatizados para scraping, "
                "minería de datos o bases de datos sin autorización expresa por escrito."
            )
            if not api_robots_readable:
                reason += (
                    " Además, el robots.txt de site.api.espn.com no es legible para nuestro "
                    "User-Agent, así que el cliente compartido no pediría datos a ese host."
                )
            reason += f" Con permiso escrito, correr con {PERMISSION_ENV}=si."
            report["motivo"] = reason
            report["no_verificado"] = NOT_VERIFIED

    # Cuenta solo esta ejecución: si se repite, la caché responde y no sale nada a la red.
    report["pedidos_robots_a_la_red_en_esta_ejecucion"] = network
    path = write_report(SOURCE, report)
    # Ruta relativa: la consola de Windows (cp1252) no puede imprimir la Θ del nombre del repo.
    print(f"Informe guardado en {path.relative_to(ROOT).as_posix()}")
    print(f"Estado: {report['estado_acceso']}")
    print(f"Pedidos a la red: robots.txt={network}, datos={report['pedidos_de_datos_a_la_red']}")
    for url, info in robots_report.items():
        print(f"  {url}: {info.get('http', info.get('estado'))}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
