"""Cobertura del catálogo de estadísticas: crudas, calculables y total compuesto.

Lee data/raw_stat_coverage.csv (estadísticas que hay que traer de una fuente) y
data/derived_stat_coverage.csv (las que se calculan con las crudas). Un dato «parcial» vale la
mitad; «en_fuente» es algo que la fuente publica y todavía no se extrae.

Uso: uv run python scripts/coverage_report.py
"""

from __future__ import annotations

import csv
from collections import Counter
from pathlib import Path

DATA = Path(__file__).resolve().parents[1] / "data"
DONE = {"cargado": 1.0, "calculable": 1.0, "parcial": 0.5}


def load(name: str) -> list[dict[str, str]]:
    with (DATA / name).open(encoding="utf-8") as f:
        return list(csv.DictReader(f))


def score(rows: list[dict[str, str]]) -> float:
    return sum(DONE.get(r["estado"], 0.0) for r in rows)


def pct(part: float, total: int) -> str:
    return f"{100 * part / total:.1f} %" if total else "n/d"


def main() -> None:
    raw, derived = load("raw_stat_coverage.csv"), load("derived_stat_coverage.csv")
    original = [r for r in raw if not r["id"].startswith("n")]
    print("Crudas (inventario original):", pct(score(original), len(original)), f"de {len(original)}")
    print("Crudas (con las nuevas):     ", pct(score(raw), len(raw)), f"de {len(raw)}")
    print("Estados de las crudas:", dict(Counter(r["estado"] for r in raw)))
    print("Calculables:                 ", pct(score(derived), len(derived)), f"de {len(derived)}")
    total = len(raw) + len(derived)
    print("Total compuesto:             ", pct(score(raw) + score(derived), total), f"de {total}")
    pending = [r for r in raw if r["estado"] == "en_fuente"]
    if pending:
        with_pending = score(raw) + score(derived) + len(pending)
        print("Total si se extrae lo pendiente:", pct(with_pending, total))
    missing = [f"{r['id']} {r['nombre_es']}" for r in raw if r["estado"] == "falta"]
    print("Sin fuente permitida:", ", ".join(missing))


if __name__ == "__main__":
    main()
