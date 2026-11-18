"""Tests de los modelos: valor de mercado, alternativas (K-means), predictor Poisson y fuentes nuevas."""

from __future__ import annotations

import math
import random
from datetime import date
from pathlib import Path

import pytest

from pipeline import analytics, market_value, match_predictor, similarity
from pipeline.metrics import Game
from sources import football_data, market_values


def _player(pid: int, rng: random.Random, position: str = "Mediocampista") -> dict[str, object]:
    minutes = rng.randint(600, 3000)
    keys = [k for k, *_ in similarity.FEATURES] + ["goles_asistencias", "npxg_xa", "rendimiento_indice"]
    stats = {k: rng.uniform(1, 60) for k in keys}
    stats["pct_pases"] = rng.uniform(60, 92)
    stats["rendimiento_indice"] = rng.uniform(30, 80)
    return {
        "player_id": pid,
        "known_as": f"Jugador {pid}",
        "position_group": position,
        "age": rng.randint(18, 34),
        "minutes": minutes,
        "stats": stats,
    }


@pytest.fixture
def squad() -> list[dict[str, object]]:
    rng = random.Random(1)  # noqa: S311
    return [_player(i, rng) for i in range(1, 25)] + [_player(99, rng, "Arquero")]


TODAY = date(2026, 11, 18)


def _league_players(n: int = 120, seed: int = 4) -> list[dict[str, object]]:
    """Liga sintética: seis clubes; el primero es el propio («189») y sus jugadores tienen player_id."""
    rng = random.Random(seed)  # noqa: S311
    return [
        {
            "name": f"Liga {i}",
            "team": f"Club {i % 6}",
            "club_id": "189" if i % 6 == 0 else f"c{i % 6}",
            "age": rng.randint(18, 34),
            "position_group": ["Arquero", "Defensor", "Mediocampista", "Delantero"][i % 4],
            "contract_until": date(2026 + rng.randint(1, 4), 6, 30),
            "foreign": rng.random() < 0.3,
            "value_eur": round(rng.uniform(3e5, 8e6)),
            "player_id": i + 1 if i % 6 == 0 else None,
        }
        for i in range(n)
    ]


def test_market_value_without_league_is_sin_datos(squad: list[dict[str, object]]) -> None:
    out = market_value.fit([], squad, "boca-juniors", "189", TODAY)
    assert out["run"]["status"] == "sin_datos"
    assert out["coefs"] == [] and out["predictions"] == []


def test_market_value_recovers_a_known_relation() -> None:
    league = _league_players()
    totals: dict[str, float] = {}
    for q in league:
        totals[str(q["club_id"])] = totals.get(str(q["club_id"]), 0.0) + float(q["value_eur"])  # type: ignore[arg-type]
    # Valor exacto según edad, contrato y nacionalidad: el β de contrato tiene que dar 0,3.
    for q in league:
        f = market_value.features_of(q, totals, TODAY)
        assert f is not None
        q["value_eur"] = round(math.exp(9 + 0.1 * f["edad"] + 0.3 * f["contrato"] + 0.4 * f["extranjero"]))
    out = market_value.fit(league, [{"player_id": 1}], "boca-juniors", "189", TODAY)
    coef = {c["feature"]: c["coef"] for c in out["coefs"]}
    assert out["run"]["status"] == "ok"
    assert coef["contrato"] == pytest.approx(0.3, abs=0.05)
    assert coef["extranjero"] == pytest.approx(0.4, abs=0.05)
    row = out["predictions"][0]
    assert row["low_eur"] <= row["predicted_eur"] <= row["high_eur"]
    assert set(row["detail"]["effects"]) >= {"edad", "contrato", "extranjero", "ln_club"}
    assert len(row["detail"]["comparables"]) == market_value.N_COMPARABLES
    assert all(c["team"] != "Club 0" for c in row["detail"]["comparables"])  # de otros clubes
    assert out["run"]["metrics"]["median_ape_oos"] is not None


def test_market_value_performance_adjustment() -> None:
    league = _league_players(240)
    rng = random.Random(2)  # noqa: S311
    own = []
    for q in league:
        if q["player_id"] is not None:
            idx = rng.uniform(30, 80)
            q["value_eur"] = round(float(q["value_eur"]) * math.exp(0.03 * (idx - 55)))  # type: ignore[arg-type]
            own.append({"player_id": q["player_id"], "minutes": 900, "stats": {"rendimiento_indice": idx}})
    out = market_value.fit(league, own, "boca-juniors", "189", TODAY)
    adjust = out["run"]["metrics"]["performance_adjust"]
    assert adjust is not None and adjust["b"] > 0  # el mercado paga el rendimiento
    assert "rendimiento" in out["predictions"][0]["detail"]["effects"]


