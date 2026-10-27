"""Tests del cruce de NoFluffPicks con los partidos de Promiedos."""

from __future__ import annotations

from datetime import UTC, datetime

from pipeline import enrich
from sources import nofluffpicks as nfp
from sources import promiedos as pd
from sources import scoutingstats as ss
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


def test_nofluffpicks_does_not_overwrite_a_key_already_loaded() -> None:
    parsed = pd.parse_game(game())
    assert parsed is not None
    enrich.attach_scoutingstats([parsed], [ss_match()], [])
    enrich.attach_nofluffpicks([parsed], [(nfp_fixture(), {"xg": (9.0, 9.0)})], [])
    xg = [s for s in parsed.team_stats if s.stat_key == "xg"]
    assert len(xg) == 2 and all(s.source == "scoutingstats" for s in xg)


def ss_match(boca_home: bool = True, players: list[ss.PlayerLine] | None = None) -> ss.ParsedMatch:
    return ss.ParsedMatch(
        kickoff_utc=datetime(2026, 4, 29, 0, 30, tzinfo=UTC),
        boca_home=boca_home,
        team_stats={"xg": (1.8, 0.6), "xgot": (1.1, 0.2), "shots_total": (12, 7), "possession_pct": (55, 45)},
        formations=("4-2-3-1", "4-4-2"),
        boca_players=players
        if players is not None
        else [
            ss.PlayerLine("Ana Arquera", "GK", {"rating": 7.5, "passes": 30}),
            ss.PlayerLine("Beto Volanté", "MID", {"rating": 6.9, "key_passes": 2}),
            ss.PlayerLine("C. Nueve", "FWD", {"rating": 7.0}),
            ss.PlayerLine("Nadie Conocido", "FWD", {"rating": 6.0}),
        ],
    )


def test_scoutingstats_adds_new_team_keys_only() -> None:
    parsed = pd.parse_game(game())
    assert parsed is not None
    enrich.attach_scoutingstats([parsed], [ss_match()], [])
    ss_rows = {
        (s.team_source_id, s.stat_key): s.value for s in parsed.team_stats if s.source == "scoutingstats"
    }
    assert ss_rows[("igg", "xg")] == 1.8 and ss_rows[("zzz", "xgot")] == 0.2
    # Remates y posesión ya los trae Promiedos: no se duplican.
    assert ("igg", "shots_total") not in ss_rows and ("igg", "possession_pct") not in ss_rows


def test_scoutingstats_formations_by_side() -> None:
    parsed = pd.parse_game(game())
    assert parsed is not None
    enrich.attach_scoutingstats([parsed], [ss_match()], [])
    assert {(f.team_source_id, f.formation) for f in parsed.formations} == {
        ("igg", "4-2-3-1"),
        ("zzz", "4-4-2"),
    }


def test_scoutingstats_players_matched_by_name() -> None:
    parsed = pd.parse_game(game())
    assert parsed is not None
    warnings: list[str] = []
    enrich.attach_scoutingstats([parsed], [ss_match()], warnings)
    by_player = {(s.player_source_id, s.stat_key): s.value for s in parsed.player_stats}
    assert by_player[("ana arquera", "rating")] == 7.5
    assert by_player[("beto volante", "key_passes")] == 2  # sin tildes
    assert by_player[("carlos nueve", "rating")] == 7.0  # por apellido, único en la alineación
    assert any("Nadie Conocido" in w for w in warnings)


def test_scoutingstats_side_mismatch_is_skipped() -> None:
    parsed = pd.parse_game(game())
    assert parsed is not None
    warnings: list[str] = []
    assert enrich.attach_scoutingstats([parsed], [ss_match(boca_home=False)], warnings) == 0
    assert not parsed.player_stats and not parsed.formations and warnings


def test_unmatched_fixture_does_nothing() -> None:
    parsed = pd.parse_game(game())
    assert parsed is not None
    enrich.attach_nofluffpicks([parsed], [(nfp_fixture(iso="2026-06-01T20:00:00"), {"xg": (1.0, 2.0)})], [])
    assert not any(s.source == "nofluffpicks" for s in parsed.team_stats)
