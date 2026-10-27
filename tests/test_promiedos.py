"""Tests del adaptador de Promiedos con datos sintéticos.

Los diccionarios imitan la FORMA de `__NEXT_DATA__` (ver data/raw/phase0/promiedos.json), pero
los nombres y números son inventados: no se guardan datos de terceros en el repositorio.
"""

from __future__ import annotations

from typing import Any

import pytest

from sources import promiedos as pd

BOCA = {"name": "Boca Juniors", "short_name": "Boca Jrs.", "id": "igg", "country_id": "ba"}
RIVAL = {"name": "Rival FC", "short_name": "Rival", "id": "zzz", "country_id": "ba"}


def player(name: str, num: int, position: str = "Mediocampista", **extra: Any) -> dict[str, Any]:
    return {
        "jersey_num": num,
        "name": name,
        "position": position,
        "formation_position": f"{position} (puesto exacto)",
        "height": "1.80",
        **extra,
    }


def game(**overrides: Any) -> dict[str, Any]:
    base: dict[str, Any] = {
        "id": "g1",
        "league": {"name": "Liga Profesional Argentina", "id": "hc", "country_id": "ba"},
        "stage_round_name": "Fecha 3",
        "teams": [BOCA, RIVAL],
        "scores": [2, 1],
        "status": {"enum": 3, "name": "Finalizado"},
        "start_time": "28-04-2026 21:30",
        "game_info": [{"name": "Estadio", "value": "La Bombonera"}, {"name": "Árbitro", "value": "Juez Uno"}],
        "players": {
            "lineups": {
                "teams": [
                    {
                        "team_num": 1,
                        "starting": [
                            player("Ana Arquera", 1, "Arquero"),
                            player("Beto Volante", 5),
                            player("Carlos Nueve", 9, "Delantero"),
                        ],
                        "bench": [player("Dani Suplente", 20), player("Eze Banco", 30)],
                    },
                    {"team_num": 2, "starting": [player("Rival Uno", 1, "Arquero")], "bench": []},
                ]
            }
        },
        "events": [
            {
                "name": "Entretiempo",
                "is_penalties_stage": False,
                "scores": [1, 0],
                "rows": [
                    {
                        "events": [
                            {"type": 1, "time": "10'", "team": 1, "texts": ["Carlos Nueve", "Beto Volante"]}
                        ]
                    },
                    {"events": [{"type": 4, "time": "45'+2", "team": 1, "texts": ["Beto Volante"]}]},
                ],
            },
            {
                "name": "Fin de los 90 minutos",
                "is_penalties_stage": False,
                "scores": [2, 1],
                "rows": [
                    {
                        "events": [
                            {"type": 15, "time": "60'", "team": 1, "texts": ["Dani Suplente", "Beto Volante"]}
                        ]
                    },
                    {"events": [{"type": 3, "time": "70'", "team": 1, "texts": ["Carlos Nueve"]}]},
                    {"events": [{"type": 1, "time": "80'", "team": 2, "texts": ["Rival Uno"]}]},
                    {"events": [{"type": 6, "time": "85'", "team": 1, "texts": ["Carlos Nueve"]}]},
                ],
            },
        ],
        "statistics": [
            {"name": "Posesión", "values": ["55%", "45%"]},
            {"name": "Total Remates", "values": ["12", "7"]},
            {"name": "Algo Nuevo", "values": ["1", "2"]},
        ],
    }
    base.update(overrides)
    return base


def test_parse_minute_with_added_time() -> None:
    assert pd.parse_minute("45'+2") == (45, 2)
    assert pd.parse_minute("94'") == (94, None)


def test_parse_minute_rejects_garbage() -> None:
    with pytest.raises(ValueError):
        pd.parse_minute("medio tiempo")


def test_player_key_ignores_accents_and_case() -> None:
    assert pd.player_key("Édinson  Cavani") == pd.player_key("edinson cavani")


def test_match_basic_fields() -> None:
    parsed = pd.parse_game(game())
    m = parsed.match
    assert (m.home_source_id, m.away_source_id) == ("igg", "zzz")
    assert (m.home_goals, m.away_goals) == (2, 1)
    assert (m.home_goals_ht, m.away_goals_ht) == (1, 0)
    assert m.status == "jugado"
    assert m.match_date.isoformat() == "2026-04-28"
    assert m.kickoff_at.isoformat() == "2026-04-28T21:30:00-03:00"
    assert m.referee == "Juez Uno"
    assert m.venue == "La Bombonera"


def test_boca_lineup_minutes() -> None:
    lineups = {lu.player_source_id: lu for lu in pd.parse_game(game()).lineups}
    # Titular completo, sale por cambio, expulsado y suplente que entra.
    assert (
        lineups[pd.player_key("Ana Arquera")].minute_in,
        lineups[pd.player_key("Ana Arquera")].minute_out,
    ) == (
        0,
        90,
    )
    assert lineups[pd.player_key("Beto Volante")].minute_out == 60
    assert lineups[pd.player_key("Carlos Nueve")].minute_out == 85
    assert (
        lineups[pd.player_key("Dani Suplente")].minute_in,
        lineups[pd.player_key("Dani Suplente")].minute_out,
    ) == (
        60,
        90,
    )
    # Suplente que no entra: queda convocado sin minutos.
    assert lineups[pd.player_key("Eze Banco")].minute_in is None


