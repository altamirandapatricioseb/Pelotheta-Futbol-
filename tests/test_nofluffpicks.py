"""Tests del adaptador de NoFluffPicks con HTML sintético (misma forma, datos inventados)."""

from __future__ import annotations

import json

from sources import nofluffpicks as nfp


def fixture(**overrides: object) -> dict[str, object]:
    base: dict[str, object] = {
        "matchId": 1,
        "slug": "boca-juniors-vs-rival-fc-2026-01-25",
        "hasMatchPage": True,
        "iso": "2026-01-25T21:30:00.000Z",
        "status": "complete",
        "homeId": 705,
        "homeName": "Boca Juniors",
        "awayId": 9,
        "awayName": "Rival FC",
        "homeGoals": 1,
        "awayGoals": 0,
        "odds": {"home": 1.6, "draw": 3.6, "away": 6.5},
        "xg": {"home": 0, "away": 0},
        "over25Potential": 0,
    }
    base.update(overrides)
    return base


def league_html(*fixtures: dict[str, object]) -> str:
    # Next.js deja el payload con las comillas escapadas dentro de un string de JavaScript.
    payload = json.dumps(list(fixtures), separators=(",", ":")).replace('"', '\\"')
    return f'<html><script>self.__next_f.push([1,"{payload}"])</script></html>'


def stat_row(home: str, label: str, away: str) -> str:
    return (
        '<div class="py-3"><div class="mb-1.5 flex items-center justify-between gap-3 text-sm">'
        f'<span class="font-semibold tabular-nums text-foreground">{home}</span>'
        f'<span class="text-center text-xs font-medium uppercase">{label}</span>'
        f'<span class="font-semibold tabular-nums text-foreground">{away}</span></div></div>'
    )


def test_fixtures_are_parsed_from_payload() -> None:
    fixtures = nfp.parse_fixtures(league_html(fixture(), fixture(matchId=2, homeId=3, awayId=4)))
    assert [f.match_id for f in fixtures] == [1, 2]
    first = fixtures[0]
    assert first.slug == "boca-juniors-vs-rival-fc-2026-01-25"
    assert first.home_id == 705 and first.complete
    assert first.local_date.isoformat() == "2026-01-25"  # 21:30 UTC = 18:30 en Buenos Aires


def test_late_utc_kickoff_uses_argentine_date() -> None:
    (f,) = nfp.parse_fixtures(league_html(fixture(iso="2026-02-01T01:00:00.000Z")))
    assert f.local_date.isoformat() == "2026-01-31"


def test_boca_fixtures_only_complete_ones() -> None:
    fixtures = nfp.parse_fixtures(
        league_html(
            fixture(), fixture(matchId=2, status="incomplete"), fixture(matchId=3, homeId=3, awayId=4)
        )
    )
    assert [f.match_id for f in nfp.boca_fixtures(fixtures)] == [1]


def test_game_stats_parsed_by_label() -> None:
    html = (
        stat_row("34", "Possession (%)", "66")
        + stat_row("2.26", "xG", "1.34")
        + stat_row("66", "Dangerous attacks", "58")
    )
    stats = nfp.parse_game_stats(html)
    assert stats["xg"] == (2.26, 1.34)
    assert stats["dangerous_attacks"] == (66, 58)
    assert stats["possession_pct"] == (34, 66)


def test_unknown_labels_are_ignored() -> None:
    assert nfp.parse_game_stats(stat_row("1", "Algo nuevo", "2")) == {}


def test_page_without_stats_returns_empty() -> None:
    assert nfp.parse_game_stats("<html>Pre-game profile</html>") == {}
