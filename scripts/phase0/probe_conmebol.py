"""Sonda de la etapa 1 de la escala Conmebol (docs/plan-escala-conmebol.md).

Qué hace y por qué:

- Promiedos: lee el menú de ligas y cada liga de un país de la Conmebol (equipos por tabla, si trae
  goleadores, si la página ofrece temporadas anteriores). Para los países que no están en el menú
  (Ecuador, Perú, Bolivia, Venezuela) abre la página de un equipo suyo de la Libertadores o la
  Sudamericana y anota a qué ligas enlaza. Solo HTML público; nunca `api.promiedos.com.ar`.
- Federaciones y ligas oficiales: robots.txt y enlaces a términos de uso de la portada. No se
  piden datos, solo se lee qué permiten.
- Todo pasa por `PoliteClient` (3 s por host, robots.txt, caché, manifiesto). Sin evadir desafíos.

Uso (desde la raíz del repo):
    uv run python -m scripts.phase0.probe_conmebol
"""

from __future__ import annotations

import re
from datetime import UTC, datetime
from typing import Any

from scripts.phase0.common import write_report
from scripts.phase0.probe_promiedos import next_data
from sources.http_client import FetchError, PoliteClient, RetryableFetchError

BASE = "https://www.promiedos.com.ar"
CONMEBOL_MENU = {"Argentina", "Brasil", "Uruguay", "Paraguay", "Colombia", "Chile", "Internacional"}
CUPS = ("/league/libertadores/bac", "/league/conmebol-sudamericana/dij")

OFFICIAL = [
    ("CONMEBOL", "https://www.conmebol.com/"),
    ("Argentina AFA", "https://www.afa.com.ar/"),
    ("Argentina LPF", "https://www.ligaprofesional.ar/"),
    ("Brasil CBF", "https://www.cbf.com.br/"),
    ("Uruguay AUF", "https://www.auf.org.uy/"),
    ("Chile ANFP", "https://www.anfp.cl/"),
    ("Colombia Dimayor", "https://dimayor.com.co/"),
    ("Paraguay APF", "https://www.apf.org.py/"),
    ("Ecuador LigaPro", "https://ligapro.ec/"),
    ("Perú FPF", "https://www.fpf.org.pe/"),
    ("Perú Liga 1", "https://liga1.pe/"),
    ("Bolivia FBF", "https://www.fbf.com.bo/"),
    ("Venezuela FVF", "https://www.federacionvenezolanadefutbol.org/"),
    ("Venezuela Liga FUTVE", "https://www.ligafutve.org/"),
]
TERMS_RE = re.compile(
    r'href="([^"]+)"[^>]*>([^<]{0,60}(?:t[ée]rminos|condiciones|termos|legal|aviso|privacidad|privacidade)[^<]{0,60})<',
    re.I,
)
DISALLOW_ALL_RE = re.compile(r"(?im)^user-agent:\s*\*\s*$(?:\s*^(?!user-agent).*$)*?\s*^disallow:\s*/\s*$")
CHALLENGE_MARKS = ("<title>Just a moment...</title>", "cf-chl", "challenge-platform")
ERRORS = (FetchError, RetryableFetchError, ValueError, KeyError)


def walk(obj: Any, key: str = ""):
    """Recorre el JSON y devuelve (clave, dict) de cada diccionario."""
    if isinstance(obj, dict):
        yield key, obj
        for k, v in obj.items():
            yield from walk(v, k)
    elif isinstance(obj, list):
        for v in obj:
            yield from walk(v, key)


def teams_of(data: Any) -> dict[str, dict[str, Any]]:
    return {d["id"]: d for _, d in walk(data) if {"id", "url_name", "country_id"} <= d.keys()}


def leagues_linked(data: Any) -> list[str]:
    return sorted(
        {
            f"{d.get('name')} ({d.get('country_name')}) /league/{d['url_name']}/{d['id']}"
            for k, d in walk(data)
            if k == "league" and {"id", "url_name"} <= d.keys()
        }
    )


def page(client: PoliteClient, path: str) -> dict[str, Any]:
    props: dict[str, Any] = next_data(client.get(BASE + path).text())["props"]["pageProps"]
    return props


def probe_promiedos(client: PoliteClient) -> dict[str, Any]:
    menu = page(client, "/league/liga-profesional/hc")["menuData"]["categories"]
    leagues: dict[str, Any] = {}
    for cat in menu:
        if cat.get("name") not in CONMEBOL_MENU:
            continue
        items = next((v for v in cat.values() if isinstance(v, list)), [])
        for item in items:
            path = item["link"].removeprefix(BASE)
            if not path.startswith("/league/") or path in leagues:
                continue
            row: dict[str, Any] = {"pais": cat["name"], "nombre": item["name"]}
            try:
                data = page(client, path)["data"]
                row |= {
                    "equipos": len(teams_of(data.get("tables_groups") or [])),
                    "grupos_de_tabla": len(data.get("tables_groups") or []),
                    "goleadores": bool(data.get("players_statistics")),
                    "claves": sorted(data.keys()),
                    "temporadas_anteriores": any(k in data for k in ("seasons", "season", "years")),
                }
            except ERRORS as exc:
                row["error"] = str(exc)
            leagues[path] = row
    # Países sin liga en el menú: un equipo de cada uno, sacado de las copas.
    seen: dict[str, dict[str, Any]] = {}
    for cup in CUPS:
        for team in teams_of(page(client, cup)["data"]).values():
            seen.setdefault(team["country_id"], team)
    by_country: dict[str, Any] = {}
    for country_id, team in seen.items():
        try:
            data = page(client, f"/team/{team['url_name']}/{team['id']}")
            by_country[country_id] = {"equipo": team["name"], "ligas_enlazadas": leagues_linked(data)}
        except ERRORS as exc:
            by_country[country_id] = {"equipo": team["name"], "error": str(exc)}
    return {"ligas_del_menu": leagues, "equipos_de_copas_por_pais": by_country}


def probe_official(client: PoliteClient) -> list[dict[str, Any]]:
    rows = []
    for name, home in OFFICIAL:
        row: dict[str, Any] = {"sitio": name, "url": home}
        try:
            robots = client.get(home + "robots.txt", check_robots=False, use_cache=False)
            text = robots.text()
            row |= {
                "robots_status": robots.status,
                "robots_disallow_todo": bool(DISALLOW_ALL_RE.search(text)),
                "robots_desafio": any(m in text for m in CHALLENGE_MARKS),
            }
        except (FetchError, RetryableFetchError) as exc:
            row["robots_error"] = str(exc)
        try:
            html = client.get(home).text()
            row["portada_desafio"] = any(m in html for m in CHALLENGE_MARKS)
            row["enlaces_terminos"] = sorted({f"{t.strip()} -> {h}" for h, t in TERMS_RE.findall(html)})[:6]
        except (FetchError, RetryableFetchError) as exc:
            row["portada_error"] = str(exc)
        rows.append(row)
    return rows


def main() -> int:
    now = datetime.now(UTC).isoformat(timespec="seconds")
    report: dict[str, Any] = {"source": "conmebol", "generated_at": now}
    with PoliteClient(source="promiedos") as client:
        report["promiedos"] = probe_promiedos(client)
    with PoliteClient(source="oficiales") as client:
        report["oficiales"] = probe_official(client)
    # ascii(): la consola de Windows (cp1252) no imprime la «Θ» de la ruta del repo.
    print(ascii(str(write_report("conmebol", report))))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
