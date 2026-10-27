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


def test_goal_text_header_from_corner_with_assist() -> None:
    goal = st.parse_goal_text(
        "Goal! Rival 0, Boca Juniors 1. Carlos Nueve (Boca Juniors) header from very close range to "
        "the centre of the goal. Assisted by Beto Volante following a corner.",
        team_id="5",
    )
    assert goal == st.GoalInfo(
        team_id="5",
        scorer="Carlos Nueve",
        assister="Beto Volante",
        body="header",
        zone="six_yard_box",
        situation="corner",
        assist_type="pass",
    )


def test_goal_text_outside_box_fast_break_and_cross() -> None:
    g1 = st.parse_goal_text(
        "Goal! A 3, B 0. Alexander Díaz (A) right footed shot from outside the box to the bottom right "
        "corner following a fast break.",
        team_id="1",
    )
    assert (g1.body, g1.zone, g1.situation, g1.assister) == ("right_foot", "outside_box", "fast_break", None)
    g2 = st.parse_goal_text(
        "Goal! A 0, B 1. Santiago Uno (B) header from very close range to the centre of the goal. "
        "Assisted by Seba Dos with a cross.",
        team_id="2",
    )
    assert (g2.assister, g2.assist_type) == ("Seba Dos", "cross")


def test_goal_text_direct_free_kick_and_penalty() -> None:
    fk = st.parse_goal_text(
        "Goal! A 0, B 1. Diego Tres (B) from a free kick with a right footed shot to the "
        "bottom right corner.",
        team_id="2",
    )
    assert (fk.situation, fk.body) == ("free_kick", "right_foot")
    pen = st.parse_goal_text(
        "Goal! A 1, B 0. Pedro Cuatro (A) converts the penalty with a left footed shot to the "
        "bottom left corner.",
        team_id="1",
    )
    assert (pen.situation, pen.body) == ("penalty", "left_foot")


def test_goal_type_counts_per_side() -> None:
    goals = [
        st.GoalInfo("5", "X", None, "header", "box", "corner", None),
        st.GoalInfo("5", "Y", "Z", "left_foot", "outside_box", None, "cross"),
        st.GoalInfo("11", "R", None, "right_foot", "box", "penalty", None),
    ]
    counts = st.goal_type_counts(goals, home_id="5", away_id="11")
    assert counts["goals_header"] == (1, 0)
    assert counts["goals_corner"] == (1, 0)
    assert counts["goals_outside_box"] == (1, 0)
    assert counts["goals_from_cross"] == (1, 0)
    assert counts["goals_penalty"] == (0, 1)
    assert counts["goals_fast_break"] == (0, 0)  # se sabe que no hubo: es un cero real


def events_payload() -> dict[str, object]:
    def shot(
        seq: int, team: str, player: str, assister: str | None, xg: float, penalty: bool = False
    ) -> dict:
        return {
            "seq": seq,
            "type": "shot-off-target",
            "team_id": team,
            "player": player,
            "player2": assister,
            "shot": {"xg": xg, "penalty": penalty, "outcome": "missed"},
        }

    return {
        "data": {
            "events": [
                shot(1, "5", "Carlos Nueve", "Beto Volante", 0.2),
                shot(2, "5", "Carlos Nueve", "Beto Volante", 0.1),
                shot(3, "5", "Beto Volante", None, 0.3),
                shot(4, "5", "Carlos Nueve", "Ana Arquera", 0.7, penalty=True),  # el penal no suma xA
                shot(5, "11", "Rival Uno", "Rival Dos", 0.4),
                {
                    "seq": 6,
                    "type": "foul",
                    "team_id": "5",
                    "player": "Ana Arquera",
                    "player2": "Rival Uno",
                    "text": "Penalty conceded by Ana Arquera (Boca Juniors) after a foul in the penalty "
                    "area.",
                },
                {
                    "seq": 7,
                    "type": "foul",
                    "team_id": "11",
                    "player": "Rival Dos",
                    "player2": "Carlos Nueve",
                    "text": "Penalty conceded by Rival Dos (Rival) after a foul in the penalty area.",
                },
                {
                    "seq": 8,
                    "type": "handball",
                    "team_id": "5",
                    "player": "Beto Volante",
                    "text": "Hand ball by Beto Volante.",
                },
            ]
        }
    }


def test_event_stats_for_boca_players() -> None:
    stats = st.boca_event_stats(events_payload())
    assert stats["Beto Volante"]["xa"] == 0.3 and stats["Beto Volante"]["shot_assists"] == 2
    assert stats["Beto Volante"]["handballs"] == 1
    assert "xa" not in stats.get("Ana Arquera", {})  # asistió un penal: no cuenta
    assert stats["Ana Arquera"]["penalties_conceded"] == 1
    assert stats["Carlos Nueve"]["penalties_won"] == 1
    assert "Rival Dos" not in stats


def test_penalty_fouls_in_both_wordings_are_counted_once() -> None:
    def foul(seq: int, team: str, fouler: str, fouled: str, text: str) -> dict[str, object]:
        return {
            "seq": seq,
            "minute": 30,
            "type": "foul",
            "team_id": team,
            "player": fouler,
            "player2": fouled,
            "text": text,
        }

    payload = {
        "data": {
            "events": [
                foul(
                    1,
                    "11",
                    "Rival Uno",
                    "Carlos Nueve",
                    "Penalty Boca Juniors. Carlos Nueve draws a foul in the penalty area.",
                ),
                foul(
                    2,
                    "11",
                    "Rival Uno",
                    "Carlos Nueve",
                    "Penalty conceded by Rival Uno (Rival) after a foul in the penalty area.",
                ),
                foul(
                    3,
                    "5",
                    "Ana Arquera",
                    "Rival Dos",
                    "Penalty Rival. Rival Dos draws a foul in the penalty area.",
                ),
                {
                    "seq": 4,
                    "minute": 70,
                    "type": "var---referee-decision-cancelled",
                    "team_id": "5",
                    "player": "Beto Volante",
                    "text": "VAR Decision: Penalty Boca Juniors.",
                },
            ]
        }
    }
    stats = st.boca_event_stats(payload)
    assert stats["Carlos Nueve"]["penalties_won"] == 1  # dos relatos de la misma falta
    assert stats["Ana Arquera"]["penalties_conceded"] == 1
    assert stats["Beto Volante"]["penalties_won"] == 1  # penal dado por el VAR sin falta relatada
