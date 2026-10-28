"""Tests del catálogo de estadísticas (`data/stat_catalog.csv`) y de sus conjuntos (`data/stat_sets.csv`).

El catálogo no es solo documentación: cada fila dice cómo se calcula la estadística y la vista
SQL de la tabla maestra lo interpreta. Por eso se valida como código.
"""

from __future__ import annotations

import json
import re

import httpx
import pytest

from pipeline import catalog, load

STATS = catalog.load_catalog()
SETS = catalog.load_sets()
BY_ID = {s.id: s for s in STATS}


def test_ids_are_unique_snake_case() -> None:
    ids = [s.id for s in STATS]
    assert len(ids) == len(set(ids))
    assert all(re.fullmatch(r"[a-z][a-z0-9_]*", i) for i in ids)


def test_catalog_covers_players_and_team() -> None:
    # Piso del catálogo: lo de las secciones 5.1 y 5.2 (no se achica por calcular más).
    assert sum(s.entidad == "jugador" for s in STATS) >= 100
    assert sum(s.entidad == "equipo" for s in STATS) >= 90


def test_descriptions_are_short_and_own() -> None:
    for s in STATS:
        assert 10 <= len(s.descripcion_es) <= 160, s.id


def test_every_stat_says_how_to_read_it() -> None:
    # Guía de lectura: qué significa un valor alto, bajo, negativo o cerca de 0.
    for s in STATS:
        assert 10 <= len(s.lectura_es) <= 160, s.id


def test_no_emojis_in_texts() -> None:
    emoji = re.compile("[\U0001f300-\U0001faff☀-➿]")
    for s in STATS:
        for text in (s.nombre_es, s.descripcion_es, s.formula, s.abrev):
            assert not emoji.search(text), s.id


def test_level_c_is_never_available_and_has_no_rule() -> None:
    for s in STATS:
        if s.nivel == "C":
            assert not s.available, s.id
            assert s.agregacion == "nd", s.id
        if s.agregacion == "nd":
            assert s.nivel == "C", s.id


def test_estimated_stats_are_level_b() -> None:
    assert all(s.nivel == "B" for s in STATS if s.estimada)


def test_base_rules_point_to_known_base_keys() -> None:
    for s in STATS:
        if s.agregacion in ("suma", "promedio"):
            assert s.arg1 in catalog.BASE_KEYS[s.entidad], s.id


def test_composite_rules_use_base_stats_of_the_same_entity() -> None:
    # Una sola pasada en SQL: los compuestos solo combinan sumas o promedios ya agregados.
    for s in STATS:
        if s.agregacion in catalog.COMPOSITE:
            for arg in (s.arg1, s.arg2):
                ref = BY_ID.get(arg)
                assert ref is not None, f"{s.id}: {arg} no existe"
                assert ref.entidad == s.entidad, s.id
                assert ref.agregacion in ("suma", "promedio"), f"{s.id}: {arg} es {ref.agregacion}"


def test_own_metrics_say_how_they_add_up() -> None:
    # Las métricas que calcula el pipeline se guardan por partido (y se suman o promedian al
    # agrupar por rival, mes o competición) o solo por ventana (rachas, forma, exponente).
    for s in STATS:
        if s.agregacion in ("metrica", "especial"):
            allowed = ("suma", "promedio", "ventana") if s.entidad == "equipo" else ("ventana",)
            assert s.arg2 in allowed, s.id


def test_ratios_have_a_positive_factor() -> None:
    assert all(s.factor > 0 for s in STATS if s.agregacion == "cociente")


def test_percentages_and_ratios_are_not_per_90() -> None:
    assert not any(s.por90 for s in STATS if s.agregacion in ("cociente", "promedio", "perfil"))


def test_projection_metrics_from_section_6_1() -> None:
    for metric_id in (
        "rendimiento_indice",
        "mejoria_alpha",
        "mejoria_beta",
        "potencial_alpha",
        "potencial_beta",
    ):
        s = BY_ID[metric_id]
        assert (s.nivel, s.estimada, s.higher_is_better, s.agregacion) == ("B", True, True, "metrica")


