"""Modelo de Power BI en esquema estrella (sección 11): CSV en `data/powerbi/`.

Lee las mismas vistas `api` que la web y los libros de Excel y escribe dimensiones y hechos en
formato largo, así la tabla maestra y los gráficos cambian de estadística con un segmentador sin
armar una medida por columna. Con `--upload` también los sube al bucket público `exports/powerbi/`
(para refrescar el modelo sin clonar el repositorio). Los CSV van en UTF-8 con BOM (Power BI y Excel
los abren con tildes bien) y con punto decimal.
"""

from __future__ import annotations

import argparse
import csv
import io
import os
import sys
from collections.abc import Sequence
from datetime import date
from pathlib import Path
from typing import Any

import httpx

from pipeline import excel
from pipeline import projection as pj

OUT = Path(__file__).resolve().parents[1] / "data" / "powerbi"
MONTHS = (
    "enero",
    "febrero",
    "marzo",
    "abril",
    "mayo",
    "junio",
    "julio",
    "agosto",
    "septiembre",
    "octubre",
    "noviembre",
    "diciembre",
)
DAYS = ("lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo")

Table = tuple[list[str], list[list[Any]]]

# Mapa de tiros (gráfico 11): x e y como fracción de la cancha (0 a 1), como en la web.
SHOT_COLUMNS = (
    "shot_id",
    "match_id",
    "boca_shot",
    "player_id",
    "player_name",
    "minute",
    "outcome",
    "body_part",
    "penalty",
    "zone",
    "xg",
    "x",
    "y",
)


def _cell(value: Any) -> Any:
    if isinstance(value, bool):
        return int(value)
    if isinstance(value, str):
        return excel.safe_text(value)
    return "" if value is None else value


def to_csv(table: Table) -> bytes:
    head, rows = table
    buffer = io.StringIO()
    writer = csv.writer(buffer, lineterminator="\n")
    writer.writerow(head)
    writer.writerows([_cell(v) for v in row] for row in rows)
    return buffer.getvalue().encode("utf-8-sig")


def _player_stat_rows(data: excel.Data) -> list[list[Any]]:
    """Jugador × competición × estadística, con valor, valor por 90 y percentil (entre los del mismo
    tipo, arqueros o de campo, con el mínimo de minutos de cada competición)."""
    rows: list[list[Any]] = []
    for code, players in data.players.items():
        threshold = min(excel.MIN_MINUTES, int(0.4 * max((p.minutes for p in players), default=0)))
        eligible = [p for p in players if p.minutes >= threshold]
        for s in data.stats:
            groups = {
                gk: [
                    v
                    for p in eligible
                    if (p.line == "Arquero") == gk and (v := excel.per90(p, s)) is not None
                ]
                for gk in (True, False)
            }
            for p in players:
                raw = p.stats.get(s.id)
                if raw is None:
                    continue
                v90 = excel.per90(p, s)
                group = groups[p.line == "Arquero"]
                pct = excel.percentile(group, v90, s.higher_is_better) if v90 is not None and group else None
                rows.append([p.id, code, s.id, raw, v90 if s.per90 else None, pct, s.estimated])
    return rows


def _distribution(data: excel.Data, eligible: Sequence[excel.Player]) -> list[list[Any]]:
    out: list[list[Any]] = []
    for s in data.stats:
        vals = sorted(v for p in eligible if (v := excel.per90(p, s)) is not None)
        if len(vals) < 4 or vals[0] == vals[-1]:
            continue
        width = (vals[-1] - vals[0]) / 6
        for k in range(6):
            lo = vals[0] + k * width
            hi = lo + width
            count = sum(1 for v in vals if lo <= v < hi or (k == 5 and v == vals[-1]))
            out.append([s.id, k + 1, round(lo, 4), round(hi, 4), count])
    return out


