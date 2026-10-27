"""Sonda de Fase 0 para football-data.co.uk (CSV de "ligas nuevas", archivo de Argentina).

Qué hace y por qué:

- football-data.co.uk publica un CSV por país con TODOS los partidos de primera división de
  varias temporadas (para Argentina: `new/ARG.csv`). Es un archivo estático, pensado para
  bajarse entero, así que alcanza con UNA request de datos para ver qué trae de verdad.
- La request pasa por el cliente compartido `PoliteClient` (User-Agent identificable, pausa por
  host, caché, robots.txt y manifiesto con SHA-256). El robots.txt se lee con el mismo cliente.
- El informe describe COLUMNAS y CONTEOS (temporadas, equipos, partidos de Boca 2026), no copia
  el CSV: son datos de un tercero. Como mucho guarda 2 o 3 valores de ejemplo para confirmar
  que el archivo trae a Boca en 2026.
- Las columnas de cuotas de apuestas se identifican y se marcan como "no usar": el sitio
  Pelotheta no muestra cuotas. Solo interesan las columnas de resultado, para validación cruzada.

Presupuesto: como máximo 3 requests de datos para esta fuente; la sonda usa 1 (ARG.csv).
robots.txt no cuenta como dato. La caché del cliente evita repetir la request al re-ejecutar.

Ejecutar desde la raíz del repo:
    uv run python -m scripts.phase0.probe_football_data_co_uk
"""

from __future__ import annotations

import csv
import io
import json
import urllib.robotparser
from collections import Counter
from datetime import UTC, date, datetime
from typing import Any

from scripts.phase0.common import write_report
from sources.http_client import (
    MANIFEST_PATH,
    ROOT,
    USER_AGENT,
    FetchError,
    FetchResult,
    PoliteClient,
    RetryableFetchError,
)

SOURCE = "football_data_co_uk"
SITE = "https://www.football-data.co.uk"
ROBOTS_URL = f"{SITE}/robots.txt"
ARG_CSV_URL = f"{SITE}/new/ARG.csv"

MAX_DATA_REQUESTS = 3  # tope pedido para esta fuente; la sonda planifica solo 1
TARGET_SEASON = "2026"
BOCA_HINT = "boca"  # se busca por subcadena para no depender de la grafía exacta del nombre

# Columnas que el archivo de "ligas nuevas" usa para identificar el partido y su resultado.
# notes.txt no las define para estos archivos (solo define las de las ligas principales), así que
# el significado de cada una se deduce del nombre y se confirma mirando los valores.
RESULT_COLUMNS = ("Country", "League", "Season", "Date", "Time", "Home", "Away", "HG", "AG", "Res")

# Prefijos de las columnas de cuotas según notes.txt: PS = Pinnacle, Max/Avg = máximo y promedio
# del mercado, BFE = Betfair Exchange, B365 = Bet365. La "C" después del prefijo significa cierre.
ODDS_PREFIXES = ("PS", "Max", "Avg", "BFE", "B365", "WH", "Bb", "P>", "P<", "AH")

# Términos, notas y robots.txt leídos a mano (WebFetch) ANTES de pedir datos (regla 1).
TERMS_REVIEWED: list[dict[str, str]] = [
    {
        "url": f"{SITE}/robots.txt",
        "summary": (
            "Grupo 'User-agent: *' con 'Disallow:' vacío: todo el sitio permitido para cualquier "
            "robot no nombrado. Bloquea con 'Disallow: /' a bots de IA y de recolección por "
            "nombre: GPTBot, ChatGPT-User, Google-Extended, Anthropic-AI, Claude-Web, ClaudeBot, "
            "PerplexityBot, Applebot-Extended, CCBot, Meta-ExternalAgent, Diffbot, Omgilibot. "
            "Sin Crawl-delay ni Sitemap."
        ),
    },
    {
        "url": f"{SITE}/notes.txt",
        "summary": (
            "Clave de columnas de los CSV de las ligas principales (Div, Date, HomeTeam, FTHG, "
            "FTR, estadísticas HS/HST/HC/HY/HR, y cuotas por casa de apuestas con sufijo H/D/A; "
            "'C' = cuota de cierre). No define las columnas propias de las 'ligas nuevas' "
            "(Country, League, Season, Home, Away, HG, AG). Incluye agradecimientos a las "
            "fuentes de origen (resultados: XScores; cuotas: Betbrain, Oddsportal y casas de "
            "apuestas). Sin licencia, copyright ni condiciones de reutilización."
        ),
    },
    {
        "url": f"{SITE}/all_new_data.php",
        "summary": (
            "Índice de 'ligas nuevas' (16 países, Argentina incluida). Dice 'My data is free'. "
            "Ofrece una API paga de un socio (TheStatsAPI). Pide avisar errores u omisiones. "
            "No dice nada de redistribución, uso comercial, atribución ni descarga automatizada."
        ),
    },
    {
        "url": f"{SITE}/argentina.php",
        "summary": (
            "Página de Argentina: enlaces a new/ARG.csv y new/ARG.xlsx, 'Last updated' de "
            "octubre de 2026, enlace a Notes.txt y a disclaimer.php. No lista temporadas ni "
            "describe columnas. Sin condiciones de uso."
        ),
    },
    {
        "url": f"{SITE}/disclaimer.php",
        "summary": (
            "Solo descargo de responsabilidad: no garantiza la exactitud de los datos, no se "
            "responsabiliza por pérdidas de apuestas, el contenido no es consejo para apostar y "
            "el sitio se financia con publicidad de casas de apuestas. No trae licencia, "
            "copyright, permisos de reutilización, límites de descarga ni pedido de atribución."
        ),
    },
]


