"""Tests de las reglas de conclusiones (`data/conclusion_catalog.csv`)."""

from __future__ import annotations

import json

import httpx
import pytest

from pipeline import catalog, conclusions, load

RULES = conclusions.load_rules()
STATS = {s.id for s in catalog.load_catalog()}


def test_rules_cover_team_and_every_position() -> None:
    ids = [r.id for r in RULES]
    assert len(ids) == len(set(ids))
    assert {r.alcance for r in RULES} == conclusions.POSITIONS
    assert {r.tono_alto for r in RULES} | {r.tono_bajo for r in RULES} >= {"positivo", "negativo", "neutral"}


def test_links_point_to_real_stats_or_situations() -> None:
    for r in RULES:
        assert r.enlace == "situaciones" or r.enlace in STATS, r.id


def test_every_rule_says_something_at_the_ends() -> None:
    # Las del equipo dicen algo arriba y abajo; las de jugador, al menos en un extremo (en las de
    # volumen, «pocos centros» no dice nada de un jugador que juega en otra posición).
    for r in RULES:
        if r.tipo == "jugador":
            assert r.texto_alto or r.texto_bajo, r.id
        else:
            assert r.texto_alto and r.texto_bajo, r.id


def test_plantel_rule_speaks_in_every_band_so_no_player_is_left_out() -> None:
    plantel = [r for r in RULES if r.alcance == "plantel"]
    assert plantel
    for r in plantel:
        assert r.tipo == "jugador" and r.minimo == 0, r.id
        assert r.texto_alto and r.texto_medio and r.texto_bajo, r.id


def test_about_one_hundred_conclusions_half_team_half_players() -> None:
    team = [r for r in RULES if r.tipo != "jugador"]
    players = [r for r in RULES if r.tipo == "jugador"]
    assert len(team) >= 45
    assert len(players) >= 25


def test_band_without_tone_or_unknown_placeholder_is_rejected() -> None:
    base = RULES[0].model_dump()
    with pytest.raises(ValueError):
        conclusions.Rule.model_validate({**base, "tono_alto": ""})
    with pytest.raises(ValueError):
        conclusions.Rule.model_validate({**base, "texto_bajo": "Dice {inventado}"})


def test_payload_and_rpc() -> None:
    payload = conclusions.to_payload(RULES)
    assert payload[0]["sort_order"] == 1
    seen: dict[str, object] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["path"] = request.url.path
        seen["body"] = json.loads(request.content)
        return httpx.Response(200, json={"rules": len(RULES)})

    client = httpx.Client(transport=httpx.MockTransport(handler))
    assert load.send_conclusions(payload, "https://x.supabase.co", "sb_secret_abc", client) == {
        "rules": len(RULES)
    }
    assert seen["path"] == "/rest/v1/rpc/load_conclusions"