def _own(squad: list[dict[str, object]]) -> list[dict[str, object]]:
    return [{**p, "name": p["known_as"], "team": "Boca Juniors", "value_eur": None} for p in squad]


def _others(n: int, value: float | None = None, coverage: float = 1.0) -> list[dict[str, object]]:
    rng = random.Random(9)  # noqa: S311
    keep = similarity.KEYS[: round(len(similarity.KEYS) * coverage)]
    out = []
    for i in range(n):
        p = _player(1000 + i, rng)
        out.append(
            {
                **p,
                "player_id": None,
                "name": f"Rival {i}",
                "team": f"Club {i % 4}",
                "stats": {k: v for k, v in p["stats"].items() if k in keep},  # type: ignore[attr-defined]
                "value_eur": value,
            }
        )
    return out


def test_alternatives_only_club_without_other_teams(squad: list[dict[str, object]]) -> None:
    out = similarity.fit(_own(squad), [], "boca-juniors")
    assert out["run"]["status"] == "ok"
    assert out["run"]["message"]  # avisa que faltan jugadores de otros clubes
    assert 99 not in {s["player_id"] for s in out["styles"]}  # el arquero no entra
    assert 2 <= out["run"]["metrics"]["k"] <= 6
    assert {a["section"] for a in out["alternatives"]} == {"club"}
    first = [a for a in out["alternatives"] if a["player_id"] == 1]
    assert [a["rank"] for a in first] == [1, 2, 3, 4, 5]
    sims = [a["similarity"] for a in first]
    assert sims == sorted(sims, reverse=True)  # de mejor a peor
    assert all(a["members"][0]["player_id"] != 1 for a in first)


def test_alternatives_from_other_teams_and_pairs(squad: list[dict[str, object]]) -> None:
    out = similarity.fit(_own(squad), _others(30), "boca-juniors")
    mine = [a for a in out["alternatives"] if a["player_id"] == 1]
    ext = [a for a in mine if a["section"] == "externo"]
    pairs = [a for a in mine if a["section"] == "dupla"]
    assert len(ext) == similarity.TOP_EXTERNAL and len(pairs) == similarity.TOP_PAIR
    assert all(m["team"] != "Boca Juniors" for a in ext + pairs for m in a["members"])
    assert all(len(a["members"]) == 2 for a in pairs)
    for section in (ext, pairs):
        sims = [a["similarity"] for a in section]
        assert sims == sorted(sims, reverse=True)


def test_pairs_respect_the_budget(squad: list[dict[str, object]]) -> None:
    own = _own(squad)
    own[0]["value_eur"] = 1_500_000.0
    out = similarity.fit(own, _others(30, value=1_000_000.0), "boca-juniors")
    mine = [a for a in out["alternatives"] if a["player_id"] == 1]
    assert not [a for a in mine if a["section"] == "dupla"]  # dos de un millón se pasan de 1,5
    assert all(a["savings_eur"] == 500_000 for a in mine if a["section"] == "externo")


def test_others_without_enough_stats_are_left_out(squad: list[dict[str, object]]) -> None:
    out = similarity.fit(_own(squad), _others(10, coverage=0.3), "boca-juniors")
    assert out["run"]["params"]["others_with_stats"] == 0
    assert {a["section"] for a in out["alternatives"]} == {"club"}


def test_alternatives_with_few_players_is_sin_datos(squad: list[dict[str, object]]) -> None:
    assert similarity.fit(_own(squad)[:3], [], "boca-juniors")["run"]["status"] == "sin_datos"


def _league(n_rounds: int = 6) -> list[Game]:
    rng = random.Random(3)  # noqa: S311
    teams = ["Boca Juniors", "River Plate", "Racing", "Independiente", "San Lorenzo", "Huracán"]
    strength = {t: 1.6 - 0.2 * i for i, t in enumerate(teams)}
    games = []
    day = 0
    for _ in range(n_rounds):
        for h in teams:
            for a in teams:
                if h != a:
                    day += 1
                    hg = match_predictor._poisson_sample(rng, strength[h])
                    ag = match_predictor._poisson_sample(rng, strength[a] * 0.8)
                    games.append(Game(f"2026-{1 + day // 28:02d}-{1 + day % 28:02d}", h, a, hg, ag))
    return games


