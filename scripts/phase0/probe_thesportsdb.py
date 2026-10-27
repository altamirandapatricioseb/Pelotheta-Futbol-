"""Sonda de Fase 0 para TheSportsDB (API v1 con la clave gratuita pública "123").

Qué hace y por qué:

- Pide pocas URLs reales (presupuesto fijo de 8 requests de datos) para ver qué devuelve de
  verdad la API gratuita sobre Boca Juniors y la Liga Profesional 2026.
- Todas las requests pasan por el cliente compartido `PoliteClient`, que ya respeta robots.txt,
  la pausa por host, la caché y el manifiesto con SHA-256.
- El informe describe la FORMA de los campos (con `json_paths`) y cuenta cosas (cuántos partidos,
  qué tipos de evento aparecen), pero no copia los datos: son de un tercero.

Ejecutar desde la raíz del repo:
    uv run python -m scripts.phase0.probe_thesportsdb
"""

from __future__ import annotations

import json
import urllib.robotparser
from collections import Counter
from datetime import UTC, datetime
from typing import Any

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

SOURCE = "thesportsdb"
SITE = "https://www.thesportsdb.com"

# "123" es la clave gratuita que publica la documentación oficial: no es un secreto.
# A propósito NO leemos una clave paga desde variables de entorno: en la v1 la clave va en la
# RUTA de la URL y el cliente compartido solo enmascara claves que viajan como parámetros de
# query, así que una clave paga terminaría escrita en la caché y en el manifiesto. Si algún día
# se usa la clave paga, corresponde la API v2, que la manda en el header X-API-KEY (los headers
# nunca se guardan).
FREE_KEY = "123"
API = f"{SITE}/api/v1/json/{FREE_KEY}/"

MAX_DATA_REQUESTS = 8  # tope pedido para esta fuente (robots.txt no cuenta como dato)
SEASON = "2026"
ALT_SEASON = "2025-2026"  # solo se prueba si "2026" no devuelve partidos
TEAM_NAME = "Boca Juniors"

# Id de Boca tomado de la URL pública de su ficha (thesportsdb.com/team/135156-boca-juniors),
# encontrada con un buscador. Solo se usa si la búsqueda por nombre no devuelve a Boca, porque
# la documentación avisa que la búsqueda gratuita está limitada al equipo "Arsenal".
BOCA_ID_FROM_WEB = "135156"

# Páginas de términos y documentación leídas a mano antes de pedir datos (regla 1).
TERMS_REVIEWED: list[dict[str, str]] = [
    {
        "url": f"{SITE}/robots.txt",
        "resumen": (
            "User-agent * puede todo salvo /nfo/ y /nfo.php; /api/ no está bloqueado. Bloquea "
            "por nombre a GPTBot, Slurp, AhrefsBot, Amazonbot, Semrush y SemrushBot. Sin "
            "Crawl-delay. Declara Content-Signal ai-train=no, search=yes, ai-input=no."
        ),
    },
    {
        "url": f"{SITE}/documentation",
        "resumen": (
            "Clave gratuita '123' en la ruta. Plan gratis: 30 requests/min (429 si se excede). "
            "Cada endpoint tiene límite de resultados gratis/premium, p. ej. searchteams 1 (solo "
            "'Arsenal'), eventsseason 15, eventslast 1 (solo partidos de local), lookupevent 1, "
            "lookuplineup/lookuptimeline/lookupeventstats/lookuptable 5, lookup_all_players 10. "
            "La v2 (header X-API-KEY) es solo premium (USD 9/mes)."
        ),
    },
    {
        "url": f"{SITE}/docs_terms_of_use.php",
        "resumen": (
            "Uso gratis: consultar datos y arte 'para tus proyectos de desarrollo'. Publicar apps "
            "en tiendas exige suscripción paga. Usuarios pagos pueden hacer apps y servicios "
            "dentro del límite y deben mencionar a TheSportsDB como fuente. Se permite copiar y "
            "modificar el contenido devuelto por los endpoints oficiales; no scrapear el sitio "
            "web; no revender la API. Imágenes según el campo strCreativeCommons. No dice nada "
            "de caché, descarga masiva ni sitios web públicos con la clave gratis."
        ),
    },
    {
        "url": f"{SITE}/free_sports_api",
        "resumen": (
            "Presenta la API gratis y el plan premium (clave de producción dedicada, v2, "
            "livescores). No agrega condiciones de uso."
        ),
    },
]


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


