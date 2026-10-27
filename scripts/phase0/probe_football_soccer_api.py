"""Sonda de Fase 0 para "Football Soccer API" (footballsoccerapi.com).

Qué servicio es (identificado con búsqueda web y lectura manual de su sitio):

- El nombre "Football Soccer API" corresponde a footballsoccerapi.com, operado por "New Tabs"
  (términos regidos por la ley de Tailandia). La API vive en https://api.footballsoccerapi.com/v1
  y se autentica con el header `X-API-Key` (o `Authorization: Bearer`). La clave en la URL se
  rechaza con `400 key_in_address`, así que acá NUNCA va en la query.
- La clave gratuita (sin tarjeta, 50 llamadas por día) se obtiene SOLO iniciando sesión con
  Google. No creamos cuentas: la sonda lee la clave de FOOTBALL_SOCCER_API_KEY y, si no está, no
  pide ningún endpoint de datos.

Qué hace y por qué:

- Sin clave: pide con el cliente compartido el robots.txt del host de la API y, si robots.txt lo
  permite, la especificación OpenAPI (`/v1/openapi.json`). La documentación da el comando para
  descargarla y no dice que requiera clave; es la única ruta pública candidata. De ella se saca
  la FORMA: rutas, parámetros, plan mínimo de cada ruta y qué datos promete cada descripción
  (como banderas sí/no), sin copiar el texto de la documentación.
- Con clave: ejecuta un plan corto para ubicar la Liga Profesional y a Boca y ver qué deja el
  plan gratuito, que solo ve "ayer" (un día UTC completo). Alineaciones, eventos, estadísticas y
  tablas son del plan Archive: se espera un 403 `plan_required`, que también es información.
- La clave nunca se imprime ni se guarda: va solo en el header y el cliente compartido no guarda
  headers en caché ni en el manifiesto.

Presupuesto: como máximo 10 requests de datos EN TOTAL para esta fuente (se cuentan las del
manifiesto, así que volver a correr la sonda no lo supera). Sin clave usa 2.

Ejecución (desde la raíz del repo):
    uv run python -m scripts.phase0.probe_football_soccer_api
"""

from __future__ import annotations

import json
import os
import re
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any

from scripts.phase0.common import json_paths, write_report
from sources.http_client import (
    MANIFEST_PATH,
    ROOT,
    FetchError,
    FetchResult,
    PoliteClient,
    RetryableFetchError,
)

SOURCE = "football_soccer_api"
KEY_ENV = "FOOTBALL_SOCCER_API_KEY"
API_ORIGIN = "https://api.footballsoccerapi.com"
BASE_URL = f"{API_ORIGIN}/v1"
ROBOTS_URL = f"{API_ORIGIN}/robots.txt"
OPENAPI_URL = f"{BASE_URL}/openapi.json"

# Id de la Liga Profesional Argentina según la página pública de cobertura del sitio
# (https://footballsoccerapi.com/our-football-api-data/argentina/liga-profesional-argentina).
# No verificado contra la API: con clave, la sonda lo confirma con /v1/leagues.
LIGA_PROFESIONAL_ID = "lg_22EEYKR"
COUNTRY = "Argentina"
# La API nombra la temporada por el año en que empieza; para ligas de año calendario es el año.
SEASON = "2026"

MAX_DATA_REQUESTS = 10

# Rutas que importan para los datos crudos mínimos (tal como figuran en la especificación).
PATHS_OF_INTEREST = (
    "/v1/coverage",
    "/v1/leagues",
    "/v1/teams",
    "/v1/teams/{team_id}",
    "/v1/matches",
    "/v1/matches/{match_id}",
    "/v1/results/yesterday",
    "/v1/matches/{match_id}/lineups",
    "/v1/matches/{match_id}/events",
    "/v1/matches/{match_id}/statistics",
    "/v1/matches/{match_id}/players",
    "/v1/players/{player_id}",
    "/v1/leagues/{league_id}/seasons/{season}/players",
    "/v1/standings/{league_id}/{season}",
    "/v1/teams/{team_id}/matches",
    "/v1/seasons/{league_id}/{season}",
    "/v1/export/{league_id}/{season}",
)

