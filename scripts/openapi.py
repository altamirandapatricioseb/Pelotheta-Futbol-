"""Especificación OpenAPI 3.1 de la API de solo lectura (16.2).

La Data API de Supabase (PostgREST) ya expone las vistas del esquema `api`. Este script pide su
especificación (Swagger 2.0, que genera PostgREST) y la convierte en un OpenAPI 3.1 que solo
documenta lectura: `GET` de cada vista y de las dos funciones. Las escrituras no existen para la
clave pública (RLS), así que no se documentan. Escribe `web/public/openapi.json`, que sirve la web
y lee la página `/api-docs`.

Uso: `uv run python -m scripts.openapi` (necesita SUPABASE_URL y la clave secreta en `.env`: la
especificación completa de PostgREST solo se entrega con ella; la clave nunca se escribe).
"""

from __future__ import annotations

import json
import os
import sys
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import httpx

OUT = Path(__file__).resolve().parents[1] / "web" / "public" / "openapi.json"
MAX_ROWS = 1000
TIMEOUT_S = 3
PK_NOTE = "Note:\nThis is a Primary Key.<pk/>"

DESCRIPTION = f"""API de solo lectura de Pelotheta Θ: las vistas del esquema `api` de Supabase (PostgREST).

- **Autenticación:** la clave publicable de Supabase en la cabecera `apikey` (es pública por diseño; RLS
  impide escribir). Nunca uses la clave secreta en un cliente.
- **Esquema:** todas las consultas llevan `Accept-Profile: api`.
- **Límites:** hasta {MAX_ROWS} filas por pedido (paginá con `limit` y `offset`) y {TIMEOUT_S} s de tiempo
  máximo por consulta.
- **Filtros:** cada columna admite los operadores de PostgREST, por ejemplo `?goals_for=gte.2` o
  `?competition_code=eq.copa_argentina`; `select` elige columnas y `order` ordena (`order=match_date.desc`).
- **Sin escrituras:** la clave pública no tiene permiso de escritura en ninguna vista; `POST`, `PATCH` y
  `DELETE` responden con error (403, o 500 cuando PostgreSQL rechaza la vista antes de mirar permisos)."""


def _schema(prop: dict[str, Any]) -> dict[str, Any]:
    out: dict[str, Any] = {}
    if "type" in prop:
        out["type"] = prop["type"]
    if prop.get("format") and prop.get("type") != "array":
        out["format"] = prop["format"]
    if "items" in prop:
        out["items"] = _schema(prop["items"])
    if "enum" in prop:
        out["enum"] = prop["enum"]
    description = (prop.get("description") or "").replace(PK_NOTE, "Clave primaria.").strip()
    if description:
        out["description"] = description
    return out


def convert(spec: dict[str, Any], server: str) -> dict[str, Any]:
    """Swagger 2.0 de PostgREST → OpenAPI 3.1 con solo los `GET`."""
    shared = {
        "select": {"description": "Columnas separadas por coma.", "example": "match_id,opponent"},
        "order": {"description": "Columna y sentido.", "example": "match_date.desc"},
        "limit": {"description": f"Filas a devolver (máximo {MAX_ROWS}).", "example": 50},
        "offset": {"description": "Filas a saltear, para paginar.", "example": 0},
    }
    components_params = {
        name: {
            "name": name,
            "in": "query",
            "required": False,
            "description": d["description"],
            "schema": {"type": "integer" if name in ("limit", "offset") else "string"},
            "example": d["example"],
        }
        for name, d in shared.items()
    }
    paths: dict[str, Any] = {}
    for path, item in sorted(spec["paths"].items()):
        get = item.get("get")
        if path == "/" or not get:
            continue
        name = path.removeprefix("/")
        if name.startswith("rpc/"):
            fn = name.removeprefix("rpc/")
            paths[path] = {
                "get": {
                    "operationId": fn,
                    "summary": spec.get("definitions", {}).get(fn, {}).get("description") or f"Función {fn}",
                    "tags": ["Funciones"],
                    "parameters": [
                        {
                            "name": p["name"],
                            "in": "query",
                            "required": p.get("required", False),
                            "schema": _schema(p),
                        }
                        for p in get.get("parameters", [])
                        if "name" in p
                    ],
                    "responses": {"200": {"description": "Filas que devuelve la función."}},
                }
            }
            continue
        definition = spec["definitions"].get(name, {})
        filters = [
            {
                "name": column,
                "in": "query",
                "required": False,
                "description": "Filtro de PostgREST (por ejemplo `eq.5`, `gte.2`, `in.(1,2)`).",
                "schema": {"type": "string"},
            }
            for column in definition.get("properties", {})
        ]
        paths[path] = {
            "get": {
                "operationId": name,
                "summary": definition.get("description") or name,
                "tags": ["Vistas"],
                "parameters": [{"$ref": f"#/components/parameters/{p}"} for p in shared] + filters,
                "responses": {
                    "200": {
                        "description": "Filas de la vista.",
                        "content": {
                            "application/json": {
                                "schema": {"type": "array", "items": {"$ref": f"#/components/schemas/{name}"}}
                            }
                        },
                    }
                },
            }
        }
    schemas = {
        name: {
            "type": "object",
            **({"description": d["description"]} if d.get("description") else {}),
            "properties": {k: _schema(v) for k, v in d.get("properties", {}).items()},
        }
        for name, d in sorted(spec.get("definitions", {}).items())
        if f"/{name}" in paths
    }
    return {
        "openapi": "3.1.0",
        "info": {
            "title": "Pelotheta Θ · API de solo lectura",
            "version": datetime.now(UTC).strftime("%Y.%m.%d"),
            "description": DESCRIPTION,
            "license": {
                "name": "Datos de terceros: ver /privacidad",
                "url": "https://pelotheta-futbol.vercel.app/privacidad",
            },
        },
        "servers": [{"url": f"{server.rstrip('/')}/rest/v1"}],
        "security": [{"apikey": []}],
        "tags": [
            {"name": "Vistas", "description": "Una vista por tabla publicada."},
            {"name": "Funciones", "description": "Estadística desglosada (9.8): serie y ventanas."},
        ],
        "paths": paths,
        "components": {
            "securitySchemes": {
                "apikey": {
                    "type": "apiKey",
                    "in": "header",
                    "name": "apikey",
                    "description": "Clave publicable.",
                }
            },
            "parameters": components_params,
            "schemas": schemas,
        },
    }


def main() -> int:
    from pipeline.run import load_dotenv, secret_key

    load_dotenv()
    url, key = os.environ.get("SUPABASE_URL", "").strip(), secret_key()
    if not (url and key):
        print("Faltan SUPABASE_URL o la clave secreta.", file=sys.stderr)
        return 2
    response = httpx.get(
        f"{url.rstrip('/')}/rest/v1/",
        headers={"apikey": key, "Authorization": f"Bearer {key}", "Accept-Profile": "api"},
        timeout=30,
    )
    response.raise_for_status()
    doc = convert(response.json(), url)
    OUT.write_text(json.dumps(doc, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print(f"{OUT.name}: {len(doc['paths'])} rutas, {OUT.stat().st_size // 1024} KB")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
