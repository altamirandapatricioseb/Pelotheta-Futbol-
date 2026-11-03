"""Matriz de casos de prueba (sección 15) con los resultados reales de la última corrida.

Lee los reportes JUnit de pytest, Vitest y Playwright y escribe docs/pruebas/matriz_casos_prueba.csv y
.xlsx (con los estilos de la sección 10, vía pipeline.excel.Book). Cada fila es un caso automatizado; el
requisito sale de la matriz de trazabilidad de docs/requisitos.md según el archivo de la prueba.

    uv run pytest --junitxml=$TEMP/junit/pytest.xml
    pnpm exec vitest run --reporter=junit --outputFile=$TEMP/junit/vitest.xml       (en web/)
    PLAYWRIGHT_JUNIT_OUTPUT_NAME=$TEMP/junit/playwright.xml pnpm exec playwright test --reporter=junit
    uv run python -m scripts.matriz_pruebas $TEMP/junit
"""

from __future__ import annotations

import csv
import os
import sys
import xml.etree.ElementTree as ET
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "docs" / "pruebas" / "matriz_casos_prueba"
HEAD = [
    "ID", "Requisito", "Módulo", "Tipo", "Precondiciones", "Pasos", "Datos", "Resultado esperado",
    "Resultado obtenido", "Estado", "Prioridad", "Severidad si falla", "Automatizado", "Ruta del test",
    "Fecha", "Versión",
]  # fmt: skip
# Archivo de prueba (fragmento) -> requisito, módulo, tipo, prioridad. El primero que coincide gana.
RULES = [
    ("test_rls", "RNF01", "Base de datos", "seguridad", "Alta"),
    ("security.spec", "RNF02, RNF03", "Web", "seguridad", "Alta"),
    ("csp.test", "RNF02", "Web", "seguridad", "Alta"),
    ("blocklist", "RNF03", "Web", "seguridad", "Media"),
    ("a11y.spec", "RNF04, RNF08", "Web", "accesibilidad", "Alta"),
    ("visual.spec", "RF01", "Web", "regresión visual", "Media"),
    ("test_backup", "RNF10", "Operación", "integración", "Alta"),
    ("test_contracts", "RNF09", "Datos", "integración", "Alta"),
    ("test_excel", "RF06", "Excel", "unitaria", "Media"),
    ("xlsx.test", "RF06", "Web", "unitaria", "Media"),
    ("test_powerbi", "RF07", "Power BI", "unitaria", "Media"),
    ("test_openapi", "RF07", "API", "unitaria", "Media"),
    ("test_projection", "RF11", "Métricas propias", "unitaria", "Alta"),
    ("test_own_metrics", "RF11", "Métricas propias", "unitaria", "Alta"),
    ("test_metrics", "RF01", "Métricas", "unitaria", "Alta"),
    ("test_situational", "RF04", "Situaciones", "unitaria", "Media"),
    ("board.test", "RF04", "Web", "unitaria", "Media"),
    ("compare", "RF05", "Web", "unitaria", "Media"),
    ("breakdown", "RF05", "Web", "unitaria", "Media"),
    ("detail.test", "RF03", "Web", "unitaria", "Media"),
    ("sort.test", "RF02", "Web", "unitaria", "Media"),
    ("stats/", "RF02", "Web", "unitaria", "Media"),
    ("state.test", "RF08", "Web", "unitaria", "Media"),
    ("test_chart_catalog", "RF01", "Catálogo", "unitaria", "Media"),
    ("transform.test", "RF01", "Web", "unitaria", "Media"),
    ("test_pipeline", "RF09", "Pipeline", "integración", "Alta"),
    ("test_", "RF09", "Fuentes", "unitaria", "Media"),
    ("", "—", "Web", "unitaria", "Baja"),
]


def classify(path: str) -> tuple[str, str, str, str]:
    return next((req, mod, kind, prio) for frag, req, mod, kind, prio in RULES if frag in path)


def cases(report: Path, prefix: str) -> list[tuple[str, str, str]]:
    """(ruta del test, nombre, estado) de cada caso de un reporte JUnit."""
    out = []
    for case in ET.parse(report).getroot().iter("testcase"):  # noqa: S314
        where = case.get("file") or case.get("classname") or ""
        if prefix == "pytest":
            where = where.replace(".", "/") + ".py"
        state = (
            "omitido"
            if case.find("skipped") is not None
            else "falla"
            if case.find("failure") is not None or case.find("error") is not None
            else "pasa"
        )
        out.append((where, case.get("name") or "", state))
    return out


def rows(junit_dir: Path) -> list[list[str]]:
    version = os.environ.get("GITHUB_SHA", "")[:7] or "local"
    today = date.today().isoformat()
    result = []
    for name in ("pytest", "vitest", "playwright"):
        report = junit_dir / f"{name}.xml"
        if not report.exists():
            continue
        for where, test, state in cases(report, name):
            req, mod, kind, prio = classify(where)
            result.append(
                [
                    f"CP-{len(result) + 1:04d}", req, mod, kind, "Entorno de la corrida (local o CI)", test,
                    "Fixtures del test o datos reales", "La aserción se cumple", state, state,
                    prio, "Alta" if prio == "Alta" else "Media", "sí", where, today, version,
                ]
            )  # fmt: skip
    return result


def main(argv: list[str] | None = None) -> int:
    args = argv if argv is not None else sys.argv[1:]
    data = rows(Path(args[0]) if args else ROOT / "junit")
    OUT.parent.mkdir(parents=True, exist_ok=True)
    with OUT.with_suffix(".csv").open("w", encoding="utf-8-sig", newline="") as handle:
        csv.writer(handle).writerows([HEAD, *data])
    from pipeline.excel import Book

    book = Book("Matriz de casos de prueba", "Pruebas automatizadas", date.today().isoformat())
    ws = book.sheet("Matriz", "Casos de prueba con el resultado de la última corrida")
    start = book.header(ws, "Matriz de casos de prueba", "reportes JUnit de pytest, Vitest y Playwright")
    book.table(ws, start, HEAD, data, widths=[10, 12, 16, 16, 22, 50, 22, 20, 12, 10, 10, 12, 10, 50, 11, 9])
    OUT.with_suffix(".xlsx").write_bytes(book.finish())
    passed = sum(r[9] == "pasa" for r in data)
    print(f"{len(data)} casos: {passed} pasan, {sum(r[9] == 'falla' for r in data)} fallan")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
