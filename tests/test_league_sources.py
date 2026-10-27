"""Tests de los datos de liga, perfiles y momentum (respuestas sintéticas, misma forma)."""

from __future__ import annotations

from datetime import date

from sources import promiedos as pd
from sources import scoutingstats as ss
from sources import strikerapi as st
from sources import wikipedia as wp


def test_striker_results_only_final_games() -> None:
    payload = {
        "data": {
            "games": [
                {
                    "game_id": "1",
                    "season": 2026,
                    "stage": "Torneo Clausura",
                    "date": "2026-10-27",
                    "status": "final",
                    "home": {"name": "Instituto", "score": 1},
                    "away": {"name": "Riestra", "score": 0},
                },
                {"game_id": "2", "status": "scheduled", "date": "2026-11-01", "home": {}, "away": {}},
            ]
        }
    }
    (row,) = st.parse_results(payload)
    assert (row.ext_id, row.home_team, row.away_team, row.home_goals, row.away_goals) == (
        "1",
        "Instituto",
        "Riestra",
        1,
        0,
    )
    assert row.match_date == date(2026, 10, 27) and row.stage == "Torneo Clausura"


def test_striker_ratings_and_team_stats() -> None:
    ratings = st.parse_ratings(
        {"data": {"as_of": "2026-10-27", "ratings": [{"rank": 1, "name": "Boca Juniors", "elo": 1637.3}]}}
    )
    assert ratings[0].elo == 1637.3 and ratings[0].as_of == date(2026, 10, 27)
    stats = st.parse_team_stats(
        {
            "data": {
                "season": 2026,
                "teams": [
                    {"display_name": "Boca Juniors", "games": 31, "xg_for": 1.5, "possession_pct": None}
                ],
            }
        }
    )
    assert {(s.team_name, s.stat_key, s.value) for s in stats} == {
        ("Boca Juniors", "games", 31),
        ("Boca Juniors", "xg_for", 1.5),
    }


def test_striker_leaders() -> None:
    (row,) = st.parse_leaders(
        {
            "data": {
                "stat": "goals",
                "season": 2026,
                "leaders": [
                    {
                        "rank": 1,
                        "name": "Delantero Uno",
                        "team": "USF",
                        "games": 31,
                        "minutes": 2718,
                        "value": 15,
                        "per90": 0.5,
                    }
                ],
            }
        }
    )
    assert (row.stat, row.rank, row.player_name, row.team_name, row.value) == (
        "goals",
        1,
        "Delantero Uno",
        "USF",
        15,
    )


def standings_row(num: int, name: str, values: dict[str, object]) -> dict[str, object]:
    return {
        "num": num,
        "values": [{"key": k, "value": v} for k, v in values.items()],
        "entity": {"type": 1, "object": {"name": name}},
    }


def test_promiedos_standings_and_leaders() -> None:
    league = {
        "tables_groups": [
            {
                "name": "Clausura",
                "tables": [
                    {
                        "name": "Grupo A",
                        "table": {
                            "rows": [
                                standings_row(
                                    1,
                                    "Boca Juniors",
                                    {
                                        "Points": "30",
                                        "GamePlayed": "14",
                                        "Goals": "21:10",
                                        "GamesWon": "9",
                                        "GamesEven": "3",
                                        "GamesLost": "2",
                                    },
                                )
                            ]
                        },
                    }
                ],
            },
            {
                "name": "",
                "tables": [
                    {
                        "name": "Promedios - Relegation",
                        "table": {
                            "columns": [{"key": "Pct", "title": "Prom"}, {"key": "GamesWon", "title": "24"}],
                            "rows": [
                                standings_row(
                                    28,
                                    "Rival FC",
                                    {"Pct": "1.050", "Points": "84", "GamePlayed": "80", "GamesWon": "30"},
                                )
                            ],
                        },
                    }
                ],
            },
        ],
        "players_statistics": {
            "tables": [
                {
                    "name": "Goles",
                    "rows": [
                        {
                            "num": 1,
                            "entity": {"object": {"name": "Delantero Uno", "team_id": "x"}},
                            "values": [{"key": "Goals", "value": "10"}],
                        }
                    ],
                }
            ]
        },
    }
    rows = pd.parse_standings(league, 2026)
    clausura = next(r for r in rows if r.table_name == "Clausura - Grupo A")
    assert (
        clausura.rank,
        clausura.team_name,
        clausura.points,
        clausura.goals_for,
        clausura.goals_against,
    ) == (1, "Boca Juniors", 30, 21, 10)
    promedio = next(r for r in rows if r.table_name == "Promedios - Relegation")
    assert promedio.average == 1.05 and promedio.played == 80 and promedio.points == 84
    assert promedio.won is None  # en esta tabla esas columnas son puntos por temporada
    (leader,) = pd.parse_league_leaders(league, 2026)
    assert (leader.stat, leader.player_name, leader.value) == ("goles", "Delantero Uno", 10)