@pytest.mark.parametrize(
    "name",
    [
        "Resumen",
        "Participación",
        "Ataque",
        "Creación",
        "Defensa",
        "Disciplina",
        "Rendimiento vs esperado",
        "Porteros",
        "Físico y carga",
        "Métricas propias",
        "Evolución y proyección",
    ],
)
def test_player_sets_of_section_9_1(name: str) -> None:
    assert any(st.entidad == "jugador" and st.nombre_es == name and st.stats for st in SETS)


@pytest.mark.parametrize(
    "name",
    [
        "Resultados",
        "Goles",
        "Ataque y tiros",
        "Rendimiento vs esperado (xG)",
        "Posesión y circulación",
        "Defensa",
        "Balón parado",
        "Disciplina y árbitros",
        "Tramos de minutos",
        "Local y visitante",
        "Rivales y calendario",
        "Forma y rachas",
        "Métricas propias",
        "Tabla de posiciones y Boca vs liga",
    ],
)
def test_team_sets_of_section_9_5(name: str) -> None:
    assert any(st.entidad == "equipo" and st.nombre_es == name and st.stats for st in SETS)


def test_set_items_exist_with_the_same_entity() -> None:
    for st in SETS:
        assert len(st.stats) == len(set(st.stats)), st.id
        for stat_id in st.stats:
            assert stat_id in BY_ID, f"{st.id}: {stat_id}"
            assert BY_ID[stat_id].entidad == st.entidad, f"{st.id}: {stat_id}"


def test_summary_set_matches_section_9_1() -> None:
    resumen = next(st for st in SETS if st.entidad == "jugador" and st.nombre_es == "Resumen")
    for stat_id in ("partidos", "minutos", "goles", "asistencias", "goles_asistencias", "calificacion"):
        assert stat_id in resumen.stats


def test_payload_uses_the_database_names() -> None:
    payload = catalog.to_payload(STATS, SETS)
    goles = next(s for s in payload["stats"] if s["stat_id"] == "goles")
    assert goles["entity"] == "player"
    assert goles["short_name"] == "Goles"
    assert goles["rule"] == "suma" and goles["arg1"] == "goals"
    eq = next(s for s in payload["stats"] if s["stat_id"] == "eq_puntos")
    assert eq["entity"] == "team"
    first = payload["sets"][0]
    assert first["set_id"] == "resumen" and first["sort_order"] == 1
    assert first["stats"][0] == "partidos"


def test_send_catalog_goes_to_its_own_function() -> None:
    seen: dict[str, httpx.Request] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["req"] = request
        return httpx.Response(200, json={"stats": 1, "set_items": 1})

    with httpx.Client(transport=httpx.MockTransport(handler)) as client:
        load.send_catalog({"stats": [], "sets": []}, "https://x.supabase.co", "sb_secret_abc", client=client)
    assert seen["req"].url.path == "/rest/v1/rpc/load_catalog"
    assert json.loads(seen["req"].content) == {"p_stats": [], "p_sets": []}


def test_refresh_stats_calls_its_function_without_arguments() -> None:
    seen: dict[str, httpx.Request] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["req"] = request
        return httpx.Response(204)

    with httpx.Client(transport=httpx.MockTransport(handler)) as client:
        load.refresh_stats("https://x.supabase.co", "sb_secret_abc", client=client)
    assert seen["req"].url.path == "/rest/v1/rpc/refresh_stats"
    assert json.loads(seen["req"].content) == {}


def test_every_player_stat_belongs_to_some_set() -> None:
    # Si una estadística no está en ningún conjunto, la tabla maestra nunca la muestra.
    in_sets = {stat_id for st in SETS for stat_id in st.stats}
    missing = [s.id for s in STATS if s.id not in in_sets]
    assert not missing, missing
