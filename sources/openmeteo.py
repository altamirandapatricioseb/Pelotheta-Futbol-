"""Adaptador de Open-Meteo: clima a la hora de cada partido (temperatura, lluvia, viento, humedad).

Por qué así: Open-Meteo publica una API gratuita para uso no comercial con licencia CC BY 4.0
(el sitio es no comercial, decisión del dueño del 27-oct-2026). El robots.txt de los dominios
de la API dice «Disallow: /» para rastreadores; acá no se rastrean páginas sino que se hace una
consulta documentada por partido, con caché y pausa (decisión registrada en
docs/security/compliance_register.md). La web cita «Datos del clima: Open-Meteo.com».

Ubicación: la ciudad del estadio (la publica ScoutingStats) se geocodifica con la API de
geocoding de Open-Meteo y se toma el lugar más poblado con ese nombre.
"""

from __future__ import annotations

import json
import time
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import httpx

from sources.http_client import CACHE_DIR, USER_AGENT

SOURCE = "openmeteo"
GEOCODING_URL = "https://geocoding-api.open-meteo.com/v1/search"
WEATHER_URL = "https://historical-forecast-api.open-meteo.com/v1/forecast"
HOURLY = {
    "temperature_2m": "temperature_c",
    "precipitation": "precipitation_mm",
    "wind_speed_10m": "wind_kmh",
    "relative_humidity_2m": "humidity_pct",
}
MIN_INTERVAL_SECONDS = 1.0


class OpenMeteoError(RuntimeError):
    pass


# Nombres que publica la fuente y que el geocodificador (GeoNames) no encuentra tal cual.
# Florencio Varela no figura: se usa Berazategui, a unos 5 km (alcanza para el clima).
CITY_ALIASES = {
    "capital federal": "Buenos Aires",
    "santiago de chile": "Santiago",
    "florencio varela": "Berazategui",
}


def geocoding_name(city: str) -> str:
    alias = CITY_ALIASES.get(city.strip().lower())
    if alias:
        return alias
    for prefix in ("Ciudad de ", "Ciudad del "):
        if city.startswith(prefix):
            return city[len(prefix) :]
    return city


def city_from_venue(venue: str | None) -> str | None:
    """«Estadio X, Ciudad» -> «Ciudad». None si el texto no trae la ciudad."""
    if not venue or "," not in venue:
        return None
    city = venue.rsplit(",", 1)[1].strip()
    return city or None


def best_place(payload: dict[str, Any]) -> tuple[float, float] | None:
    results = [r for r in payload.get("results") or [] if "latitude" in r and "longitude" in r]
    if not results:
        return None
    best = max(results, key=lambda r: r.get("population") or 0)
    return float(best["latitude"]), float(best["longitude"])


def weather_at(payload: dict[str, Any], kickoff_utc: datetime) -> dict[str, float]:
    """Valores de la hora del inicio del partido (UTC). Vacío si la hora no está."""
    hourly = payload.get("hourly") or {}
    stamp = kickoff_utc.astimezone(UTC).strftime("%Y-%m-%dT%H:00")
    times = hourly.get("time") or []
    if stamp not in times:
        return {}
    i = times.index(stamp)
    result: dict[str, float] = {}
    for raw_key, key in HOURLY.items():
        values = hourly.get(raw_key) or []
        if i < len(values) and isinstance(values[i], int | float):
            result[key] = values[i]
    return result


@dataclass
class OpenMeteoClient:
    cache_dir: Path = CACHE_DIR / SOURCE
    _last: float = 0.0

    def _get(self, url: str, params: dict[str, Any], cache_key: str) -> dict[str, Any]:
        cache_file = self.cache_dir / f"{cache_key}.json"
        if cache_file.exists():
            cached: dict[str, Any] = json.loads(cache_file.read_text(encoding="utf-8"))
            return cached
        wait = MIN_INTERVAL_SECONDS - (time.monotonic() - self._last)
        if wait > 0:
            time.sleep(wait)
        try:
            response = httpx.get(url, params=params, headers={"User-Agent": USER_AGENT}, timeout=30)
        except httpx.HTTPError as exc:
            raise OpenMeteoError(type(exc).__name__) from None
        self._last = time.monotonic()
        if response.status_code != 200:
            raise OpenMeteoError(f"HTTP {response.status_code}")
        data: dict[str, Any] = response.json()
        cache_file.parent.mkdir(parents=True, exist_ok=True)
        cache_file.write_text(json.dumps(data), encoding="utf-8")
        return data

    def place(self, city: str) -> tuple[float, float] | None:
        name = geocoding_name(city)
        key = "geo_" + "".join(ch if ch.isalnum() else "_" for ch in name.lower())
        return best_place(self._get(GEOCODING_URL, {"name": name, "count": 10, "format": "json"}, key))

    def weather(self, lat: float, lon: float, kickoff_utc: datetime) -> dict[str, float]:
        day = kickoff_utc.astimezone(UTC).date().isoformat()
        payload = self._get(
            WEATHER_URL,
            {
                "latitude": round(lat, 3),
                "longitude": round(lon, 3),
                "start_date": day,
                "end_date": day,
                "hourly": ",".join(HOURLY),
                "timezone": "UTC",
            },
            f"wx_{round(lat, 2)}_{round(lon, 2)}_{day}",
        )
        return weather_at(payload, kickoff_utc)
