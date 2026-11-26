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
    # La fila trae solo el id del club: con el mapa de la tabla queda el nombre.
    (named,) = pd.parse_league_leaders(league, 2026, {leader.team_name or "": "Club Uno"})
    assert named.team_name == "Club Uno"


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


WIKI_ROUND = """{|class="wikitable collapsible collapsed"
!colspan="12" style="width: 100%;" | Fecha 1
|-
!width="160"|Local
!width="75"|Resultado
!width="160"|Visitante
!width="150"|Estadio
!width="95"|Fecha
!width="65"|Hora
|-
|bgcolor=#D0E7FF|'''Bolivar'''
|5 – 2
|[[CDT Real Oruro|Real Oruro]]
|Hernando Siles
|rowspan=2|3 de abril
|15:00
|-
|Aurora [[Archivo:Copa.png|40px|Clasificado a la Libertadores]]
|bgcolor=#D0E7FF|'''[https://liga.example/partido?id=1 0 – 0]'''
|Bolívar<ref>nota</ref>
|Félix Capriles
|17:15
|-
|Real Oruro
|–
|Aurora
|Jesús Bermúdez
|4 de abril
|20:00
|}"""


def test_wikipedia_round_tables_with_rowspan_and_unplayed() -> None:
    from sources import wikipedia_league as wl

    games = wl.parse_games(WIKI_ROUND, 2026)
    assert [(g.home_team, g.away_team, g.home_goals, g.away_goals) for g in games] == [
        ("Bolivar", "Real Oruro", 5, 2),
        ("Aurora", "Bolívar", 0, 0),
    ]
    assert {g.match_date for g in games} == {date(2026, 4, 3)}  # el rowspan baja la fecha
    assert games[0].round == 1 and games[0].venue == "Hernando Siles"


def test_wikipedia_tables_merge_spellings_and_skip_minutes() -> None:
    from pipeline import league_wikipedia as lw
    from sources import wikipedia_league as wl

    out = lw.tables(wl.parse_games(WIKI_ROUND, 2026), "bol-primera", 2026)
    table = {r["team_name"]: r for r in out["league_standing"]}
    assert set(table) == {"Bolivar", "Real Oruro", "Aurora"}  # empate de grafías: queda la primera
    assert (table["Bolivar"]["points"], table["Bolivar"]["played"], table["Bolivar"]["rank"]) == (4, 2, 1)
    assert all(s["con_minutos"] == 0 for s in out["league_situation"])  # ni el 0 a 0 cuenta


SPORTS_TABLES = """==Torneo Apertura==
===Regular stage===
====Standings====
{{#invoke:Sports table|main|style=WDL
|source=[https://liga.example Liga]<ref>{{cite web|title=x}}</ref>
<!--Update team positions here-->
|team_order=AAA, BBB
|win_AAA=2 |draw_AAA=1 |loss_AAA=0 |gf_AAA=5 |ga_AAA=1 |adjust_points_AAA=−3
|win_BBB=0 |draw_BBB=1 |loss_BBB=2 |gf_BBB=1 |ga_BBB=5
|name_AAA=[[Club Alfa|Alfa]] |name_BBB={{nowrap|[[Club Beta|Beta FC]]}}
}}
===Final stages===
{{#invoke:Sports table|main|section=Apertura Group A|show_matches=true|team_order=AAA, BBB}}
==League table==
{{#invoke:Sports table|main
|team1=BBB |team2=AAA
|win_BBB=1 |draw_BBB=0 |loss_BBB=0 |gf_BBB=1 |ga_BBB=0
}}"""


def test_wikipedia_sports_tables_points_names_and_orders() -> None:
    from sources import wikipedia_league as wl

    rows = wl.parse_sports_tables(SPORTS_TABLES)
    assert [(r.table_name, r.rank, r.team_name, r.points) for r in rows] == [
        ("Torneo Apertura · Fase regular", 1, "Alfa", 4),  # 7 menos 3 de descuento
        ("Torneo Apertura · Fase regular", 2, "Beta FC", 1),
        ("Tabla general", 1, "BBB", 3),  # sin nombre: queda el código; la de grupos sin datos no entra
        ("Tabla general", 2, "AAA", 0),
    ]


def test_promiedos_team_stats_of_any_game_and_team_match_rows() -> None:
    from pipeline.league_team_match import team_match_rows
    from pipeline.models import LeagueResultRecord

    raw = {
        "teams": [{"id": "aa"}, {"id": "bb"}],
        "statistics": [
            {"name": "Total Remates", "values": ["12", "5"]},
            {"name": "Posesión", "values": ["60%", "40%"]},
            {"name": "Otra", "values": ["1", "2"]},
        ],
    }
    stats = pd.parse_team_stats(raw)
    assert stats == {
        "aa": {"shots_total": 12, "possession_pct": 60},
        "bb": {"shots_total": 5, "possession_pct": 40},
    }
    game = LeagueResultRecord(
        source="promiedos",
        ext_id="g1",
        season=2026,
        stage="Fecha 1",
        match_date=date(2026, 3, 1),
        home_team="Local",
        away_team="Visita",
        home_goals=2,
        away_goals=1,
        home_goal_minutes=[10, 80],
        away_goal_minutes=[46],
    )
    home, away = team_match_rows([game], {"g1": {"Local": stats["aa"], "Visita": stats["bb"]}})
    assert (home["team_name"], home["home"], away["opponent"]) == ("Local", True, "Local")
    assert home["stats"]["points"] == 3 and away["stats"]["losses"] == 1
    assert home["stats"]["shots_total"] == 12 and home["stats"]["shots_total_against"] == 5
    assert (
        home["stats"]["goals_for_00_15"],
        home["stats"]["goals_for_76_90"],
        away["stats"]["goals_for_46_60"],
    ) == (1, 1, 1)
    # Si los minutos no cierran con el marcador, no hay tramos (no se adivinan).
    partial = game.model_copy(update={"home_goal_minutes": [10]})
    assert "goals_for_00_15" not in team_match_rows([partial], {})[0]["stats"]
