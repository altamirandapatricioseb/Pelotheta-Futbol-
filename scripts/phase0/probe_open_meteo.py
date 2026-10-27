"""Sonda de Fase 0 para Open-Meteo (clima histórico; fuente OPCIONAL del proyecto).

Qué hace y por qué:

- Open-Meteo ofrece una API gratuita (uso no comercial, datos CC BY 4.0) con clima horario
  histórico. Al proyecto le serviría para anotar el clima de cada partido en La Bombonera
  (temperatura, lluvia y viento a la hora del partido). No aporta datos de fútbol.
- Se planifican como máximo 2 requests de DATOS a la API histórica (`archive-api`):
    1. un día de partido de ejemplo (2026-08-15), para ver los campos horarios que devuelve;
    2. una ventana de los últimos días, para medir cuántos días de retraso tiene el archivo.
- Las requests pasan por el cliente compartido `PoliteClient`, que respeta robots.txt. Antes de
  cada request la sonda le pregunta al cliente si robots.txt la permite; si no, NO la hace y lo
  deja registrado. No se usa `check_robots=False` para datos: saltear robots.txt iría contra la
  regla del proyecto, y esa excepción la tiene que decidir una persona, no la sonda.
- El informe describe la FORMA de la respuesta (rutas de campos, unidades, conteos y nulos), no
  copia la serie horaria: como mucho 2 o 3 valores de ejemplo.

robots.txt no cuenta como request de datos. La caché del cliente evita repetir requests al
re-ejecutar (por eso las fechas son fijas y no dependen del día en que se corre).

Ejecutar desde la raíz del repo:
    uv run python -m scripts.phase0.probe_open_meteo
"""

from __future__ import annotations

import json
from datetime import date, datetime, timedelta
from typing import Any
from urllib.parse import urlencode

from scripts.phase0.common import json_paths, write_report
from sources.http_client import (
    ROOT,
    USER_AGENT,
    FetchError,
    FetchResult,
    PoliteClient,
    RetryableFetchError,
)

SOURCE = "open_meteo"
ARCHIVE_HOST = "https://archive-api.open-meteo.com"
ARCHIVE_URL = f"{ARCHIVE_HOST}/v1/archive"
ROBOTS_URL = f"{ARCHIVE_HOST}/robots.txt"

MAX_DATA_REQUESTS = 2  # tope pedido para esta fuente

# Coordenadas aproximadas de La Bombonera. La API devuelve la celda de grilla más cercana,
# que puede no coincidir exactamente con estas coordenadas (se informa la que use).
BOMBONERA_LAT = "-34.6356"
BOMBONERA_LON = "-58.3647"
# Hora local argentina: así las horas de la serie se pueden cruzar con el horario del partido.
TIMEZONE = "America/Argentina/Buenos_Aires"

# Variables horarias que le interesan al proyecto: temperatura, lluvia y viento (más humedad y
# código de tiempo, que ayudan a describir "día de lluvia" sin tener que inferirlo).
HOURLY_VARS = (
    "temperature_2m",
    "relative_humidity_2m",
    "precipitation",
    "rain",
    "wind_speed_10m",
    "wind_direction_10m",
    "wind_gusts_10m",
    "weather_code",
)

MATCH_DAY = "2026-08-15"  # fecha de ejemplo pedida por el plan de la Fase 0
# Fecha de referencia fija ("hoy" según el plan). Es fija para que la URL no cambie entre
# ejecuciones y la caché evite repetir la request.
REFERENCE_DAY = date(2026, 10, 26)
DELAY_WINDOW_DAYS = 10  # el archivo ERA5 tarda ~5 días según la doc; 10 da margen para medirlo