# Conceptos que buscamos en la descripción de cada ruta. Se guardan como banderas (sí/no) para
# documentar qué promete la API sin copiar su texto.
DESCRIPTION_KEYWORDS = {
    "minuto": ("minute",),
    "minuto_entrada_salida": ("minute_on", "minute_off"),
    "titular_suplente": ("starting eleven", "started", "substitutes"),
    "asistencia": ("assist",),
    "tarjetas": ("card",),
    "amarillas": ("yellow",),
    "penales": ("penalt",),
    "cambios": ("substitution",),
    "tiros": ("shots",),
    "pases": ("passes",),
    "posesion": ("possession",),
    "xg": ("xg",),
    "fecha_nacimiento": ("birth", "date of birth", "dob"),
    "altura": ("height",),
    "nacionalidad": ("nationality",),
    "posicion": ("position",),
    "rating": ("rating",),
}

PLAN_PATTERN = re.compile(r"Plan required:\s*([A-Za-z]+(?: key)?)")


@dataclass(frozen=True)
class PlannedRequest:
    """Una request del plan con clave: ruta, parámetros y para qué sirve."""

    name: str
    path: str
    params: dict[str, str]
    purpose: str

    def url(self) -> str:
        query = "&".join(f"{k}={v}" for k, v in self.params.items())
        return f"{BASE_URL}{self.path}" + (f"?{query}" if query else "")


def build_plan() -> list[PlannedRequest]:
    """Plan con clave (8 requests; con robots.txt y openapi.json suman 10).

    `<boca_id>` y `<match_id>` se completan en ejecución con lo que devuelvan las anteriores.
    """
    return [
        PlannedRequest(
            "usage",
            "/usage",
            {},
            "Plan de la clave y cuota restante (solo se guardan plan y contadores).",
        ),
        PlannedRequest(
            "coverage_liga_2026",
            "/coverage",
            {"league_id": LIGA_PROFESIONAL_ID, "season": SEASON},
            "Qué porcentaje de partidos 2026 trae alineaciones, goles, estadísticas y árbitro.",
        ),
        PlannedRequest(
            "leagues_argentina",
            "/leagues",
            {"country": COUNTRY, "limit": "50"},
            "Confirmar el id de la Liga Profesional y ver si están Copa Argentina y otras.",
        ),
        PlannedRequest(
            "teams_liga",
            "/teams",
            {"league_id": LIGA_PROFESIONAL_ID, "limit": "50"},
            "Encontrar el id de Boca Juniors (tm_...) y contar equipos de la liga.",
        ),
        PlannedRequest(
            "matches_boca_2026",
            "/matches",
            {"team_id": "<boca_id>", "season": SEASON},
            "Partidos de Boca 2026: verifica que la clave gratuita solo ve ayer (403 o vacío).",
        ),
        PlannedRequest(
            "results_yesterday_ar",
            "/results/yesterday",
            {"country": COUNTRY},
            "Partidos de ayer en Argentina: lo único que ve la clave gratuita.",
        ),
        PlannedRequest(
            "match_detail",
            "/matches/<match_id>",
            {},
            "Detalle de un partido de ayer (plan gratuito; la doc dice que trae line-ups).",
        ),
        PlannedRequest(
            "match_lineups",
            "/matches/<match_id>/lineups",
            {},
            "Alineaciones con minutos (plan Archive: se espera 403 plan_required).",
        ),
    ]


def _record(result: FetchResult, note: str) -> dict[str, Any]:
    """Resume una respuesta para el informe: metadatos auditables, nunca el cuerpo."""
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
    """Describe el robots.txt del host de la API (404 = todo permitido según RFC 9309)."""
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
        "directives": directives[:15],  # robots.txt es público y corto: se puede citar
        "interpretation": (
            "404: el host no publica robots.txt; por RFC 9309 todo está permitido"
            if result.status == 404
            else "ver directivas"
        ),
    }


def _manifest_requests() -> int:
    """Cuenta las descargas reales de esta fuente en el manifiesto (total entre corridas)."""
    if not MANIFEST_PATH.exists():
        return 0
    total = 0
    for line in MANIFEST_PATH.read_text(encoding="utf-8").splitlines():
        if line.strip() and json.loads(line).get("source") == SOURCE:
            total += 1
    return total


# --- Análisis de la especificación OpenAPI ---------------------------------------------------


def _resolve(spec: dict[str, Any], node: Any) -> Any:
    """Sigue una referencia `$ref` local (`#/components/...`) hasta el objeto real."""
    seen: set[str] = set()
    while isinstance(node, dict) and isinstance(node.get("$ref"), str):
        ref = node["$ref"]
        if ref in seen or not ref.startswith("#/"):
            return {}
        seen.add(ref)
        target: Any = spec
        for part in ref[2:].split("/"):
            target = target.get(part, {}) if isinstance(target, dict) else {}
        node = target
    return node