# --- utilidades para describir el archivo sin copiar datos -------------------------------
def describe_fetch(result: FetchResult) -> dict[str, Any]:
    """Metadatos de la descarga (sin el cuerpo)."""
    return {
        "url": result.url,
        "status": result.status,
        "content_type": result.content_type,
        "bytes": len(result.body),
        "sha256": result.sha256,
        "from_cache": result.from_cache,
        "fetched_at": result.fetched_at,
    }


def decode_csv(body: bytes) -> tuple[str, str]:
    """Decodifica el CSV y devuelve (texto, codificación usada).

    El sitio no declara la codificación. Se prueba UTF-8 (con o sin BOM) y, si falla, cp1252,
    que es lo habitual en archivos exportados desde Excel en Windows.
    """
    try:
        return body.decode("utf-8-sig"), "utf-8"
    except UnicodeDecodeError:
        return body.decode("cp1252", errors="replace"), "cp1252"


def parse_date(raw: str) -> date | None:
    """Las fechas vienen como dd/mm/yyyy (o dd/mm/yy en archivos viejos)."""
    for fmt in ("%d/%m/%Y", "%d/%m/%y"):
        try:
            return datetime.strptime(raw.strip(), fmt).date()
        except ValueError:
            continue
    return None


def classify_columns(columns: list[str]) -> dict[str, list[str]]:
    """Separa columnas de partido/resultado, cuotas de apuestas y cualquier otra."""
    result_cols = [c for c in columns if c in RESULT_COLUMNS]
    odds_cols = [c for c in columns if c not in RESULT_COLUMNS and c.startswith(ODDS_PREFIXES)]
    other = [c for c in columns if c not in result_cols and c not in odds_cols]
    return {"partido_y_resultado": result_cols, "cuotas_apuestas": odds_cols, "otras": other}


def filled_ratio(rows: list[dict[str, str]], column: str) -> str:
    """Cuántas filas traen valor en una columna, como texto 'n/total'."""
    filled = sum(1 for r in rows if (r.get(column) or "").strip())
    return f"{filled}/{len(rows)}"


def is_boca(row: dict[str, str], side: str) -> bool:
    return BOCA_HINT in (row.get(side) or "").lower()


def season_summary(rows: list[dict[str, str]]) -> dict[str, Any]:
    """Conteos por temporada: cuántos partidos y equipos, para ver cobertura histórica."""
    by_season: dict[str, dict[str, Any]] = {}
    for season in sorted({r.get("Season", "") for r in rows}):
        season_rows = [r for r in rows if r.get("Season", "") == season]
        teams = {r.get("Home", "") for r in season_rows} | {r.get("Away", "") for r in season_rows}
        by_season[season] = {"partidos": len(season_rows), "equipos": len(teams - {""})}
    return by_season


def season_2026_summary(rows: list[dict[str, str]]) -> dict[str, Any]:
    """Describe la temporada 2026 completa (todos los equipos de la liga)."""
    dates = sorted(d for d in (parse_date(r.get("Date", "")) for r in rows) if d is not None)
    teams = {r.get("Home", "") for r in rows} | {r.get("Away", "") for r in rows}
    with_result = [r for r in rows if (r.get("HG") or "").strip() and (r.get("AG") or "").strip()]
    # Partidos por equipo: sirve para ver si hay equipos con más partidos (playoffs) y si la
    # liga completa está, que es lo que hace falta para comparar a Boca contra el resto.
    per_team: Counter[str] = Counter()
    for r in rows:
        per_team[r.get("Home", "")] += 1
        per_team[r.get("Away", "")] += 1
    per_team_counts = sorted(per_team.values())
    return {
        "partidos": len(rows),
        "con_resultado": len(with_result),
        "sin_resultado": len(rows) - len(with_result),
        "fecha_min": dates[0].isoformat() if dates else None,
        "fecha_max": dates[-1].isoformat() if dates else None,
        "equipos_distintos": len(teams - {""}),
        "partidos_por_equipo_min": per_team_counts[0] if per_team_counts else None,
        "partidos_por_equipo_max": per_team_counts[-1] if per_team_counts else None,
        "valores_League": sorted({r.get("League", "") for r in rows}),
        "valores_Country": sorted({r.get("Country", "") for r in rows}),
        "valores_Res": dict(Counter(r.get("Res", "") for r in rows)),
        "partidos_ene_jun": sum(1 for d in dates if d.month <= 6),
        "partidos_jul_dic": sum(1 for d in dates if d.month >= 7),
        "formato_Time_ejemplo_largo": sorted({len(r.get("Time", "")) for r in rows}),
    }


