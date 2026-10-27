"""Sonda de Fase 0 para FootyStats (API de football-data-api.com).

Qué prueba y por qué:

- La web de FootyStats (footystats.org) NO se toca desde código. Sus términos prohíben el acceso
  automatizado ("scrape", "crawl", "bots") salvo autorización escrita, y aclaran que esa
  prohibición no alcanza a su API. Por eso la única vía que podría automatizarse es la API.
- La API es paga (planes desde £29,99/mes). La documentación ofrece una clave pública de demo,
  `key=example`, pensada para probar endpoints sin cuenta. Según la documentación solo cubre la
  Premier League, así que la sonda intenta UNA sola request a un endpoint de lista de ligas
  (`/league-list`) para confirmar en la respuesta real qué deja ver esa clave.
- Antes de esa request el cliente compartido lee el robots.txt del host de la API. Si robots.txt
  no lo permite, NO se fuerza (nada de `check_robots=False` para datos): se registra y se sigue.
- No usamos ninguna clave propia ni creamos cuenta: el proyecto no paga la API en esta fase.

Presupuesto: como máximo 10 requests de datos; esta sonda usa como máximo 2 (robots.txt del host
de la API y `/league-list`). La caché del cliente evita repetirlas si se vuelve a correr.

Ejecución (desde la raíz del repo):
    uv run python -m scripts.phase0.probe_footystats
"""

from __future__ import annotations

import json
from datetime import UTC, datetime
from typing import Any

from scripts.phase0.common import json_paths, write_report
from sources.http_client import (
    MANIFEST_PATH,
    ROOT,
    FetchError,
    FetchResult,
    PoliteClient,
    RetryableFetchError,
    mask_url,
)

SOURCE = "footystats"
API_ORIGIN = "https://api.football-data-api.com"
ROBOTS_URL = f"{API_ORIGIN}/robots.txt"
LEAGUE_LIST_URL = f"{API_ORIGIN}/league-list"

# La clave "example" NO es un secreto: es la clave de demo publicada en la documentación oficial
# (https://footystats.org/api/documentations/try-all-endpoints). Igual el cliente la enmascara
# como "***" en caché y manifiesto porque el parámetro se llama "key".
EXAMPLE_KEY = "example"

MAX_DATA_REQUESTS = 10

# Nombres que usa FootyStats para la primera división argentina. Se comparan en minúsculas y sin
# depender de tildes exactas, porque la API puede devolver "Primera División" o "Primera Division".
ARGENTINA_COUNTRY = "argentina"
ARGENTINA_TOP_LEAGUE_HINTS = ("primera divisi", "liga profesional")

# --- Lectura de términos y robots.txt (hecha a mano con WebFetch, no desde código) -----------
# Se deja en el informe para que la decisión quede auditable junto con la evidencia de red.
WEB_ROBOTS_TXT = {
    "url": "https://footystats.org/robots.txt",
    "summary": (
        "Grupo 'User-agent: *' sin Disallow total, pero bloquea /api/club*, /api/team*, "
        "/api/match*, /c-dl.php (por el nombre, quizás la descarga de CSV: no verificado), "
        "/*.php, /matches?*, /players?*, "
        "/team-stats?* y /*?*hardknock=json*. /clubs/... no figura bloqueado, pero los términos "
        "de la web prohíben igual el acceso automatizado, así que la web no se pide desde código."
    ),
}

