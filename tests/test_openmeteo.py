"""Tests del adaptador de Open-Meteo (clima a la hora del partido) con respuestas sintéticas."""

from __future__ import annotations

from datetime import UTC, datetime

from sources import openmeteo as om


def test_best_place_is_the_most_populated() -> None:
    payload = {
        "results": [
            {
                "name": "Avellaneda",
                "country_code": "ES",
                "population": 41,
                "latitude": 40.4,
                "longitude": -5.4,
            },
            {
                "name": "Avellaneda",
                "country_code": "AR",
                "population": 367554,
                "latitude": -34.66,
                "longitude": -58.37,
            },
            {"name": "Avellaneda", "country_code": "AR", "latitude": -29.1, "longitude": -59.7},
        ]
    }
    assert om.best_place(payload) == (-34.66, -58.37)


def test_no_results_gives_none() -> None:
    assert om.best_place({}) is None


def test_weather_at_kickoff_hour() -> None:
    hours = [f"2026-10-25T{h:02d}:00" for h in range(24)]
    payload = {
        "hourly": {
            "time": hours,
            "temperature_2m": [float(h) for h in range(24)],
            "precipitation": [0.0] * 20 + [1.5, 0, 0, 0],
            "wind_speed_10m": [10.0] * 24,
            "relative_humidity_2m": [50] * 24,
        }
    }
    weather = om.weather_at(payload, datetime(2026, 10, 25, 20, 10, tzinfo=UTC))
    assert weather == {
        "temperature_c": 20.0,
        "precipitation_mm": 1.5,
        "wind_kmh": 10.0,
        "humidity_pct": 50,
    }


def test_missing_hour_gives_empty() -> None:
    assert om.weather_at({"hourly": {"time": []}}, datetime(2026, 10, 25, 20, tzinfo=UTC)) == {}


def test_city_from_venue_text() -> None:
    assert om.city_from_venue("Estadio Libertadores de América, Avellaneda") == "Avellaneda"
    assert om.city_from_venue("La Bombonera") is None


def test_city_names_are_normalized_for_geocoding() -> None:
    assert om.geocoding_name("Capital Federal") == "Buenos Aires"
    assert om.geocoding_name("Ciudad de Córdoba") == "Córdoba"
    assert om.geocoding_name("Santiago de Chile") == "Santiago"
    assert om.geocoding_name("Florencio Varela") == "Berazategui"
    assert om.geocoding_name("Avellaneda") == "Avellaneda"
