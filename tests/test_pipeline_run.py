"""Tests del arranque del pipeline: destino validado antes del scraping y errores registrados.

La corrida del 28-oct falló después de 44 minutos de scraping sin dejar rastro en `ingest_log`:
si la URL o la clave de Supabase están mal, la carga falla y el registro del fallo también.
Por eso el destino se valida y se prueba al empezar, y cualquier error inesperado se registra.
"""

from __future__ import annotations

from typing import Any

import httpx
import pytest

from pipeline import load, run

URL = "https://x.supabase.co"
KEY = "sb_secret_abc"


class StopCrawlError(Exception):
    """Corta la corrida apenas empieza el scraping."""


@pytest.fixture
def env(monkeypatch: pytest.MonkeyPatch) -> dict[str, Any]:
    """Entorno sin `.env` ni red: registra las llamadas a la base y corta el scraping."""
    calls: dict[str, Any] = {"crawled": False, "failures": []}
    monkeypatch.setattr(run, "load_dotenv", lambda: None)
    monkeypatch.delenv("SUPABASE_SECRET_KEY", raising=False)
    monkeypatch.delenv("API_SUPABASE_SECRET_KEY", raising=False)
    real_check = load._check_target

    def check_connection(url: str, key: str) -> None:
        # Mismo contrato que el real: valida la forma antes de ir a la red.
        real_check(url, key)
        calls["checked"] = (url, key)

    monkeypatch.setattr(load, "check_connection", check_connection)
    monkeypatch.setattr(
        load, "log_failure", lambda source, message, url, key: calls["failures"].append(message)
    )

    def crawl(*_: object) -> None:
        calls["crawled"] = True
        raise StopCrawlError("corte del test")

    monkeypatch.setattr(run, "crawl", crawl)
    return calls


def test_url_with_trailing_newline_is_rejected() -> None:
    with pytest.raises(load.LoadError):
        load.send_batch({}, url=URL + "\n", key=KEY)


def test_bad_key_stops_before_scraping(env: dict[str, Any], monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("SUPABASE_URL", URL)
    monkeypatch.setenv("SUPABASE_SECRET_KEY", "eyJhbGciOiJIUzI1NiJ9.legacy")
    assert run.main([]) == 2
    assert not env["crawled"]


def test_unreachable_target_stops_before_scraping(
    env: dict[str, Any], monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("SUPABASE_URL", URL)
    monkeypatch.setenv("SUPABASE_SECRET_KEY", KEY)

    def refuse(url: str, key: str) -> None:
        raise load.LoadError("Supabase respondió 401")

    monkeypatch.setattr(load, "check_connection", refuse)
    assert run.main([]) == 2
    assert not env["crawled"]


def test_secrets_with_spaces_or_newlines_are_trimmed(
    env: dict[str, Any], monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("SUPABASE_URL", f" {URL}\n")
    monkeypatch.setenv("SUPABASE_SECRET_KEY", f"{KEY} \n")
    with pytest.raises(StopCrawlError):
        run.main([])
    assert env["checked"] == (URL, KEY)


def test_unexpected_error_is_logged_and_raised(env: dict[str, Any], monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("SUPABASE_URL", URL)
    monkeypatch.setenv("SUPABASE_SECRET_KEY", KEY)
    with pytest.raises(StopCrawlError):
        run.main([])
    assert env["crawled"]
    assert env["failures"] and "StopCrawlError" in env["failures"][0]


def test_check_connection_reads_the_api_schema_with_the_secret_header() -> None:
    seen: dict[str, httpx.Request] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["req"] = request
        return httpx.Response(200, json=[{"key": "ultima_actualizacion"}])

    with httpx.Client(transport=httpx.MockTransport(handler)) as client:
        load.check_connection(URL, KEY, client=client)
    req = seen["req"]
    assert req.method == "GET"
    assert req.url.path == "/rest/v1/system_status"
    assert req.headers["Accept-Profile"] == "api"
    assert req.headers["apikey"] == KEY
    assert KEY not in str(req.url)


def test_check_connection_reports_status_without_the_key() -> None:
    with (
        httpx.Client(
            transport=httpx.MockTransport(lambda r: httpx.Response(401, text="Invalid API key"))
        ) as client,
        pytest.raises(load.LoadError) as exc,
    ):
        load.check_connection(URL, KEY, client=client)
    assert "401" in str(exc.value)
    assert KEY not in str(exc.value)