# --- utilidades para describir respuestas sin copiar datos ------------------------------
def is_filled(value: Any) -> bool:
    """TheSportsDB marca la ausencia con null, "" o "0" en algunos campos de texto."""
    return value is not None and value != ""


def payload_rows(data: Any) -> tuple[str | None, list[dict[str, Any]], bool]:
    """Devuelve (clave de la lista, filas, vino_null).

    Las respuestas v1 son un objeto con una sola lista adentro ({"events": [...]},
    {"lineup": [...]}, etc.). Cuando no hay datos la lista viene como null.
    """
    if not isinstance(data, dict):
        return None, [], False
    for key, value in data.items():
        if isinstance(value, list):
            return key, [row for row in value if isinstance(row, dict)], False
    for key, value in data.items():
        if value is None:
            return key, [], True
    return None, [], False


def filled_fields(rows: list[dict[str, Any]]) -> tuple[list[str], list[str]]:
    """Separa los campos que traen valor en alguna fila de los que vienen siempre vacíos."""
    keys: set[str] = set()
    filled: set[str] = set()
    for row in rows:
        for key, value in row.items():
            keys.add(key)
            if is_filled(value):
                filled.add(key)
    return sorted(filled), sorted(keys - filled)


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


def parse_body(result: FetchResult, entry: dict[str, Any]) -> Any:
    """Intenta leer JSON; si no es JSON guarda el comienzo del texto (suele ser un aviso)."""
    try:
        data = result.json()
    except ValueError:  # incluye JSONDecodeError y UnicodeDecodeError
        text = result.text()
        if "html" in result.content_type.lower():
            # Un HTML suele ser una página de error o de "solo premium": nos quedamos con el texto.
            text = BeautifulSoup(text, "html.parser").get_text(" ", strip=True)
        entry["json"] = False
        entry["texto_inicio"] = text[:160]
        return None
    entry["json"] = True
    entry["claves_raiz"] = sorted(data) if isinstance(data, dict) else type(data).__name__
    entry["forma"] = json_paths(data)
    key, rows, came_null = payload_rows(data)
    entry["lista"] = key
    entry["n_items"] = len(rows)
    entry["lista_null"] = came_null
    if rows:
        filled, empty = filled_fields(rows)
        entry["campos_con_valor"] = filled
        entry["campos_siempre_vacios"] = empty
    return data


def call(
    client: PoliteClient,
    budget: Budget,
    log: list[dict[str, Any]],
    endpoint: str,
    params: dict[str, str],
) -> list[dict[str, Any]]:
    """Pide un endpoint de datos (si queda presupuesto), lo registra y devuelve sus filas."""
    entry: dict[str, Any] = {"endpoint": endpoint, "params": params}
    log.append(entry)
    if not budget.take():
        entry["estado"] = "omitido_por_presupuesto"
        return []
    try:
        result = client.get(API + endpoint, params=params)
    except (FetchError, RetryableFetchError) as exc:
        # 403/429/robots/tamaño: se registra y se sigue, sin reintentos por fuera del cliente.
        entry["estado"] = "error"
        entry["error"] = str(exc)
        return []
    entry.update(describe_fetch(result))
    data = parse_body(result, entry)
    _, rows, came_null = payload_rows(data)
    if result.status != 200:
        entry["estado"] = f"http_{result.status}"
    elif rows:
        entry["estado"] = "con_datos"
    elif came_null:
        entry["estado"] = "null_sin_datos"
    else:
        entry["estado"] = "sin_lista"
    return rows


# --- resúmenes por entidad (conteos y vocabulario de campos, no datos) -------------------
def team_ids(row: dict[str, Any]) -> set[str]:
    return {str(row.get("idHomeTeam")), str(row.get("idAwayTeam"))}


def is_boca_event(row: dict[str, Any], team_id: str) -> bool:
    return team_id in team_ids(row)


