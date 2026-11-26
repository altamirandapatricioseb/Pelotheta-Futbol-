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
import re
import sys
import unicodedata
from collections import defaultdict
from collections.abc import Callable, Iterable
from dataclasses import dataclass
from datetime import UTC, date, datetime
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
    # Toda la liga desde Bzzoiro (no pasan por Supabase: no entran en 500 MB).
    Table("league_player_match", "liga", "restringida", "Crudo por jugador y partido", ("bzzoiro",)),
    Table("league_player_profile", "liga", "abierta", "Percentiles por posición: cálculo propio"),
    Table("league_fixture", "liga", "abierta", "Próximos partidos de la liga (Promiedos)"),
    Table(
        "league_situation",
        "liga",
        "abierta",
        "Situaciones por club: cálculo propio sobre resultados y minutos de gol",
        ("promiedos", "pelotheta"),
    ),
    Table(
        "league_market_value",
        "liga",
        "abierta",
        "Valor esperado por un modelo propio sobre valores CC0",
        ("transfermarkt_datasets", "pelotheta"),
    ),
    Table("model_run", "liga", "abierta", "Parámetros y métricas de modelos propios", row_source=False),
]
# Tablas que no son vistas de Supabase: las arma `pipeline.league_players` desde Bzzoiro.
LEAGUE_PLAYER_VIEWS = {"league_player_match", "league_player_profile"}
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


def partition(table: Table, year: int | None, row: dict[str, Any] | None = None) -> str:
    """Carpeta de la fila. Las tablas de toda una liga (etapa 5j) traen su país (`country_code`, FIFA)
    y su competición (`competition_uid`) en cada fila; las que no, son de Boca y la Liga Profesional."""
    if table.scope == "referencia":
        return "referencia"
    row = row or {}
    country = row.get("country_code") or COUNTRY
    league = row.get("competition_uid") or FOCUS_LEAGUE
    owner = f"equipo={FOCUS_TEAM}" if table.scope == "equipo" else f"liga={league}"
    return f"pais={country}/{owner}/temporada={year if year is not None else 'sin-fecha'}"


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
            groups[(visibility, partition(table, current if year is None else year, row))].append(row)
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


# Tope de consultas nuevas a Bzzoiro por exportación: la cuota es de 7 500 por día y la corrida diaria
# usa una parte. Una temporada entera de las 13 competiciones son ~6 600; se completa en pocas corridas.
BZZOIRO_BUDGET = 3000


def league_player_rows(season_year: int = 2026) -> dict[str, list[dict[str, Any]]]:
    """Crudo y perfiles de jugadores de todas las competiciones de Bzzoiro en la Conmebol (etapa 5j-2).

    Cada fila lleva su país y su competición: el exportador la guarda en su liga. Los percentiles se
    calculan dentro de cada competición. Vacío (con aviso) sin clave o sin red."""
    from pipeline import league_players as lp
    from sources import bzzoiro as bz

    out: dict[str, list[dict[str, Any]]] = {v: [] for v in LEAGUE_PLAYER_VIEWS}
    key = os.environ.get("BZZOIRO_API_KEY", "")
    if not key:
        print("Aviso: sin BZZOIRO_API_KEY no se exportan los jugadores de las ligas.", file=sys.stderr)
        return out
    client, budget = bz.BzzoiroClient(api_key=key), BZZOIRO_BUDGET
    for uid, league_id in bz.LEAGUES.items():
        report: dict[str, int] = {}
        try:
            raw = lp.collect(client, league_id, season_year, max_new=budget, report=report)
        except bz.BzzoiroError as exc:
            print(f"Aviso: Bzzoiro no respondió en {uid} ({exc}).", file=sys.stderr)
            continue
        budget -= report.get("consultas_nuevas", 0)
        if report.get("pendientes"):
            print(f"{uid}: {report['pendientes']} partidos quedan para la próxima corrida.", file=sys.stderr)
        tag = {"country_code": bz.country_of(uid), "competition_uid": uid}
        out["league_player_match"] += [{**r, **tag} for r in raw]
        out["league_player_profile"] += [{**p, **tag} for p in lp.profiles(raw, season_year)]
    return out


