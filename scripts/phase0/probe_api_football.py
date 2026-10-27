"""Sonda de Fase 0 para API-Football (api-sports.io, v3).

Qué hace y por qué:

- API-Football es la fuente principal prevista, pero exige clave (header `x-apisports-key`).
  La clave se lee SOLO de la variable de entorno API_FOOTBALL_KEY: nunca se imprime, nunca se
  guarda y nunca va en la URL (el cliente compartido no la escribe en caché ni en el manifiesto).
- Si la clave no está, la sonda NO hace ninguna request de datos: deja el informe con
  access_status "requiere_clave" y el plan exacto de requests que haría.
- Si la clave está, ejecuta ese plan (≤ 8 requests de datos + robots.txt) con el cliente
  compartido PoliteClient, y describe la FORMA de cada respuesta (rutas de campos), no los datos.
- Las respuestas de error de API-Football llegan con HTTP 200 y un objeto `errors` (por ejemplo
  `errors.plan` cuando la temporada no está incluida en el plan gratuito). Por eso se revisa
  `errors` en cada respuesta y no solo el código HTTP.

Uso (desde la raíz del repo):
    uv run python -m scripts.phase0.probe_api_football
"""

from __future__ import annotations

import os
from collections import Counter
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

from scripts.phase0.common import json_paths, write_report
from sources.http_client import (
    ROOT,
    FetchError,
    FetchResult,
    PoliteClient,
    RetryableFetchError,
)

SOURCE = "api_football"
BASE_URL = "https://v3.football.api-sports.io"
KEY_ENV = "API_FOOTBALL_KEY"
SEASON = 2026

# Ids "habituales" según ejemplos públicos. NO están verificados contra la API (sin clave no se
# puede): la sonda los confirma con /leagues y /teams cuando hay clave.
LEAGUE_ID = 128  # Liga Profesional Argentina (no verificado)
TEAM_ID = 451  # Boca Juniors (no verificado)

# Tope de requests de datos de esta sonda (la regla de la Fase 0 permite 10; dejamos margen
# para el robots.txt del host de la API).
MAX_DATA_REQUESTS = 8

# Estados de partido que significan "jugado" en API-Football (FT normal, AET alargue, PEN penales).
PLAYED_STATUSES = frozenset({"FT", "AET", "PEN"})

# Placeholder para el partido jugado que se elige en tiempo de ejecución.
FIXTURE_PLACEHOLDER = "<fixture_id de un partido jugado de Boca 2026>"


@dataclass(frozen=True)
class PlannedRequest:
    """Una request del plan: endpoint, parámetros y para qué sirve."""

    name: str
    path: str
    params: dict[str, str]
    purpose: str

    def url(self) -> str:
        query = "&".join(f"{k}={v}" for k, v in self.params.items())
        return f"{BASE_URL}{self.path}" + (f"?{query}" if query else "")


def build_plan(team_id: int, fixture_id: str) -> list[PlannedRequest]:
    """Plan exacto de requests (8). El fixture se completa cuando se conoce un partido jugado."""
    season = str(SEASON)
    return [
        PlannedRequest(
            "status",
            "/status",
            {},
            "Plan de la cuenta y cuota usada (solo se guardan plan y contadores, nunca la cuenta).",
        ),
        PlannedRequest(
            "leagues",
            "/leagues",
            {"id": str(LEAGUE_ID), "season": season},
            "Confirmar id de la Liga Profesional y leer el objeto coverage de la temporada 2026.",
        ),
        PlannedRequest(
            "teams",
            "/teams",
            {"search": "Boca"},
            "Confirmar el id de Boca Juniors (Argentina).",
        ),
        PlannedRequest(
            "fixtures",
            "/fixtures",
            {"team": str(team_id), "season": season},
            "Todos los partidos de Boca 2026 (todas las competiciones) y elegir uno jugado.",
        ),
        PlannedRequest(
            "lineups",
            "/fixtures/lineups",
            {"fixture": fixture_id},
            "Alineaciones: titulares, suplentes, formación y DT.",
        ),
        PlannedRequest(
            "events",
            "/fixtures/events",
            {"fixture": fixture_id},
            "Eventos con minuto: goles (tipo y asistente), cambios, tarjetas, VAR.",
        ),
        PlannedRequest(
            "statistics",
            "/fixtures/statistics",
            {"fixture": fixture_id},
            "Box score por equipo (tiros, posesión, pases, xG si existe).",
        ),
        PlannedRequest(
            "players",
            "/fixtures/players",
            {"fixture": fixture_id},
            "Box score por jugador (minutos, rating, tiros, pases, duelos, etc.).",
        ),
    ]


