"""Genera docs/catalogo_estadisticas.md desde data/stat_catalog.csv (sección 5.6).

Uso: uv run python -m scripts.catalog_doc
"""

from __future__ import annotations

from collections import Counter

from pipeline import catalog

# Estadísticas de nivel A que se podrían calcular desde datos más básicos (regla 8 del prompt).
# Las demás son conteos propios del proveedor (necesitan eventos con coordenadas que ninguna
# fuente gratuita permitida publica) y no tienen reemplazo.
DERIVABLE = {
    "remates": "Parcial: contar los tiros ubicados de StrikerAPI (solo liga); los tiros validan a la fuente.",
    "remates_arco": "Parcial: tiros ubicados con resultado gol o atajado (solo liga).",
    "goles_cabeza": "Sí, desde los tiros ubicados (parte del cuerpo); es lo que hace la vista por partido.",
    "goles_fuera_area": "Sí, desde los tiros ubicados (zona); es lo que hace la vista por partido.",
    "remates_cabeza": "Sí, desde los tiros ubicados.",
    "remates_fuera_area": "Sí, desde los tiros ubicados.",
    "eq_remates": "Parcial: suma de los remates de los jugadores (ScoutingStats); valida al de Promiedos.",
    "eq_goles_penal": "Sí, desde los eventos de penal convertido de Promiedos (todas las competiciones).",
    "eq_posicion": "Sí, desde los resultados de toda la liga; la fuente queda como validación.",
    "altura": "No: dato de la ficha.",
    "peso": "No: dato de la ficha.",
    "pie": "No: dato de la ficha.",
    "nacionalidad": "No: dato de la ficha.",
    "posicion": "No: dato del plantel.",
}


def main() -> None:
    stats = catalog.load_catalog()
    levels = Counter((s.entidad, s.nivel) for s in stats)
    lines = [
        "# Catálogo de estadísticas",
        "",
        "Generado desde `data/stat_catalog.csv` con `uv run python -m scripts.catalog_doc`.",
        "El CSV es la fuente de verdad: la web y las vistas SQL leen de él la descripción, el nivel",
        "y la regla de cálculo.",
        "",
        "| Entidad | Nivel A | Nivel B | Nivel C | Total |",
        "|---|---|---|---|---|",
    ]
    for entity in ("jugador", "equipo"):
        a, b, c = (levels[(entity, lvl)] for lvl in "ABC")
        lines.append(f"| {entity} | {a} | {b} | {c} | {a + b + c} |")
    lines += [
        "",
        "Niveles: **A** viene directo de una fuente; **B** se calcula (por 90, porcentajes, rachas,",
        "métricas propias); **C** no tiene fuente gratuita fiable y se muestra `n/d`.",
        "",
        "## Nivel A: ¿se puede calcular desde datos más básicos?",
        "",
        "| Estadística | Fuente | Reemplazo por cálculo |",
        "|---|---|---|",
    ]
    for s in stats:
        if s.nivel == "A":
            note = DERIVABLE.get(
                s.id, "No: conteo propio del proveedor, sin eventos con coordenadas para recalcularlo."
            )
            lines.append(f"| {s.nombre_es} (`{s.id}`) | {s.fuente.replace('|', ', ')} | {note} |")
    lines += ["", "## Nivel C (n/d)", "", "| Estadística | Motivo |", "|---|---|"]
    for s in stats:
        if s.nivel == "C":
            lines.append(f"| {s.nombre_es} (`{s.id}`) | {s.descripcion_es} |")
    (catalog.ROOT / "docs" / "catalogo_estadisticas.md").write_text("\n".join(lines) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
