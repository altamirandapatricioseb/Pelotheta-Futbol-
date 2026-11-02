"""Especificación OpenAPI de la API de solo lectura (16.2)."""

from __future__ import annotations

from scripts.openapi import convert

SWAGGER = {
    "swagger": "2.0",
    "paths": {
        "/": {"get": {}},
        "/boca_match": {"get": {"parameters": []}, "post": {}, "patch": {}, "delete": {}},
        "/rpc/stat_series": {
            "get": {"parameters": [{"name": "p_stat", "in": "query", "required": True, "type": "string"}]},
            "post": {},
        },
    },
    "definitions": {
        "boca_match": {
            "description": "Partidos de Boca.",
            "properties": {
                "match_id": {
                    "type": "integer",
                    "format": "int32",
                    "description": "Note:\nThis is a Primary Key.<pk/>",
                },
                "tags": {"type": "array", "items": {"type": "string", "format": "text"}, "format": "text[]"},
            },
        },
        "otra_tabla": {"properties": {}},
    },
}


def test_only_reads_are_documented() -> None:
    doc = convert(SWAGGER, "https://x.supabase.co/")
    assert doc["openapi"] == "3.1.0"
    assert doc["servers"] == [{"url": "https://x.supabase.co/rest/v1"}]
    assert set(doc["paths"]) == {"/boca_match", "/rpc/stat_series"}
    assert all(set(item) == {"get"} for item in doc["paths"].values())


def test_schemas_and_functions() -> None:
    doc = convert(SWAGGER, "https://x.supabase.co")
    schema = doc["components"]["schemas"]["boca_match"]
    assert schema["properties"]["match_id"]["description"] == "Clave primaria."
    assert schema["properties"]["tags"] == {"type": "array", "items": {"type": "string", "format": "text"}}
    # Solo se documentan los esquemas de vistas publicadas.
    assert "otra_tabla" not in doc["components"]["schemas"]
    rpc = doc["paths"]["/rpc/stat_series"]["get"]
    assert rpc["tags"] == ["Funciones"] and rpc["parameters"][0]["required"] is True
