"""Prueba de Row Level Security y privilegios contra el proyecto real de Supabase (sección 7).

Usa SOLO la clave pública (publicable o anon), igual que un visitante cualquiera:
- se puede leer el esquema expuesto `api`;
- no se puede llegar a `core` ni a `public` por la Data API;
- no se puede insertar, actualizar ni borrar nada.

Necesita SUPABASE_URL y SUPABASE_PUBLISHABLE_KEY en el entorno; si faltan, se saltea.
"""

from __future__ import annotations

import os

import httpx
import pytest

URL = os.environ.get("SUPABASE_URL", "").rstrip("/")
KEY = os.environ.get("SUPABASE_PUBLISHABLE_KEY", "")

pytestmark = pytest.mark.skipif(not (URL and KEY), reason="Faltan SUPABASE_URL o SUPABASE_PUBLISHABLE_KEY")


@pytest.fixture(scope="module")
def client() -> httpx.Client:
    with httpx.Client(base_url=f"{URL}/rest/v1", headers={"apikey": KEY}, timeout=15) as c:
        yield c


def test_anon_lee_la_fila_de_prueba(client: httpx.Client) -> None:
    response = client.get("/system_status", params={"select": "key,value"})
    assert response.status_code == 200
    keys = {row["key"] for row in response.json()}
    assert "etapa" in keys


@pytest.mark.parametrize("schema", ["core", "public", "graphql_public"])
def test_esquemas_no_expuestos(client: httpx.Client, schema: str) -> None:
    response = client.get("/match", headers={"Accept-Profile": schema})
    assert response.status_code in (400, 406)
    assert response.json()["code"] == "PGRST106"


def test_anon_no_inserta(client: httpx.Client) -> None:
    response = client.post("/system_status", json={"key": "intruso", "value": "x"})
    assert response.status_code in (401, 403)


def test_anon_no_actualiza(client: httpx.Client) -> None:
    response = client.patch("/system_status", params={"key": "eq.etapa"}, json={"value": "x"})
    assert response.status_code in (401, 403)


def test_anon_no_borra(client: httpx.Client) -> None:
    response = client.delete("/system_status", params={"key": "eq.etapa"})
    assert response.status_code in (401, 403)
    # Y la fila sigue ahí.
    still = client.get("/system_status", params={"select": "key", "key": "eq.etapa"})
    assert still.json() == [{"key": "etapa"}]


def test_anon_no_ve_el_detalle_del_log(client: httpx.Client) -> None:
    # La vista pública expone estado por fuente, nunca los mensajes internos del log.
    response = client.get("/source_status", params={"select": "message"})
    assert response.status_code == 400


@pytest.mark.parametrize(
    "function",
    [
        "load_batch",
        "log_failure",
        "internal_id",
        "load_weather",
        "load_extras",
        "load_competition_metrics",
        "load_player_foot",
        "load_player_stats",
    ],
)
def test_anon_no_ejecuta_la_carga(client: httpx.Client, function: str) -> None:
    # El esquema `ingest` está expuesto solo para que el pipeline cargue con la clave secreta.
    response = client.post(f"/rpc/{function}", headers={"Content-Profile": "ingest"}, json={})
    assert response.status_code in (401, 403, 404)


def test_anon_lee_el_resumen_sin_fecha_de_nacimiento(client: httpx.Client) -> None:
    response = client.get("/player_summary", params={"select": "*", "limit": "1"})
    assert response.status_code == 200
    rows = response.json()
    assert rows, "la vista debería tener datos después de la primera carga"
    assert "birth_date" not in rows[0]
    assert "age" in rows[0]


@pytest.mark.parametrize(
    "view",
    [
        "player_stat_totals",
        "boca_formation",
        "boca_shot",
        "player_shot_totals",
        "boca_weather",
        "boca_absence",
        "boca_momentum",
        "league_result",
        "club_rating",
        "club_season_stat",
        "league_leader",
        "league_standing",
        "player_profile",
        "boca_penalty",
        "boca_competition_metric",
        "referee_stats",
        "league_absences",
        "player_position",
        "match_lineup",
    ],
)
def test_anon_lee_las_vistas_avanzadas(client: httpx.Client, view: str) -> None:
    response = client.get(f"/{view}", params={"select": "*", "limit": "1"})
    assert response.status_code == 200
    assert response.json(), "la vista debería tener datos después de la carga de ScoutingStats"


def test_anon_no_lee_fecha_de_nacimiento_aunque_la_pida(client: httpx.Client) -> None:
    response = client.get("/player_summary", params={"select": "birth_date"})
    assert response.status_code == 400


def test_anon_no_escribe_en_exports() -> None:
    # El bucket de los libros de Excel es de lectura pública; escribir solo con la clave secreta.
    response = httpx.post(
        f"{URL}/storage/v1/object/exports/intruso.xlsx",
        content=b"x",
        headers={
            "apikey": KEY,
            "Authorization": f"Bearer {KEY}",
            "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        },
        timeout=15,
    )
    assert response.status_code >= 400


def test_anon_descarga_el_libro_global() -> None:
    response = httpx.get(f"{URL}/storage/v1/object/public/exports/pelotheta-global.xlsx", timeout=30)
    assert response.status_code == 200
    assert response.content[:2] == b"PK"