# ---------------------------------------------------------------------------------------------
# Lo que se investigó en documentación y términos (leído con WebFetch/WebSearch, no es scraping).
# Se guarda en el informe para que la decisión quede auditable.
# ---------------------------------------------------------------------------------------------
DOC_RESEARCH: dict[str, Any] = {
    "robots_txt": [
        {
            "url": "https://www.api-football.com/robots.txt",
            "resumen": "User-agent * con Allow: / ; solo prohíbe directorios internos de /news/. "
            "Incluye Content-Signal search=yes, ai-input=yes, ai-train=yes.",
        },
        {
            "url": "https://api-sports.io/robots.txt",
            "resumen": "User-agent * con Allow: / y sin Disallow.",
        },
        {
            "url": "https://v3.football.api-sports.io/robots.txt",
            "resumen": "Devolvió HTTP 403 a WebFetch (no verificado con nuestro User-Agent). Si "
            "sigue sin poder leerse, PoliteClient trata el host como NO permitido y la sonda se "
            "detiene: la decisión de omitir robots.txt en una API autenticada es del dueño del "
            "proyecto, no de la sonda.",
        },
    ],
    "terminos": [
        {
            "url": "https://www.api-football.com/terms",
            "resumen": "403 a WebFetch; contenido leído por extractos de buscador (página con "
            "~584 días de antigüedad según el índice). Los datos vienen de socios; se prohíbe "
            "revenderlos a terceros; se ofrecen para construir apps, sitios y juegos fantasy; es "
            "responsabilidad del usuario obtener autorizaciones o licencias para usar o publicar "
            "los datos en sus productos; apuestas, TV, fantasy o medios masivos pueden requerir "
            "licencias de los titulares de derechos; cuentas bloqueables por incumplimiento; ley "
            "francesa.",
        },
        {
            "url": "https://api-sports.io/terms",
            "resumen": "403 a WebFetch; extracto de buscador: no otorgan licencia para publicar "
            "los datos en apps o sitios; el permiso debe pedirse a las autoridades competentes.",
        },
    ],
    "precios_y_plan_gratuito": [
        {
            "url": "https://www.api-football.com/pricing",
            "resumen": "403 a WebFetch; según buscador: todos los planes incluyen todas las "
            "competiciones y endpoints, con nota de que el plan gratuito está limitado en "
            "temporadas disponibles. Free: 100 requests/día (reinicio 00:00 UTC) y 10/min "
            "según guías de terceros. Rango exacto de temporadas: no publicado / no verificado.",
        },
        {
            "url": "https://github.com/MinhHai12345/MMO/pull/38",
            "resumen": "Reporte de un desarrollador (2026-10-20): el plan Free responde "
            "errors.plan para temporadas fuera de su rango, con 2025/2026 como ejemplo. Indica "
            "que la temporada en curso NO está en el plan gratuito (no oficial).",
        },
    ],
    "documentacion": [
        {
            "url": "https://www.api-football.com/documentation-v3",
            "resumen": "403 a WebFetch. Forma de respuestas tomada de un cliente Go público "
            "(pkg.go.dev/github.com/badkaktus/go-api-football) y guías: coverage.fixtures "
            "{events, lineups, statistics_fixtures, statistics_players}, standings, players, "
            "top_scorers, top_assists, top_cards, injuries, predictions, odds.",
        },
        {
            "url": "https://www.api-football.com/news/post/how-to-optimize-api-sports-calls-and-quota-usage",
            "resumen": "Según extracto: /fixtures?ids= acepta hasta 20 fixture ids separados por "
            "guion y devuelve events, lineups, statistics y players embebidos 'cuando el plan "
            "lo permite' (no verificado para Free).",
        },
    ],
}


def api_errors(payload: Any) -> dict[str, str]:
    """Normaliza `errors`: la API devuelve [] si no hay errores o un dict {campo: mensaje}."""
    if not isinstance(payload, dict):
        return {"parse": "la respuesta no es un objeto JSON"}
    errors = payload.get("errors")
    if isinstance(errors, dict):
        return {str(k): str(v)[:200] for k, v in errors.items()}
    if isinstance(errors, list) and errors:
        return {str(i): str(v)[:200] for i, v in enumerate(errors)}
    return {}