def _correlation(data: excel.Data, eligible: Sequence[excel.Player]) -> list[list[Any]]:
    keys = [s for s in data.stats if s.key]
    out: list[list[Any]] = []
    for a in keys:
        for b in keys:
            pairs = [
                (x, y)
                for p in eligible
                if (x := excel.per90(p, a)) is not None and (y := excel.per90(p, b)) is not None
            ]
            r = excel.pearson([x for x, _ in pairs], [y for _, y in pairs]) if pairs else None
            if r is not None:
                out.append([a.id, b.id, round(r, 4)])
    return out


def build_tables(data: excel.Data, extra: dict[str, list[dict[str, Any]]]) -> dict[str, Table]:
    """Todas las tablas del modelo a partir de los datos ya leídos."""
    stats = data.stats
    by_id = {s.id: s for s in stats}
    players_all = data.players.get("todas", [])
    eligible_all = [p for p in players_all if p.minutes >= excel.MIN_MINUTES]
    dates = sorted({m["match_date"] for m in data.team if m.get("match_date")})
    matches = []
    for m in data.team:
        gf, ga = m["goals_for"] or 0, m["goals_against"] or 0
        result = "G" if gf > ga else "P" if gf < ga else "E"
        points = 3 if gf > ga else 1 if gf == ga else 0
        matches.append(
            [
                m["match_id"],
                m["match_date"],
                m["competition_code"],
                m["opponent"],
                m["boca_home"],
                gf,
                ga,
                result,
                points,
            ]
        )
    return {
        "dim_player": (
            ["player_id", "nombre", "linea", "posicion", "edad"],
            [[p.id, p.name, p.line, p.role, p.age] for p in players_all],
        ),
        "dim_competition": (
            ["competition_code", "nombre"],
            [["todas", "Todas las competiciones"], *[[c, n] for c, n in data.competitions]],
        ),
        "dim_date": (
            ["fecha", "anio", "mes", "nombre_mes", "dia_semana"],
            [
                [d, (x := date.fromisoformat(d)).year, x.month, MONTHS[x.month - 1], DAYS[x.weekday()]]
                for d in dates
            ],
        ),
        "dim_team": (
            ["rival"],
            [[t] for t in sorted({m["opponent"] for m in data.team if m.get("opponent")})],
        ),
        "dim_stat": (
            [
                "stat_id",
                "nombre",
                "abrev",
                "grupo",
                "unidad",
                "descripcion_es",
                "formula",
                "nivel",
                "mas_es_mejor",
                "estimada",
                "por90",
                "clave",
            ],
            [
                [
                    s.id,
                    s.name,
                    s.short,
                    s.group,
                    s.unit,
                    s.description,
                    s.formula,
                    s.level,
                    s.higher_is_better,
                    s.estimated,
                    s.per90,
                    s.key,
                ]
                for s in stats
            ],
        ),
        "dim_stat_set": (
            ["set_id", "conjunto", "stat_id", "orden"],
            [
                [sid, name, st, k + 1]
                for sid, name, ids in data.sets
                for k, st in enumerate(ids)
                if st in by_id
            ],
        ),
        "fact_player_stat": (
            ["player_id", "competition_code", "stat_id", "valor", "valor_90", "percentil", "estimada"],
            _player_stat_rows(data),
        ),
        "fact_player_minutes": (
            ["player_id", "competition_code", "partidos", "minutos"],
            [[p.id, code, p.matches, p.minutes] for code, ps in data.players.items() for p in ps],
        ),
        "fact_match": (
            [
                "match_id",
                "fecha",
                "competition_code",
                "rival",
                "local",
                "goles_favor",
                "goles_contra",
                "resultado",
                "puntos",
            ],
            matches,
        ),
        "fact_team_match_stat": (
            ["match_id", "clave", "valor"],
            [
                [m["match_id"], k, v]
                for m in data.team
                for k, v in sorted((m["stats"] or {}).items())
                if isinstance(v, int | float)
            ],
        ),
        "fact_player_match_value": (
            ["match_id", "player_id", "clave", "valor"],
            [
                [r["match_id"], r["player_id"], r["key"], r["value"]]
                for r in extra.get("player_match_value", [])
            ],
        ),
        "fact_stat_match_value": (
            ["entidad", "entity_id", "match_id", "stat_id", "valor", "minimo", "maximo", "rolling_5"],
            _rolling_rows(extra.get("stat_match_value", []), [m["match_id"] for m in data.team]),
        ),
        "stat_distribution": (
            ["stat_id", "intervalo", "desde", "hasta", "jugadores"],
            _distribution(data, eligible_all),
        ),
        "stat_correlation": (["stat_a", "stat_b", "pearson"], _correlation(data, eligible_all)),
        "fact_situational": (
            [
                "card_id",
                "categoria",
                "tarjeta",
                "fila",
                "partidos",
                "ganados",
                "empatados",
                "perdidos",
                "pct_victorias",
                "dif_vs_base",
                "puntos_por_partido",
                "gf",
                "gc",
            ],
            [
                [
                    s["card_id"],
                    s["category"],
                    s["title"],
                    s["param_value"],
                    s["n"],
                    s["w"],
                    s["d"],
                    s["l"],
                    s["win_pct"],
                    s["delta"],
                    s["ppg"],
                    s["gf_avg"],
                    s["ga_avg"],
                ]
                for s in data.situations
            ],
        ),
        "dim_chart": (
            ["chart_id", "titulo", "categoria", "tipo", "powerbi", "excel", "disponible", "motivo"],
            [
                [
                    r["chart_id"],
                    r["title_es"],
                    r["category"],
                    r["chart_type"],
                    r["powerbi"],
                    r["excel"],
                    r["available"],
                    r["reason_es"],
                ]
                for r in extra.get("chart_catalog", [])
            ],
        ),
        "chart_source_map": (
            ["chart_id", "destino_tipo", "destino_ref", "parametros", "etiqueta_es"],
            [
                [r["chart_id"], r["target_type"], r["target_ref"], r["params"], r["label_es"]]
                for r in extra.get("chart_source_map", [])
            ],
        ),
        "fact_shot": (list(SHOT_COLUMNS), [[r[c] for c in SHOT_COLUMNS] for r in extra.get("shot", [])]),
        "fact_projection": (
            [
                "player_id",
                "edad",
                "minutos",
                "es_arquero",
                "indice_rendimiento",
                "cobertura",
                "mejoria_alpha",
                "mejoria_beta",
                "nivel_pct",
                "nivel_n",
                "potencial_alpha",
                "potencial_beta",
            ],
            _projection_rows(data, players_all),
        ),
    }