def boca_2026_summary(rows: list[dict[str, str]]) -> dict[str, Any]:
    """Conteos de los partidos de Boca 2026 (sin copiar resultados partido por partido)."""
    boca_rows = [r for r in rows if is_boca(r, "Home") or is_boca(r, "Away")]
    names = sorted(
        {r.get("Home", "") for r in boca_rows if is_boca(r, "Home")}
        | {r.get("Away", "") for r in boca_rows if is_boca(r, "Away")}
    )
    dates = sorted(d for d in (parse_date(r.get("Date", "")) for r in boca_rows) if d is not None)
    # Resultado desde el punto de vista de Boca: es un agregado (G/E/P), no la lista de partidos.
    outcome: Counter[str] = Counter()
    for r in boca_rows:
        res = r.get("Res", "")
        if res not in ("H", "D", "A"):
            outcome["sin_resultado"] += 1
        elif res == "D":
            outcome["empates"] += 1
        elif (res == "H") == is_boca(r, "Home"):
            outcome["ganados"] += 1
        else:
            outcome["perdidos"] += 1
    rivals = {r.get("Away", "") if is_boca(r, "Home") else r.get("Home", "") for r in boca_rows}
    example = boca_rows[0] if boca_rows else None
    return {
        "nombres_de_boca_en_el_archivo": names,
        "partidos": len(boca_rows),
        "de_local": sum(1 for r in boca_rows if is_boca(r, "Home")),
        "de_visitante": sum(1 for r in boca_rows if is_boca(r, "Away")),
        "fecha_min": dates[0].isoformat() if dates else None,
        "fecha_max": dates[-1].isoformat() if dates else None,
        "partidos_ene_jun": sum(1 for d in dates if d.month <= 6),
        "partidos_jul_dic": sum(1 for d in dates if d.month >= 7),
        "rivales_distintos": len(rivals - {""}),
        "resultado_agregado": dict(outcome),
        # Un solo partido de ejemplo, con 3 valores, para confirmar que es Boca 2026.
        "ejemplo": (
            {
                "Date": example.get("Date"),
                "Home": example.get("Home"),
                "Away": example.get("Away"),
            }
            if example is not None
            else None
        ),
    }


def analyze_csv(result: FetchResult) -> dict[str, Any]:
    """Lee el CSV y arma el resumen: columnas, cobertura por temporada y Boca 2026."""
    text, encoding = decode_csv(result.body)
    reader = csv.DictReader(io.StringIO(text))
    columns = [c.strip() for c in (reader.fieldnames or [])]
    rows = [{(k or "").strip(): (v or "").strip() for k, v in row.items()} for row in reader]
    season_rows = [r for r in rows if r.get("Season", "") == TARGET_SEASON]
    columns_by_kind = classify_columns(columns)
    return {
        "codificacion": encoding,
        "filas_totales": len(rows),
        "columnas": columns,
        "columnas_por_tipo": columns_by_kind,
        # Completitud de las columnas de resultado en 2026 (cuántas filas traen valor).
        "completitud_2026_columnas_resultado": {
            c: filled_ratio(season_rows, c) for c in columns_by_kind["partido_y_resultado"]
        },
        "temporadas": season_summary(rows),
        "tiene_temporada_2026": bool(season_rows),
        "temporada_2026": season_2026_summary(season_rows),
        "boca_2026": boca_2026_summary(season_rows),
    }


