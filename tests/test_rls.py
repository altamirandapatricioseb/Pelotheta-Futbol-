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

pytestmark = pytest.mark.skipif(
    not (URL and KEY), reason="Faltan SUPABASE_URL o SUPABASE_PUBLISHABLE_KEY"
)


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
