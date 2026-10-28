"""Tests del catálogo de Situaciones (`data/situational_catalog.csv`) y de sus consultas SQL."""

from __future__ import annotations

import json
import re

import httpx

from pipeline import load, situations

CARDS = situations.load_cards()
SQL = "\n".join(p.read_text(encoding="utf-8") for p in sorted(situations.SQL_DIR.glob("[a-k]_*.sql")))
# Ids que aparecen como card_id en algún SELECT de las consultas.
SQL_IDS = set(re.findall(r"'(s\d{3})'", SQL))


def test_at_least_one_hundred_distinct_cards() -> None:
    ids = [c.id for c in CARDS]
    assert len(ids) == len(set(ids))
    assert len(CARDS) >= 100
    assert sum(c.available for c in CARDS) >= 100


def test_every_available_card_has_a_query_and_no_query_without_card() -> None:
    available = {c.id for c in CARDS if c.available}
    assert available <= SQL_IDS, sorted(available - SQL_IDS)
    assert {c.id for c in CARDS} >= SQL_IDS, sorted(SQL_IDS - {c.id for c in CARDS})


def test_unavailable_cards_say_what_is_missing_and_have_no_query() -> None:
    for c in CARDS:
        if not c.available:
            assert c.motivo, c.id
            assert c.id not in SQL_IDS, c.id


def test_categories_follow_section_9_6() -> None:
    assert {c.categoria for c in CARDS} == set("ABCDEFGHIJK")


def test_payload_and_rpc() -> None:
    payload = situations.to_payload(CARDS)
    assert payload[0]["sort_order"] == 1
    assert {p["card_id"] for p in payload} == {c.id for c in CARDS}

    seen: dict[str, object] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["path"] = request.url.path
        seen["body"] = json.loads(request.content)
        return httpx.Response(200, json={"cards": len(CARDS)})

    client = httpx.Client(transport=httpx.MockTransport(handler))
    result = load.send_situations(payload, "https://x.supabase.co", "sb_secret_abc", client)
    assert seen["path"] == "/rest/v1/rpc/load_situations"
    assert set(seen["body"]) == {"p_cards"}  # type: ignore[arg-type]
    assert result == {"cards": len(CARDS)}
