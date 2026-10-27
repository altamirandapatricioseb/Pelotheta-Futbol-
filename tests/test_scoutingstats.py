"""Tests del adaptador de ScoutingStats con HTML sintético (misma forma, datos inventados)."""

from __future__ import annotations

import re

import pytest

from sources import scoutingstats as ss

BOCA_CREST = "https://cdn.sportmonks.com/images/soccer/teams/11/587.png"
RIVAL_CREST = "https://cdn.sportmonks.com/images/soccer/teams/24/999.png"


def stat_row(home: str, label: str, away: str) -> str:
    return (
        '<div class="mr8-sr"><div class="mr8-sr-top">'
        f'<span class="v h lead">{home}</span><span class="l">{label}</span>'
        f'<span class="v a">{away}</span></div></div>'
    )


def player_row(side: str, name: str, crest: str, **data: str) -> str:
    values = {
        "r": "7.0",
        "min": "90",
        "g": "0",
        "a": "0",
        "xg": "0",
        "sh": "2",
        "kp": "1",
        "ps": "40",
        "tk": "3",
        "in": "1",
        "du": "5",
        "dr": "2",
    } | data
    attrs = " ".join(f'data-{k}="{v}"' for k, v in values.items())
    passes = values["ps"]
    return (
        f'<tr data-side="{side}" data-name="{name}" {attrs}>'
        f'<th class="pl" scope="row"><a href="/player/x-1/"><img src="{crest}">'
        f'<span class="nm">{name}</span><span class="ps">MID</span></a></th>'
        f"<td>{values['r']}</td><td>{values['min']}</td><td>0</td><td>0</td><td>–</td>"
        f"<td>{values['sh']}<small> (1)</small></td><td>1</td><td>{passes}<small> 85%</small></td>"
        "<td>3</td><td>1</td><td>5</td><td>2</td></tr>"
    )


def match_html(state: str = "Full time", boca_home: bool = False) -> str:
    home_crest, away_crest = (BOCA_CREST, RIVAL_CREST) if boca_home else (RIVAL_CREST, BOCA_CREST)
    boca_side = "h" if boca_home else "a"
    return (
        "<html><body>"
        f'<div class="mr8-state">{state}</div>'
        '<p class="mr8-meta"><time datetime="2026-10-25T23:30:00Z" data-when>2026-10-25</time>'
        " · Estadio Libertadores de América, Avellaneda</p>"
        + stat_row("1.82", "Expected goals (xG)", "1.43")
        + stat_row("1.57", "xG on target", "0.76")
        + stat_row("1", "Big chances", "5")
        + stat_row("74%", "Pass accuracy", "87%")
        + stat_row("23", "Shots", "10")
        + stat_row("9", "Algo nuevo", "9")
        + '<table class="mr8-rt" data-rt><tbody>'
        + player_row(boca_side, "Álvaro Montero", BOCA_CREST, r="8.1", sh="0")
        + player_row("h" if not boca_home else "a", "Rival Uno", RIVAL_CREST)
        + "</tbody></table>"
        f'<div class="mr8-lu-head"><span class="h"><img src="{home_crest}"><b>Local</b><i>4-3-3</i></span>'
        f'<span class="a"><i>4-2-3-1</i><b>Visitante</b><img src="{away_crest}"></span></div>'
        "</body></html>"
    )


def test_match_ids_from_club_page() -> None:
    html = (
        '<a href="/match/19636565?from=club-hub">x</a><a href="/match/19636557?from=club-hub">y</a>'
        '<a href="/match/19636565?from=club-hub">repetido</a><a href="/match/5">otro</a>'
    )
    assert ss.match_ids(html) == [19636565, 19636557]


def test_finished_match_is_parsed() -> None:
    parsed = ss.parse_match(match_html())
    assert parsed is not None
    assert parsed.local_date.isoformat() == "2026-10-25"  # 23:30 UTC = 20:30 en Buenos Aires
    assert parsed.boca_home is False
    assert parsed.team_stats["xg"] == (1.82, 1.43)
    assert parsed.team_stats["xgot"] == (1.57, 0.76)
    assert parsed.team_stats["big_chances"] == (1, 5)
    assert parsed.team_stats["pass_accuracy_pct"] == (74, 87)
    assert parsed.team_stats["shots_total"] == (23, 10)
    assert "algo_nuevo" not in parsed.team_stats
    assert parsed.formations == ("4-3-3", "4-2-3-1")


def test_late_utc_kickoff_uses_argentine_date() -> None:
    html = match_html().replace("2026-10-25T23:30:00Z", "2026-10-26T01:00:00Z")
    parsed = ss.parse_match(html)
    assert parsed is not None and parsed.local_date.isoformat() == "2026-10-25"


def test_only_boca_players_with_their_stats() -> None:
    parsed = ss.parse_match(match_html())
    assert parsed is not None
    (montero,) = parsed.boca_players
    assert montero.name == "Álvaro Montero"
    assert montero.stats["rating"] == 8.1
    assert montero.stats["passes"] == 40
    assert montero.stats["duels_won"] == 5
    assert montero.stats["dribbles_successful"] == 2
    assert "minutes" not in montero.stats  # los minutos los calcula Promiedos


def test_player_xg_dash_is_not_stored_as_zero() -> None:
    # La fuente pone data-xg="0" pero muestra «–»: no hay xG por jugador, no es un cero.
    parsed = ss.parse_match(match_html())
    assert parsed is not None
    assert "xg" not in parsed.boca_players[0].stats


def test_boca_home_detected_from_crest() -> None:
    parsed = ss.parse_match(match_html(boca_home=True))
    assert parsed is not None and parsed.boca_home is True
    assert [p.name for p in parsed.boca_players] == ["Álvaro Montero"]


@pytest.mark.parametrize("state", ["After extra time", "Penalties 3–4"])
def test_extra_time_and_penalties_count_as_finished(state: str) -> None:
    assert ss.parse_match(match_html(state=state)) is not None


def test_match_without_lineup_block_uses_player_crests() -> None:
    html = re.sub(r'<div class="mr8-lu-head">.*?</div>', "", match_html())
    parsed = ss.parse_match(html)
    assert parsed is not None
    assert parsed.boca_home is False and parsed.formations is None
    assert [p.name for p in parsed.boca_players] == ["Álvaro Montero"]


def test_unfinished_match_returns_none() -> None:
    assert ss.parse_match(match_html(state="Preview")) is None


def test_odd_formation_is_ignored() -> None:
    html = match_html().replace("<i>4-3-3</i>", "<i>raro</i>")
    parsed = ss.parse_match(html)
    assert parsed is not None and parsed.formations is None


def test_venue_text_is_kept() -> None:
    parsed = ss.parse_match(match_html())
    assert parsed is not None
    assert parsed.venue == "Estadio Libertadores de América, Avellaneda"