# Términos, licencia, documentación y robots.txt leídos a mano (WebFetch) ANTES de pedir datos.
TERMS_REVIEWED: list[dict[str, str]] = [
    {
        "url": "https://open-meteo.com/en/terms",
        "summary": (
            "API gratuita solo para uso no comercial (sitios privados o sin fines de lucro sin "
            "suscripciones ni publicidad, educación, investigación pública). Límites del plan "
            "gratuito: 600/min, 5.000/h, 10.000/día, 300.000/mes, por IP y por aplicación; "
            "advierte que desde Vercel/Netlify/Render el límite puede llegar antes. Usar la API "
            "gratuita implica aceptar la licencia CC BY 4.0. Se reservan bloquear apps o IPs que "
            "abusen sin aviso. No habla de scraping, descarga en bloque ni redistribución."
        ),
    },
    {
        "url": "https://open-meteo.com/en/licence",
        "summary": (
            "Datos de la API bajo CC BY 4.0: se pueden compartir y adaptar con atribución, enlace "
            "a la licencia e indicación de cambios. Pide un enlace a Open-Meteo donde se muestren "
            "los datos (ejemplo: 'Weather data by Open-Meteo.com'). Los datos de reanálisis se "
            "atribuyen al Copernicus Climate Change Service (C3S). Código del servidor: AGPLv3."
        ),
    },
    {
        "url": "https://open-meteo.com/en/pricing",
        "summary": (
            "Plan gratuito para uso no comercial; uso comercial requiere suscripción (clave "
            "'apikey' en customer-api.open-meteo.com). En planes pagos, el histórico requiere "
            "Professional o superior. Atribución CC BY 4.0 obligatoria en todos los planes. No "
            "menciona descargas en bloque; para cargas grandes sugiere autoalojar el servidor."
        ),
    },
    {
        "url": "https://open-meteo.com/en/docs/historical-weather-api",
        "summary": (
            "Endpoint https://archive-api.open-meteo.com/v1/archive con latitude, longitude, "
            "start_date y end_date; variables horarias (temperature_2m, precipitation, rain, "
            "wind_speed_10m, wind_direction_10m, wind_gusts_10m, weather_code, etc.), unidades "
            "configurables y timezone. Retraso documentado: ERA5 y ERA5-Land ~5 días; ECMWF IFS "
            "sin retraso (cada 6 h, 9 km, desde 2017); IFS Analysis Long-Window 2 días. "
            "'Best match' combina IFS, ERA5 y ERA5-Land. Errores: HTTP 400 con 'error' y 'reason'."
        ),
    },
    {
        "url": f"{ARCHIVE_HOST}/robots.txt",
        "summary": "'User-agent: *' con 'Disallow: /': prohíbe todo el host a cualquier robot.",
    },
    {
        "url": "https://api.open-meteo.com/robots.txt",
        "summary": "Igual: 'User-agent: *' con 'Disallow: /' (API de pronóstico, past_days).",
    },
    {
        "url": "https://historical-forecast-api.open-meteo.com/robots.txt",
        "summary": "Igual: 'User-agent: *' con 'Disallow: /' (Historical Forecast API).",
    },
    {
        "url": "https://open-meteo.com/robots.txt",
        "summary": "Sitio web (documentación): 'User-agent: *' con 'Allow: /'.",
    },
]


# --- armado de URLs -----------------------------------------------------------------------
def archive_url(start: str, end: str, variables: tuple[str, ...]) -> str:
    """Arma la URL de la API histórica. Las comas quedan sin codificar para que sea legible."""
    params = {
        "latitude": BOMBONERA_LAT,
        "longitude": BOMBONERA_LON,
        "start_date": start,
        "end_date": end,
        "hourly": ",".join(variables),
        "timezone": TIMEZONE,
    }
    return f"{ARCHIVE_URL}?{urlencode(params, safe=',/')}"


def planned_requests() -> list[tuple[str, str]]:
    """Las 2 requests de datos planificadas: (etiqueta, URL)."""
    window_start = (REFERENCE_DAY - timedelta(days=DELAY_WINDOW_DAYS)).isoformat()
    window_end = REFERENCE_DAY.isoformat()
    return [
        ("dia_de_partido", archive_url(MATCH_DAY, MATCH_DAY, HOURLY_VARS)),
        # Para medir el retraso alcanza una sola variable: se busca la última hora con valor.
        ("ventana_reciente", archive_url(window_start, window_end, ("temperature_2m",))),
    ]


# --- descripción de respuestas sin copiar datos -------------------------------------------
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


def hourly_series(payload: dict[str, Any]) -> dict[str, list[Any]]:
    """Devuelve el bloque `hourly` como dict de listas (vacío si no viene)."""
    hourly = payload.get("hourly")
    if not isinstance(hourly, dict):
        return {}
    return {str(k): v for k, v in hourly.items() if isinstance(v, list)}


def describe_payload(payload: dict[str, Any]) -> dict[str, Any]:
    """Forma de la respuesta: rutas, unidades, horas devueltas y nulos por variable."""
    series = hourly_series(payload)
    times = series.get("time", [])
    nulls = {name: sum(1 for v in values if v is None) for name, values in series.items()}
    return {
        "rutas_json": json_paths(payload),
        "hourly_units": payload.get("hourly_units"),
        "horas_devueltas": len(times),
        "primera_hora": times[0] if times else None,
        "ultima_hora": times[-1] if times else None,
        "nulos_por_variable": nulls,
        # Metadatos de la celda de grilla usada (no son datos de un tercero sobre fútbol).
        "celda_latitude": payload.get("latitude"),
        "celda_longitude": payload.get("longitude"),
        "elevation_m": payload.get("elevation"),
        "timezone": payload.get("timezone"),
        "utc_offset_seconds": payload.get("utc_offset_seconds"),
    }


def match_day_examples(payload: dict[str, Any]) -> dict[str, Any]:
    """Como mucho 3 valores de ejemplo a las 21:00 local (hora típica de partido nocturno)."""
    series = hourly_series(payload)
    times = series.get("time", [])
    target = f"{MATCH_DAY}T21:00"
    if target not in times:
        return {"nota": f"no hay hora {target} en la serie"}
    i = times.index(target)
    return {
        "hora": target,
        **{
            var: series[var][i]
            for var in ("temperature_2m", "precipitation", "wind_speed_10m")
            if var in series and i < len(series[var])
        },
    }


