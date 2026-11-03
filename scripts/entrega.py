"""PDF único de entrega (sección 15): arma docs/entrega/documentacion.html con toda la documentación.

Portada «Pelotheta Θ», índice y un capítulo por documento, en Montserrat. Los bloques Mermaid de
`docs/diagramas/` y del Gantt se reemplazan por los SVG que exporta mermaid-cli (`<archivo>-<n>.svg`).
El PDF lo imprime Chromium: `just docs` corre esto y después `web/scripts/pdf.ts`.
"""

from __future__ import annotations

import html
import os
import re
from pathlib import Path

import mistune

ROOT = Path(__file__).resolve().parents[1]
DOCS = ROOT / "docs"
OUT = DOCS / "entrega" / "documentacion.html"
SVG = DOCS / "diagramas" / "svg"
NL = chr(10)

CHAPTERS = [
    "README.md",
    "docs/producto/vision.md",
    "docs/requisitos.md",
    "docs/casos_de_uso.md",
    "docs/diagramas/arquitectura.md",
    "docs/diagramas/der.md",
    "docs/diagramas/flujos.md",
    "docs/diagramas/secuencias.md",
    "docs/diccionario_datos.md",
    "docs/catalogo_estadisticas.md",
    "docs/metricas_propias.md",
    "docs/model_cards/elo.md",
    "docs/model_cards/pitagorico_xpts.md",
    "docs/model_cards/mejoria_potencial.md",
    "docs/model_cards/resultado_partido.md",
    "docs/source_audit.md",
    "docs/manual_usuario.md",
    "docs/manual_tecnico.md",
    "docs/powerbi_guia.md",
    "docs/slo.md",
    "docs/recuperacion.md",
    "docs/security/threat_model.md",
    "docs/security/incident_response.md",
    "docs/pruebas/estrategia.md",
    "docs/pruebas/plan_de_pruebas.md",
    "docs/gestion/gantt.md",
    "docs/gestion/informe_cierre.md",
    "docs/portfolio/caso_de_estudio.md",
    "docs/portfolio/guia_entrevista.md",
    "docs/portfolio/puestos.md",
    "docs/glosario.md",
    *sorted(str(p.relative_to(ROOT)).replace(chr(92), "/") for p in (DOCS / "adr").glob("*.md")),
]

MERMAID = re.compile(r"```mermaid\n.*?```", re.S)
SRC = re.compile(r'src="(?!https?:|data:|file:)([^"]+)"')
CSS = """
@page { size: A4; margin: 18mm 16mm 20mm; }
body { font-family: Montserrat, sans-serif; font-size: 10pt; line-height: 1.45; color: #111; }
h1 { color: #103f79; break-before: page; font-size: 20pt; }
h2 { color: #103f79; font-size: 14pt; } h3 { font-size: 11.5pt; }
table { border-collapse: collapse; width: 100%; font-size: 8.5pt; margin: 8px 0; }
th, td { border: 1px solid #ccc; padding: 3px 5px; text-align: left; vertical-align: top; }
th { background: #eef2f8; } tr { break-inside: avoid; }
code, pre { font-family: Consolas, monospace; font-size: 8.5pt; }
pre { background: #f5f5f5; padding: 6px; white-space: pre-wrap; }
img { max-width: 100%; } a { color: #103f79; }
.cover { height: 250mm; display: flex; flex-direction: column; justify-content: center; text-align: center; }
.cover h1 { break-before: auto; font-size: 44pt; margin: 0; }
.cover p { font-size: 14pt; color: #555; }
.toc { break-before: page; } .toc h1 { break-before: auto; }
.toc ol { columns: 2; font-size: 10pt; }
"""


def chapter(rel: str, md: mistune.Markdown) -> str:
    path = ROOT / rel
    text = path.read_text(encoding="utf-8").replace("\r\n", NL)
    if path.parent.name == "diagramas" or path.name == "gantt.md":
        blocks = iter(range(1, 100))
        # Ruta relativa: mistune descarta las file:; SRC la vuelve absoluta después.
        rel_svg = Path(os.path.relpath(SVG, path.parent)).as_posix()
        svg = lambda _: f"![Diagrama]({rel_svg}/{path.stem}-{next(blocks)}.svg)"  # noqa: E731
        text = MERMAID.sub(svg, text)
    # Las insignias de Actions no cargan fuera de GitHub con el repositorio privado.
    text = re.sub(r"^\[!\[.*?\]\(https://github\.com/.*$", "", text, flags=re.M)
    body = str(md(text))
    return SRC.sub(lambda m: f'src="{(path.parent / m.group(1)).resolve().as_uri()}"', body)


def build() -> str:
    md = mistune.create_markdown(plugins=["table", "strikethrough"])
    parts, toc = [], []
    for i, rel in enumerate(CHAPTERS, 1):
        body = chapter(rel, md)
        # Cada documento abre con su h1: se le pone el ancla del índice.
        body = body.replace("<h1>", f'<h1 id="c{i}">', 1)
        title = re.search(r"<h1[^>]*>(.*?)</h1>", body, re.S)
        toc.append(f'<li><a href="#c{i}">{title.group(1) if title else html.escape(rel)}</a></li>')
        parts.append(body)
    return NL.join([
        "<!doctype html><html lang='es'><head><meta charset='utf-8'>",
        "<link href='https://fonts.googleapis.com/css2?family=Montserrat:wght@400;600;700&display=swap'",
        " rel='stylesheet'>",
        f"<title>Pelotheta Θ: documentación</title><style>{CSS}</style></head><body>",
        "<section class='cover'><h1>Pelotheta Θ</h1><p>Documentación del sistema</p>",
        "<p>Boca Juniors, temporada 2026 · v1.0.0</p></section>",
        f"<section class='toc'><h1>Índice</h1><ol>{''.join(toc)}</ol></section>",
        *parts,
        "</body></html>",
    ])


def main() -> None:
    missing = [rel for rel in CHAPTERS if not (ROOT / rel).exists()]
    if missing:
        raise SystemExit(f"Faltan documentos: {missing}")
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(build(), encoding="utf-8")
    print(f"{len(CHAPTERS)} documentos en {OUT}")


if __name__ == "__main__":
    main()