TERMS_REVIEWED = [
    {
        "url": "https://footystats.org/terms-and-conditions",
        "summary": (
            "Términos de la web (Over-Under Digital Inc., Canadá; ley y tribunales de Canadá). "
            "Licencia limitada para ver y descargar/imprimir contenido solo para uso personal y "
            "no comercial. Prohíbe acceder, consultar, scrapear, indexar o descargar la web por "
            "medios automatizados (bots, scripts, IA) salvo autorización escrita; aclara que eso "
            "no incluye la API. Prohíbe recuperar datos sistemáticamente para armar bases o "
            "colecciones y republicar contenido sin permiso escrito. CSV: 1 crédito por "
            "descarga, tope de 100 CSV por mes para usuarios Premium. No exige atribución."
        ),
    },
    {
        "url": "https://footystats.org/api/documentations/terms-of-use-and-legal",
        "summary": (
            "Términos de la API: se permite usar los datos en webs y apps públicas y en modelos; "
            "prohíbe revender o redistribuir la API o sus datos crudos a terceros y crear sitios "
            "que copien o compitan con footystats.org. Cuentas individuales. Datos 'as is'."
        ),
    },
    {
        "url": "https://footystats.org/api/documentations/faq",
        "summary": (
            "FAQ de la API: se pueden guardar los datos en base propia y conservarlos tras "
            "cancelar; no exige atribución; prohíbe redistribuir datos crudos de la API."
        ),
    },
    {
        "url": "https://footystats.org/api/documentations/try-all-endpoints",
        "summary": (
            "La clave 'example' es de prueba y no requiere cuenta; los ejemplos usan Premier "
            "League (season_id 12325 = 2024/25). No dice que cubra otras ligas."
        ),
    },
    {
        "url": "https://footystats.org/api/",
        "summary": (
            "Planes: Free (solo Premier League, 180 req/h), Hobby £29,99/mes (50 ligas), "
            "Serious £69,99/mes (150 ligas), Everything £389,99/mes (todas). Lista Argentina "
            "Primera División entre las ligas disponibles."
        ),
    },
    {
        "url": "https://footystats.org/download-stats-csv",
        "summary": (
            "Descarga de CSV requiere login; gratis solo la muestra Premier League 2018/19. "
            "El resto requiere Premium (página /premium: £19,99/mes con promo para Argentina). "
            "Pide usar la API, no los CSV, para descargas automatizadas."
        ),
    },
]

PERMISSIONS = {
    "consult": "Sí, consulta manual en el navegador para uso personal y no comercial.",
    "bulk_download": (
        "Web: no (prohíbe recuperación sistemática). CSV: solo con Premium, 100 por mes, y la "
        "licencia de la web es personal y no comercial. API: guardar datos permitido (FAQ)."
    ),
    "automated_queries": (
        "Web: prohibido salvo autorización escrita. API: permitido con plan pago, pero el "
        "robots.txt del host de la API es 'Disallow: /' para todos."
    ),
    "public_app_reuse": (
        "API paga: sí (webs y apps públicas), sin redistribuir datos crudos. Web y CSV: no "
        "especificado de forma explícita; la licencia de la web es solo personal y no comercial "
        "y prohíbe republicar sin permiso escrito, así que mostrar CSV en el sitio público no "
        "está cubierto."
    ),
    "attribution": "No exigida (FAQ de la API). Web: no borrar avisos de copyright.",
}


def _record(result: FetchResult, note: str) -> dict[str, Any]:
    """Resume una respuesta para el informe: nunca guarda el cuerpo, solo metadatos auditables."""
    return {
        "url_masked": result.url,
        "status": result.status,
        "content_type": result.content_type,
        "bytes": len(result.body),
        "sha256": result.sha256,
        "from_cache": result.from_cache,
        "fetched_at": result.fetched_at,
        "note": note,
    }


def _summarize_robots(result: FetchResult) -> dict[str, Any]:
    """Describe el robots.txt del host de la API.

    Si el host no tiene robots.txt (404) el estándar (RFC 9309) lo trata como "todo permitido".
    Si devuelve HTML o algo que no parece robots.txt, lo anotamos para no sacar conclusiones falsas.
    """
    text = result.text() if 200 <= result.status < 300 else ""
    directives = [
        line.strip()
        for line in text.splitlines()
        if line.strip().lower().startswith(("user-agent", "disallow", "allow", "crawl-delay"))
    ]
    return {
        "url": ROBOTS_URL,
        "status": result.status,
        "content_type": result.content_type,
        "directive_count": len(directives),
        "directives_sample": directives[:10],  # robots.txt es público y corto: se puede citar
        "looks_like_html": "<html" in text.lower(),
    }


