"""Sonda de Fase 0 para football-data.org (API v4).

Qué hace y por qué:

- football-data.org es una API REST con plan gratis limitado a 12 competiciones. La pregunta de
  esta sonda es una sola: ¿la Liga Profesional Argentina (código "ASL", id 2024 según las tablas
  de la documentación) está en el plan gratis? Si no está, la fuente se descarta para Boca 2026.
- Para responderla alcanza con UNA request de datos: GET /v4/competitions. Según la
  documentación, sin token la lista trae todas las competiciones disponibles y, con token, la
  lista filtrada para el cliente. Cada competición trae un campo `plan` (TIER_ONE..TIER_FOUR),
  y el plan gratis corresponde a TIER_ONE (se contrasta con la lista de la página de cobertura).
- La documentación permite acceso anónimo limitado (100 requests por día, solo áreas y lista de
  competiciones), así que la request sin clave es un uso previsto por el proveedor.
- Si existe FOOTBALL_DATA_ORG_KEY en el entorno, se manda en el header X-Auth-Token. Los headers
  nunca se guardan en la caché ni en el manifiesto, y la clave nunca se imprime.
- Todas las requests pasan por PoliteClient (robots.txt, pausa por host, caché, manifiesto con
  SHA-256). El informe describe la FORMA de la respuesta y cuenta cosas; no copia la lista.

Uso (desde la raíz del repo):
    uv run python -m scripts.phase0.probe_football_data_org
"""

from __future__ import annotations

import os
from collections import Counter
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

SOURCE = "football_data_org"
API_HOST = "https://api.football-data.org"
COMPETITIONS_URL = f"{API_HOST}/v4/competitions"
KEY_ENV = "FOOTBALL_DATA_ORG_KEY"

# Presupuesto de la tarea: como máximo 3 requests (robots.txt + 1 de datos + 1 de margen).
MAX_REQUESTS = 3

# El plan Free permite 10 requests por minuto: 6 s entre requests respeta ese ritmo aunque
# solo vayamos a hacer una. Es más que el piso de 3 s del cliente compartido.
MIN_DELAY_SECONDS = 6.0

# Código e id de la Liga Profesional según la tabla de búsqueda de la documentación v4.
ARGENTINA_CODE = "ASL"
ARGENTINA_ID = 2024

# Las 12 competiciones del plan Free según https://www.football-data.org/coverage, traducidas a
# códigos con la tabla de la documentación (Champions League = CL, Primeira Liga = PPL, ...).
# Sirve para comprobar que "TIER_ONE" equivale de verdad al plan gratis.
FREE_TIER_CODES_FROM_COVERAGE = frozenset(
    {"CL", "PPL", "PL", "DED", "BL1", "FL1", "SA", "PD", "ELC", "BSA", "WC", "EC"}
)

# Competiciones que juega Boca en 2026, además de la liga: se buscan por código o nombre.
OTHER_BOCA_COMPETITIONS = {
    "CLI": "Copa Libertadores",
}
OTHER_NAME_HINTS = ("Sudamericana", "Copa Argentina")

