"""Tests del cruce de NoFluffPicks con los partidos de Promiedos."""

from __future__ import annotations

from datetime import UTC, datetime

from pipeline import enrich
from sources import nofluffpicks as nfp
from sources import promiedos as pd
from tests.test_promiedos import game


def nfp_fixture(
    home_id: int = nfp.BOCA_ID, away_id: int = 9, iso: str = "2026-04-29T00:30:00"
) -> nfp.Fixture:
    return nfp.Fixture(
        match_id=1,
        slug="x-vs-y-2026-04-28",
        kickoff_utc=datetime.fromisoformat(iso).replace(tzinfo=UTC),
        complete=True,
        home_id=home_id,
        away_id=away_id,
        home_goals=2,
        away_goals=1,
    )


def test_xg_is_attached_to_the_same_match() -> None:
    parsed = pd.parse_game(game())  # Boca local, 28-04-2026 21:30 en Argentina
    assert parsed is not None
    warnings: list[str] = []
    enrich.attach_nofluffpicks(
        [parsed],
        [(nfp_fixture(), {"xg": (1.8, 0.6), "dangerous_attacks": (50, 30), "shots_total": (12, 7)})],
        warnings,
    )
    xg = {(s.team_source_id, s.stat_key): s for s in parsed.team_stats if s.source == "nofluffpicks"}
    assert xg[("igg", "xg")].value == 1.8
    assert xg[("zzz", "xg")].value == 0.6
    assert ("igg", "dangerous_attacks") in xg
    assert warnings == []


def test_home_away_mismatch_is_skipped_with_warning() -> None:
    parsed = pd.parse_game(game())
    assert parsed is not None
    warnings: list[str] = []
    enrich.attach_nofluffpicks(
        [parsed], [(nfp_fixture(home_id=9, away_id=nfp.BOCA_ID), {"xg": (1.0, 2.0)})], warnings
    )
    assert not any(s.source == "nofluffpicks" for s in parsed.team_stats)
    assert warnings


def test_big_shot_difference_is_reported() -> None:
    parsed = pd.parse_game(game())
    assert parsed is not None
    warnings: list[str] = []
    enrich.attach_nofluffpicks(
        [parsed], [(nfp_fixture(), {"xg": (1.0, 2.0), "shots_total": (30, 7)})], warnings
    )
    assert any("remates" in w for w in warnings)


def test_unmatched_fixture_does_nothing() -> None:
    parsed = pd.parse_game(game())
    assert parsed is not None
    enrich.attach_nofluffpicks([parsed], [(nfp_fixture(iso="2026-06-01T20:00:00"), {"xg": (1.0, 2.0)})], [])
    assert not any(s.source == "nofluffpicks" for s in parsed.team_stats)
