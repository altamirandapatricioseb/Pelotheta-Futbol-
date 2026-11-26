"""Jugadores de toda la liga (Bzzoiro): parseo de los dos equipos, perfiles y licencia."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from pipeline import export_parquet as ex
from pipeline import league_players as lp
from sources import bzzoiro as bz

LINEUPS = {
    "lineups": {
        "home": {"team_name": "Club A", "players": [{"id": 1, "name": "Arquero A", "position": "G"}]},
        "away": {
            "team_name": "Club B",
            "players": [{"id": 2, "name": "Nueve B", "position": "F"}],
            "substitutes": [{"id": 3, "name": "Suplente B", "position": "F"}],
        },
    }
}
STATS = {
    "player_stats": [
        {"id": 9, "event_id": 7, "player_id": 1, "team_id": 10, "minutes_played": 90, "saves": 4, "goals": 0},
        {
            "id": 8,
            "event_id": 7,
            "player_id": 2,
            "team_id": 11,
            "minutes_played": 90,
            "goals": 2,
            "rating": "7.5",
        },
        {"id": 7, "event_id": 7, "player_id": 3, "team_id": 11, "minutes_played": 0, "goals": 0},
        {"id": 6, "event_id": 7, "player_id": 99, "team_id": 11, "minutes_played": 90},  # sin nombre: fuera
    ]
}


def test_parse_all_player_stats_keeps_both_teams_and_drops_ids() -> None:
    rows = bz.parse_all_player_stats(STATS, LINEUPS)
    assert [(r["player_name"], r["team_name"], r["position"]) for r in rows] == [
        ("Arquero A", "Club A", "G"),
        ("Nueve B", "Club B", "F"),
    ]
    assert rows[1]["rating"] == 7.5 and "event_id" not in rows[1] and "team_id" not in rows[1]


def test_bzzoiro_club_names_become_the_table_names() -> None:
    lineups = {
        "lineups": {
            "home": {"team_name": "CA Talleres", "players": [{"id": 5, "name": "X", "position": "M"}]}
        }
    }
    assert bz.lineup_people(lineups) == {5: ("X", "Talleres de Córdoba", "M")}


def test_league_events_only_finished_of_the_season() -> None:
    payload = {
        "results": [
            {"id": 1, "event_date": "2026-02-01T20:00:00+00:00", "status": "finished", "home_team": "A"},
            {"id": 2, "event_date": "2026-02-08T20:00:00+00:00", "status": "notstarted"},
            {"id": 3, "event_date": "2025-12-01T20:00:00+00:00", "status": "finished"},
        ]
    }
    assert [e.event_id for e in bz.parse_league_events(payload, 2026)] == [1]


def game(player: int, team: str, position: str, day: int, **stats: Any) -> dict[str, Any]:
    return {
        "player_id": player,
        "player_name": f"J{player}",
        "team_name": team,
        "position": position,
        "match_date": f"2026-03-{day:02d}",
        **stats,
    }


def test_profiles_percentiles_by_position_and_minimum_minutes() -> None:
    rows = [
        *(game(1, "A", "F", d, minutes_played=90, goals=1, saves=0) for d in range(1, 7)),
        *(game(2, "B", "F", d, minutes_played=90, goals=0) for d in range(1, 7)),
        *(game(3, "B", "F", d, minutes_played=90) for d in range(1, 3)),  # 180 min: sin perfil
        *(game(4, "C", "G", d, minutes_played=90, saves=3) for d in range(1, 7)),
    ]
    out = {p["player_name"]: p for p in lp.profiles(rows, 2026)}
    assert set(out) == {"J1", "J2", "J4"}
    assert (out["J1"]["pct_goals"], out["J2"]["pct_goals"]) == (100, 0)
    assert out["J1"]["pct_saves"] is None  # las atajadas solo cuentan para arqueros
    assert out["J4"]["position"] == "Arquero" and out["J4"]["pct_goals"] is None
    assert out["J2"]["pct_expected_goals"] is None  # sin el dato no hay percentil (no es 0)


def test_raw_goes_private_and_profiles_public(tmp_path: Path) -> None:
    raw = [{**game(1, "A", "F", 1, minutes_played=90, goals=1), "season_year": 2026, "event_id": 7}]
    rows = {"league_player_match": raw, "league_player_profile": [{"player_name": "J1", "season_year": 2026}]}
    manifests = ex.export(lambda view: rows.get(view, []), tmp_path, sorted(ex.LEAGUE_PLAYER_VIEWS))
    assert [f["tabla"] for f in manifests["publico"]["archivos"]] == ["league_player_profile"]
    assert [f["tabla"] for f in manifests["privado"]["archivos"]] == ["league_player_match"]