def response_items(payload: Any) -> list[Any]:
    if isinstance(payload, dict) and isinstance(payload.get("response"), list):
        return list(payload["response"])
    return []


# --- resúmenes por endpoint: describen forma y cobertura, sin copiar datos crudos -------------
def summarize_status(payload: Any) -> dict[str, Any]:
    """Solo plan y contadores. El bloque `account` (nombre, email) NO se copia nunca."""
    resp = payload.get("response") if isinstance(payload, dict) else None
    if not isinstance(resp, dict):
        return {}
    subscription = resp.get("subscription") or {}
    requests_info = resp.get("requests") or {}
    return {
        "plan": subscription.get("plan"),
        "activa": subscription.get("active"),
        "requests_hoy": requests_info.get("current"),
        "limite_diario": requests_info.get("limit_day"),
    }


def summarize_leagues(payload: Any) -> dict[str, Any]:
    items = response_items(payload)
    if not items:
        return {"encontrada": False}
    first = items[0]
    league = first.get("league", {})
    seasons = first.get("seasons") or []
    season_info = next((s for s in seasons if s.get("year") == SEASON), None)
    return {
        "encontrada": True,
        "league_id": league.get("id"),
        "nombre": league.get("name"),
        "pais": (first.get("country") or {}).get("name"),
        "temporada_2026_presente": season_info is not None,
        "temporada_2026_inicio_fin": (
            [season_info.get("start"), season_info.get("end")] if season_info else None
        ),
        "coverage_2026": season_info.get("coverage") if season_info else None,
    }


def pick_boca(payload: Any) -> int | None:
    """Elige Boca Juniors de Argentina entre los resultados de /teams?search=Boca."""
    for item in response_items(payload):
        team = item.get("team", {})
        if team.get("name") == "Boca Juniors" and team.get("country") == "Argentina":
            team_id = team.get("id")
            return int(team_id) if isinstance(team_id, int) else None
    return None


def summarize_teams(payload: Any) -> dict[str, Any]:
    items = response_items(payload)
    return {
        "candidatos": len(items),
        "boca_juniors_id": pick_boca(payload),
        "boca_id_coincide_con_451": pick_boca(payload) == TEAM_ID,
    }


def pick_played_fixture(items: list[Any]) -> dict[str, Any] | None:
    """Prefiere el último partido jugado de la Liga Profesional; si no hay, cualquiera jugado."""
    played = [i for i in items if i.get("fixture", {}).get("status", {}).get("short") in PLAYED_STATUSES]
    if not played:
        return None
    played.sort(key=lambda i: i.get("fixture", {}).get("timestamp") or 0)
    league_played = [i for i in played if i.get("league", {}).get("id") == LEAGUE_ID]
    chosen: dict[str, Any] = (league_played or played)[-1]
    return chosen


def summarize_fixtures(payload: Any, team_id: int) -> dict[str, Any]:
    items = response_items(payload)
    competitions: Counter[str] = Counter()
    statuses: Counter[str] = Counter()
    rounds_128: set[str] = set()
    dates: list[str] = []
    for item in items:
        league = item.get("league", {})
        competitions[f"{league.get('id')} | {league.get('name')}"] += 1
        statuses[str(item.get("fixture", {}).get("status", {}).get("short"))] += 1
        if league.get("id") == LEAGUE_ID:
            # El nombre de la ronda dice cómo separa la API Apertura y Clausura (forma, no datos).
            rounds_128.add(str(league.get("round")).split(" - ")[0])
        if item.get("fixture", {}).get("date"):
            dates.append(str(item["fixture"]["date"])[:10])
    chosen = pick_played_fixture(items)
    example: dict[str, Any] | None = None
    if chosen is not None:
        teams = chosen.get("teams", {})
        home = teams.get("home", {})
        away = teams.get("away", {})
        boca_home = home.get("id") == team_id
        # Un único ejemplo (fecha, rival, competición) para confirmar que es Boca 2026.
        example = {
            "fixture_id": chosen.get("fixture", {}).get("id"),
            "fecha": str(chosen.get("fixture", {}).get("date"))[:10],
            "rival": (away if boca_home else home).get("name"),
            "competicion": chosen.get("league", {}).get("name"),
        }
    return {
        "partidos": len(items),
        "jugados": sum(statuses[s] for s in PLAYED_STATUSES),
        "estados": dict(statuses),
        "competiciones": dict(competitions),
        "prefijos_de_ronda_liga_128": sorted(rounds_128),
        "rango_fechas": [min(dates), max(dates)] if dates else None,
        "partido_elegido": example,
    }


