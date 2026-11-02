"""Adaptador de ELNINE con payloads guardados a mano (sin red)."""

from __future__ import annotations

from datetime import date

import pytest

from sources import elnine as en

# Forma observada el 2-nov-2026: JSON con las comillas escapadas dentro del payload de Next.js.
DAY = (
    'self.__next_f.push([1,"{\\"matches\\":[{\\"id\\":\\"Nv8oeRPKIW\\",\\"homeTeam\\":{\\"id\\":\\"a79x697FDX\\",'
    '\\"name\\":\\"Independiente\\",\\"shortName\\":\\"Independiente\\"},\\"awayTeam\\":{\\"id\\":\\"pHrfj0cwD8\\",'
    '\\"name\\":\\"Boca Juniors\\",\\"shortName\\":\\"Boca\\"},\\"homeScore\\":0,\\"awayScore\\":1,'
    '\\"startTime\\":\\"2026-10-25T20:00:00Z\\"},{\\"id\\":\\"OtroBoca01\\",\\"homeTeam\\":{\\"id\\":\\"pHrfj0cwD8\\",'
    '\\"name\\":\\"Boca Juniors\\"},\\"awayTeam\\":{\\"id\\":\\"0zQe5jRsj2\\",\\"name\\":\\"River Plate\\"},'
    '\\"startTime\\":\\"2026-11-02T23:30:00Z\\"}]}"])'
)

MATCH = (
    '{\\"stadium\\":\\"Estadio Alberto José Armando, Argentina\\",\\"capacity\\":57200,'
    '\\"referee\\":\\"Nicolás Ramírez\\",\\"homeLineup\\":{\\"formation\\":\\"4-3-3\\",'
    '\\"coach\\":{\\"name\\":\\"Rodolfo Martín Arruabarrena\\",\\"nameFull\\":\\"Rodolfo Arruabarrena\\"},'
    '\\"players\\":[]},\\"awayLineup\\":{\\"formation\\":\\"4-3-1-2\\",'
    '\\"coach\\":{\\"name\\":\\"Leonardo Ponzio\\",\\"nameFull\\":\\"Leonardo Ponzio\\"}}}'
)


def test_day_lists_matches_and_picks_boca_of_that_date() -> None:
    matches = en.parse_day(DAY)
    assert [m.match_id for m in matches] == ["Nv8oeRPKIW", "OtroBoca01"]
    found = en.boca_match(matches, date(2026, 10, 25))
    assert found is not None and found.match_id == "Nv8oeRPKIW" and not found.boca_home
    assert found.path == "/partido/Nv8oeRPKIW"
    # 23:30 UTC del 2-nov es el 2-nov en la Argentina (20:30): la fecha se mira en hora local.
    later = en.boca_match(matches, date(2026, 11, 2))
    assert later is not None and later.boca_home
    assert en.boca_match(matches, date(2026, 10, 26)) is None


def test_match_reads_stadium_coaches_and_formations() -> None:
    info = en.parse_match(MATCH)
    assert info == {
        "stadium": "Estadio Alberto José Armando, Argentina",
        "capacity": 57200,
        "referee": "Nicolás Ramírez",
        "home_formation": "4-3-3",
        "away_formation": "4-3-1-2",
        "home_coach": "Rodolfo Arruabarrena",
        "away_coach": "Leonardo Ponzio",
    }


def test_missing_or_absurd_values_are_none() -> None:
    info = en.parse_match('{\\"capacity\\":999999,\\"stadium\\":\\"\\"}')
    assert info["capacity"] is None and info["stadium"] is None and info["home_coach"] is None


def test_cloudflare_challenge_is_detected_not_bypassed() -> None:
    with pytest.raises(en.ChallengeError):
        en.check_challenge("<!DOCTYPE html><html><head><title>Just a moment...</title></head></html>")
    assert en.check_challenge(DAY) == DAY