def _manifest_requests() -> int:
    """Cuenta cuántas descargas reales de esta fuente quedaron en el manifiesto.

    Sirve para que el informe diga el total real aunque la sonda se vuelva a correr desde caché.
    """
    if not MANIFEST_PATH.exists():
        return 0
    total = 0
    for line in MANIFEST_PATH.read_text(encoding="utf-8").splitlines():
        if line.strip() and json.loads(line).get("source") == SOURCE:
            total += 1
    return total


def _season_years(league: dict[str, Any]) -> list[str]:
    """Devuelve los años de temporada como texto (FootyStats usa p. ej. 20242025 o 2026)."""
    seasons = league.get("season")
    if not isinstance(seasons, list):
        return []
    return [str(s.get("year")) for s in seasons if isinstance(s, dict)]


def _analyze_league_list(payload: Any) -> dict[str, Any]:
    """Saca la forma de la respuesta y lo mínimo para decidir: qué ligas deja ver la clave demo.

    No copia la lista: cuenta ligas y países, y solo detalla Argentina (lo que nos importa).
    """
    analysis: dict[str, Any] = {"json_paths": json_paths(payload)}
    if not isinstance(payload, dict):
        analysis["error"] = "La respuesta no es un objeto JSON"
        return analysis

    analysis["top_level_keys"] = sorted(payload.keys())
    for key in ("success", "message"):
        if key in payload:
            analysis[key] = payload[key]

    leagues = payload.get("data")
    if not isinstance(leagues, list):
        analysis["error"] = "No hay lista 'data' con ligas"
        return analysis

    dict_leagues = [lg for lg in leagues if isinstance(lg, dict)]
    analysis["league_count"] = len(dict_leagues)
    analysis["country_count"] = len({str(lg.get("country", "")) for lg in dict_leagues})
    # Hasta 3 nombres de ejemplo para ver qué deja la clave demo, sin volcar la lista.
    analysis["league_name_examples"] = [str(lg.get("name", "")) for lg in dict_leagues[:3]]

    argentina = [lg for lg in dict_leagues if str(lg.get("country", "")).lower() == ARGENTINA_COUNTRY]
    analysis["argentina_league_count"] = len(argentina)
    analysis["argentina_leagues"] = [
        {
            "name": str(lg.get("name", "")),
            "season_count": len(_season_years(lg)),
            "has_2026": any("2026" in y for y in _season_years(lg)),
        }
        for lg in argentina
    ]
    analysis["argentina_top_league_found"] = any(
        any(hint in str(lg.get("name", "")).lower() for hint in ARGENTINA_TOP_LEAGUE_HINTS)
        for lg in argentina
    )
    return analysis