# Tope de páginas nuevas de ScoutingStats por exportación (3 s cada una: ~30 minutos).
SCOUTING_BUDGET = 600


def league_scouting_rows(season_year: int = 2026) -> dict[str, list[dict[str, Any]]]:
    """Crudo y perfiles de las ligas que solo cubre ScoutingStats (etapa 5j-3), con país y liga."""
    from pipeline import league_players as lp
    from pipeline import league_scouting as ls
    from sources import scoutingstats as ss
    from sources.http_client import FetchError, PoliteClient, RetryableFetchError

    out: dict[str, list[dict[str, Any]]] = {v: [] for v in LEAGUE_PLAYER_VIEWS}
    budget = SCOUTING_BUDGET
    with PoliteClient(ss.SOURCE) as client:
        for uid, (path, slug) in ss.LEAGUES.items():
            report: dict[str, int] = {}
            try:
                raw = ls.collect(client, path, slug, season_year, max_new=max(budget, 0), report=report)
            except (FetchError, RetryableFetchError) as exc:
                print(f"Aviso: ScoutingStats no respondió en {uid} ({exc}).", file=sys.stderr)
                continue
            budget -= report.get("consultas_nuevas", 0)
            if report.get("pendientes"):
                print(
                    f"{uid}: {report['pendientes']} partidos quedan para la próxima corrida.", file=sys.stderr
                )
            tag = {"country_code": uid[:3].upper(), "competition_uid": uid}
            # La fuente va en el crudo (restringido); los perfiles son cálculo propio y se publican.
            out["league_player_match"] += [{**r, **tag, "source": ss.SOURCE} for r in raw]
            out["league_player_profile"] += [{**p, **tag} for p in lp.profiles(raw, season_year)]
    return out


# Tope de páginas de partido nuevas de Promiedos por exportación (3 s cada una: ~75 minutos).
PROMIEDOS_BUDGET = 1500


def league_promiedos_rows(season_year: int = 2026) -> dict[str, list[dict[str, Any]]]:
    """Resultados, tablas, líderes, próximos partidos y situaciones de las demás ligas que publica
    Promiedos (etapa 5j-4), con país y liga en cada fila. Una liga que falla no frena a las otras."""
    from pipeline import league_promiedos as lpr
    from sources import promiedos as pd
    from sources.http_client import PoliteClient

    out: dict[str, list[dict[str, Any]]] = {}
    budget = PROMIEDOS_BUDGET
    with PoliteClient(pd.SOURCE) as client:
        for uid, (path, league_id) in lpr.LEAGUES.items():
            report: dict[str, int] = {}
            try:
                tables = lpr.collect(
                    client, path, league_id, season_year, max_new=max(budget, 0), report=report
                )
            except lpr.ERRORS as exc:
                print(f"Aviso: Promiedos no respondió en {uid} ({exc}).", file=sys.stderr)
                continue
            budget -= report.get("consultas_nuevas", 0)
            if report.get("pendientes"):
                print(
                    f"{uid}: {report['pendientes']} partidos quedan para la próxima corrida.", file=sys.stderr
                )
            tag = {"country_code": uid[:3].upper(), "competition_uid": uid}
            for view, rows in tables.items():
                out.setdefault(view, []).extend({**r, **tag} for r in rows)
    return out


