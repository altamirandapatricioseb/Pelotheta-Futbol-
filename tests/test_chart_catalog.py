"""Tests del catálogo de gráficos (`data/chart_catalog.csv`) y del mapa de origen (9.9).

Prueba obligatoria de 9.9: todo destino de «Ver origen de los datos» existe (sin enlaces rotos)
y un gráfico sin destino no muestra el botón.
"""

from __future__ import annotations

import json
from pathlib import Path

import httpx

from pipeline import catalog, charts, load

ROOT = Path(__file__).resolve().parent.parent
CHARTS = charts.load_charts()
SOURCES = charts.load_sources()
SETS = {s.id: s for s in catalog.load_sets()}
STATS = {s.id: s for s in catalog.load_catalog()}


def test_at_least_fifty_charts_with_unique_ids() -> None:
    ids = [c.id for c in CHARTS]
    assert len(ids) == len(set(ids))
    assert len(CHARTS) >= 50
    assert sum(c.available for c in CHARTS) >= 50


def test_category_n_follows_section_6_1() -> None:
    # 6.1.6: la categoría N lleva los gráficos 78 a 84.
    assert {f"g{n}" for n in range(78, 85)} <= {c.id for c in CHARTS if c.categoria == "N"}


def test_origin_ref_points_to_a_real_stat_set_of_the_same_entity() -> None:
    for c in CHARTS:
        entity, set_id = c.origen_ref.split(":")
        assert set_id in SETS, c.id
        assert SETS[set_id].entidad == ("equipo" if entity == "equipo" else "jugador"), c.id


def test_every_source_destination_exists() -> None:
    chart_ids = {c.id for c in CHARTS}
    for s in SOURCES:
        assert s.chart_id in chart_ids, s.chart_id
        assert s.destino_ref in charts.TARGET_PAGES[s.destino_tipo], s
        params = dict(p.split("=") for p in s.parametros.split("&") if p)
        if s.destino_tipo == "desglosada":
            # Página dinámica /estadistica/[stat] y estadística que existe para esa entidad.
            assert (ROOT / "web" / "app" / "estadistica" / "[stat]" / "page.tsx").exists(), s
            stat = STATS.get(params.get("stat", ""))
            assert stat is not None and stat.available, s
            assert stat.entidad == ("jugador" if params.get("entidad") == "jugador" else "equipo"), s
            assert s.href().startswith(f"/estadistica/{stat.id}")
            continue
        assert (ROOT / "web" / "app" / s.destino_ref / "page.tsx").exists(), s
        if "conjunto" in params:
            stat_set = SETS.get(params["conjunto"])
            assert stat_set is not None, s
            assert stat_set.entidad == ("equipo" if s.destino_ref == "equipo" else "jugador"), s


def test_source_label_names_its_origin() -> None:
    for s in SOURCES:
        prefix = "Desglosada: " if s.destino_tipo == "desglosada" else "Origen: "
        assert s.etiqueta_es.startswith(prefix), s.chart_id
        assert s.href().startswith("/")


def test_unavailable_chart_without_reason_is_rejected() -> None:
    row = {
        "id": "g99",
        "categoria": "A",
        "titulo_es": "Prueba",
        "tipo": "linea",
        "datos_requeridos": "nada",
        "origen_ref": "equipo:eq_resultados",
        "powerbi": "sí",
        "excel": "sí",
        "available": "false",
        "motivo": "",
    }
    try:
        charts.Chart.model_validate(row)
    except ValueError:
        return
    raise AssertionError("un gráfico sin datos debe decir por qué")


def test_payload_and_rpc() -> None:
    payload = charts.to_payload(CHARTS, SOURCES)
    assert len(payload["charts"]) == len(CHARTS)
    assert payload["charts"][0]["sort_order"] == 1
    assert {c["chart_id"] for c in payload["charts"]} >= {s["chart_id"] for s in payload["sources"]}

    seen: dict[str, object] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["path"] = request.url.path
        seen["body"] = json.loads(request.content)
        return httpx.Response(200, json={"charts": len(CHARTS), "sources": len(SOURCES)})

    client = httpx.Client(transport=httpx.MockTransport(handler))
    result = load.send_charts(payload, "https://x.supabase.co", "sb_secret_abc", client)
    assert seen["path"] == "/rest/v1/rpc/load_charts"
    assert set(seen["body"]) == {"p_charts", "p_sources"}  # type: ignore[arg-type]
    assert result == {"charts": len(CHARTS), "sources": len(SOURCES)}
