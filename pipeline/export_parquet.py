"""Exportador a Parquet de la capa fría (etapa 3 de docs/plan-escala-conmebol.md).

Lee las vistas `api` (lo mismo que ya muestra la web), las parte por país, equipo o liga y
temporada, y escribe Parquet con zstd más un `manifest.json` con versión, filas, hash y licencia
de cada archivo. Separa lo publicable de lo que no se puede redistribuir:

- `publico/`: tablas de licencia abierta y filas de fuentes que permiten compartir con atribución.
- `privado/`: el resto (estadísticas crudas de fuentes que prohíben redistribuirlas). Nunca va a
  un repositorio público; `push` lo sube solo a un dataset privado.

Formato versionado: cada Parquet lleva `schema_version` en sus metadatos. Si cambia una columna,
sube SCHEMA_VERSION y se anota la migración en docs/formato-parquet.md.

Uso:
    uv run python -m pipeline.export_parquet --out <carpeta>          # solo escribe
    uv run python -m pipeline.export_parquet --out <carpeta> --push   # y sube a Hugging Face
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
from collections import defaultdict
from collections.abc import Callable, Iterable
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import httpx
import pyarrow as pa
import pyarrow.parquet as pq

SCHEMA_VERSION = 1
TIMEOUT = 60
PAGE = 1000

# Fuentes cuyas filas se pueden redistribuir (con la atribución del manifiesto).
OPEN_SOURCES = {
    "promiedos": "Promiedos (promiedos.com.ar): «puede ser compartida libremente … "
    "siempre y cuando sea citada su fuente»",
    "transfermarkt_datasets": "transfermarkt-datasets (CC0)",
    "wikipedia": "Wikipedia (CC BY-SA 4.0)",
    "wikidata": "Wikidata (CC0)",
    "openfootball": "OpenFootball (CC0)",
    "pelotheta": "Cálculo propio de Pelotheta Θ",
}

# shortcut: hoy solo hay datos de Boca y de la Liga Profesional; en la etapa 5 salen de api.team_identity.
COUNTRY, FOCUS_TEAM, FOCUS_LEAGUE = "ARG", "arg-boca-juniors", "arg-liga-profesional-argentina"


@dataclass(frozen=True)
class Table:
    view: str
    scope: str  # "equipo", "liga" o "referencia"
    license: str  # "abierta" o "restringida"
    note: str
    sources: tuple[str, ...] = ("pelotheta",)  # origen cuando la vista no trae columna `source`
    row_source: bool = True  # False si `source` describe el dato y no de dónde salió la fila


TABLES = [
    Table("boca_match", "equipo", "abierta", "Resultados de Promiedos", ("promiedos",)),
    Table("match_lineup", "equipo", "abierta", "Alineaciones de Promiedos", ("promiedos",)),
    Table("boca_formation", "equipo", "abierta", "Formaciones por fuente"),
    Table("boca_absence", "equipo", "abierta", "Bajas de Promiedos"),
    Table("player_summary", "equipo", "abierta", "Minutos, goles y tarjetas desde Promiedos", ("promiedos",)),
    Table("situational_match", "equipo", "abierta", "Situaciones: cálculo propio sobre resultados"),
    Table("situational_result", "equipo", "abierta", "Situaciones: cálculo propio sobre resultados"),
    Table("player_alternative", "equipo", "abierta", "Alternativas: salida de modelo propio"),
    Table("match_prediction", "equipo", "abierta", "Predictor: salida de modelo propio"),
    Table("team_strength", "liga", "abierta", "Fuerza de equipos: parámetros de modelo propio"),
    Table("league_result", "liga", "abierta", "Resultados de liga (filas por fuente)"),
    Table("league_standing", "liga", "abierta", "Tablas (filas por fuente)"),
    Table("league_leader", "liga", "abierta", "Goleadores y líderes (filas por fuente)"),
    Table("club_rating", "liga", "abierta", "Elo (filas por fuente)"),
    Table("coverage", "referencia", "abierta", "Cobertura por época: cálculo propio"),
    Table("team_identity", "referencia", "abierta", "Ids estables y alias: propio"),
    Table("stat_catalog", "referencia", "abierta", "Catálogo de estadísticas: propio", row_source=False),
    # Estadísticas crudas o casi crudas de fuentes que prohíben redistribuirlas como dataset.
    Table(
        "player_match_value",
        "equipo",
        "restringida",
        "Stats por jugador",
        ("bzzoiro", "statshub", "scoutingstats"),
    ),
    Table("team_match_value", "equipo", "restringida", "Stats de equipo", ("scoutingstats",)),
    Table("stat_match_value", "equipo", "restringida", "Valores por partido derivados 1 a 1 del crudo"),
    Table("boca_shot", "equipo", "restringida", "Tiros con coordenadas (StrikerAPI)"),
    Table("boca_momentum", "equipo", "restringida", "Momentum (ScoutingStats)"),
    Table("player_pool", "liga", "restringida", "Mercado: valores CC0 con stats de fuentes cerradas"),
    Table("player_style", "equipo", "restringida", "Estilos: incluye features crudas por 90"),
    Table("market_value_prediction", "equipo", "restringida", "Valor: incluye features crudas"),
    Table("club_season_stat", "liga", "restringida", "Promedios de clubes (StrikerAPI)"),
]
BY_VIEW = {t.view: t for t in TABLES}

Fetch = Callable[[str], list[dict[str, Any]]]


def fetch_view(url: str, key: str, client: httpx.Client, view: str) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    while True:
        response = client.get(
            f"{url.rstrip('/')}/rest/v1/{view}",
            params={"select": "*", "limit": str(PAGE), "offset": str(len(rows))},
            headers={"apikey": key, "Authorization": f"Bearer {key}", "Accept-Profile": "api"},
        )
        response.raise_for_status()
        page = response.json()
        rows.extend(page)
        if len(page) < PAGE:
            return rows


def year_of(row: dict[str, Any], match_years: dict[Any, int]) -> int | None:
    for col in ("season_year", "season"):
        value = row.get(col)
        if value not in (None, "") and str(value)[:4].isdigit():
            return int(str(value)[:4])
    if row.get("match_id") in match_years:
        return match_years[row["match_id"]]
    for col in ("match_date", "as_of"):
        if row.get(col):
            return int(str(row[col])[:4])
    return None


def partition(table: Table, year: int | None) -> str:
    if table.scope == "referencia":
        return "referencia"
    owner = f"equipo={FOCUS_TEAM}" if table.scope == "equipo" else f"liga={FOCUS_LEAGUE}"
    return f"pais={COUNTRY}/{owner}/temporada={year if year is not None else 'sin-fecha'}"


def is_open(table: Table, row: dict[str, Any]) -> bool:
    """Una fila es publicable si su tabla es abierta y, si trae fuente, la fuente lo permite."""
    if table.license != "abierta":
        return False
    source = row.get("source") if table.row_source else None
    return source is None or source in OPEN_SOURCES


def to_table(rows: list[dict[str, Any]]) -> pa.Table:
    # Los jsonb (stats, features…) van como texto JSON: esquema estable aunque cambien sus claves.
    flat = [
        {k: json.dumps(v, ensure_ascii=False) if isinstance(v, (dict, list)) else v for k, v in r.items()}
        for r in rows
    ]
    return pa.Table.from_pylist(flat)


def write_file(path: Path, rows: list[dict[str, Any]], table: Table, visibility: str) -> dict[str, Any]:
    data = to_table(rows)
    from_rows = {str(r["source"]) for r in rows if r.get("source")} if table.row_source else set()
    sources = sorted(from_rows) or list(table.sources)
    data = data.replace_schema_metadata(
        {
            "schema_version": str(SCHEMA_VERSION),
            "tabla": table.view,
            "licencia": table.license if visibility == "publico" else "restringida",
            "fuentes": ",".join(sources),
        }
    )
    path.parent.mkdir(parents=True, exist_ok=True)
    pq.write_table(data, path, compression="zstd", compression_level=9)
    body = path.read_bytes()
    return {
        "tabla": table.view,
        "filas": len(rows),
        "bytes": len(body),
        "sha256": hashlib.sha256(body).hexdigest(),
        "licencia": table.license if visibility == "publico" else "restringida",
        "fuentes": sources,
        "atribucion": [OPEN_SOURCES[s] for s in sources if s in OPEN_SOURCES],
        "nota": table.note,
    }


def export(fetch: Fetch, out: Path, views: Iterable[str] | None = None) -> dict[str, dict[str, Any]]:
    """Escribe `out/publico` y `out/privado`; devuelve el manifiesto de cada uno."""
    chosen = [BY_VIEW[v] for v in views] if views else TABLES
    cache: dict[str, list[dict[str, Any]]] = {}

    def rows_of(view: str) -> list[dict[str, Any]]:
        if view not in cache:
            cache[view] = fetch(view)
        return cache[view]

    match_years = {
        r["match_id"]: int(str(r["match_date"])[:4]) for r in rows_of("boca_match") if r.get("match_date")
    }
    # shortcut: lo que no trae fecha (agregados de la temporada) va a la temporada en curso;
    # en la etapa 5 cada agregado se calcula y se guarda con su temporada.
    current = max(match_years.values(), default=None)
    manifests: dict[str, dict[str, Any]] = {}
    files: dict[str, list[dict[str, Any]]] = {"publico": [], "privado": []}
    for table in chosen:
        groups: dict[tuple[str, str], list[dict[str, Any]]] = defaultdict(list)
        for row in rows_of(table.view):
            visibility = "publico" if is_open(table, row) else "privado"
            year = year_of(row, match_years)
            groups[(visibility, partition(table, current if year is None else year))].append(row)
        for (visibility, part), rows in sorted(groups.items()):
            rel = f"{part}/{table.view}.parquet"
            entry = write_file(out / visibility / rel, rows, table, visibility)
            files[visibility].append({"ruta": rel, **entry})
    now = datetime.now(UTC).isoformat(timespec="seconds")
    for visibility, entries in files.items():
        manifest = {
            "schema_version": SCHEMA_VERSION,
            "generado": now,
            "visibilidad": visibility,
            "archivos": entries,
        }
        (out / visibility).mkdir(parents=True, exist_ok=True)
        (out / visibility / "manifest.json").write_text(
            json.dumps(manifest, ensure_ascii=False, indent=2), "utf-8"
        )
        manifests[visibility] = manifest
    (out / "publico" / "README.md").write_text(dataset_card(manifests["publico"]), "utf-8")
    return manifests


def dataset_card(manifest: dict[str, Any]) -> str:
    """Tarjeta del dataset (Hugging Face la exige): licencia, atribuciones y formato."""
    credits = sorted({a for f in manifest["archivos"] for a in f["atribucion"]})
    return "\n".join(
        [
            "---",
            "license: other",
            "license_name: mixta-con-atribucion",
            "language: [es]",
            "tags: [football, soccer, conmebol, parquet]",
            "---",
            "",
            "# Pelotheta Θ: archivo de fútbol de la Conmebol",
            "",
            f"Formato Parquet (zstd), `schema_version` {manifest['schema_version']}, particionado "
            "`pais=/equipo=|liga=/temporada=/tabla.parquet`. `manifest.json` lista cada archivo con filas, "
            "hash SHA-256, licencia y fuentes.",
            "",
            "Los datos faltantes son `null`, nunca `0`: la tabla `referencia/coverage.parquet` dice qué hay "
            "en cada competición y temporada.",
            "",
            "## Fuentes y atribución",
            "",
            *[f"- {c}" for c in credits],
            "",
            "Las estadísticas de fuentes que no permiten redistribuir sus datos no están en este dataset.",
            "",
        ]
    )


def push(out: Path, public_repo: str, private_repo: str | None, token: str) -> None:
    from huggingface_hub import HfApi

    api = HfApi(token=token)
    api.upload_folder(
        repo_id=public_repo,
        repo_type="dataset",
        folder_path=out / "publico",
        commit_message=f"Exportación schema_version {SCHEMA_VERSION}",
    )
    if private_repo:
        if not api.repo_info(private_repo, repo_type="dataset").private:
            raise SystemExit(f"{private_repo} no es privado: no se sube el crudo restringido")
        api.upload_folder(
            repo_id=private_repo,
            repo_type="dataset",
            folder_path=out / "privado",
            commit_message=f"Exportación schema_version {SCHEMA_VERSION}",
        )


def main(argv: list[str] | None = None) -> int:
    from pipeline.run import load_dotenv, secret_key

    parser = argparse.ArgumentParser(description="Exporta las vistas api a Parquet")
    parser.add_argument("--out", required=True, help="carpeta temporal de salida")
    parser.add_argument(
        "--push", action="store_true", help="subir a Hugging Face (HF_TOKEN, HF_DATASET_REPO)"
    )
    args = parser.parse_args(argv)
    load_dotenv()
    url, key = os.environ.get("SUPABASE_URL", "").strip(), secret_key()
    if not (url and key):
        print("Faltan SUPABASE_URL o la clave secreta.", file=sys.stderr)
        return 2
    out = Path(args.out)
    with httpx.Client(timeout=TIMEOUT) as client:
        manifests = export(lambda view: fetch_view(url, key, client, view), out)
    for visibility, manifest in manifests.items():
        total = sum(f["bytes"] for f in manifest["archivos"])
        print(f"{visibility}: {len(manifest['archivos'])} archivos, {total / 1024:.0f} KB")
    if args.push:
        token, repo = os.environ.get("HF_TOKEN", ""), os.environ.get("HF_DATASET_REPO", "")
        if not (token and repo):
            print("Faltan HF_TOKEN o HF_DATASET_REPO.", file=sys.stderr)
            return 2
        push(out, repo, os.environ.get("HF_PRIVATE_DATASET_REPO") or None, token)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