def test_score_matrix_is_a_joint_distribution() -> None:
    matrix = match_predictor.score_matrix(1.4, 1.1)
    assert sum(map(sum, matrix)) == pytest.approx(1.0)
    home, draw, away = match_predictor.outcome_probs(matrix)
    assert home + draw + away == pytest.approx(1.0)
    assert home > away  # más λ, más probabilidad de ganar


def test_simulation_agrees_with_exact_probabilities() -> None:
    exact = match_predictor.outcome_probs(match_predictor.score_matrix(1.5, 0.9))
    sim = match_predictor.simulate(1.5, 0.9)
    assert sim["p_home"] == pytest.approx(exact[0], abs=0.02)
    assert sim["mean_home"] == pytest.approx(1.5, abs=0.05)


def test_predictor_run_with_backtest_and_tests() -> None:
    out = match_predictor.run(_league(), "Boca Juniors", "boca-juniors")
    assert out["run"]["status"] == "ok"
    scenarios = [p for p in out["predictions"] if p["kind"] == "escenario" and p["competition"] == "liga"]
    assert len(scenarios) == 10  # 5 rivales × local y visitante
    assert out["run"]["metrics"]["evaluated"] > 0
    assert out["run"]["metrics"]["chosen"] in match_predictor.CANDIDATES
    ids = {t["test_id"] for t in out["tests"]}
    assert {"gof_goles_favor", "ic_goles_favor", "indep_localia_resultado", "gof_goles_liga"} <= ids
    boca = {s["team_name"]: s for s in out["strengths"]}["Boca Juniors"]
    assert boca["attack_home"] > 1  # el más fuerte ataca por encima del promedio


def test_predictor_with_few_games_is_sin_datos() -> None:
    assert match_predictor.run(_league()[:10], "Boca Juniors", "boca-juniors")["run"]["status"] == "sin_datos"


def test_poisson_gof_merges_small_classes() -> None:
    gof = match_predictor.poisson_gof([0, 1, 1, 2, 0, 1, 3, 0, 2, 1, 5, 1, 0, 2, 1, 0, 1, 2, 0, 1])
    assert gof["labels"][-1].endswith("+")
    assert sum(gof["observed"]) == 20
    assert sum(gof["expected"]) == pytest.approx(20, abs=0.01)


def test_analytics_compute_builds_one_payload(squad: list[dict[str, object]]) -> None:
    payload = analytics.compute(squad, {}, _league(), "boca-juniors", league=_league_players())
    assert [r["model"] for r in payload["runs"]] == ["valor_mercado", "alternativas", "predictor_partido"]
    assert payload["styles"] and payload["alternatives"] and payload["match_predictions"] and payload["tests"]
    match = analytics.player_matcher(squad)
    assert match("Jugador 7") == 7
    assert match("Nadie Conocido Acá") is None


TM_PLAYERS = [
    {
        "player_id": "1",
        "name": "Jugador 7",
        "date_of_birth": "2000-06-01 00:00:00",
        "position": "Midfield",
        "current_club_id": "189",
        "current_club_name": "Club Atlético Boca Juniors",
        "current_club_domestic_competition_id": "ARG1",
        "market_value_in_eur": "900000",
        "url": "https://www.transfermarkt.co.uk/x/profil/spieler/1",
    },
    {
        "player_id": "2",
        "name": "Rival Uno",
        "date_of_birth": "1995-01-10 00:00:00",
        "position": "Attack",
        "current_club_id": "209",
        "current_club_name": "Club Atlético River Plate",
        "current_club_domestic_competition_id": "ARG1",
        "market_value_in_eur": "",
        "url": "",
    },
    {"player_id": "3", "name": "Europeo", "current_club_domestic_competition_id": "GB1"},
]


def test_transfermarkt_datasets_parse_and_split() -> None:
    from datetime import date

    from sources import transfermarkt_datasets as tmd

    valuations = tmd.latest_valuations(
        [
            {"player_id": "1", "date": "2026-01-01 00:00:00", "market_value_in_eur": "500000"},
            {"player_id": "1", "date": "2026-05-01 00:00:00", "market_value_in_eur": "800000"},
            {"player_id": "2", "date": "2026-04-01", "market_value_in_eur": "3000000"},
            {"player_id": "9", "date": "mal", "market_value_in_eur": "1"},
        ]
    )
    rows = tmd.parse_players(TM_PLAYERS, valuations, date(2026, 11, 18))
    assert [(r.player_name, r.value_eur, r.age, r.position_group) for r in rows] == [
        ("Jugador 7", 800_000, 26, "Mediocampista"),
        ("Rival Uno", 3_000_000, 31, "Delantero"),
    ]
    values, pool = analytics.split_pool(rows, lambda n: 7 if n == "Jugador 7" else None, date(2026, 11, 18))
    assert [(v.player_id, v.value_eur, str(v.as_of)) for v in values] == [(7, 800_000, "2026-05-01")]
    assert [p.player_name for p in pool] == ["Rival Uno"]
    assert analytics.pool_row(tmd.dump(pool)[0])["team"] == "Club Atlético River Plate"
    with pytest.raises(ValueError):
        tmd.read_csv(None, "../x")  # type: ignore[arg-type]


