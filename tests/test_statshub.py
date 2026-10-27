"""Tests del adaptador de Statshub con una respuesta sintética (misma forma, datos inventados)."""

from __future__ import annotations

from datetime import UTC, datetime

from sources import statshub as sh


def payload() -> dict[str, object]:
    def stats(event: int, **values: object) -> dict[str, object]:
        return {"eventId": event, "teamId": 3202, "minutesPlayed": 90, **values}

    return {
        "data": [
            {
                "name": "Carlos Nueve",
                "stats": {
                    "10": stats(
                        10,
                        totalCross=4,
                        accurateCross=1,
                        aerialWon=3,
                        expectedAssists="0.2500",
                        possessionLostCtrl=9,
                        totalClearance=None,
                    ),
                    "11": stats(11, minutesPlayed=0, totalCross=0),
                },
            },
            {"name": "Rival Uno", "stats": {"10": {"eventId": 10, "teamId": 999, "totalCross": 2}}},
        ],
        "events": [
            {"events": {"id": 10, "timeStartTimestamp": 1777422600}},
            {"events": {"id": 11, "timeStartTimestamp": 1777509000}},
        ],
    }


def test_matches_group_boca_player_lines_by_event() -> None:
    matches = sh.parse_performance(payload())
    assert len(matches) == 1  # el partido 11 sin minutos se descarta
    (match,) = matches
    assert match.kickoff_utc == datetime.fromtimestamp(1777422600, tz=UTC)
    ((name, values),) = match.players
    assert name == "Carlos Nueve"
    assert values["crosses"] == 4 and values["crosses_accurate"] == 1
    assert values["aerials_won"] == 3 and values["xa"] == 0.25 and values["possession_lost"] == 9
    assert "clearances" not in values  # nulo no es cero


def test_rival_players_are_ignored() -> None:
    names = [n for m in sh.parse_performance(payload()) for n, _ in m.players]
    assert "Rival Uno" not in names