def league_wikipedia_rows(season_year: int = 2026) -> dict[str, list[dict[str, Any]]]:
    """Lo que publica Wikipedia de las ligas sin otra fuente abierta, con país y liga en cada fila:
    resultados, tabla calculada y situaciones (Bolivia y Ecuador, 5j-7 y 5j-9) y la tabla oficial
    (Perú, Venezuela y Brasil B, 5j-12). Una liga que falla no frena a las otras."""
    from pipeline import league_wikipedia as lw
    from sources import wikipedia_league as wl
    from sources.http_client import PoliteClient

    out: dict[str, list[dict[str, Any]]] = {}
    with PoliteClient(wl.SOURCE) as client:
        jobs = [(uid, lw.collect) for uid in lw.LEAGUES] + [(uid, lw.collect_tables) for uid in lw.EN_TABLES]
        for uid, collect in jobs:
            try:
                tables = collect(client, uid, season_year)
            except lw.ERRORS as exc:
                print(f"Aviso: Wikipedia no respondió en {uid} ({exc}).", file=sys.stderr)
                continue
            tag = {"country_code": uid[:3].upper(), "competition_uid": uid}
            for view, rows in tables.items():
                out.setdefault(view, []).extend({**r, **tag} for r in rows)
    return out


# Palabras que no distinguen clubes («Club», «Deportes», «FC»…): se comparan las demás.
GENERIC_NAME_WORDS = {
    "club", "ca", "cd", "fc", "sc", "ec", "ac", "cf", "sa", "clube", "de", "da", "do", "del", "la",
    "el", "los", "futbol", "football", "esporte", "sport", "sporting", "deportes", "deportivo",
    "atletico", "athletico", "associacao", "asociacion", "corporacion", "sad",
}  # fmt: skip


def _name_words(name: str) -> tuple[set[str], set[str]]:
    """(palabras que distinguen, todas las palabras) de un nombre de club."""
    plain = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode().lower()
    words = set(re.findall(r"[a-z0-9]+", plain))
    return words - GENERIC_NAME_WORDS, words


def match_club_names(names: Iterable[str], targets: Iterable[str]) -> dict[str, str]:
    """Cada nombre con el club de `targets` que más palabras comparte, de a uno por club
    («Red Bull Bragantino» → «Bragantino», «Colo-Colo» → «Colo Colo»). Sin palabra en común, nada."""
    pairs = []
    for name in set(names):
        for target in set(targets):
            (a, a_all), (b, b_all) = _name_words(name), _name_words(target)
            if not (a and b):  # un nombre hecho solo de palabras genéricas («Sport»): se comparan todas
                a, b = a_all, b_all
            if a & b:
                pairs.append((len(a & b) / len(a | b), name, target))
    out: dict[str, str] = {}
    for _, name, target in sorted(pairs, reverse=True):
        if name not in out and target not in out.values():
            out[name] = target
    return out