def main() -> None:
    requests_log: list[dict[str, Any]] = []
    network_this_run = 0
    errors: list[str] = []
    robots_summary: dict[str, Any] | None = None
    league_list_status = "no_intentado"
    league_list_analysis: dict[str, Any] | None = None
    league_list_masked = mask_url(f"{LEAGUE_LIST_URL}?key={EXAMPLE_KEY}")

    with PoliteClient(source=SOURCE) as client:
        # 1) robots.txt del host de la API. Lo pedimos explícitamente (sin chequeo de robots, como
        #    hace el propio cliente al cargarlo) para poder documentarlo; queda en caché y el
        #    chequeo interno de la request siguiente lo reutiliza sin volver a la red.
        try:
            robots = client.get(ROBOTS_URL, check_robots=False)
            network_this_run += 0 if robots.from_cache else 1
            requests_log.append(_record(robots, "robots.txt del host de la API"))
            robots_summary = _summarize_robots(robots)
        except (FetchError, RetryableFetchError) as exc:
            errors.append(f"robots.txt: {exc}")

        # 2) Una sola request de datos: lista de ligas con la clave de demo, solo si robots.txt
        #    la permite. Si no la permite, no se fuerza: es una regla del proyecto.
        if not client.robots_allows(f"{LEAGUE_LIST_URL}?key={EXAMPLE_KEY}"):
            league_list_status = "no_pedido_robots_txt"
        elif network_this_run >= MAX_DATA_REQUESTS:
            league_list_status = "no_pedido_presupuesto"
        else:
            try:
                result = client.get(LEAGUE_LIST_URL, params={"key": EXAMPLE_KEY})
                network_this_run += 0 if result.from_cache else 1
                requests_log.append(_record(result, "league-list con key=example"))
                league_list_status = f"http_{result.status}"
                if result.status == 200:
                    try:
                        league_list_analysis = _analyze_league_list(result.json())
                    except ValueError:
                        # Un desafío anti-bots suele llegar como HTML: lo anotamos y no insistimos.
                        errors.append("league-list no devolvió JSON (posible bloqueo o HTML)")
            except (FetchError, RetryableFetchError) as exc:
                league_list_status = "error"
                errors.append(f"league-list: {exc}")

    robots_blocked = league_list_status == "no_pedido_robots_txt"
    report: dict[str, Any] = {
        "source": SOURCE,
        "probed_at": datetime.now(UTC).isoformat(timespec="seconds"),
        "owner_link": "https://footystats.org/clubs/ca-boca-juniors-705",
        "api_docs": "https://footystats.org/api/documentations/",
        "scope_note": (
            "Solo se intentó la API con la clave pública de demo. La web de footystats.org no se "
            "pidió desde código (sus términos prohíben el acceso automatizado a la web); "
            "términos y robots.txt de la web se leyeron a mano."
        ),
        "network_requests_this_run": network_this_run,
        "network_requests_total_in_manifest": _manifest_requests(),
        "requests": requests_log,
        "api_robots_txt": robots_summary,
        "web_robots_txt": WEB_ROBOTS_TXT,
        "league_list": {
            "url_masked": league_list_masked,
            "status": league_list_status,
            "analysis": league_list_analysis,
        },
        "terms_reviewed": TERMS_REVIEWED,
        "permissions": PERMISSIONS,
        "conclusion": (
            "La API no se pudo probar: el robots.txt de api.football-data-api.com dice "
            "'Disallow: /' para todos y el cliente compartido no lo fuerza. "
            if robots_blocked
            else ""
        )
        + (
            "Para Boca 2026 la API exige plan pago (la clave demo solo cubre Premier League según "
            "la documentación, no verificado con respuesta real) y la web prohíbe el acceso "
            "automatizado. Uso recomendado: referencia manual; CSV subidos a mano a data/manual/ "
            "solo con Premium y para análisis personal, sin publicarlos en el sitio."
        ),
        "errors": errors,
    }
    path = write_report(SOURCE, report)

    # Resumen corto por consola (sin claves ni datos crudos). La ruta se muestra relativa al repo
    # porque la consola de Windows (cp1252) no puede imprimir la "Θ" del nombre de la carpeta.
    print(f"Informe: {path.relative_to(ROOT).as_posix()}")
    print(f"Requests a la red en esta corrida: {network_this_run}")
    for entry in requests_log:
        print(f"  {entry['status']} {entry['url_masked']} (cache={entry['from_cache']})")
    print(f"league-list: {league_list_status}")
    if league_list_analysis is not None:
        print(f"Ligas visibles con key=example: {league_list_analysis.get('league_count')}")
        print(f"Ligas de Argentina visibles: {league_list_analysis.get('argentina_league_count')}")
    for err in errors:
        print(f"Error: {err}")


if __name__ == "__main__":
    main()