def test_only_boca_players_are_stored() -> None:
    parsed = pd.parse_game(game())
    assert all(lu.team_source_id == "igg" for lu in parsed.lineups)
    assert pd.player_key("Rival Uno") not in {p.source_id for p in parsed.players}


def test_events_types_and_assist() -> None:
    events = pd.parse_game(game()).events
    goal = next(e for e in events if e.type == "gol" and e.team_source_id == "igg")
    assert goal.player_source_id == pd.player_key("Carlos Nueve")
    assert goal.related_player_source_id == pd.player_key("Beto Volante")
    assert {e.type for e in events} >= {"gol", "amarilla", "cambio", "penal_convertido", "roja"}
    rival_goal = next(e for e in events if e.team_source_id == "zzz")
    assert rival_goal.player_source_id is None  # de los rivales no se guardan nombres
    card = next(e for e in events if e.type == "amarilla")
    assert (card.minute, card.added_time, card.period) == (45, 2, 1)


def test_team_stats_known_keys_only() -> None:
    stats = {(s.team_source_id, s.stat_key): s.value for s in pd.parse_game(game()).team_stats}
    assert stats[("igg", "possession_pct")] == 55
    assert stats[("zzz", "shots_total")] == 7
    assert all(key in pd.STAT_KEYS.values() for _, key in stats)


def test_extra_time_and_shootout() -> None:
    stages = [
        *game()["events"],
        {"name": "Suplementario", "is_penalties_stage": False, "scores": [2, 2], "rows": []},
        {
            "name": "Penales",
            "is_penalties_stage": True,
            "scores": [4, 3],
            "rows": [
                {"events": [{"type": 3, "time": "1", "team": 1, "texts": ["Carlos Nueve"]}]},
                {"events": [{"type": 17, "time": "1", "team": 2, "texts": ["Rival Uno"]}]},
            ],
        },
    ]
    parsed = pd.parse_game(game(events=stages, scores=[2, 2]))
    assert parsed.match.extra_time is True
    assert (parsed.match.penalties_home, parsed.match.penalties_away) == (4, 3)
    full = next(lu for lu in parsed.lineups if lu.player_source_id == pd.player_key("Ana Arquera"))
    assert full.minute_out == 120
    shootout = [e for e in parsed.events if e.period == 5]
    assert {e.type for e in shootout} == {"penal_convertido", "penal_fallado"}


def test_friendly_without_lineups_is_skipped() -> None:
    assert pd.parse_game(game(league={"name": "Partido Amistoso", "id": "am"}, players=None)) is None


def test_scheduled_game_is_skipped() -> None:
    assert pd.parse_game(game(status={"enum": 1, "name": "Programado"})) is None


def test_squad_parsing() -> None:
    team_data = {
        "squad": {
            "groups": [
                {"name": "Dirección", "rows": [{"entity": {"object": {"name": "DT", "is_staff": True}}}]},
                {
                    "name": "Arqueros",
                    "rows": [
                        {
                            "entity": {
                                "object": {
                                    "num": "1",
                                    "name": "Ana Arquera",
                                    "position": "Arqueros",
                                    "height": "1.91",
                                    "birthdate": "20/07/2000",
                                }
                            }
                        }
                    ],
                },
            ]
        }
    }
    players, squad = pd.parse_squad(team_data)
    assert len(players) == 1
    assert players[0].birth_date is not None and players[0].birth_date.isoformat() == "2000-07-20"
    assert players[0].height_cm == 191
    assert squad[0].shirt_number == 1 and squad[0].position_group == "Arquero"


def test_boca_game_refs_from_team_page() -> None:
    team_data = {
        "games": {
            "last": {
                "rows": [
                    {
                        "game": {
                            "id": "a1",
                            "url_name": "boca-vs-x",
                            "teams": [BOCA, RIVAL],
                            "start_time": "01-02-2026 20:00",
                        }
                    },
                    {
                        "game": {
                            "id": "a2",
                            "url_name": "x-vs-y",
                            "teams": [RIVAL, RIVAL],
                            "start_time": "01-02-2026 20:00",
                        }
                    },
                    {
                        "game": {
                            "id": "a3",
                            "url_name": "boca-vs-z",
                            "teams": [BOCA, RIVAL],
                            "start_time": "01-02-2025 20:00",
                        }
                    },
                ]
            }
        }
    }
    refs = pd.boca_game_refs(team_data, season_year=2026)
    assert [r.game_id for r in refs] == ["a1"]


def test_friendly_with_lineups_is_skipped() -> None:
    # Los amistosos no suman a las estadísticas oficiales.
    assert pd.parse_game(game(league={"name": "Partido Amistoso", "id": "am"})) is None


def test_lineup_player_keeps_position_group() -> None:
    parsed = pd.parse_game(game())
    assert parsed is not None
    keeper = next(p for p in parsed.players if p.source_id == pd.player_key("Ana Arquera"))
    assert keeper.position_raw == "Arquero"