def test_scoutingstats_momentum_bars() -> None:
    html = (
        '<div class="mr8-mo-plot"><svg viewBox="0 0 98 100">'
        '<rect class="bh" x="2.1" y="25" width="0.8" height="25"/>'
        '<rect class="ba" x="47.1" y="50" width="0.8" height="10"/>'
        "</svg></div>"
    )
    assert ss.parse_momentum(html) == [(3, "home", 0.5), (48, "away", 0.2)]


def test_wikipedia_squad_template() -> None:
    html = (
        '{"template":{"target":{"wt":"Jugador de fútbol"},"params":{"num":{"wt":"16"},"nac":{"wt":"URU"},'
        '"pos":{"wt":"DEL"},"nombre":{"wt":"[[Miguel Merentiel]]"},'
        '"formativo":{"wt":"{{bandera|URU}} [[Club Atlético Peñarol|Peñarol]]"},'
        '"internacional":{"wt":"{{bandera|URU}} [[Selección de fútbol de Uruguay|Absoluta]]"}},"i":42}}'
        '{"template":{"target":{"wt":"Jugador de fútbol"},"params":{"nac":{"wt":"ARG"},'
        '"nombre":{"wt":"[[Juan Pérez (futbolista)|Juan Pérez]]"},'
        '"formativo":{"wt":"{{bandera|ARG}} [[Club Atlético Boca Juniors|Boca Juniors]]"}},"i":43}}'
    )
    rows = wp.parse_squad(html)
    assert [(r.name, r.article, r.nationality, r.academy) for r in rows] == [
        ("Miguel Merentiel", "Miguel Merentiel", "URU", False),
        ("Juan Pérez", "Juan Pérez (futbolista)", "ARG", True),
    ]
    assert rows[0].youth_club == "Peñarol" and rows[0].national_team == "Absoluta"


def test_wikipedia_infobox_weight() -> None:
    html = (
        '<table class="infobox"><tr><th>Altura</th><td>1,75 m</td></tr>'
        "<tr><th>Peso</th><td>70 kg (154 lb)</td></tr></table>"
    )
    assert wp.parse_weight(html) == 70
    assert wp.parse_weight('<table class="infobox"><tr><th>Altura</th><td>1,75 m</td></tr></table>') is None


def metric_row(key: str, value: str, avg: str, rank: str) -> str:
    return (
        f'<div class="ch2-str" role="row" data-k="{key}"><span class="m"><b>X</b></span>'
        f'<span role="cell" class="num v" data-f="vs">{value}</span>'
        f'<span role="cell" class="num a" data-f="avgs">{avg}</span>'
        f'<span role="cell" class="rk" data-f="rk"><b class="num">{rank}</b></span></div>'
    )


def test_scoutingstats_competition_metrics() -> None:
    html = (
        '<span role="columnheader">Rank <small class="ch2-st-of">of 47</small></span>'
        + metric_row("ppda", "10.0", "10.6", "19th")
        + metric_row("save_pct", "60%", "73%", "41st")
        + metric_row("goals_prevented", "+0.02", "+0.41", "32nd")
    )
    rows = ss.parse_competition_metrics(html, season=2026, competition="conmebol_copa_libertadores")
    by_key = {r.metric: r for r in rows}
    assert by_key["ppda"].value == 10.0 and by_key["ppda"].comp_average == 10.6 and by_key["ppda"].rank == 19
    assert by_key["save_pct"].value == 60 and by_key["goals_prevented"].value == 0.02
    assert all(r.n_teams == 47 for r in rows)
