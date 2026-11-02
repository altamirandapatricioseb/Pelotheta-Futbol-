"""Libros de Excel (sección 10): hojas, interactividad, gráficos nativos y textos seguros."""

from __future__ import annotations

import io
import re
import zipfile

import openpyxl

from pipeline import excel


def _stat(
    sid: str, group: str = "Ataque", hib: bool = True, key: bool = True, per90: bool = True
) -> excel.Stat:
    return excel.Stat(
        sid, sid.title(), sid[:4], f"Descripción de {sid}", "", group, "", "A", hib, False, per90, "suma", key
    )


def _data() -> excel.Data:
    stats = [_stat(s) for s in ("goles", "xg", "remates", "pases_clave", "calificacion", "nr")]
    stats.append(_stat("perdidas", "Creación", hib=False, key=False))
    players = [
        excel.Player(
            i,
            name,
            line,
            None,
            10,
            minutes,
            {
                "goles": i,
                "xg": i * 0.8,
                "remates": i * 3,
                "pases_clave": 10 - i,
                "calificacion": 6 + i / 10,
                "nr": i - 3,
                "perdidas": 20 - i,
            },
        )
        for i, (name, line, minutes) in enumerate(
            [
                ('=HYPERLINK("x")', "Delantero", 900),
                ("Paredes", "Mediocampista", 1800),
                ("Blanco", "Defensor", 1500),
                ("Marchesín", "Arquero", 900),
                ("Zenon", "Delantero", 500),
            ],
            start=1,
        )
    ]
    team = [
        {
            "match_id": i,
            "match_date": f"2026-0{1 + i // 4}-1{i % 9}",
            "competition_code": "liga",
            "competition_name": "Liga",
            "opponent": f"Rival {i}",
            "boca_home": i % 2 == 0,
            "goals_for": i % 3,
            "goals_against": 1,
            "stats": {
                "xg": 1.2,
                "xg_against": 0.8,
                "shots_total": 12,
                "possession_pct": 55,
                "eq_xpts": 1.6,
                "goals_for_00_15": 1,
            },
        }
        for i in range(8)
    ]
    return excel.Data(
        updated="2026-10-28 10:00",
        competitions=[("liga", "Liga")],
        stats=stats,
        sets=[("ataque", "Ataque", ["goles", "xg", "remates", "pases_clave"])],
        players={"todas": players, "liga": players},
        team=team,
        situations=[
            {
                "card_id": "s001",
                "category": "Contexto",
                "title": "Local",
                "param_value": "Sí",
                "n": 4,
                "w": 2,
                "d": 1,
                "l": 1,
                "win_pct": 50,
                "delta": 2,
                "ppg": 1.75,
                "gf_avg": 1.5,
                "ga_avg": 1,
            }
        ],
        projection={
            2: {
                "rendimiento_indice": {"value": 70.0, "detail": {"componentes": {"A": 60, "C": 80, "D": 70}}},
                "mejoria_alpha": {
                    "value": 55.0,
                    "detail": {
                        "w": 0.5,
                        "min_r": 450,
                        "min_b": 900,
                        "tasas": [
                            {
                                "tasa": "pases_90",
                                "r": 50,
                                "b": 45,
                                "sigma": 5,
                                "peso": 1,
                                "mas_es_mejor": True,
                            }
                        ],
                    },
                },
                "potencial_alpha": {"value": 72.0, "detail": {"nivel_pct": 65.0}},
                "potencial_beta": {"value": 60.0, "detail": {}},
            }
        },
    )


def test_projection_sheet_has_live_formulas_and_named_parameters() -> None:
    _, wb = _book()
    assert {"Parámetros", "Proyección"} <= set(wb.sheetnames)
    assert {"K_REL", "ALFA_ESC", "PESOS", "LINEAS"} <= set(wb.defined_names)
    formulas = [c.value for row in wb["Proyección"].iter_rows() for c in row if isinstance(c.value, str)]
    assert any(f.startswith("=") and "ALFA_ESC" in f for f in formulas)
    assert any("INDEX(PESOS,MATCH(" in f for f in formulas)
    assert wb["Proyección"].data_validations.dataValidation


def _book() -> tuple[bytes, openpyxl.Workbook]:
    content = excel.build(_data(), "todas", "Todas las competiciones")
    return content, openpyxl.load_workbook(io.BytesIO(content))


def test_has_the_required_sheets_with_index_first() -> None:
    _, wb = _book()
    names = wb.sheetnames
    assert names[0] == "Índice"
    for sheet in (
        "Metadatos",
        "Tabla maestra",
        "Catálogo",
        "Comparador",
        "Dispersión",
        "Comparación",
        "Equipo",
        "Situaciones",
    ):
        assert sheet in names, sheet
    assert {n for n in names if n.startswith("G")} >= {
        "G03 Ranking",
        "G04 Distribución",
        "G05 Evolución",
        "G06 Forma",
        "G07 Tramos",
        "G08 xG",
        "G13 Métricas propias",
        "G14 Correlación",
    }


def test_index_links_every_visible_sheet() -> None:
    _, wb = _book()
    links = {
        c.hyperlink.location.split("!")[0].strip("'")
        for row in wb["Índice"].iter_rows()
        for c in row
        if c.hyperlink
    }
    assert {"Metadatos", "Tabla maestra", "Comparador", "G06 Forma"} <= links


def test_charts_are_native() -> None:
    content, _ = _book()
    with zipfile.ZipFile(io.BytesIO(content)) as z:
        charts = [n for n in z.namelist() if re.match(r"xl/charts/chart\d+\.xml", n)]
        radar = any("<c:radarChart>" in z.read(n).decode() for n in charts)
        scatter = any("<c:scatterChart>" in z.read(n).decode() for n in charts)
    assert len(charts) >= 10
    assert radar and scatter


def test_comparador_and_dispersion_are_interactive() -> None:
    _, wb = _book()
    comp = wb["Comparador"]
    assert comp.data_validations.dataValidation, "faltan las listas desplegables"
    formulas = [
        c.value
        for row in comp.iter_rows()
        for c in row
        if isinstance(c.value, str) and c.value.startswith("=")
    ]
    assert any("INDEX(" in f and "MATCH(" in f for f in formulas)
    disp = wb["Dispersión"]
    assert disp.data_validations.dataValidation
    assert any(isinstance(c.value, str) and "MATCH(" in c.value for row in disp.iter_rows() for c in row)


def test_text_that_looks_like_a_formula_is_written_as_text() -> None:
    _, wb = _book()
    cells = [
        c
        for row in wb["Tabla maestra"].iter_rows()
        for c in row
        if isinstance(c.value, str) and "HYPERLINK" in c.value
    ]
    assert cells and all(c.data_type == "s" and c.value.startswith("'=") for c in cells)


def test_percentile_respects_direction() -> None:
    assert excel.percentile([1, 2, 3, 4], 4, True) == 87.5
    assert excel.percentile([1, 2, 3, 4], 1, False) == 87.5


def test_per90_and_media() -> None:
    p = excel.Player(1, "A", "Delantero", None, 10, 900, {"goles": 5})
    s = _stat("goles")
    assert excel.per90(p, s) == 0.5
    assert excel.media([p, excel.Player(2, "B", None, None, 1, 450, {"goles": 1})], s) == 0.35


def test_file_names() -> None:
    assert excel.file_name("todas") == "pelotheta-global.xlsx"
    assert excel.file_name("copa_argentina") == "pelotheta-copa_argentina.xlsx"
