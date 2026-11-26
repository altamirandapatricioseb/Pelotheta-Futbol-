"""Exportador a Parquet (sin red): ida y vuelta, licencias, partición y manifiesto."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any

import pyarrow.parquet as pq

from pipeline import export_parquet as ex

TEAM = "publico/pais=ARG/equipo=arg-boca-juniors"
LEAGUE = "pais=ARG/liga=arg-liga-profesional-argentina"
ROWS: dict[str, list[dict[str, Any]]] = {
    "boca_match": [
        {"match_id": 1, "match_date": "2026-02-01", "season_year": 2026, "opponent": "River", "goals_for": 2},
        {
            "match_id": 2,
            "match_date": "2025-11-01",
            "season_year": 2025,
            "opponent": "Racing",
            "goals_for": 0,
        },
    ],
    "match_lineup": [{"match_id": 1, "player_id": 9, "started": True, "minute_out": None}],
    "league_result": [
        {"source": "promiedos", "season": "2026", "home_team": "A", "home_goals": 1},
        {"source": "strikerapi", "season": "2026", "home_team": "B", "home_goals": 3},
    ],
    "player_match_value": [{"match_id": 1, "player_id": 9, "key": "passes", "value": 41}],
    "team_strength": [{"team_slug": "boca", "attack_home": 1.2, "features": {"a": 1}}],
    "coverage": [{"competition_uid": "arg-liga", "season_year": 2026, "level": "parcial"}],
}


def run(tmp_path: Path) -> dict[str, dict[str, Any]]:
    return ex.export(lambda view: ROWS[view], tmp_path, list(ROWS))


def test_round_trip_keeps_rows_and_nulls(tmp_path: Path) -> None:
    run(tmp_path)
    table = pq.read_table(tmp_path / TEAM / "temporada=2026/boca_match.parquet")
    assert table.to_pylist() == [ROWS["boca_match"][0]]
    lineup = pq.read_table(tmp_path / TEAM / "temporada=2026/match_lineup.parquet")
    assert lineup.to_pylist()[0]["minute_out"] is None  # el faltante sigue siendo null, no 0


def test_restricted_never_lands_in_public(tmp_path: Path) -> None:
    manifests = run(tmp_path)
    public = manifests["publico"]["archivos"]
    assert "player_match_value" not in {f["tabla"] for f in public}
    assert all("strikerapi" not in f["fuentes"] for f in public)
    assert not list((tmp_path / "publico").rglob("player_match_value.parquet"))
    private = pq.read_table(tmp_path / "privado" / LEAGUE / "temporada=2026/league_result.parquet")
    assert private.column("source").to_pylist() == ["strikerapi"]


def test_metadata_and_manifest_hash(tmp_path: Path) -> None:
    manifests = run(tmp_path)
    entry = next(f for f in manifests["publico"]["archivos"] if f["tabla"] == "league_result")
    path = tmp_path / "publico" / entry["ruta"]
    assert hashlib.sha256(path.read_bytes()).hexdigest() == entry["sha256"]
    meta = pq.read_schema(path).metadata
    assert meta[b"schema_version"] == str(ex.SCHEMA_VERSION).encode()
    assert meta[b"licencia"] == b"abierta"
    assert entry["atribucion"] == [ex.OPEN_SOURCES["promiedos"]]
    on_disk = json.loads((tmp_path / "publico/manifest.json").read_text("utf-8"))
    assert on_disk["schema_version"] == ex.SCHEMA_VERSION


def test_json_columns_and_reference_partition(tmp_path: Path) -> None:
    run(tmp_path)
    strength = pq.read_table(tmp_path / "publico" / LEAGUE / "temporada=2026/team_strength.parquet")
    assert json.loads(strength.to_pylist()[0]["features"]) == {"a": 1}
    assert (tmp_path / "publico/referencia/coverage.parquet").exists()
    assert "Promiedos" in (tmp_path / "publico/README.md").read_text("utf-8")


def test_league_rows_go_to_their_own_country_and_league(tmp_path: Path) -> None:
    rows = {
        "league_player_profile": [
            {"player_name": "A", "season_year": 2026},  # sin país ni liga: la Liga Profesional
            {
                "player_name": "B",
                "season_year": 2026,
                "country_code": "URU",
                "competition_uid": "uru-primera",
            },
        ]
    }
    manifests = ex.export(lambda view: rows.get(view, []), tmp_path, ["league_player_profile"])
    paths = sorted(f["ruta"] for f in manifests["publico"]["archivos"])
    assert paths == [
        f"{LEAGUE}/temporada=2026/league_player_profile.parquet",
        "pais=URU/liga=uru-primera/temporada=2026/league_player_profile.parquet",
    ]


def test_descriptive_source_column_does_not_split_rows(tmp_path: Path) -> None:
    rows = {**ROWS, "stat_catalog": [{"stat_id": "xg", "source": "statshub|bzzoiro"}]}
    manifests = ex.export(lambda view: rows[view], tmp_path, ["boca_match", "stat_catalog"])
    assert [f["tabla"] for f in manifests["privado"]["archivos"]] == []
    entry = next(f for f in manifests["publico"]["archivos"] if f["tabla"] == "boca_match")
    assert entry["atribucion"] == [ex.OPEN_SOURCES["promiedos"]]


def test_unify_club_names_per_league() -> None:
    from pipeline.export_parquet import unify_club_names

    standings = [
        {"competition_uid": "uru-primera", "team_name": n} for n in ("Cerro", "Cerro Largo", "Nacional")
    ] + [{"competition_uid": "bra-serie-a", "team_name": n} for n in ("Bragantino", "Sport")]
    rows = [
        {"competition_uid": "uru-primera", "team_name": "Cerro Largo"},
        {"competition_uid": "uru-primera", "team_name": "Cerro"},
        {"competition_uid": "bra-serie-a", "team_name": "Red Bull Bragantino"},
        {"competition_uid": "bra-serie-a", "team_name": "Sport Recife"},
        {"competition_uid": "col-primera-a", "team_name": "Atlético Nacional"},  # su liga no tiene tabla
    ]
    assert [r["team_name"] for r in unify_club_names(rows, standings)] == [
        "Cerro Largo",
        "Cerro",
        "Bragantino",
        "Sport",
        "Atlético Nacional",
    ]