def unify_club_names(rows: list[dict[str, Any]], standings: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """El club de cada fila de jugador con el nombre de la tabla de su misma liga (Promiedos o
    Wikipedia), para que la ficha encuentre su plantel. Ligas sin tabla quedan como vienen."""
    targets: dict[Any, set[str]] = defaultdict(set)
    for r in standings:
        targets[r.get("competition_uid")].add(r["team_name"])
    names: dict[Any, set[str]] = defaultdict(set)
    for r in rows:
        if r.get("team_name"):
            names[r.get("competition_uid")].add(r["team_name"])
    alias = {
        (uid, name): target
        for uid, own in names.items()
        if uid in targets
        for name, target in match_club_names(own, targets[uid]).items()
    }
    return [
        {**r, "team_name": alias.get((r.get("competition_uid"), r.get("team_name")), r.get("team_name"))}
        for r in rows
    ]


def league_value_rows(club_names: list[str], today: date | None = None) -> list[dict[str, Any]]:
    """Valor real (transfermarkt-datasets, CC0) y esperado por el modelo propio de cada jugador de la
    liga, con el club en el nombre de la tabla de Promiedos (el de las fichas). Vacío si falla la fuente."""
    from pipeline import analytics, market_value
    from sources import transfermarkt_datasets as tmd
    from sources.http_client import FetchError, PoliteClient, RetryableFetchError

    today = today or date.today()
    try:
        with PoliteClient(source=tmd.SOURCE) as client:
            dataset = tmd.fetch(client, today)
    except (FetchError, RetryableFetchError, OSError, ValueError) as exc:
        print(f"Aviso: sin valores de mercado ({exc}).", file=sys.stderr)
        return []
    rows = analytics.league_rows(dataset, lambda _: None, "", {})
    out = market_value.league_values(rows, today)
    for r in out:
        r["team_name"] = analytics.club_match(str(r["team_name"]), club_names) or r["team_name"]
        r["season_year"] = today.year
    return out


def league_situation_rows(season_year: int | None = None) -> list[dict[str, Any]]:
    """Situaciones de los clubes de la liga con los partidos de Promiedos (los mismos que recorre la
    corrida diaria; en caché salvo las páginas de equipo). Vacío si Promiedos falla."""
    from pipeline import league_situations
    from pipeline.run import SEASON_YEAR, crawl
    from sources import promiedos as pd
    from sources.http_client import FetchError, PoliteClient, RetryableFetchError

    season = season_year or SEASON_YEAR
    try:
        with PoliteClient(pd.SOURCE) as client:
            league_games = crawl(client, season)[5]
    except (FetchError, RetryableFetchError, ValueError, KeyError) as exc:
        print(f"Aviso: sin situaciones de la liga ({exc}).", file=sys.stderr)
        return []
    return league_situations.situations(league_games, season)


def league_fixture_rows() -> list[dict[str, Any]]:
    """Próximos partidos entre clubes de la liga: la tabla de la liga (ids y nombres) y la lista
    «próximos» de cada página de equipo de Promiedos (~31 páginas a 3 s). Vacío si Promiedos falla."""
    from pipeline.run import LEAGUE_PATH, league_team_names, league_team_paths
    from sources import promiedos as pd
    from sources.http_client import FetchError, PoliteClient, RetryableFetchError

    seen: dict[str, dict[str, Any]] = {}
    try:
        with PoliteClient(pd.SOURCE) as client:
            league = pd.next_data(client.get(pd.BASE_URL + LEAGUE_PATH, use_cache=False).text())["data"]
            names = league_team_names(league)
            for path in [*league_team_paths(league), pd.BOCA_TEAM_PATH]:
                team = pd.next_data(client.get(pd.BASE_URL + path, use_cache=False).text())["data"]
                seen.update({g["ext_id"]: g for g in pd.upcoming_league_games(team, names)})
    except (FetchError, RetryableFetchError, ValueError, KeyError) as exc:
        print(f"Aviso: sin próximos partidos de Promiedos ({exc}).", file=sys.stderr)
    return sorted(seen.values(), key=lambda g: g["kickoff_at"])


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
    bzzoiro, scouting = league_player_rows(), league_scouting_rows()
    league_rows = {
        **{v: bzzoiro[v] + scouting[v] for v in LEAGUE_PLAYER_VIEWS},
        "league_fixture": league_fixture_rows(),
        "league_situation": league_situation_rows(),
    }

    # Las demás ligas de Promiedos (etapa 5j-4) se suman a las tablas de liga de la Liga Profesional.
    other_leagues = league_promiedos_rows()
    for view, rows in league_wikipedia_rows().items():
        other_leagues.setdefault(view, []).extend(rows)
    for view in LEAGUE_PLAYER_VIEWS:
        league_rows[view] = unify_club_names(league_rows[view], other_leagues.get("league_standing", []))

    def fetch(view: str) -> list[dict[str, Any]]:
        base = league_rows[view] if view in league_rows else fetch_view(url, key, client, view)
        return base + other_leagues.get(view, [])

    with httpx.Client(timeout=TIMEOUT) as client:
        clubs = sorted({r["team_name"] for r in fetch("league_standing") if r.get("team_name")})
        league_rows["league_market_value"] = league_value_rows(clubs)
        manifests = export(fetch, out)
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