def schema_fields(spec: dict[str, Any], schema: Any, prefix: str = "", depth: int = 0) -> list[str]:
    """Lista las rutas de campos que declara un esquema (por ejemplo `meta.next_cursor`).

    Resuelve `$ref` y `items`; se corta en 6 niveles. Solo nombres de campos, nada de datos.
    """
    if depth > 6:
        return []
    node = _resolve(spec, schema)
    if not isinstance(node, dict):
        return []
    fields: list[str] = []
    if isinstance(node.get("items"), dict):
        fields.extend(schema_fields(spec, node["items"], f"{prefix}[]", depth + 1))
    properties = node.get("properties")
    if isinstance(properties, dict):
        for name, sub in properties.items():
            path = f"{prefix}.{name}" if prefix else str(name)
            fields.append(path)
            fields.extend(schema_fields(spec, sub, path, depth + 1))
    return sorted(set(fields))


def _as_dict(value: Any) -> dict[str, Any]:
    """Devuelve el valor si es un objeto JSON, o un objeto vacío (la especificación es de terceros)."""
    return value if isinstance(value, dict) else {}


def _keyword_flags(description: str) -> dict[str, bool]:
    """Marca qué conceptos menciona la descripción de una ruta (sin guardar el texto)."""
    text = description.lower()
    return {concept: any(word in text for word in words) for concept, words in DESCRIPTION_KEYWORDS.items()}


def analyze_openapi(spec: Any) -> dict[str, Any]:
    """Saca de la especificación lo necesario para decidir, sin copiarla.

    La especificación de esta API declara todas las respuestas con un sobre genérico
    (`Envelope`: `data` + `meta`) sin el detalle de campos de `data`; el detalle está en la
    descripción de cada ruta. Por eso se guarda, por ruta: plan mínimo, parámetros y banderas
    de conceptos mencionados.
    """
    if not isinstance(spec, dict):
        return {"error": "openapi.json no es un objeto JSON"}
    info = _as_dict(spec.get("info"))
    paths = _as_dict(spec.get("paths"))
    components = _as_dict(spec.get("components"))
    security_schemes = components.get("securitySchemes", {})
    schemas = components.get("schemas", {})
    global_security = spec.get("security")

    schemes_summary = {
        name: {k: v for k, v in scheme.items() if k in ("type", "in", "name", "scheme")}
        for name, scheme in (security_schemes.items() if isinstance(security_schemes, dict) else [])
        if isinstance(scheme, dict)
    }

    keyless: list[str] = []
    plan_counts: dict[str, int] = {}
    plan_by_operation: dict[str, str] = {}
    of_interest: dict[str, Any] = {}
    for path, item in paths.items():
        if not isinstance(item, dict):
            continue
        for method, operation in item.items():
            if not isinstance(operation, dict):
                continue
            op_name = f"{method.upper()} {path}"
            # Una operación con `security: []` (o sin seguridad global) no necesita clave.
            if operation.get("security") == [] or ("security" not in operation and not global_security):
                keyless.append(op_name)
            description = str(operation.get("description", ""))
            match = PLAN_PATTERN.search(description)
            plan = match.group(1) if match else "no indicado"
            plan_by_operation[op_name] = plan
            plan_counts[plan] = plan_counts.get(plan, 0) + 1
            if method == "get" and path in PATHS_OF_INTEREST:
                params = []
                for raw in operation.get("parameters", []) or []:
                    param = _resolve(spec, raw)
                    if isinstance(param, dict):
                        params.append(f"{param.get('name')} ({param.get('in')})")
                of_interest[path] = {
                    "summary": str(operation.get("summary", ""))[:80],
                    "tags": operation.get("tags", []),
                    "plan_required": plan,
                    "parameters": params,
                    "error_codes_declared": sorted(operation.get("responses", {}).keys()),
                    "mentions": _keyword_flags(description),
                }

    x_plans = spec.get("x-plans")
    return {
        "openapi_version": spec.get("openapi"),
        "info_title": info.get("title"),
        "info_version": info.get("version"),
        "servers": [s.get("url") for s in spec.get("servers", []) if isinstance(s, dict)],
        "security_schemes": schemes_summary,
        "global_security_declared": global_security is not None,
        "keyless_operations": keyless,
        "path_count": len(paths),
        "operation_count": len(plan_by_operation),
        "operations_by_plan": plan_counts,
        "plans_declared": x_plans if isinstance(x_plans, dict) else None,
        "schemas_declared": sorted(schemas.keys()) if isinstance(schemas, dict) else [],
        "envelope_fields": schema_fields(spec, {"$ref": "#/components/schemas/Envelope"}),
        "error_fields": schema_fields(spec, {"$ref": "#/components/schemas/Error"}),
        "paths_of_interest_missing": [p for p in PATHS_OF_INTEREST if p not in paths],
        "paths_of_interest": of_interest,
        "plan_by_operation": plan_by_operation,
        "spec_shape": json_paths(spec, max_depth=1),
    }


