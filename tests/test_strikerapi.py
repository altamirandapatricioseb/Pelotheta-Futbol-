"""Tests del adaptador de StrikerAPI con respuestas sintéticas (misma forma, datos inventados)."""

from __future__ import annotations

from datetime import UTC, datetime

from sources import strikerapi as st


def shot(**overrides: object) -> dict[str, object]:
    base: dict[str, object] = {
        "game_id": "401",
        "date": "2026-04-29",
        "minute": 7,
        "team": "CABJ",
        "player_id": "9",
        "player": "Carlos Nueve",
        "outcome": "goal",
        "body_part": "head",
        "penalty": False,
        "zone": "penalty_area",
        "xg": 0.19,
        "x": 0.13,
        "y": 0.4,
        "end_x": 0,
        "end_y": 0.41,
        "distance_m": 9.4,
    }
    return base | overrides


def game_payload(status: str = "final", boca_home: bool = True) -> dict[str, object]:
    boca = {"team_id": "5", "abbrev": "CABJ", "name": "Boca Juniors", "score": 2}
    rival = {"team_id": "11", "abbrev": "RIV", "name": "Rival", "score": 1}
    home, away = (boca, rival) if boca_home else (rival, boca)
    stats = {
        "clearances": 22,
        "tackles": 21,
        "effective_tackles": 10,
        "penalty_attempts": 1,
        "penalty_goals": 1,
    }
    return {
        "data": {
            "game": {
                "game_id": "401",
                "status": status,
                "starts_at": "2026-04-29T00:30:00.000Z",
                "stage": "Torneo Apertura",
                "home": home,
                "away": away,
            },
            "team_stats": [
                {"team_id": home["team_id"], "home": True, **stats},
                {"team_id": away["team_id"], "home": False, **stats, "clearances": 30},
            ],
            "players": [
                {
                    "name": "Carlos Nueve",
                    "team_id": "5",
                    "minute_on": 0,
                    "fouls_committed": 2,
                    "fouls_suffered": 3,
                    "offsides": None,
                },
                {
                    "name": "Ana Arquera",
                    "team_id": "5",
                    "minute_on": 0,
                    "saves": 4,
                    "shots_faced": 5,
                    "goals_conceded": 1,
                },
                {"name": "Rival Uno", "team_id": "11", "fouls_committed": 1},
                {"name": "Banco Sinentrar", "team_id": "5", "minute_on": None, "fouls_committed": 0},
            ],
        }
    }


def test_shots_are_parsed_with_coordinates() -> None:
    (parsed,) = st.parse_shots({"data": {"shots": [shot()]}}, boca=True)
    assert parsed.game_id == "401" and parsed.player == "Carlos Nueve" and parsed.boca
    assert parsed.body_part == "head" and parsed.outcome == "goal" and parsed.xg == 0.19
    assert (parsed.x, parsed.y, parsed.end_x, parsed.end_y) == (0.13, 0.4, 0, 0.41)


def test_shot_with_odd_values_is_skipped() -> None:
    shots = st.parse_shots({"data": {"shots": [shot(xg="raro"), shot(outcome=None), shot()]}}, boca=False)
    assert len(shots) == 1 and not shots[0].boca


def test_final_game_ids_from_list() -> None:
    payload = {
        "data": {"games": [{"game_id": "1", "status": "final"}, {"game_id": "2", "status": "scheduled"}]}
    }
    assert st.final_game_ids(payload) == ["1"]


def test_game_line_with_new_team_keys_and_boca_players() -> None:
    line = st.parse_game(game_payload())
    assert line is not None
    assert line.kickoff_utc == datetime(2026, 4, 29, 0, 30, tzinfo=UTC)
    assert line.boca_home is True
    assert line.team_stats["clearances"] == (22, 30)
    assert line.team_stats["tackles_won"] == (10, 10)
    assert "tackles" not in line.team_stats  # ya la trae ScoutingStats
    names = {p.name: p.stats for p in line.boca_players}
    assert names["Carlos Nueve"] == {"fouls_committed": 2, "fouls_suffered": 3}  # None no es cero
    assert names["Ana Arquera"]["shots_faced"] == 5
    assert "Rival Uno" not in names
    assert "Banco Sinentrar" not in names


def test_unfinished_game_returns_none() -> None:
    assert st.parse_game(game_payload(status="scheduled")) is None


def test_boca_away_detected() -> None:
    line = st.parse_game(game_payload(boca_home=False))
    assert line is not None and line.boca_home is False
