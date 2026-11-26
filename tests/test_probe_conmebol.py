"""Partes puras de la sonda Conmebol (sin red)."""

from scripts.phase0.probe_conmebol import DISALLOW_ALL_RE, teams_of


def test_teams_of_finds_nested_teams_once() -> None:
    team = {"id": "igg", "url_name": "boca-juniors", "country_id": "ba", "name": "Boca"}
    data = [{"rows": [{"entity": {"object": team}}, {"entity": {"object": dict(team)}}]}, {"id": "x"}]
    assert list(teams_of(data)) == ["igg"]


def test_disallow_all_only_for_star_agent() -> None:
    assert DISALLOW_ALL_RE.search("User-agent: *\nDisallow: /\n")
    assert not DISALLOW_ALL_RE.search("User-agent: *\nDisallow: /admin/\n")
    assert not DISALLOW_ALL_RE.search("User-agent: *\nAllow: /\n\nUser-agent: GPTBot\nDisallow: /\n")