# --- Ejecución con clave (solo si FOOTBALL_SOCCER_API_KEY existe) -----------------------------


def _rows(payload: Any) -> list[dict[str, Any]]:
    """Devuelve las filas de `data` (lista de objetos) del sobre de la API."""
    data = payload.get("data") if isinstance(payload, dict) else None
    if isinstance(data, list):
        return [x for x in data if isinstance(x, dict)]
    return []


def run_with_key(client: PoliteClient, key: str, budget: int) -> dict[str, Any]:
    """Ejecuta el plan con clave y describe la forma de cada respuesta (no los datos).

    La clave va solo en el header `X-API-Key`. Se guardan el código HTTP, el código de error de
    la API (por ejemplo `plan_required`), la cantidad de filas y las rutas de campos.
    """
    headers = {"X-API-Key": key}
    results: dict[str, Any] = {}
    ids: dict[str, str] = {}
    used = 0
    for planned in build_plan():
        if used >= budget:
            results[planned.name] = {"status": "no_pedido_presupuesto"}
            continue
        path = planned.path
        params = dict(planned.params)
        missing = [
            name for name in ("boca_id", "match_id") if f"<{name}>" in path or f"<{name}>" in params.values()
        ]
        if any(name not in ids for name in missing):
            results[planned.name] = {"status": f"no_pedido_falta_{'_'.join(missing)}"}
            continue
        for name, value in ids.items():
            path = path.replace(f"<{name}>", value)
            params = {k: v.replace(f"<{name}>", value) for k, v in params.items()}
        try:
            res = client.get(f"{BASE_URL}{path}", params=params or None, headers=headers)
        except (FetchError, RetryableFetchError) as exc:
            results[planned.name] = {"status": "error", "error": str(exc)}
            continue
        used += 0 if res.from_cache else 1
        entry: dict[str, Any] = {"request": _record(res, planned.purpose)}
        try:
            payload = res.json()
        except ValueError:
            entry["error"] = "respuesta no JSON"
            results[planned.name] = entry
            continue
        entry["json_paths"] = json_paths(payload)[:150]
        if isinstance(payload, dict) and isinstance(payload.get("error"), dict):
            # Errores de la API: solo el código estable (p. ej. plan_required), no el mensaje.
            entry["api_error"] = payload["error"].get("code")
        rows = _rows(payload)
        entry["row_count"] = len(rows)
        if planned.name == "teams_liga":
            boca = [r for r in rows if "boca" in str(r.get("name", "")).lower()]
            entry["boca_found"] = bool(boca)
            if boca:
                ids["boca_id"] = str(boca[0].get("id") or boca[0].get("team_id"))
                entry["boca_id"] = ids["boca_id"]
        if planned.name == "results_yesterday_ar" and rows:
            # Preferimos un partido de la Liga Profesional; si no, el primero de Argentina.
            liga = [r for r in rows if LIGA_PROFESIONAL_ID in json.dumps(r)]
            chosen = (liga or rows)[0]
            ids["match_id"] = str(chosen.get("id") or chosen.get("match_id"))
            entry["liga_profesional_rows"] = len(liga)
        results[planned.name] = entry
    results["_network_requests"] = used
    return results