def _rolling_rows(values: Sequence[dict[str, Any]], order: Sequence[int]) -> list[list[Any]]:
    """Valor por partido con su media móvil de los últimos 5 partidos (gráfico 5 de 9.4), en orden
    cronológico por entidad y estadística."""
    pos = {m: k for k, m in enumerate(order)}
    series: dict[tuple[str, int, str], list[dict[str, Any]]] = {}
    for r in values:
        series.setdefault((r["entity"], r["entity_id"], r["stat_id"]), []).append(r)
    out: list[list[Any]] = []
    for rows in series.values():
        rows.sort(key=lambda r: pos.get(r["match_id"], len(pos)))
        window: list[float] = []
        for r in rows:
            if r["value"] is not None:
                window = [*window[-4:], r["value"]]
            rolling = round(sum(window) / len(window), 4) if window else None
            out.append(
                [
                    r["entity"],
                    r["entity_id"],
                    r["match_id"],
                    r["stat_id"],
                    r["value"],
                    r["low"],
                    r["high"],
                    rolling,
                ]
            )
    return out


def _level_from(p: excel.Player) -> float | None:
    """N despejado del Potencial α con los parámetros por defecto (datos previos al detalle con
    `nivel_pct`). Con Potencial α = 100 el tope esconde N: queda n/d."""
    value, age = p.stats.get("potencial_alpha"), p.age
    if value is None or age is None or value >= 100:
        return None
    peak = pj.PEAK_AGE_GOALKEEPER if p.line == "Arquero" else pj.PEAK_AGE
    m = (p.stats["mejoria_alpha"] - 50) / 50 if "mejoria_alpha" in p.stats else 0.0
    return round(value - pj.GROWTH_PER_YEAR * max(0.0, peak - age) * (1 + pj.TREND_WEIGHT * m), 3)