def summarize_lineups(payload: Any) -> dict[str, Any]:
    items = response_items(payload)
    return {
        "equipos": len(items),
        "titulares_por_equipo": [len(i.get("startXI") or []) for i in items],
        "suplentes_por_equipo": [len(i.get("substitutes") or []) for i in items],
        "trae_formacion": all(bool(i.get("formation")) for i in items) if items else False,
        "trae_minutos_entrada_salida": False,  # lineups no trae minutos: salen de events/players
    }


def summarize_events(payload: Any) -> dict[str, Any]:
    items = response_items(payload)
    kinds: Counter[str] = Counter()
    with_minute = 0
    goals_with_assist = 0
    goals = 0
    for item in items:
        kinds[f"{item.get('type')} / {item.get('detail')}"] += 1
        if isinstance(item.get("time", {}).get("elapsed"), int):
            with_minute += 1
        if item.get("type") == "Goal":
            goals += 1
            if (item.get("assist") or {}).get("id"):
                goals_with_assist += 1
    return {
        "eventos": len(items),
        "tipos_y_detalles": dict(kinds),
        "eventos_con_minuto": with_minute,
        "goles": goals,
        "goles_con_asistente": goals_with_assist,
    }


def summarize_statistics(payload: Any) -> dict[str, Any]:
    items = response_items(payload)
    stat_types: set[str] = set()
    for item in items:
        for stat in item.get("statistics") or []:
            stat_types.add(str(stat.get("type")))
    return {
        "equipos": len(items),
        "tipos_de_estadistica": sorted(stat_types),
        "trae_xg": any("expected" in t.lower() for t in stat_types),
    }


def summarize_players(payload: Any) -> dict[str, Any]:
    items = response_items(payload)
    players = 0
    with_minutes = 0
    stat_blocks: set[str] = set()
    for team_block in items:
        for player in team_block.get("players") or []:
            players += 1
            for stats in player.get("statistics") or []:
                stat_blocks.update(str(k) for k in stats)
                if isinstance((stats.get("games") or {}).get("minutes"), int):
                    with_minutes += 1
    return {
        "equipos": len(items),
        "jugadores": players,
        "jugadores_con_minutos": with_minutes,
        "bloques_de_estadistica": sorted(stat_blocks),
    }


SUMMARIZERS = {
    "status": summarize_status,
    "leagues": summarize_leagues,
    "teams": summarize_teams,
    "lineups": summarize_lineups,
    "events": summarize_events,
    "statistics": summarize_statistics,
    "players": summarize_players,
}


