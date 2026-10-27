"""Tests del adaptador de Bzzoiro con respuestas sintéticas (misma forma, datos inventados)."""

from __future__ import annotations

from datetime import UTC, datetime

from sources import bzzoiro as bz


def test_finished_boca_events() -> None:
    payload = {
        "results": [
            {
                "id": 1,
                "event_date": "2026-10-25T20:00:00+00:00",
                "status": "finished",
                "home_team_id": 9,
                "away_team_id": 780,
            },
            {
                "id": 2,
                "event_date": "2025-10-25T20:00:00+00:00",
                "status": "finished",
                "home_team_id": 780,
                "away_team_id": 9,
            },
            {
                "id": 3,
                "event_date": "2026-11-01T20:00:00+00:00",
                "status": "upcoming",
                "home_team_id": 780,
                "away_team_id": 9,
            },
        ]
    }
    events = bz.parse_events(payload, season_year=2026)
    assert [(e.event_id, e.kickoff_utc) for e in events] == [(1, datetime(2026, 10, 25, 20, tzinfo=UTC))]


def test_boca_player_lines_with_names_from_lineups() -> None:
    stats = {
        "player_stats": [
            {
                "player_id": 7,
                "team_id": 780,
                "minutes_played": 90,
                "total_contest": 4,
                "won_contest": 1,
                "ball_recovery": 6,
                "outfielder_block": 2,
                "aerial_lost": 1,
                "error_lead_to_a_shot": 0,
                "progressive_ball_carries_count": 3,
                "pass_value_normalized": -0.2,
                "expected_goals": None,
            },
            {"player_id": 8, "team_id": 780, "minutes_played": 0, "ball_recovery": 1},
            {"player_id": 99, "team_id": 9, "minutes_played": 90, "ball_recovery": 9},
        ]
    }
    lineups = {
        "lineups": {
            "away": {"team_id": 780, "players": [{"id": 7, "name": "Carlos Nueve"}]},
            "home": {"team_id": 9, "players": [{"id": 99, "name": "Rival"}]},
        }
    }
    ((name, values),) = bz.parse_player_stats(stats, lineups)
    assert name == "Carlos Nueve"
    assert values["dribbles_attempted"] == 4 and values["recoveries"] == 6 and values["blocks"] == 2
    assert (
        values["aerials_lost"] == 1 and values["errors_to_shot"] == 0 and values["progressive_carries"] == 3
    )
    assert "xg" not in values  # nulo no es cero
    assert all(v >= 0 for v in values.values())  # las valoraciones normalizadas negativas no se guardan


def test_preferred_foot_codes() -> None:
    assert bz.foot({"preferred_foot": "R"}) == "derecho"
    assert bz.foot({"preferred_foot": "L"}) == "izquierdo"
    assert bz.foot({"preferred_foot": "B"}) == "ambidiestro"
    assert bz.foot({"preferred_foot": None}) is None


def test_boca_player_ids_from_lineups() -> None:
    lineups = {
        "lineups": {
            "home": {
                "team_id": 780,
                "players": [{"id": 1, "name": "A"}],
                "substitutes": [{"id": 2, "name": "B"}],
            },
            "away": {"team_id": 9, "players": [{"id": 3, "name": "C"}]},
        }
    }
    assert bz.boca_player_ids(lineups) == {1: "A", 2: "B"}
