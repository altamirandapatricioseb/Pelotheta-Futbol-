"""Jugadores de toda la liga (Bzzoiro): parseo de los dos equipos, perfiles y licencia."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from pipeline import export_parquet as ex
from pipeline import league_players as lp
from sources import bzzoiro as bz

LINEUPS = {
    "lineups": {
        "home": {"team_name": "Club A", "players": [{"id": 1, "name": "Arquero A", "position": "G"}]},
        "away": {
            "team_name": "Club B",
            "players": [{"id": 2, "name": "Nueve B", "position": "F"}],
            "substitutes": [{"id": 3, "name": "Suplente B", "position": "F"}],
        },
    }
}
STATS = {
    "player_stats": [
        {"id": 9, "event_id": 7, "player_id": 1, "team_id": 10, "minutes_played": 90, "saves": 4, "goals": 0},
        {
            "id": 8,
            "event_id": 7,
            "player_id": 2,
            "team_id": 11,
            "minutes_played": 90,
            "goals": 2,
            "rating": "7.5",
        },
        {"id": 7, "event_id": 7, "player_id": 3, "team_id": 11, "minutes_played": 0, "goals": 0},
        {"id": 6, "event_id": 7, "player_id": 99, "team_id": 11, "minutes_played": 90},  # sin nombre: fuera
    ]
}


def test_parse_all_player_stats_keeps_both_teams_and_drops_ids() -> None:
    rows = bz.parse_all_player_stats(STATS, LINEUPS)
    assert [(r["player_name"], r["team_name"], r["position"]) for r in rows] == [
        ("Arquero A", "Club A", "G"),
        ("Nueve B", "Club B", "F"),
    ]
    assert rows[1]["rating"] == 7.5 and "event_id" not in rows[1] and "team_id" not in rows[1]


def test_bzzoiro_club_names_become_the_table_names() -> None:
    lineups = {
        "lineups": {
            "home": {"team_name": "CA Talleres", "players": [{"id": 5, "name": "X", "position": "M"}]}
        }
    }
    assert bz.lineup_people(lineups) == {5: ("X", "Talleres de Córdoba", "M")}


def test_league_events_only_finished_of_the_season() -> None:
    payload = {
        "results": [
            {"id": 1, "event_date": "2026-02-01T20:00:00+00:00", "status": "finished", "home_team": "A"},
            {"id": 2, "event_date": "2026-02-08T20:00:00+00:00", "status": "notstarted"},
            {"id": 3, "event_date": "2025-12-01T20:00:00+00:00", "status": "finished"},
        ]
    }
    assert [e.event_id for e in bz.parse_league_events(payload, 2026)] == [1]


def game(player: int, team: str, position: str, day: int, **stats: Any) -> dict[str, Any]:
    return {
        "player_id": player,
        "player_name": f"J{player}",
        "team_name": team,
        "position": position,
        "match_date": f"2026-03-{day:02d}",
        **stats,
    }


def test_profiles_percentiles_by_position_and_minimum_minutes() -> None:
    rows = [
        *(game(1, "A", "F", d, minutes_played=90, goals=1, saves=0) for d in range(1, 7)),
        *(game(2, "B", "F", d, minutes_played=90, goals=0) for d in range(1, 7)),
        *(game(3, "B", "F", d, minutes_played=90) for d in range(1, 3)),  # 180 min: sin perfil
        *(game(4, "C", "G", d, minutes_played=90, saves=3) for d in range(1, 7)),
    ]
    out = {p["player_name"]: p for p in lp.profiles(rows, 2026)}
    assert set(out) == {"J1", "J2", "J4"}
    assert (out["J1"]["pct_goals"], out["J2"]["pct_goals"]) == (100, 0)
    assert out["J1"]["pct_saves"] is None  # las atajadas solo cuentan para arqueros
    assert out["J4"]["position"] == "Arquero" and out["J4"]["pct_goals"] is None
    assert out["J2"]["pct_expected_goals"] is None  # sin el dato no hay percentil (no es 0)


def test_season_stats_use_catalog_keys_and_keep_missing_as_absent() -> None:
    rows = [
        game(1, "A", "M", 1, minutes_played=90, key_pass=2, total_pass=40, accurate_pass=30),
        game(1, "A", "M", 2, minutes_played=45, key_pass=1, total_pass=10, accurate_pass=10),
    ]
    out = lp.season_stats(rows)[("J1", "A")]
    assert out["minutes"] == 135
    assert (
        out["stats"]["pases_clave"] == 3 and out["stats"]["pases"] == 50 and out["stats"]["pct_pases"] == 80.0
    )
    assert "npxg" not in out["stats"] and "remates" not in out["stats"]  # sin dato: ausente, no 0
    assert "calificacion" not in out["stats"]  # sin notas no hay promedio


def test_season_stats_rating_is_weighted_and_clean_sheets_need_full_games() -> None:
    rows = [
        game(4, "C", "G", 1, minutes_played=90, rating=8.0, goals_conceded=0, duel_won=1, duel_lost=3),
        game(4, "C", "G", 2, minutes_played=30, rating=6.0, goals_conceded=0),  # entró: no es valla invicta
    ]
    st = lp.season_stats(rows)[("J4", "C")]["stats"]
    assert st["calificacion"] == 7.5  # (8 × 90 + 6 × 30) / 120
    assert st["vallas_invictas"] == 1 and st["goles_recibidos"] == 0
    assert st["pct_duelos"] == 25.0


def test_pool_gets_league_stats_by_club_and_name() -> None:
    from pipeline import analytics as an
    from sources import transfermarkt_datasets as tmd

    def pool(name: str, team: str) -> tmd.PoolPlayerRecord:
        return tmd.PoolPlayerRecord(
            source="transfermarkt_datasets", ext_id=name, player_name=name, team_name=team,
            club_ext_id="1", competition="AR1N",
        )  # fmt: skip

    stats = {
        ("Juan Pérez", "Tigre"): {"minutes": 900, "stats": {"pases": 300.0}},
        ("Lucas Gómez", "Tigre"): {"minutes": 500, "stats": {"pases": 100.0}},
    }
    out = an.with_league_stats(
        [pool("Juan Perez", "Club Atlético Tigre"), pool("L. Gómez", "Tigre"), pool("Otro", "Tigre")],
        stats,
    )
    assert [(r.minutes, r.stats) for r in out] == [
        (900, {"pases": 300.0}),
        (500, {"pases": 100.0}),
        (None, {}),
    ]


def test_league_values_predict_out_of_sample_for_every_player() -> None:
    from datetime import date

    from pipeline import market_value as mv

    positions = ["Arquero", "Defensor", "Mediocampista", "Delantero"]
    league = [
        {
            "name": f"J{i}",
            "team": f"Club {i % 6}",
            "club_id": str(i % 6),
            "age": 18 + i % 15,
            "position_group": positions[i % 4],
            "contract_until": date(2027 + i % 3, 6, 30),
            "foreign": i % 7 == 0,
            # Valor que crece con el club y baja con la edad, con ruido determinista.
            "value_eur": int(1e6 * (1 + i % 6) * (1.5 - (i % 15) / 30) * (1 + (i * 7 % 11) / 50)),
        }
        for i in range(120)
    ]
    out = mv.league_values(league, date(2026, 11, 26))
    assert len(out) == 120 and {r["player_name"] for r in out} == {f"J{i}" for i in range(120)}
    assert all(r["predicted_eur"] > 0 for r in out)
    errors = sorted(abs(r["gap_pct"]) for r in out)
    assert errors[len(errors) // 2] < 40  # con datos que siguen el modelo, la mediana de error es chica
    assert mv.league_values(league[:20], date(2026, 11, 26)) == []  # pocos datos: no se inventa


def test_league_situations_from_results_and_goal_minutes() -> None:
    from datetime import date

    from pipeline import league_situations as ls
    from pipeline.models import LeagueResultRecord

    def g(day: int, home: str, away: str, hm: list[int], am: list[int], **kw: Any) -> LeagueResultRecord:
        return LeagueResultRecord(
            source="promiedos", ext_id=str(day), season=2026, match_date=date(2026, 3, day), home_team=home,
            away_team=away, home_goals=kw.get("hg", len(hm)), away_goals=kw.get("ag", len(am)),
            home_goal_minutes=hm, away_goal_minutes=am,
        )  # fmt: skip

    games = [
        g(1, "A", "B", [10, 50], [30]),  # A marca primero y gana; al descanso 1-1
        g(2, "B", "A", [20], [60, 88]),  # A pierde al descanso y lo da vuelta (remontada)
        g(3, "A", "C", [], []),  # 0-0: valla invicta y sin marcar
        g(4, "C", "A", [5], [], hg=2, ag=0),  # minutos incompletos (2 goles, 1 minuto): no se usan
    ]
    a = next(r for r in ls.situations(games, 2026) if r["team_name"] == "A")
    assert (a["partidos"], a["puntos"], a["racha"]) == (4, 7, "GGEP")
    assert (a["ppp_local"], a["ppp_visitante"]) == (2.0, 1.5)
    assert (a["con_minutos"], a["marco_primero"], a["recibio_primero"]) == (3, 1, 1)
    assert (a["descanso_perdiendo"], a["remontadas"], a["descanso_empatando"]) == (1, 1, 2)
    assert (a["vallas_invictas"], a["sin_marcar"]) == (1, 2)
    assert (a["favor_0_15"], a["favor_46_60"], a["favor_76_90"], a["contra_16_30"]) == (1, 2, 1, 2)


def test_league_game_keeps_goal_minutes_only_when_they_add_up() -> None:
    from sources import promiedos as pd

    def ev(time: str, team: int, kind: int = 1) -> dict[str, Any]:
        return {"time": time, "team": team, "type": kind}

    game = {
        "id": "x", "status": {"enum": 3}, "league": {"id": pd.LEAGUE_ID}, "start_time": "01-03-2026 18:00",
        "teams": [{"name": "A", "id": "a"}, {"name": "B", "id": "b"}], "scores": [2, 1],
        "events": [{"rows": [{"events": [ev("45'+2", 1), ev("70'", 2, 3), ev("80'", 1), ev("81'", 2, 4)]}]}],
    }  # fmt: skip
    row = pd.parse_league_game(game, 2026)
    assert row is not None and (row.home_goal_minutes, row.away_goal_minutes) == ([45, 80], [70])
    game["scores"] = [3, 1]  # falta un gol en los eventos: esos minutos no se usan
    row = pd.parse_league_game(game, 2026)
    assert row is not None and (row.home_goal_minutes, row.away_goal_minutes) == ([], [70])


def test_collect_respects_the_budget_and_continues_from_cache(tmp_path: Path) -> None:
    class Fake:
        def __init__(self) -> None:
            self.cache_dir, self.calls = tmp_path, 0

        def get(self, path: str, params: Any = None, cache_key: str | None = None) -> dict[str, Any]:
            if path == "/api/v2/events/":
                ev = [
                    {"id": i, "event_date": f"2026-03-0{i}T20:00:00+00:00", "status": "finished"}
                    for i in (1, 2, 3)
                ]
                return {"results": ev, "next": None}
            self.calls += 1
            if cache_key:
                (tmp_path / f"{cache_key}.json").write_text("{}", encoding="utf-8")
            return {"player_stats": [], "lineups": {}}

    client = Fake()
    report: dict[str, int] = {}
    lp.collect(client, 85, 2026, max_new=4, report=report)  # type: ignore[arg-type]
    assert report == {"partidos": 3, "pendientes": 1, "consultas_nuevas": 4}
    lp.collect(client, 85, 2026, max_new=4, report=report)  # type: ignore[arg-type]
    assert report == {"partidos": 3, "pendientes": 0, "consultas_nuevas": 2}  # los dos primeros, de caché


def test_raw_goes_private_and_profiles_public(tmp_path: Path) -> None:
    raw = [{**game(1, "A", "F", 1, minutes_played=90, goals=1), "season_year": 2026, "event_id": 7}]
    rows = {"league_player_match": raw, "league_player_profile": [{"player_name": "J1", "season_year": 2026}]}
    manifests = ex.export(lambda view: rows.get(view, []), tmp_path, sorted(ex.LEAGUE_PLAYER_VIEWS))
    assert [f["tabla"] for f in manifests["publico"]["archivos"]] == ["league_player_profile"]
    assert [f["tabla"] for f in manifests["privado"]["archivos"]] == ["league_player_match"]