def events_summary(rows: list[dict[str, Any]], team_id: str) -> dict[str, Any]:
    dates = sorted(str(r.get("dateEvent")) for r in rows if is_filled(r.get("dateEvent")))
    teams: set[str] = set()
    for row in rows:
        teams |= team_ids(row)
    teams.discard("None")
    return {
        "n_partidos": len(rows),
        "temporadas": sorted({str(r.get("strSeason")) for r in rows}),
        "competiciones": sorted({f"{r.get('idLeague')} {r.get('strLeague')}" for r in rows}),
        "fecha_min": dates[0] if dates else None,
        "fecha_max": dates[-1] if dates else None,
        "equipos_distintos": len(teams),
        "partidos_de_boca": sum(is_boca_event(r, team_id) for r in rows),
        "con_resultado": sum(is_filled(r.get("intHomeScore")) for r in rows),
        "estados": dict(Counter(str(r.get("strStatus")) for r in rows)),
        "rondas": sorted({str(r.get("intRound")) for r in rows}),
    }


def lineup_summary(rows: list[dict[str, Any]]) -> dict[str, Any]:
    minute_fields = sorted(
        {k for r in rows for k in r if "min" in k.lower() or "time" in k.lower()}
    )
    return {
        "n_filas": len(rows),
        "por_localia_strHome": dict(Counter(str(r.get("strHome")) for r in rows)),
        "por_strSubstitute": dict(Counter(str(r.get("strSubstitute")) for r in rows)),
        "posiciones_distintas": sorted({str(r.get("strPosition")) for r in rows}),
        "campos_que_parecen_minutos": minute_fields,
        "con_idPlayer": sum(is_filled(r.get("idPlayer")) for r in rows),
    }


def timeline_summary(rows: list[dict[str, Any]]) -> dict[str, Any]:
    minutes = sorted(int(r["intTime"]) for r in rows if str(r.get("intTime", "")).isdigit())
    return {
        "n_filas": len(rows),
        "tipos_strTimeline": dict(Counter(str(r.get("strTimeline")) for r in rows)),
        "detalles_strTimelineDetail": dict(Counter(str(r.get("strTimelineDetail")) for r in rows)),
        "con_minuto_intTime": len(minutes),
        "minuto_min": minutes[0] if minutes else None,
        "minuto_max": minutes[-1] if minutes else None,
        "con_strAssist": sum(is_filled(r.get("strAssist")) for r in rows),
        "con_idPlayer": sum(is_filled(r.get("idPlayer")) for r in rows),
        # strComment trae a veces el texto literal "NULL" en vez de null: hay que limpiarlo.
        "strComment_texto_NULL": sum(str(r.get("strComment")) == "NULL" for r in rows),
        "strPeriod_con_valor": sum(is_filled(r.get("strPeriod")) for r in rows),
    }


def stats_summary(rows: list[dict[str, Any]]) -> dict[str, Any]:
    # Los nombres de estadística (strStat) son vocabulario del esquema, no datos del partido.
    return {
        "n_filas": len(rows),
        "estadisticas_strStat": [str(r.get("strStat")) for r in rows],
    }


def table_summary(rows: list[dict[str, Any]], team_id: str) -> dict[str, Any]:
    return {
        "n_filas": len(rows),
        "temporadas": sorted({str(r.get("strSeason")) for r in rows}),
        "ligas": sorted({f"{r.get('idLeague')} {r.get('strLeague')}" for r in rows}),
        "boca_en_la_tabla": any(str(r.get("idTeam")) == team_id for r in rows),
        # strGroup dice qué tabla es (torneo y zona); strDescription es la zona de clasificación.
        "grupos_strGroup": sorted({str(r.get("strGroup")) for r in rows}),
        "descripciones_strDescription": sorted({str(r.get("strDescription")) for r in rows}),
        "dateUpdated_max": max((str(r.get("dateUpdated")) for r in rows), default=None),
    }