# ---------------------------------------------------------------------------------------------
# Lo que se leyó en documentación y términos antes de pedir datos (WebFetch, no es scraping).
# ---------------------------------------------------------------------------------------------
DOC_RESEARCH: dict[str, Any] = {
    "robots_txt": [
        {
            "url": "https://www.football-data.org/robots.txt",
            "resumen": "Solo bloquea al User-agent 'dotbot' (Disallow: /). Para cualquier otro "
            "agente no hay restricciones.",
        },
        {
            "url": "https://api.football-data.org/robots.txt",
            "resumen": "HTTP 404 a WebFetch: sin robots.txt en el host de la API. Por RFC 9309 "
            "eso equivale a todo permitido; la sonda lo vuelve a comprobar con PoliteClient.",
        },
    ],
    "terminos": [
        {
            "url": "https://www.football-data.org/client/register",
            "resumen": "Los 'General Terms and Conditions' (actualizados 2018-06-01) solo están "
            "en la página de registro y se aceptan al registrarse. 2.3: una clave por aplicación "
            "(un dominio para web). 3.1/3.3: política de uso justo, cancelación sin aviso por "
            "uso excesivo. 6.1: las claves no pueden guardarse en repos de código abierto. 7.1: "
            "atribución obligatoria con el texto 'Football data provided by the Football-Data.org "
            "API' visible (pie o 'acerca de'). 9.1: al terminar la suscripción no se puede seguir "
            "referenciando los datos en el sitio propio. 9.2: escudos y fotos son de sus dueños, "
            "hay que pedir permiso. 10.1: ley de Países Bajos. No hay /terms (404).",
        },
        {
            "url": "https://www.football-data.org/about",
            "resumen": "Remite a los mismos términos; datos de 'distintas fuentes' no nombradas, "
            "con chequeo manual diario. Sin garantías de exactitud ni disponibilidad.",
        },
    ],
    "precios_y_cobertura": [
        {
            "url": "https://www.football-data.org/pricing",
            "resumen": "Free: 12 competiciones, 10 requests/min, resultados y calendario con "
            "demora y tablas. Alineaciones, cambios, goleadores, tarjetas y planteles desde "
            "'Free + Deep Data' (29 EUR/mes). Estadísticas de partido (tiros, posesión, etc.) "
            "solo con el add-on Statistics (15 EUR/mes) sobre un plan pago.",
        },
        {
            "url": "https://www.football-data.org/coverage",
            "resumen": "Lista 'Liga Profesional' (Argentina, LEAGUE) y 'Copa Libertadores' entre "
            "las competiciones, pero no en la lista de las 12 gratuitas. El texto de la página no "
            "muestra en qué tier pago está cada una.",
        },
    ],
    "documentacion": [
        {
            "url": "https://docs.football-data.org/general/v4/policies.html",
            "resumen": "Autenticación con header X-Auth-Token. Anónimo: 100 requests por 24 h, "
            "solo recursos de áreas y lista de competiciones. Registrado Free: 10/min.",
        },
        {
            "url": "https://docs.football-data.org/general/v4/lookup_tables.html",
            "resumen": "Tabla de competiciones: ASL = 2024 = Liga Profesional (Argentina); "
            "CLI = 2152 = Copa Libertadores. No figuran Copa Argentina ni Sudamericana. Headers "
            "de respuesta: X-RequestsAvailable, X-RequestCounter-Reset, X-Authenticated-Client.",
        },
        {
            "url": "https://docs.football-data.org/general/v4/competition.html",
            "resumen": "Sin token la lista trae todas las competiciones; con token, filtrada "
            "para el cliente. Subrecursos: /standings, /scorers, /matches, /teams.",
        },
        {
            "url": "https://docs.football-data.org/general/v4/match.html",
            "resumen": "Match: score (fullTime, halfTime), homeTeam/awayTeam con lineup, bench, "
            "formation, coach; goals[] (minute, injuryTime, type, scorer, assist); bookings[] "
            "(minute, player, card); substitutions[] (minute, playerOut, playerIn); statistics "
            "por equipo (shots, shots_on_goal, ball_possession, fouls, corner_kicks, ...); "
            "referees; odds. Sin xG ni estadísticas por jugador.",
        },
        {
            "url": "https://docs.football-data.org/general/v4/errors.html",
            "resumen": "403 = recurso restringido (requiere autenticación o plan pago); "
            "429 = límite por minuto o por día superado.",
        },
    ],
}


def competitions_of(payload: Any) -> list[dict[str, Any]]:
    """Devuelve la lista `competitions` de la respuesta, o vacía si la forma no es la esperada."""
    if isinstance(payload, dict) and isinstance(payload.get("competitions"), list):
        return [c for c in payload["competitions"] if isinstance(c, dict)]
    return []


def area_name(comp: dict[str, Any]) -> str:
    area = comp.get("area")
    return str(area.get("name")) if isinstance(area, dict) else ""


def describe_competition(comp: dict[str, Any]) -> dict[str, Any]:
    """Metadatos de UNA competición (no son datos de partidos): sirven para decidir la fuente."""
    raw_season = comp.get("currentSeason")
    season: dict[str, Any] = raw_season if isinstance(raw_season, dict) else {}
    return {
        "id": comp.get("id"),
        "code": comp.get("code"),
        "name": comp.get("name"),
        "area": area_name(comp),
        "type": comp.get("type"),
        "plan": comp.get("plan"),
        "currentSeason_inicio_fin": [season.get("startDate"), season.get("endDate")],
        "currentSeason_currentMatchday": season.get("currentMatchday"),
        "numberOfAvailableSeasons": comp.get("numberOfAvailableSeasons"),
        "lastUpdated": comp.get("lastUpdated"),
    }