# --- robots.txt y manifiesto -------------------------------------------------------------
def robots_summary(client: PoliteClient) -> dict[str, Any]:
    """Lee robots.txt con el mismo cliente (queda en caché y el cliente lo reutiliza)."""
    try:
        result = client.get(ROBOTS_URL, check_robots=False)
    except (FetchError, RetryableFetchError) as exc:
        return {"url": ROBOTS_URL, "estado": "error", "error": str(exc)}
    lines = result.text().splitlines()
    parser = urllib.robotparser.RobotFileParser(ROBOTS_URL)
    parser.parse(lines)
    # Agentes bloqueados por nombre: es política pública del sitio, se anota para el análisis
    # de riesgos (bloquea bots de IA aunque a nuestro User-Agent lo deja pasar).
    blocked_agents: list[str] = []
    current: list[str] = []
    for raw in lines:
        line = raw.split("#", 1)[0].strip()
        if ":" not in line:
            continue
        field, value = (part.strip() for part in line.split(":", 1))
        if field.lower() == "user-agent":
            current.append(value)
        elif field.lower() == "disallow":
            if value == "/":
                blocked_agents.extend(current)
            current = []
    return {
        **describe_fetch(result),
        "csv_permitido_para_nuestro_ua": parser.can_fetch(USER_AGENT, ARG_CSV_URL),
        "crawl_delay": parser.crawl_delay(USER_AGENT),
        "agentes_bloqueados_por_nombre": sorted(set(blocked_agents)),
    }


def manifest_count() -> int:
    """Requests reales a esta fuente registradas en el manifiesto (todas las corridas)."""
    if not MANIFEST_PATH.exists():
        return 0
    count = 0
    for line in MANIFEST_PATH.read_text(encoding="utf-8").splitlines():
        if line.strip() and json.loads(line).get("source") == SOURCE:
            count += 1
    return count


# --- flujo principal ---------------------------------------------------------------------
def main() -> None:
    report: dict[str, Any] = {
        "source": SOURCE,
        "generated_at": datetime.now(UTC).isoformat(timespec="seconds"),
        "terms_reviewed": TERMS_REVIEWED,
        "nota_cuotas": (
            "El CSV trae cuotas de apuestas (Pinnacle, Betfair Exchange, máximo y promedio del "
            "mercado). Pelotheta NO muestra cuotas: esas columnas se descartan al ingerir."
        ),
    }
    requests_log: list[dict[str, Any]] = []
    data_requests = 0

    with PoliteClient(source=SOURCE) as client:
        report["robots_txt"] = robots_summary(client)

        # Única request de datos: el CSV completo de Argentina. Se pide solo si robots.txt lo
        # permite para nuestro User-Agent; si no, no se fuerza.
        entry: dict[str, Any] = {"recurso": "new/ARG.csv"}
        requests_log.append(entry)
        if data_requests >= MAX_DATA_REQUESTS:
            entry["estado"] = "omitido_por_presupuesto"
        elif not client.robots_allows(ARG_CSV_URL):
            entry["estado"] = "no_pedido_robots_txt"
        else:
            data_requests += 1
            try:
                result = client.get(ARG_CSV_URL)
            except (FetchError, RetryableFetchError) as exc:
                # 403/429/tamaño/redirección: se registra y se sigue, sin evadir nada.
                entry["estado"] = "error"
                entry["error"] = str(exc)
            else:
                entry.update(describe_fetch(result))
                if result.status != 200:
                    entry["estado"] = f"http_{result.status}"
                elif "html" in result.content_type.lower():
                    # Un HTML en lugar de un CSV suele ser un desafío anti-bot o un error.
                    entry["estado"] = "html_en_lugar_de_csv"
                else:
                    entry["estado"] = "con_datos"
                    report["arg_csv"] = analyze_csv(result)

    report["requests"] = requests_log
    report["presupuesto"] = {
        "max_requests_datos": MAX_DATA_REQUESTS,
        "requests_datos_planificadas": data_requests,
        "desde_red_en_esta_corrida": sum(1 for e in requests_log if e.get("from_cache") is False),
        "desde_cache_en_esta_corrida": sum(1 for e in requests_log if e.get("from_cache") is True),
        "total_en_manifiesto_incluye_robots": manifest_count(),
    }
    path = write_report(SOURCE, report)

    # Salida breve por consola: estado y conteos, sin datos.
    for item in requests_log:
        print(
            f"{item['recurso']:<14} {item.get('status', '-')!s:<4} {item.get('estado')}"
            f"  bytes={item.get('bytes', '-')}  cache={item.get('from_cache', '-')}"
        )
    csv_info = report.get("arg_csv")
    if isinstance(csv_info, dict):
        print(
            f"filas={csv_info['filas_totales']} temporada_2026={csv_info['tiene_temporada_2026']}"
            f" partidos_boca_2026={csv_info['boca_2026']['partidos']}"
        )
    # Ruta relativa: la consola de Windows (cp1252) no puede imprimir la Θ de la carpeta.
    print(f"Informe: {path.relative_to(ROOT).as_posix()}")


if __name__ == "__main__":
    main()