def measure_delay(payload: dict[str, Any]) -> dict[str, Any]:
    """Última hora con temperatura no nula y cuántos días quedan hasta la fecha de referencia."""
    series = hourly_series(payload)
    times = series.get("time", [])
    temps = series.get("temperature_2m", [])
    last_with_value = None
    for t, v in zip(times, temps, strict=False):
        if v is not None:
            last_with_value = t
    if last_with_value is None:
        return {"ultima_hora_con_valor": None, "retraso_dias": None}
    last_dt = datetime.fromisoformat(last_with_value)
    reference_end = datetime.combine(REFERENCE_DAY, datetime.max.time())
    delay = reference_end - last_dt
    return {
        "ultima_hora_con_valor": last_with_value,
        "fecha_referencia": REFERENCE_DAY.isoformat(),
        "retraso_dias": round(delay.total_seconds() / 86400, 1),
    }


# --- robots.txt ---------------------------------------------------------------------------
def robots_summary(client: PoliteClient) -> dict[str, Any]:
    """Lee robots.txt con el mismo cliente (lo deja en caché y en el manifiesto)."""
    try:
        result = client.get(ROBOTS_URL, check_robots=False)
    except (FetchError, RetryableFetchError) as exc:
        return {"url": ROBOTS_URL, "error": str(exc)}
    # robots.txt es corto y es una política pública del sitio: se guardan sus líneas útiles.
    lines = [ln.strip() for ln in result.text().splitlines()]
    rules = [ln for ln in lines if ln and not ln.startswith("#")]
    return {
        "url": ROBOTS_URL,
        "status": result.status,
        "reglas": rules,
        "user_agent_evaluado": USER_AGENT,
        "permite_v1_archive": client.robots_allows(ARCHIVE_URL),
    }


# --- ejecución ----------------------------------------------------------------------------
def run_requests(client: PoliteClient) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    """Hace (o no) las requests planificadas y devuelve (resultados HTTP, hallazgos)."""
    http_results: list[dict[str, Any]] = []
    findings: dict[str, Any] = {}
    data_requests = 0
    for label, url in planned_requests():
        entry: dict[str, Any] = {"etiqueta": label, "url_masked": url}
        if data_requests >= MAX_DATA_REQUESTS:
            entry["estado"] = "no_pedido_tope_de_requests"
        elif not client.robots_allows(url):
            # No se evade: robots.txt prohíbe el host entero y el cliente lo respeta.
            entry["estado"] = "no_pedido_robots_txt"
            entry["nota"] = "robots.txt del host: 'User-agent: *' + 'Disallow: /'"
        else:
            try:
                result = client.get(url)
            except (FetchError, RetryableFetchError) as exc:
                entry["estado"] = "error"
                entry["nota"] = str(exc)
            else:
                data_requests += 0 if result.from_cache else 1
                entry.update(describe_fetch(result))
                entry["estado"] = "ok" if result.status == 200 else f"http_{result.status}"
                findings[label] = analyze(label, result)
        http_results.append(entry)
    findings["requests_de_datos_por_red_en_esta_ejecucion"] = data_requests
    return http_results, findings


def analyze(label: str, result: FetchResult) -> dict[str, Any]:
    """Describe una respuesta según para qué se pidió."""
    try:
        payload = result.json()
    except (json.JSONDecodeError, UnicodeDecodeError):
        return {"error": "la respuesta no es JSON"}
    if not isinstance(payload, dict):
        return {"error": "la respuesta JSON no es un objeto"}
    if payload.get("error"):
        # La API responde HTTP 400 con {"error": true, "reason": "..."} ante parámetros inválidos.
        return {"error_api": payload.get("reason")}
    described = describe_payload(payload)
    if label == "dia_de_partido":
        described["ejemplos"] = match_day_examples(payload)
    else:
        described["retraso_medido"] = measure_delay(payload)
    return described


def main() -> None:
    report: dict[str, Any] = {
        "fuente": SOURCE,
        "generado": datetime.now().astimezone().isoformat(timespec="seconds"),
        "terminos_revisados": TERMS_REVIEWED,
        "coordenadas_pedidas": {"latitude": BOMBONERA_LAT, "longitude": BOMBONERA_LON},
        "variables_horarias_pedidas": list(HOURLY_VARS),
        "tope_requests_datos": MAX_DATA_REQUESTS,
    }
    with PoliteClient(source=SOURCE) as client:
        report["robots_txt"] = robots_summary(client)
        http_results, findings = run_requests(client)
    report["http_results"] = http_results
    report["hallazgos"] = findings
    report["retraso_documentado"] = {
        "era5_y_era5_land_dias": 5,
        "ecmwf_ifs_dias": 0,
        "ifs_analysis_long_window_dias": 2,
        "fuente": "https://open-meteo.com/en/docs/historical-weather-api",
        "verificado_empiricamente": "ventana_reciente" in findings,
    }
    path = write_report(SOURCE, report)
    # Ruta relativa: la ruta absoluta del repo tiene una Θ que la consola cp1252 de Windows
    # no puede imprimir.
    print(f"Informe guardado en {path.relative_to(ROOT).as_posix()}")
    for entry in http_results:
        print(f"- {entry['etiqueta']}: {entry['estado']}")


if __name__ == "__main__":
    main()