def _projection_rows(data: excel.Data, players: Sequence[excel.Player]) -> list[list[Any]]:
    """Insumos de 6.1 por jugador: con `nivel_n`, la edad y la Mejoría α, las medidas DAX
    recalculan el Potencial α con los parámetros de hipótesis A_pico, G y λ."""
    rows = []
    for p in players:
        # El nivel N solo está en el detalle (stat_value_detail); los valores, en la tabla maestra.
        detail = (data.projection.get(p.id, {}).get("potencial_alpha") or {}).get("detail") or {}
        level = detail.get("nivel_pct")
        n = round(pj.shrink(level, p.minutes), 3) if level is not None else _level_from(p)
        rows.append(
            [
                p.id,
                p.age,
                p.minutes,
                p.line == "Arquero",
                p.stats.get("rendimiento_indice"),
                p.stats.get("rendimiento_cobertura"),
                p.stats.get("mejoria_alpha"),
                p.stats.get("mejoria_beta"),
                level,
                n,
                p.stats.get("potencial_alpha"),
                p.stats.get("potencial_beta"),
            ]
        )
    return rows


def fetch_extra(url: str, key: str) -> dict[str, list[dict[str, Any]]]:
    with httpx.Client(timeout=excel.TIMEOUT) as c:
        return {
            "player_match_value": excel._get(
                c, url, key, "player_match_value", "match_id,player_id,key,value"
            ),
            "stat_match_value": excel._get(
                c, url, key, "stat_match_value", "entity,entity_id,match_id,stat_id,value,low,high"
            ),
            "chart_catalog": excel._get(
                c,
                url,
                key,
                "chart_catalog",
                "chart_id,title_es,category,chart_type,powerbi,excel,available,reason_es",
                order="sort_order",
            ),
            "chart_source_map": excel._get(
                c, url, key, "chart_source_map", "chart_id,target_type,target_ref,params,label_es"
            ),
            "shot": excel._get(c, url, key, "boca_shot", ",".join(SHOT_COLUMNS), order="shot_id"),
        }


def write(tables: dict[str, Table], out: Path = OUT) -> list[Path]:
    out.mkdir(parents=True, exist_ok=True)
    paths = []
    for name, table in tables.items():
        path = out / f"{name}.csv"
        path.write_bytes(to_csv(table))
        paths.append(path)
    return paths


def upload(tables: dict[str, Table], url: str, key: str) -> None:
    headers = {
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "x-upsert": "true",
        "Content-Type": "text/csv",
    }
    with httpx.Client(timeout=excel.TIMEOUT) as client:
        for name, table in tables.items():
            response = client.post(
                f"{url.rstrip('/')}/storage/v1/object/{excel.BUCKET}/powerbi/{name}.csv",
                content=to_csv(table),
                headers=headers,
            )
            if response.status_code >= 400:
                raise RuntimeError(f"Storage respondió {response.status_code}: {response.text[:200]}")


def main(argv: Sequence[str] | None = None) -> int:
    from pipeline.run import load_dotenv, secret_key

    parser = argparse.ArgumentParser(description="Modelo de Power BI (CSV en estrella)")
    parser.add_argument(
        "--upload", action="store_true", help="también sube los CSV al bucket exports/powerbi"
    )
    args = parser.parse_args(argv)
    load_dotenv()
    url, key = os.environ.get("SUPABASE_URL", "").strip(), secret_key()
    if not (url and key):
        print("Faltan SUPABASE_URL o la clave secreta.", file=sys.stderr)
        return 2
    tables = build_tables(excel.fetch(url, key), fetch_extra(url, key))
    for path in write(tables):
        print(f"{path.name}: {len(tables[path.stem][1])} filas")
    if args.upload:
        upload(tables, url, key)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