def test_market_values_csv(tmp_path: Path) -> None:
    path = tmp_path / "mv.csv"
    path.write_text(
        "jugador,equipo,fecha,valor_eur,fuente,url\n"
        "Jugador 1,boca-juniors,2026-10-01,1500000,transfermarkt,https://www.transfermarkt.com/x\n"
        "Fantasma,boca-juniors,2026-10-01,100,transfermarkt,\n"
        "Jugador 1,boca-juniors,no-es-fecha,100,transfermarkt,\n",
        encoding="utf-8",
    )
    warnings: list[str] = []
    rows = market_values.parse(path, lambda name: 1 if name == "Jugador 1" else None, warnings)
    assert [(r.player_id, r.value_eur) for r in rows] == [(1, 1_500_000)]
    assert len(warnings) == 2
    assert market_values.parse(tmp_path / "no.csv", lambda _: 1, warnings) == []


def test_market_values_csv_missing_columns(tmp_path: Path) -> None:
    path = tmp_path / "mv.csv"
    path.write_text("jugador,valor\nX,1\n", encoding="utf-8")
    warnings: list[str] = []
    assert market_values.parse(path, lambda _: 1, warnings) == []
    assert "sin columnas" in warnings[0]


def test_football_data_parse() -> None:
    payload = {
        "matches": [
            {
                "id": 1,
                "utcDate": "2026-05-01T22:00:00Z",
                "stage": "REGULAR_SEASON",
                "homeTeam": {"name": "Flamengo"},
                "awayTeam": {"name": "Palmeiras"},
                "score": {"fullTime": {"home": 2, "away": 1}},
            },
            {"id": 2, "utcDate": "2026-05-02T22:00:00Z", "score": {"fullTime": {"home": None}}},
        ]
    }
    rows = football_data.parse_matches(payload, 2026)
    assert [(r.home_team, r.home_goals, r.away_goals, str(r.match_date)) for r in rows] == [
        ("Flamengo", 2, 1, "2026-05-01")
    ]
    assert football_data.matches_url("BSA", 2026).endswith(
        "/competitions/BSA/matches?season=2026&status=FINISHED"
    )
    with pytest.raises(ValueError):
        football_data.matches_url("../x", 2026)