def summarize_competitions(payload: Any) -> dict[str, Any]:
    """Resume la lista: cuántas hay, cómo se reparten por plan y si están Argentina y las copas."""
    comps = competitions_of(payload)
    plans: Counter[str] = Counter(str(c.get("plan")) for c in comps)

    # Las del primer tier: si coinciden con las 12 gratuitas de la página de cobertura,
    # confirmamos que "TIER_ONE" = plan gratis. Listar 12 códigos es metadato del plan, no datos.
    tier_one = [c for c in comps if c.get("plan") == "TIER_ONE"]
    tier_one_codes = {str(c.get("code")) for c in tier_one}

    argentina = [c for c in comps if c.get("code") == ARGENTINA_CODE or area_name(c) == "Argentina"]
    asl = next((c for c in comps if c.get("code") == ARGENTINA_CODE), None)

    others: dict[str, Any] = {}
    for code, label in OTHER_BOCA_COMPETITIONS.items():
        found = next((c for c in comps if c.get("code") == code), None)
        others[label] = describe_competition(found) if found else None
    for hint in OTHER_NAME_HINTS:
        found = next((c for c in comps if hint.lower() in str(c.get("name")).lower()), None)
        others[hint] = describe_competition(found) if found else None

    return {
        "count": payload.get("count") if isinstance(payload, dict) else None,
        "filters": payload.get("filters") if isinstance(payload, dict) else None,
        "competiciones_listadas": len(comps),
        "competiciones_por_plan": dict(plans),
        "tier_one_codigos": sorted(tier_one_codes),
        "tier_one_coincide_con_plan_gratis_de_cobertura": (
            tier_one_codes == FREE_TIER_CODES_FROM_COVERAGE
        ),
        "argentina_competiciones": [describe_competition(c) for c in argentina],
        "asl_presente": asl is not None,
        "asl_id_coincide_con_2024": asl is not None and asl.get("id") == ARGENTINA_ID,
        "asl_en_plan_gratis": asl is not None and asl.get("plan") == "TIER_ONE",
        "otras_competiciones_de_boca": others,
    }


def decide_status(result: FetchResult, summary: dict[str, Any], with_key: bool) -> str:
    """Traduce el resultado a los estados del informe de la Fase 0."""
    if result.status in (401, 403):
        return "requiere_clave"
    if result.status == 429:
        return "bloqueado"
    if result.status != 200:
        return "error"
    if not summary.get("asl_presente"):
        return "sin_cobertura"
    if not summary.get("asl_en_plan_gratis"):
        # La liga existe en el catálogo, pero solo en planes pagos: el plan gratis no la cubre.
        return "sin_cobertura"
    # Está en el plan gratis: sin clave solo vemos la lista, con clave se podría seguir.
    return "funciona" if with_key else "funciona_parcial"


def base_report(with_key: bool) -> dict[str, Any]:
    return {
        "source": SOURCE,
        "generated_at": datetime.now(UTC).isoformat(timespec="seconds"),
        "base_url": f"{API_HOST}/v4/",
        "auth": (
            f"header X-Auth-Token leído de {KEY_ENV}"
            if with_key
            else f"sin clave ({KEY_ENV} ausente): request anónima, permitida por la documentación"
        ),
        "doc_research": DOC_RESEARCH,
        "entidades_segun_documentacion": {
            "partido": "/v4/teams/{id}/matches y /v4/competitions/{code}/matches: utcDate, "
            "status, matchday, stage, homeTeam, awayTeam, score.fullTime/halfTime, competition.",
            "alineacion": "match.homeTeam/awayTeam.lineup[] y bench[] (id, name, position, "
            "shirtNumber), formation, coach. Minutos de entrada y salida solo vía substitutions.",
            "evento": "goals[] (minute, injuryTime, type, scorer, assist), bookings[] (minute, "
            "card), substitutions[] (minute, playerOut, playerIn). Plan 'Deep Data' o superior.",
            "stats_equipo_partido": "statistics por equipo (shots, shots_on_goal, possession, "
            "fouls, corners, saves, offsides...). Solo con add-on Statistics. Sin xG.",
            "stats_jugador_partido": "No existe en la API.",
            "plantel": "/v4/teams/{id}: squad[] (id, name, position, dateOfBirth, nationality). "
            "Sin altura. Plan 'Deep Data' o superior según la página de precios.",
            "tabla": "/v4/competitions/{code}/standings: todos los equipos de la liga.",
        },
        "requests_made": 0,
        "http_results": [],
        "endpoints": {},
    }