def team_summary(team: dict[str, Any]) -> dict[str, Any]:
    """Ids de las competiciones que TheSportsDB asocia al equipo (idLeague, idLeague2..7)."""
    leagues: list[str] = []
    for suffix in ["", "2", "3", "4", "5", "6", "7"]:
        league_id = team.get(f"idLeague{suffix}")
        if is_filled(league_id):
            leagues.append(f"{league_id} {team.get(f'strLeague{suffix}')}")
    return {
        "idTeam": team.get("idTeam"),
        "strTeam": team.get("strTeam"),
        "strSport": team.get("strSport"),
        "strCountry": team.get("strCountry"),
        "competiciones_asociadas": leagues,
    }


def pick_event(
    last_rows: list[dict[str, Any]], season_rows: list[dict[str, Any]], team_id: str
) -> dict[str, Any] | None:
    """Elige UN partido de Boca 2026 ya jugado para pedir su detalle."""
    for row in last_rows + season_rows:
        if (
            is_boca_event(row, team_id)
            and str(row.get("dateEvent", "")).startswith(SEASON)
            and is_filled(row.get("intHomeScore"))
        ):
            return row
    for row in last_rows:
        if is_boca_event(row, team_id):
            return row
    return None


# --- robots.txt y manifiesto --------------------------------------------------------------
def robots_summary(client: PoliteClient) -> dict[str, Any]:
    """Lee robots.txt con el mismo cliente (queda en caché y el cliente lo reutiliza)."""
    robots_url = f"{SITE}/robots.txt"
    try:
        result = client.get(robots_url, check_robots=False)
    except (FetchError, RetryableFetchError) as exc:
        return {"url": robots_url, "estado": "error", "error": str(exc)}
    lines = result.text().splitlines()
    parser = urllib.robotparser.RobotFileParser(robots_url)
    parser.parse(lines)
    return {
        **describe_fetch(result),
        "api_permitida_para_nuestro_ua": parser.can_fetch(USER_AGENT, API + "searchteams.php"),
        "crawl_delay": parser.crawl_delay(USER_AGENT),
        # Content-Signal es una declaración de política del sitio, la anotamos tal cual.
        "content_signal": [ln.strip() for ln in lines if ln.lower().startswith("content-signal")],
        "reglas_por_user_agent": robots_groups(lines),
    }