def main() -> None:
    requests_log: list[dict[str, Any]] = []
    errors: list[str] = []
    network_this_run = 0
    robots_summary: dict[str, Any] | None = None
    openapi_status = "no_intentado"
    openapi_analysis: dict[str, Any] | None = None
    keyed_results: dict[str, Any] | None = None

    key = os.environ.get(KEY_ENV, "").strip()

    with PoliteClient(source=SOURCE) as client:
        # 1) robots.txt del host de la API, pedido explícitamente para documentarlo. Queda en
        #    caché y el chequeo interno de las requests siguientes lo reutiliza.
        try:
            robots = client.get(ROBOTS_URL, check_robots=False)
            network_this_run += 0 if robots.from_cache else 1
            requests_log.append(_record(robots, "robots.txt del host de la API"))
            robots_summary = _summarize_robots(robots)
        except (FetchError, RetryableFetchError) as exc:
            errors.append(f"robots.txt: {exc}")

        # 2) Especificación OpenAPI, sin clave. Si robots.txt no lo permite, no se fuerza.
        if not client.robots_allows(OPENAPI_URL):
            openapi_status = "no_pedido_robots_txt"
        else:
            try:
                spec_res = client.get(OPENAPI_URL)
                network_this_run += 0 if spec_res.from_cache else 1
                requests_log.append(_record(spec_res, "openapi.json sin clave"))
                openapi_status = f"http_{spec_res.status}"
                if spec_res.status == 200:
                    try:
                        openapi_analysis = analyze_openapi(spec_res.json())
                    except ValueError:
                        errors.append("openapi.json no devolvió JSON válido")
            except (FetchError, RetryableFetchError) as exc:
                openapi_status = "error"
                errors.append(f"openapi.json: {exc}")

        # 3) Datos de la API: solo con clave. Sin clave no se pide ningún endpoint de datos.
        #    El presupuesto restante se calcula con el manifiesto (total entre corridas).
        if key:
            remaining = max(0, MAX_DATA_REQUESTS - _manifest_requests())
            keyed_results = run_with_key(client, key, remaining)
            network_this_run += int(keyed_results.get("_network_requests", 0))

    access_status = "requiere_clave" if not key else "funciona_parcial"
    report: dict[str, Any] = {
        "source": SOURCE,
        "probed_at": datetime.now(UTC).isoformat(timespec="seconds"),
        "service_identified": {
            "name": "Football Soccer API",
            "site": "https://footballsoccerapi.com/",
            "operator": "New Tabs (según /terms; ley aplicable: Tailandia)",
            "api_base": BASE_URL,
            "auth": "header X-API-Key o Authorization: Bearer; clave en la URL -> 400",
            "key_signup": "Solo inicio de sesión con Google; plan gratuito sin tarjeta",
            "docs": "https://footballsoccerapi.com/documentation",
            "manual": "https://footballsoccerapi.com/documentation/manual.md",
            "liga_profesional_id_publico": LIGA_PROFESIONAL_ID,
        },
        "key_present": bool(key),
        "network_requests_this_run": network_this_run,
        "network_requests_total_in_manifest": _manifest_requests(),
        "requests": requests_log,
        "api_robots_txt": robots_summary,
        "openapi": {"url": OPENAPI_URL, "status": openapi_status, "analysis": openapi_analysis},
        "planned_requests_with_key": [
            {"name": p.name, "url": p.url(), "purpose": p.purpose} for p in build_plan()
        ],
        "free_key_window_note": (
            "Según la especificación y /pricing, la clave gratuita solo ve 'ayer' (un día UTC "
            f"completo); al correr la sonda 'ayer' es "
            f"{(datetime.now(UTC).date() - timedelta(days=1)).isoformat()}."
        ),
        "keyed_results": keyed_results,
        "access_status": access_status,
        "errors": errors,
    }
    path = write_report(SOURCE, report)

    # Resumen corto por consola (sin claves ni datos). La ruta va relativa al repo porque la
    # consola de Windows (cp1252) no imprime la "Θ" del nombre de la carpeta.
    print(f"Informe: {path.relative_to(ROOT).as_posix()}")
    print(f"Clave presente: {bool(key)}")
    print(f"Requests a la red en esta corrida: {network_this_run}")
    for entry in requests_log:
        print(f"  {entry['status']} {entry['url_masked']} (cache={entry['from_cache']})")
    print(f"openapi.json: {openapi_status}")
    if openapi_analysis is not None and "operation_count" in openapi_analysis:
        print(f"Operaciones en la especificacion: {openapi_analysis['operation_count']}")
        print(f"Operaciones por plan: {openapi_analysis['operations_by_plan']}")
    print(f"access_status: {access_status}")
    for err in errors:
        print(f"Error: {err}")


if __name__ == "__main__":
    main()
