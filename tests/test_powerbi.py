"""Modelo de Power BI (sección 11): CSV en estrella, textos seguros y cálculos de apoyo."""

from __future__ import annotations

import csv
import io

import pytest

from pipeline import excel, powerbi
from tests.test_excel import _data


def _read(table: powerbi.Table) -> list[dict[str, str]]:
    raw = powerbi.to_csv(table)
    assert raw.startswith(b"\xef\xbb\xbf")  # BOM: Power BI y Excel leen bien las tildes
    return list(csv.DictReader(io.StringIO(raw.decode("utf-8-sig"))))


def test_every_table_has_rows_matching_its_header() -> None:
    tables = powerbi.build_tables(_data(), {})
    for name, (head, rows) in tables.items():
        assert all(len(r) == len(head) for r in rows), name
    assert {"dim_player", "dim_stat", "fact_player_stat", "fact_projection", "dim_chart"} <= tables.keys()


def test_text_that_looks_like_a_formula_is_neutralized() -> None:
    rows = _read(powerbi.build_tables(_data(), {})["dim_player"])
    assert rows[0]["nombre"].startswith("'=")


def test_fact_player_stat_is_long_with_percentile_by_type() -> None:
    rows = _read(powerbi.build_tables(_data(), {})["fact_player_stat"])
    goles = [r for r in rows if r["stat_id"] == "goles" and r["competition_code"] == "todas"]
    assert len(goles) == 5
    # El arquero es el único de su tipo: su percentil sale de un grupo de uno.
    keeper = next(r for r in goles if r["player_id"] == "4")
    assert float(keeper["percentil"]) == 50.0
    assert all(r["valor_90"] for r in goles)


def test_rolling_5_uses_chronological_order() -> None:
    values = [
        {
            "entity": "player",
            "entity_id": 1,
            "match_id": m,
            "stat_id": "goles",
            "value": v,
            "low": None,
            "high": None,
        }
        for m, v in [(3, 3.0), (1, 1.0), (2, 2.0), (4, None), (5, 5.0), (6, 6.0), (7, 7.0)]
    ]
    out = powerbi._rolling_rows(values, [1, 2, 3, 4, 5, 6, 7])
    assert [r[2] for r in out] == [1, 2, 3, 4, 5, 6, 7]
    rolling = [r[-1] for r in out]
    assert rolling[:4] == [1.0, 1.5, 2.0, 2.0]  # un partido sin valor no corre la ventana
    assert rolling[-1] == pytest.approx((2 + 3 + 5 + 6 + 7) / 5)


def test_level_is_recovered_from_potencial_alpha() -> None:
    # Ejemplo de 6.1.4: 20 años, N = 60, Mejoría α 65 → Margen 12,075 y Potencial α 72,075.
    p = excel.Player(
        1, "X", "Delantero", None, 10, 900, {"potencial_alpha": 72.075, "mejoria_alpha": 65}, age=20
    )
    assert powerbi._level_from(p) == pytest.approx(60, abs=1e-3)
    capped = excel.Player(2, "Y", "Delantero", None, 10, 900, {"potencial_alpha": 100.0}, age=18)
    assert powerbi._level_from(capped) is None
