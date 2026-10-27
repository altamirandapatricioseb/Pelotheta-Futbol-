"""Tests del armado del lote y de la carga por la Data API (sin red: MockTransport)."""

from __future__ import annotations

import json
from datetime import date

import httpx
import pytest

from pipeline import load
from pipeline.models import FormationRecord, PlayerRecord, PlayerStatRecord, SquadRecord
from sources import promiedos as pd
from tests.test_promiedos import game


def test_batch_dedupes_entities_across_games() -> None:
    g1 = pd.parse_game(game())
    g2 = pd.parse_game(game(id="g2"))
    assert g1 is not None and g2 is not None
    batch = load.build_batch([g1, g2], players=[], squad=[], season_year=2026, run_id="r1")
    assert len(batch["matches"]) == 2
    assert len(batch["teams"]) == 2
    assert len(batch["competitions"]) == 1
    assert len({p["source_id"] for p in batch["players"]}) == len(batch["players"])


def test_squad_data_wins_over_lineup_data() -> None:
    g1 = pd.parse_game(game())
    assert g1 is not None
    key = pd.player_key("Ana Arquera")
    squad_player = PlayerRecord(source_id=key, full_name="Ana Arquera", birth_date=date(2000, 7, 20))
    batch = load.build_batch(
        [g1],
        players=[squad_player],
        squad=[SquadRecord(player_source_id=key, shirt_number=1)],
        season_year=2026,
    )
    merged = next(p for p in batch["players"] if p["source_id"] == key)
    assert merged["birth_date"] == "2000-07-20"
    assert merged["height_cm"] == 180  # dato que solo traía la alineación, se conserva


def test_batch_carries_player_stats_and_formations() -> None:
    g1 = pd.parse_game(game())
    assert g1 is not None
    g1.player_stats.append(
        PlayerStatRecord(
            match_source_id=g1.match.source_id,
            player_source_id="ana arquera",
            stat_key="rating",
            value=7.5,
            source="scoutingstats",
        )
    )
    g1.formations.append(
        FormationRecord(
            match_source_id=g1.match.source_id,
            team_source_id="igg",
            formation="4-2-3-1",
            source="scoutingstats",
        )
    )
    batch = load.build_batch([g1], players=[], squad=[], season_year=2026)
    assert batch["player_stats"][0]["stat_key"] == "rating"
    assert batch["formations"][0]["formation"] == "4-2-3-1"


def test_batch_is_json_serializable() -> None:
    g1 = pd.parse_game(game())
    assert g1 is not None
    json.dumps(load.build_batch([g1], players=[], squad=[], season_year=2026))


def test_load_sends_secret_only_in_header_and_ingest_profile() -> None:
    seen: dict[str, httpx.Request] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["req"] = request
        return httpx.Response(200, json={"matches": 1})

    client = httpx.Client(transport=httpx.MockTransport(handler))
    result = load.send_batch(
        {"source": "promiedos"}, url="https://x.supabase.co", key="sb_secret_abc", client=client
    )
    req = seen["req"]
    assert result == {"matches": 1}
    assert req.url.path == "/rest/v1/rpc/load_batch"
    assert req.headers["Content-Profile"] == "ingest"
    assert req.headers["apikey"] == "sb_secret_abc"
    assert "sb_secret_abc" not in str(req.url)


def test_load_error_does_not_leak_key() -> None:
    client = httpx.Client(transport=httpx.MockTransport(lambda r: httpx.Response(500, text="boom")))
    with pytest.raises(load.LoadError) as exc:
        load.send_batch(
            {"source": "promiedos"}, url="https://x.supabase.co", key="sb_secret_abc", client=client
        )
    assert "sb_secret_abc" not in str(exc.value)


def test_rejects_publishable_key() -> None:
    with pytest.raises(load.LoadError):
        load.send_batch({}, url="https://x.supabase.co", key="sb_publishable_abc")


def test_rejects_non_supabase_url() -> None:
    with pytest.raises(load.LoadError):
        load.send_batch({}, url="https://evil.example.com", key="sb_secret_abc")