def main() -> int:
    key = os.environ.get(KEY_ENV, "").strip()
    with_key = bool(key)
    report = base_report(with_key)
    headers = {"X-Auth-Token": key} if with_key else {}
    made = 0

    with PoliteClient(source=SOURCE, min_delay=MIN_DELAY_SECONDS) as client:
        # 1) robots.txt explícito para dejar constancia de su estado. Después el cliente lo
        #    reutiliza desde la caché al validar la URL de datos (no se pide dos veces).
        try:
            robots = client.get(f"{API_HOST}/robots.txt", check_robots=False)
            made += 0 if robots.from_cache else 1
            report["http_results"].append(
                {
                    "url_masked": robots.url,
                    "status": robots.status,
                    "from_cache": robots.from_cache,
                    "note": "robots.txt del host de la API (404 = sin robots.txt, todo permitido)",
                }
            )
        except (FetchError, RetryableFetchError) as exc:
            report["http_results"].append(
                {"url_masked": f"{API_HOST}/robots.txt", "status": 0, "note": str(exc)[:200]}
            )

        # 2) La única request de datos. La caché se indexa por URL (sin headers): si antes se
        #    corrió sin clave, una corrida con clave reutilizaría la respuesta anónima.
        status = "error"
        try:
            if made >= MAX_REQUESTS:
                raise FetchError("Tope de requests de la sonda alcanzado")
            result = client.get(COMPETITIONS_URL, headers=headers)
            made += 0 if result.from_cache else 1
            payload: Any = None
            try:
                payload = result.json()
            except ValueError:
                payload = None
            summary = summarize_competitions(payload) if result.status == 200 else {}
            # En errores la API devuelve un JSON chico con "message" o "error" (pista del motivo).
            error_hint: Any = None
            if isinstance(payload, dict):
                error_hint = payload.get("message") or payload.get("error")
            report["http_results"].append(
                {
                    "url_masked": result.url,
                    "status": result.status,
                    "from_cache": result.from_cache,
                    "note": "lista de competiciones"
                    + (f"; error API: {str(error_hint)[:150]}" if error_hint else ""),
                }
            )
            report["endpoints"]["competitions"] = {
                "url_masked": result.url,
                "status": result.status,
                "content_type": result.content_type,
                "sha256": result.sha256,
                "from_cache": result.from_cache,
                "field_paths": json_paths(payload),
                "summary": summary,
            }
            status = decide_status(result, summary, with_key)
        except FetchError as exc:
            report["http_results"].append({"url_masked": "-", "status": 0, "note": str(exc)[:200]})
            status = "bloqueado" if "robots" in str(exc) else "error"
        except RetryableFetchError as exc:
            report["http_results"].append({"url_masked": "-", "status": 0, "note": str(exc)[:200]})
            status = "bloqueado" if "429" in str(exc) else "error"

    report["requests_made"] = made
    report["access_status"] = status
    summary_out = report["endpoints"].get("competitions", {}).get("summary", {})
    report["conclusion"] = (
        "Descartar: la Liga Profesional Argentina no está en el plan gratis."
        if status == "sin_cobertura"
        else "Revisar: ver summary de /v4/competitions."
    )
    path = write_report(SOURCE, report)
    # La ruta del repo tiene "Θ" y la consola de Windows (cp1252) no puede imprimirla: se
    # muestra la ruta relativa a la raíz del repo.
    print(
        f"[{SOURCE}] {status}: {made} requests. ASL presente: {summary_out.get('asl_presente')}, "
        f"en plan gratis: {summary_out.get('asl_en_plan_gratis')}. "
        f"Informe: {path.relative_to(ROOT).as_posix()}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
