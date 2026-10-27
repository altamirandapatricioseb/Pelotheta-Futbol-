"""Pruebas del cliente HTTP respetuoso, sin red (transporte simulado de httpx)."""

from __future__ import annotations

import json
from pathlib import Path

import httpx
import pytest

from sources import http_client
from sources.http_client import FetchError, PoliteClient, mask_url


def make_client(tmp_path: Path, handler: httpx.MockTransport, **kwargs: object) -> PoliteClient:
    client = PoliteClient(
        source="prueba",
        cache_dir=tmp_path / "cache",
        manifest_path=tmp_path / "manifest.jsonl",
        **kwargs,  # type: ignore[arg-type]
    )
    client.__enter__()
    assert client._client is not None
    client._client = httpx.Client(transport=handler, follow_redirects=False)
    return client


def robots_ok(request: httpx.Request) -> httpx.Response | None:
    if request.url.path == "/robots.txt":
        return httpx.Response(200, text="User-agent: *\nDisallow: /privado/\n")
    return None


def test_mask_url_oculta_claves() -> None:
    assert mask_url("https://x.com/a?key=SECRETO&season=2026") == "https://x.com/a?key=***&season=2026"


def test_pausa_minima_no_se_puede_bajar() -> None:
    with pytest.raises(ValueError):
        PoliteClient(source="x", min_delay=1.0)


def test_cache_evita_repetir_requests(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(http_client.time, "sleep", lambda _s: None)
    calls: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(request.url.path)
        return robots_ok(request) or httpx.Response(200, json={"ok": True})

    client = make_client(tmp_path, httpx.MockTransport(handler))
    first = client.get("https://ejemplo.com/datos")
    second = client.get("https://ejemplo.com/datos")
    assert first.from_cache is False and second.from_cache is True
    assert calls.count("/datos") == 1
    manifest = [json.loads(line) for line in (tmp_path / "manifest.jsonl").read_text().splitlines()]
    assert any(entry["url"].endswith("/datos") and len(entry["sha256"]) == 64 for entry in manifest)


def test_respeta_robots(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(http_client.time, "sleep", lambda _s: None)
    client = make_client(tmp_path, httpx.MockTransport(lambda r: robots_ok(r) or httpx.Response(200)))
    with pytest.raises(FetchError):
        client.get("https://ejemplo.com/privado/x")


def test_bloquea_redireccion_a_otro_dominio(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(http_client.time, "sleep", lambda _s: None)

    def handler(request: httpx.Request) -> httpx.Response:
        return robots_ok(request) or httpx.Response(302, headers={"location": "https://malo.net/x"})

    client = make_client(tmp_path, httpx.MockTransport(handler))
    with pytest.raises(FetchError):
        client.get("https://ejemplo.com/x")


def test_las_claves_en_headers_no_se_guardan(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(http_client.time, "sleep", lambda _s: None)
    client = make_client(
        tmp_path, httpx.MockTransport(lambda r: robots_ok(r) or httpx.Response(200, text="ok"))
    )
    client.get("https://ejemplo.com/api?api_key=SECRETO", headers={"x-apisports-key": "SECRETO"})
    stored = "".join(p.read_text(errors="ignore") for p in tmp_path.rglob("*") if p.is_file())
    assert "SECRETO" not in stored


def test_espera_entre_requests_al_mismo_host(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    sleeps: list[float] = []
    monkeypatch.setattr(http_client.time, "sleep", sleeps.append)
    client = PoliteClient(source="prueba", cache_dir=tmp_path, manifest_path=tmp_path / "m.jsonl")
    client._wait_turn("ejemplo.com")  # primera request: no espera
    client._wait_turn("ejemplo.com")  # segunda, enseguida: espera casi 3 s
    client._wait_turn("otro.com")  # otro host: no espera
    assert len(sleeps) == 1
    assert 2.9 < sleeps[0] <= 3.0


def test_same_site_compares_full_host() -> None:
    from sources.http_client import _same_site

    assert _same_site("www.fbref.com", "fbref.com")
    assert _same_site("bocastats.com", "www.bocastats.com")
    assert not _same_site("www.football-data.co.uk", "evil.co.uk")
    assert not _same_site("www.promiedos.com.ar", "api.promiedos.com.ar")