def robots_groups(lines: list[str]) -> dict[str, list[str]]:
    """Agrupa las líneas Disallow por User-agent, para ver a quién bloquea cada regla.

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
        if field.lower() == "user-agent":
            if in_rules:  # empieza un grupo nuevo
                current, in_rules = [], False
            current.append(value)
            groups.setdefault(value, [])
        elif field.lower() == "disallow":
            in_rules = True
            for agent in current:
                if value:
                    groups[agent].append(value)
    return groups


def manifest_count() -> int:
    """Requests reales a esta fuente registradas en el manifiesto (todas las corridas)."""
    if not MANIFEST_PATH.exists():
        return 0
    count = 0
    for line in MANIFEST_PATH.read_text(encoding="utf-8").splitlines():
        if line.strip() and json.loads(line).get("source") == SOURCE:
            count += 1
    return count


# --- flujo principal ----------------------------------------------------------------------
def main() -> None:
    log: list[dict[str, Any]] = []
    budget = Budget(MAX_DATA_REQUESTS)
    report: dict[str, Any] = {
        "source": SOURCE,
        "generated_at": datetime.now(UTC).isoformat(timespec="seconds"),
        "api_base": API,
        "nota_clave": "Clave gratuita pública '123' (documentada). No se usó ninguna clave paga.",
        "terms_reviewed": TERMS_REVIEWED,
    }
    summaries: dict[str, Any] = {}
    ids: dict[str, Any] = {}

    with PoliteClient(source=SOURCE) as client:
        report["robots_txt"] = robots_summary(client)

        # 1) Buscar el equipo por nombre (lo que pide la consigna).
        found = call(client, budget, log, "searchteams.php", {"t": TEAM_NAME})
        summaries["searchteams_equipos_devueltos"] = [
            f"{r.get('strTeam')} ({r.get('strSport')}, {r.get('strCountry')})" for r in found
        ]
        boca = next(
            (r for r in found if "Boca" in str(r.get("strTeam")) and r.get("strSport") == "Soccer"),
            None,
        )
        # 2) Si la búsqueda gratis no trae a Boca, se confirma el id público con lookupteam.
        if boca is None:
            looked = call(client, budget, log, "lookupteam.php", {"id": BOCA_ID_FROM_WEB})
            boca = next((r for r in looked if "Boca" in str(r.get("strTeam"))), None)
        if boca is None:
            report["conclusion_automatica"] = "No se pudo identificar a Boca con la clave gratis."
            team_id, league_id = BOCA_ID_FROM_WEB, ""
        else:
            summaries["equipo"] = team_summary(boca)
            team_id = str(boca.get("idTeam"))
            league_id = str(boca.get("idLeague") or "")
        ids["boca_idTeam"] = team_id
        ids["liga_idLeague"] = league_id

        # 3) Partidos de la temporada de la liga.
        season_rows: list[dict[str, Any]] = []
        if league_id:
            season_rows = call(
                client, budget, log, "eventsseason.php", {"id": league_id, "s": SEASON}
            )
            summaries["eventsseason_2026"] = events_summary(season_rows, team_id)

        # 4) Últimos partidos del equipo (con la clave gratis la doc dice: solo de local).
        last_rows = call(client, budget, log, "eventslast.php", {"id": team_id})
        summaries["eventslast"] = events_summary(last_rows, team_id)

        # 5) Detalle de UN partido de Boca 2026.
        event = pick_event(last_rows, season_rows, team_id)
        if event is not None:
            event_id = str(event.get("idEvent"))
            ids["partido_elegido_idEvent"] = event_id
            # Hasta 3 valores de ejemplo para confirmar que es Boca 2026, nada más.
            ids["partido_elegido_ejemplo"] = {
                "strEvent": event.get("strEvent"),
                "dateEvent": event.get("dateEvent"),
                "strLeague": event.get("strLeague"),
            }
            detail = call(client, budget, log, "lookupevent.php", {"id": event_id})
            summaries["lookupevent"] = events_summary(detail, team_id)
            lineup = call(client, budget, log, "lookuplineup.php", {"id": event_id})
            summaries["lookuplineup"] = lineup_summary(lineup)
            timeline = call(client, budget, log, "lookuptimeline.php", {"id": event_id})
            summaries["lookuptimeline"] = timeline_summary(timeline)
            stats = call(client, budget, log, "lookupeventstats.php", {"id": event_id})
            summaries["lookupeventstats"] = stats_summary(stats)

        # 6) Request sobrante: si "2026" no trajo partidos, probar otro formato de temporada;
        #    si los trajo, mirar la tabla de la liga (para comparar Boca contra el resto).
        if league_id and not season_rows:
            alt_rows = call(
                client, budget, log, "eventsseason.php", {"id": league_id, "s": ALT_SEASON}
            )
            summaries["eventsseason_alt"] = events_summary(alt_rows, team_id)
        elif league_id:
            table = call(client, budget, log, "lookuptable.php", {"l": league_id, "s": SEASON})
            summaries["lookuptable_2026"] = table_summary(table, team_id)

    report["ids"] = ids
    report["requests"] = log
    report["resumenes"] = summaries
    report["presupuesto"] = {
        "max_requests_datos": MAX_DATA_REQUESTS,
        "requests_datos_planificadas": budget.used,
        "desde_red_en_esta_corrida": sum(1 for e in log if e.get("from_cache") is False),
        "desde_cache_en_esta_corrida": sum(1 for e in log if e.get("from_cache") is True),
        "total_en_manifiesto_incluye_robots": manifest_count(),
    }
    path = write_report(SOURCE, report)

    # Salida breve por consola: estado de cada endpoint, sin datos.
    for entry in log:
        print(
            f"{entry['endpoint']:<22} {entry.get('status', '-')!s:<4} {entry.get('estado')}"
            f"  items={entry.get('n_items', '-')}  cache={entry.get('from_cache', '-')}"
        )
    # Ruta relativa: la consola de Windows (cp1252) no puede imprimir la Θ de la carpeta.
    print(f"Informe: {path.relative_to(ROOT).as_posix()}")


if __name__ == "__main__":
    main()