def test_football_data_without_key_skips(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("FOOTBALL_DATA_ORG_KEY", raising=False)
    assert football_data.fetch_matches(None, "BSA", 2026) == []  # type: ignore[arg-type]


def test_team_key_joins_names_across_sources() -> None:
    from pipeline.metrics import team_key

    assert (
        team_key("Instituto")
        == team_key("Instituto (Córdoba)")
        == team_key("Instituto Atlético Central Córdoba")
    )
    assert team_key("Club Atlético Newell’s Old Boys") == team_key("Newell's Old Boys")
    assert team_key("Gimnasia de Mendoza") != team_key("Gimnasia La Plata")


def test_dedupe_games_merges_sources_with_different_names() -> None:
    from pipeline import own_metrics

    row = {"home_goals": 1, "away_goals": 0}
    games = own_metrics.dedupe_games(
        [
            {
                **row,
                "source": "promiedos",
                "match_date": "2026-03-01",
                "home_team": "Instituto",
                "away_team": "Belgrano",
            },
            {
                **row,
                "source": "strikerapi",
                "match_date": "2026-03-02",
                "home_team": "Instituto (Córdoba)",
                "away_team": "Belgrano (Córdoba)",
            },
        ]
    )
    assert len(games) == 1


def test_old_games_weigh_less_and_old_teams_are_not_rivals() -> None:
    old = [Game("2025-01-10", "Boca Juniors", "Descendido", 0, 3) for _ in range(10)]
    league = _league()
    assert match_predictor.weight(
        "2025-07-01", __import__("datetime").date(2025, 12, 28), 180
    ) == pytest.approx(0.5)
    plain = match_predictor.fit(old + league, half_life=None).teams["boca juniors"].defense_home
    decayed = match_predictor.fit(old + league).teams["boca juniors"].defense_home
    assert decayed < plain  # las goleadas viejas en contra pesan menos
    out = match_predictor.run(old + league, "Boca Juniors", "boca-juniors")
    assert "Descendido" not in {s["team_name"] for s in out["strengths"]}
    assert (
        len([p for p in out["predictions"] if p["kind"] == "escenario" and p["competition"] == "liga"]) == 10
    )
    boca = {s["team_name"]: s for s in out["strengths"]}["Boca Juniors"]
    assert boca["home_games"] == 30  # solo la temporada actual


def test_transfermarkt_datasets_games() -> None:
    from sources import transfermarkt_datasets as tmd

    base = {
        "competition_id": "ARG1",
        "home_club_name": "Club Atlético Tigre",
        "away_club_name": "Club Atlético Lanús",
    }
    rows = tmd.parse_games(
        [
            {**base, "date": "2025-02-01", "home_club_goals": "2", "away_club_goals": "1"},
            {**base, "date": "2023-02-01", "home_club_goals": "2", "away_club_goals": "1"},
            {
                **base,
                "competition_id": "ES1",
                "date": "2025-02-01",
                "home_club_goals": "2",
                "away_club_goals": "1",
            },
            {**base, "date": "2025-02-01", "home_club_goals": "", "away_club_goals": "1"},
        ],
        since_year=2024,
    )
    assert [(r["season"], r["home_goals"], r["source"]) for r in rows] == [
        (2025, 2, "transfermarkt_datasets")
    ]


def test_predictor_cup_rivals_and_squad_value() -> None:
    teams = ["Boca Juniors", "River Plate", "Racing", "Independiente", "San Lorenzo", "Huracán"]
    values = {match_predictor.norm(t): 1e8 / (i + 1) for i, t in enumerate(teams)}
    cups = [
        {"name": "Cruzeiro", "competition": "conmebol_copa_libertadores", "value_eur": 2e8},
        {"name": "Desconocido FC", "competition": "conmebol_copa_sudamericana", "value_eur": None},
    ]
    out = match_predictor.run(_league(), "Boca Juniors", "boca-juniors", values, cups)
    cup = [p for p in out["predictions"] if p["kind"] == "escenario" and p["competition"] != "liga"]
    # Libertadores y Sudamericana: local y visitante; Copa Argentina (la genérica de la B): neutral.
    assert len(cup) == 5
    assert [p["neutral"] for p in cup if p["competition"] == "copa_argentina"] == [True]
    rows = {s["team_name"]: s for s in out["strengths"]}
    assert rows["Desconocido FC"]["estimated"] and not rows["Cruzeiro"]["estimated"]
    assert rows[match_predictor.LOWER_DIVISION]["squad_value_eur"] < rows["Huracán"]["squad_value_eur"]
    labels = {v["label"] for v in out["run"]["metrics"]["variables"]}
    assert set(match_predictor.CANDIDATES) <= labels


def test_irls_recovers_poisson_coefficients() -> None:
    rng = random.Random(5)  # noqa: S311
    xs = [[rng.uniform(-1, 1)] for _ in range(3000)]
    ys = [float(match_predictor._poisson_sample(rng, math.exp(0.2 + 0.5 * x[0]))) for x in xs]
    beta = match_predictor.irls(xs, ys, ridge=0.0)
    assert beta[0] == pytest.approx(0.2, abs=0.06)
    assert beta[1] == pytest.approx(0.5, abs=0.06)
    assert match_predictor.glm_inference(xs, ys, beta)[1]["p_value"] < 0.001


def test_club_value_matches_short_names() -> None:
    values = {"São Paulo Futebol Clube": 81, "FC Barcelona": 1000, "Club Atlético River Plate": 112}
    assert analytics.club_value("São Paulo", values) == 81
    assert analytics.club_value("River Plate", values) == 112
    assert analytics.club_value("Barcelona SC", values) is None  # no es el de España


def test_alternative_members_carry_their_stats(squad: list[dict[str, object]]) -> None:
    out = similarity.fit(_own(squad), _others(30, value=1e6), "boca-juniors")
    member = next(a for a in out["alternatives"] if a["section"] == "externo")["members"][0]
    assert set(member["z"]) == set(similarity.KEYS)
    assert set(member["features"]) == set(similarity.KEYS)