def backfill_estimate(season_matches: int | None) -> dict[str, Any]:
    """Estimación de requests para cargar la temporada completa, con tope de 90 por día."""
    # Si no se pudo leer el calendario, se usa una estimación: ~40 partidos de liga (Apertura y
    # Clausura con fase regular y playoffs) + ~6 de Copa Argentina + ~8 internacionales.
    matches = season_matches if season_matches is not None else 54
    fixed = {
        "status": 1,
        "leagues_128_130_y_copas": 4,
        "fixtures_boca_2026": 1,
        "fixtures_liga_128_2026_completa": 1,
        "standings_128_2026": 1,
        "squads_boca": 1,
        "players_boca_2026_paginado": 3,
    }
    per_match = 4  # lineups + events + statistics + players
    total_separado = sum(fixed.values()) + matches * per_match
    total_con_ids = sum(fixed.values()) + -(-matches // 20)  # /fixtures?ids= hasta 20 por request
    # Liga completa (para comparar Boca contra la liga), formato supuesto igual a 2025 (no
    # verificado para 2026): 30 equipos, 16 fechas por fase (240 partidos) + 15 de playoffs, x2.
    liga_partidos = 2 * (30 * 16 // 2 + 15)
    return {
        "partidos_boca_considerados": matches,
        "fuente_del_numero": "calendario real" if season_matches is not None else "estimación",
        "requests_fijas": fixed,
        "boca_4_endpoints_por_partido": total_separado,
        "boca_dias_a_90_por_dia": -(-total_separado // 90),
        "boca_con_fixtures_ids_batch_20": total_con_ids,
        "boca_con_batch_dias": -(-total_con_ids // 90),
        "liga_completa_partidos_aprox": liga_partidos,
        "liga_completa_4_endpoints": liga_partidos * per_match,
        "liga_completa_dias_a_90_por_dia": -(-(liga_partidos * per_match) // 90),
        "liga_completa_con_batch_20": -(-liga_partidos // 20),
        "notas": "El batch /fixtures?ids= depende del plan (no verificado para Free). Con el "
        "plan Free la temporada 2026 probablemente responde errors.plan, así que el backfill "
        "real requiere un plan pago o aceptar temporadas anteriores.",
    }


def base_report() -> dict[str, Any]:
    plan = build_plan(TEAM_ID, FIXTURE_PLACEHOLDER)
    return {
        "source": SOURCE,
        "generated_at": datetime.now(UTC).isoformat(timespec="seconds"),
        "base_url": BASE_URL,
        "auth": f"header x-apisports-key leído de la variable de entorno {KEY_ENV}",
        "season": SEASON,
        "ids_supuestos": {"league_liga_profesional": LEAGUE_ID, "team_boca_juniors": TEAM_ID},
        "request_plan": [{"name": p.name, "url": p.url(), "purpose": p.purpose} for p in plan],
        "doc_research": DOC_RESEARCH,
        # Lo que la documentación (vía cliente público y guías) dice que trae cada endpoint.
        # Todo "no verificado" hasta correr la sonda con clave.
        "entidades_segun_documentacion": {
            "partido": "/fixtures: fixture.{id,date,timestamp,referee,venue,status}, "
            "league.{id,name,season,round}, teams.{home,away}, goals, score.{halftime,fulltime,"
            "extratime,penalty}. Filtros team/league/season; incluye todas las competiciones.",
            "alineacion": "/fixtures/lineups: formation, startXI[].player.{id,name,number,pos,"
            "grid}, substitutes[], coach. Sin minutos de entrada/salida.",
            "evento": "/fixtures/events: time.{elapsed,extra}, team, player, assist, type "
            "(Goal, Card, subst, Var), detail (Normal Goal, Penalty, Own Goal, Yellow/Red Card, "
            "Substitution N), comments.",
            "stats_equipo_partido": "/fixtures/statistics: statistics[].{type,value} por equipo "
            "(tiros, a puerta, posesión, pases, córners, faltas; expected_goals en algunas ligas).",
            "stats_jugador_partido": "/fixtures/players: games.{minutes,number,position,rating,"
            "captain,substitute}, offsides, shots, goals, passes, tackles, duels, dribbles, fouls, "
            "cards, penalty.",
            "plantel": "/players/squads (sin fecha de nacimiento) y /players?team&season "
            "(player.birth.date, height, weight, nationality + stats de temporada).",
            "tabla": "/standings?league&season: rank, team, points, goalsDiff, form, all/home/away "
            "para todos los equipos de la liga.",
        },
        "riesgos_operativos": [
            "PoliteClient reintenta hasta 3 veces ante 429/5xx: cada reintento consume cuota.",
            "Las respuestas con errors (HTTP 200) quedan en caché; para reintentar con otro plan "
            "hay que invalidar esa entrada de caché a mano.",
            "Si /status descuenta o no de la cuota diaria: no verificado.",
        ],
        "requests_made": 0,
        "http_results": [],
        "endpoints": {},
        "backfill_estimate": backfill_estimate(None),
    }


def record(report: dict[str, Any], name: str, result: FetchResult, summary: dict[str, Any]) -> None:
    payload: Any = None
    try:
        payload = result.json()
    except ValueError:
        payload = None
    errors = api_errors(payload) if payload is not None else {"parse": "respuesta no JSON"}
    report["http_results"].append(
        {
            "url_masked": result.url,
            "status": result.status,
            "from_cache": result.from_cache,
            "note": f"{name}; errores API: {sorted(errors) or 'ninguno'}",
        }
    )
    report["endpoints"][name] = {
        "url_masked": result.url,
        "status": result.status,
        "sha256": result.sha256,
        "from_cache": result.from_cache,
        "results": payload.get("results") if isinstance(payload, dict) else None,
        "errors": errors,
        "field_paths": json_paths(payload.get("response")) if isinstance(payload, dict) else [],
        "summary": summary,
    }


def run_with_key(key: str, report: dict[str, Any]) -> str:
    """Ejecuta el plan. Devuelve el access_status."""
    headers = {"x-apisports-key": key}
    made = 0
    team_id = TEAM_ID
    with PoliteClient(source=SOURCE) as client:
        # robots.txt explícito (con check_robots=False solo para el propio robots.txt): así
        # sabemos su estado; después el cliente lo reutiliza desde la caché al validar cada URL.
        try:
            robots = client.get(f"{BASE_URL}/robots.txt", check_robots=False)
            made += 0 if robots.from_cache else 1
            report["http_results"].append(
                {
                    "url_masked": robots.url,
                    "status": robots.status,
                    "from_cache": robots.from_cache,
                    "note": "robots.txt del host de la API",
                }
            )
        except (FetchError, RetryableFetchError) as exc:
            report["http_results"].append(
                {"url_masked": f"{BASE_URL}/robots.txt", "status": 0, "note": str(exc)[:200]}
            )

        def call(step: PlannedRequest) -> Any:
            nonlocal made
            if made >= MAX_DATA_REQUESTS + 1:  # +1 por el robots.txt
                raise FetchError("Tope de requests de la sonda alcanzado")
            # API autenticada con clave: la rigen sus términos y la cuota, no robots.txt (responde 403).
            result = client.get(
                f"{BASE_URL}{step.path}", params=step.params, headers=headers, check_robots=False
            )
            made += 0 if result.from_cache else 1
            payload = result.json() if result.status == 200 else None
            summarizer = SUMMARIZERS.get(step.name)
            summary = summarizer(payload) if summarizer and payload is not None else {}
            record(report, step.name, result, summary)
            if result.status in (401, 403):
                # Clave rechazada o bloqueo del host: no se insiste ni se intenta evadir.
                raise FetchError(f"HTTP {result.status} en {result.url}")
            return payload

        status = "funciona"
        try:
            plan = build_plan(team_id, FIXTURE_PLACEHOLDER)
            status_payload = call(plan[0])
            if api_errors(status_payload):
                # Clave inválida o cuenta suspendida: no tiene sentido seguir gastando requests.
                report["requests_made"] = made
                return "error"
            call(plan[1])
            teams_payload = call(plan[2])
            found = pick_boca(teams_payload)
            if found is not None:
                team_id = found
            fixtures_step = build_plan(team_id, FIXTURE_PLACEHOLDER)[3]
            fixtures_payload = call(fixtures_step)
            report["endpoints"]["fixtures"]["summary"] = summarize_fixtures(fixtures_payload, team_id)
            fixture_errors = api_errors(fixtures_payload)
            chosen = pick_played_fixture(response_items(fixtures_payload))
            # Para el backfill cuenta el calendario completo (jugados + por jugar), no solo jugados.
            season_matches = report["endpoints"]["fixtures"]["summary"].get("partidos")
            report["backfill_estimate"] = backfill_estimate(season_matches or None)
            if fixture_errors or chosen is None:
                # Típico del plan Free: errors.plan para la temporada 2026. Se corta acá.
                report["requests_made"] = made
                return "funciona_parcial"
            fixture_id = str(chosen["fixture"]["id"])
            for step in build_plan(team_id, fixture_id)[4:]:
                payload = call(step)
                if api_errors(payload):
                    status = "funciona_parcial"
        except FetchError as exc:
            report["http_results"].append({"url_masked": "-", "status": 0, "note": str(exc)[:200]})
            status = "bloqueado" if "robots" in str(exc) or "403" in str(exc) else "error"
        except RetryableFetchError as exc:
            report["http_results"].append({"url_masked": "-", "status": 0, "note": str(exc)[:200]})
            status = "bloqueado" if "429" in str(exc) else "error"
    report["requests_made"] = made
    return status


def main() -> int:
    report = base_report()
    key = os.environ.get(KEY_ENV, "").strip()
    if not key:
        # Sin clave no se toca la red: se documenta el plan y se informa "requiere_clave".
        report["access_status"] = "requiere_clave"
        report["note"] = (
            f"No se encontró {KEY_ENV} en el entorno; no se hizo ninguna request de datos. "
            "El plan de requests queda listo para ejecutarse cuando haya clave."
        )
    else:
        report["access_status"] = run_with_key(key, report)
    path = write_report(SOURCE, report)
    # La ruta del repo tiene "Θ" y la consola de Windows (cp1252) no puede imprimirla: se
    # muestra la ruta relativa a la raíz del repo.
    print(
        f"[{SOURCE}] {report['access_status']}: {report['requests_made']} requests. "
        f"Informe: {path.relative_to(ROOT).as_posix()}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
