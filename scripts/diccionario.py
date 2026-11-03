"""Diccionario de datos (sección 15): genera docs/diccionario_datos.md.

Fuentes: la especificación de la API (`web/public/openapi.json`, que PostgREST arma desde
`information_schema` y los `COMMENT ON` de la base) para cada vista y columna, y el catálogo de
estadísticas (`data/stat_catalog.csv`) para la fuente y el nivel A, B o C de cada estadística.
No necesita la contraseña de la base: se regenera con `uv run python -m scripts.diccionario` después de
`just openapi`.
"""

from __future__ import annotations

import csv
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "docs" / "diccionario_datos.md"
NULLABLE_NOTE = "Las vistas no declaran nulabilidad: toda columna puede venir vacía (n/d)."


def build(spec: dict, catalog: list[dict[str, str]]) -> str:
    schemas = spec["components"]["schemas"]
    lines = [
        "# Diccionario de datos",
        "",
        "Generado por `scripts/diccionario.py` desde la especificación de la API y el catálogo",
        "de estadísticas.",
        f"{len(schemas)} vistas del esquema `api` y {len(catalog)} estadísticas. {NULLABLE_NOTE} Las tablas",
        "privadas de `core` están en `docs/diagramas/der.md` y sus reglas en `data/contracts.yml`.",
        "",
        "## Vistas del esquema `api`",
        "",
    ]
    for name, schema in sorted(schemas.items()):
        lines += [f"### `{name}`", "", schema.get("description") or "Sin descripción.", ""]
        lines += ["| Columna | Tipo | Nota |", "|---|---|---|"]
        for column, prop in schema["properties"].items():
            kind = prop.get("format") or prop.get("type") or "—"
            note = (prop.get("description") or "").replace("|", "/").replace("\n", " ")
            lines.append(f"| `{column}` | {kind} | {note} |")
        lines.append("")
    lines += [
        "## Estadísticas del catálogo",
        "",
        "Nivel A: viene de una fuente. B: calculada desde datos crudos. C: sin dato (n/d). «Estimada»: el",
        "cálculo usa un supuesto y la web lo marca.",
        "",
        "| Id | Entidad | Nombre | Unidad | Fuente | Nivel | Estimada | Fórmula |",
        "|---|---|---|---|---|---|---|---|",
    ]
    for s in catalog:
        formula = (s.get("formula") or "").replace("|", "/")
        lines.append(
            f"| `{s['id']}` | {s['entidad']} | {s['nombre_es']} | {s.get('unidad', '')} "
            f"| {s.get('fuente', '')} | {s.get('nivel', '')} "
            f"| {'sí' if s.get('estimada') == 'true' else 'no'} | {formula} |"
        )
    return "\n".join(lines) + "\n"


def main() -> int:
    spec = json.loads((ROOT / "web" / "public" / "openapi.json").read_text(encoding="utf-8"))
    with (ROOT / "data" / "stat_catalog.csv").open(encoding="utf-8") as handle:
        catalog = list(csv.DictReader(handle))
    OUT.write_text(build(spec, catalog), encoding="utf-8")
    print(f"{OUT.name}: {len(spec['components']['schemas'])} vistas, {len(catalog)} estadísticas")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
