"""Utilidades compartidas por las sondas de la Fase 0."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from sources.http_client import ROOT

REPORT_DIR = ROOT / "data" / "raw" / "phase0"


def json_paths(obj: Any, prefix: str = "", max_depth: int = 6) -> list[str]:
    """Lista las rutas de campos de un JSON (por ejemplo `response[].statistics[].goals.total`).

    Sirve para documentar en `docs/source_audit.md` qué campos devuelve de verdad una fuente,
    sin copiar los datos: solo la forma.
    """
    paths: set[str] = set()

    def walk(node: Any, path: str, depth: int) -> None:
        if depth > max_depth:
            return
        if isinstance(node, dict):
            for key, value in node.items():
                child = f"{path}.{key}" if path else str(key)
                paths.add(child)
                walk(value, child, depth + 1)
        elif isinstance(node, list):
            for item in node[:3]:  # con los primeros elementos alcanza para ver la forma
                walk(item, f"{path}[]", depth + 1)

    walk(obj, prefix, 0)
    return sorted(paths)


def write_report(source: str, report: dict[str, Any]) -> Path:
    """Guarda el informe de una sonda en `data/raw/phase0/<fuente>.json` y devuelve la ruta."""
    REPORT_DIR.mkdir(parents=True, exist_ok=True)
    path = REPORT_DIR / f"{source}.json"
    path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    return path
