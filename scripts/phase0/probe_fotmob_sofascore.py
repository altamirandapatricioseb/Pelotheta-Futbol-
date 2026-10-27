"""Sonda de la Fase 0 para FotMob y Sofascore: SOLO revisión documental.

Por qué es distinta de las demás sondas: FotMob y Sofascore no tienen API pública oficial y sus
términos limitan el acceso automatizado. En el proyecto quedan opcionales y desactivadas por
defecto; decide el dueño. Por eso esta sonda NO pide ningún endpoint de datos: descarga solo los dos
robots.txt (www.fotmob.com y www.sofascore.com) con el cliente compartido y evalúa, sin hacer
requests, qué rutas de API quedarían permitidas o prohibidas para un bot genérico.

Lo que dicen los términos de uso se leyó a mano (con un navegador de documentación, no con esta
sonda) y queda resumido en `TERMS_REVIEW`. Lo que ofrecerían como datos viene de fuentes públicas y
está marcado como "no verificado", porque no se pidió ningún dato real.

Uso, desde la raíz del repo:
    uv run python -m scripts.phase0.probe_fotmob_sofascore
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from datetime import UTC, datetime
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

SOURCE = "fotmob_sofascore"

# Token de producto de nuestro bot (lo que un robots.txt nombraría en "User-agent:").
OUR_AGENT = USER_AGENT.split("/")[0].lower()  # "pelothetabot"
GENERIC_AGENT = "*"

# Rutas que se EVALÚAN contra robots.txt. Nunca se piden: son solo texto que se compara con las
# reglas. Los ids (Boca = 10077 en FotMob, 3202 en Sofascore; Liga Profesional = 112 en FotMob,
# 155 en Sofascore) salen de fuentes públicas y no están verificados con datos reales.
CANDIDATE_PATHS: dict[str, list[tuple[str, str]]] = {
    "www.fotmob.com": [
        ("/api/", "raíz de la API interna"),
        ("/api/teams?id=10077", "API: equipo Boca (ruta histórica)"),
        ("/api/data/teams?id=10077", "API: equipo Boca (ruta más reciente según terceros)"),
        ("/api/matchDetails?matchId=1", "API: detalle de partido (ruta histórica)"),
        ("/api/data/matchDetails?matchId=1", "API: detalle de partido (ruta más reciente)"),
        ("/api/leagues?id=112", "API: Liga Profesional (ruta histórica)"),
        ("/api/data/leagues?id=112", "API: Liga Profesional (ruta más reciente)"),
        ("/api/playerData?id=1", "API: jugador"),
        ("/api/data/tltable?leagueId=112", "API: tabla de la liga"),
        ("/_next/data/x/en/teams/10077/overview/boca-juniors.json", "datos Next.js de páginas"),
        ("/teams/10077/overview/boca-juniors", "página HTML del equipo"),
        ("/leagues/112/overview/liga-profesional", "página HTML de la liga"),
        ("/match/1/matchfacts/x", "página HTML de un partido"),
        ("/tos.txt", "términos de uso en texto plano"),
    ],
    "www.sofascore.com": [
        ("/api/v1/", "raíz de la API interna (también existe api.sofascore.com)"),
        ("/api/v1/team/3202", "API: equipo Boca"),
        ("/api/v1/team/3202/events/last/0", "API: últimos partidos de Boca"),
        ("/api/v1/event/1/lineups", "API: alineaciones de un partido"),
        ("/api/v1/event/1/incidents", "API: eventos (goles, cambios, tarjetas)"),
        ("/api/v1/event/1/statistics", "API: estadísticas del partido"),
        ("/api/v1/unique-tournament/155/season/1/standings/total", "API: tabla de la liga"),
        ("/api/v1/player/1", "API: jugador"),
        ("/team/football/boca-juniors/3202", "página HTML del equipo"),
        ("/tournament/football/argentina/liga-profesional-de-futbol/155", "página HTML de la liga"),
        ("/terms-and-conditions", "términos y condiciones"),
    ],
}

# Resumen de los términos leídos a mano el 2026-10-26. Las frases entre comillas son citas cortas;
# el resto es paráfrasis. No reemplaza leer el texto completo antes de activar la fuente.
TERMS_REVIEW: list[dict[str, str]] = [
    {
        "url": "https://www.fotmob.com/tos.txt",
        "summary": (
            "FotMob Terms of Use, fechados 'October 22, 2026' (FotMob AS, Bergen, Noruega). "
            "Sección 'Data Usage & Scraping': usar datos, contenido o información mostrada en "
            "FotMob para cualquier fin, incluido scraping, reproducción, redistribución o uso "
            "comercial, sin consentimiento escrito expreso está 'strictly prohibited'. Prohíbe "
            "robots, spiders y la recuperación sistemática, regular o masiva de datos. Excepción: "
            "buscadores y asistentes de IA pueden indexar páginas públicas según su robots.txt si "
            "no reproducen datos en bloque. La licencia de uso es personal, no transferible y "
            "'for your own personal, non-commercial use'. No menciona API ni atribución. Ley "
            "aplicable: Noruega, tribunal de distrito de Bergen."
        ),
    },
    {
        "url": "https://www.sofascore.com/terms-and-conditions",
        "summary": (
            "La página existe (título 'Sofascore - Terms & Conditions') pero el texto se carga con "
            "JavaScript y no se pudo leer con un lector de documentos: contenido de los términos "
            "NO VERIFICADO. Operador: Sofascore (Zagreb, Croacia; el nombre legal 'Sofascore Ltd' "
            "es una inferencia, no verificado)."
        ),
    },
    {
        "url": "https://www.sofascore.com/news/terms-of-service/",
        "summary": "URL vieja de términos citada por terceros: solo muestra navegación, sin texto.",
    },
    {
        "url": "https://sofascore.helpscoutdocs.com/article/129-sports-data-api-availability",
        "summary": (
            "FAQ oficial de Sofascore (actualizada 2025-11-06): por acuerdos con sus proveedores "
            "de datos no puede compartir sus fuentes como endpoints de API; los datos deben usarse "
            "según los términos de esos proveedores (propiedad intelectual de terceros). Para "
            "medios ofrece widgets vía su equipo de media partnerships."
        ),
    },
    {
        "url": "https://torneo.com/terms-of-service (redirige desde torneo.sofascore.com)",
        "summary": (
            "Términos de Torneo, otro producto de Sofascore: no se leyeron (redirección a otro "
            "dominio). Según un buscador prohíben data mining, robots y extracción, y exigen "
            "licencia para reproducir contenido con fines comerciales. No aplica directamente a "
            "sofascore.com: no verificado."
        ),
    },
]

PERMISSIONS: dict[str, str] = {
    "consult": (
        "FotMob: sí, como usuario humano con licencia personal no comercial. Sofascore: se "
        "asume consulta humana en la web/app; términos no verificados."
    ),
    "bulk_download": (
        "FotMob: prohibido (recuperación sistemática, regular o masiva). Sofascore: no "
        "verificado; su FAQ dice que no ofrece sus datos como API por acuerdos con proveedores."
    ),
    "automated_queries": (
        "FotMob: prohibido sin consentimiento escrito (robots, spiders, scraping). Sofascore: "
        "no verificado en términos; robots.txt y la FAQ apuntan a no permitirlo."
    ),
    "public_app_reuse": (
        "FotMob: prohibida la reproducción o redistribución de su contenido sin consentimiento "
        "escrito, aun sin fines comerciales. Sofascore: no verificado; la vía oficial para "
        "mostrar sus datos en un sitio son sus widgets (acuerdo con su equipo de medios)."
    ),
    "attribution": (
        "FotMob: no especificado (no hay cláusula de atribución porque no autoriza reutilizar). "
        "Sofascore: no especificado / no verificado."
    ),
}

# Qué ofrecerían según fuentes públicas (páginas de FotMob, guías y scrapers de terceros).
# Nada de esto se comprobó con datos reales: todo queda como "no verificado".
DATA_OFFERED_UNVERIFIED: dict[str, Any] = {
    "fotmob": {
        "proveedor_de_datos": "Opta (según las propias páginas de partido de FotMob)",
        "partido": "fecha, rival, localía, resultado, competición, ronda",
        "alineaciones": "formación, titulares, suplentes, DT; minuto de cambio en los eventos",
        "eventos": "goles (con asistente), tarjetas, cambios, penales, con minuto",
        "stats_equipo_partido": (
            "posesión, tiros, a puerta, big chances, xG, xGOT, pases, córners, momentum, shotmap"
        ),
        "stats_jugador_partido": "calificación FotMob, minutos, xG, xA, pases precisos, tiros",
        "stats_jugador_temporada": "rankings de xG, goles, asistencias, calificación por liga",
        "tabla": "tabla de la Liga Profesional (league id 112) con todos los equipos",
        "cobertura_liga_profesional_2026": (
            "páginas indexadas de FotMob muestran xG por equipo del Apertura 2026: no verificado"
        ),
    },
    "sofascore": {
        "partido": "fecha, rival, localía, resultado, competición, ronda",
        "alineaciones": "titulares, suplentes, formación, calificación por jugador",
        "eventos": "goles, asistencias, tarjetas, cambios, penales, con minuto",
        "stats_equipo_partido": "posesión, tiros, a puerta, pases, duelos, xG en algunas ligas",
        "stats_jugador_partido": "calificación Sofascore, minutos, mapas de calor, pases, duelos",
        "tabla": "tabla de la Liga Profesional (unique tournament 155) con todos los equipos",
        "cobertura_liga_profesional_2026": (
            "páginas indexadas de partidos de Boca 2026 en la Liga Profesional: no verificado"
        ),
    },
}


@dataclass
class RobotsGroup:
    """Un grupo de robots.txt: uno o más User-agent y sus reglas Allow/Disallow."""

    agents: list[str] = field(default_factory=list)
    rules: list[tuple[str, str]] = field(default_factory=list)  # (allow|disallow, patrón)
    crawl_delay: str | None = None


def parse_robots(text: str) -> tuple[list[RobotsGroup], list[str], int]:
    """Parsea robots.txt siguiendo RFC 9309.

    Se hace a mano, además del parser de la stdlib que usa el cliente compartido, porque el manejo
    de comodines (`*`, `$`) y de la regla más larga en `urllib.robotparser` depende de la versión
    de Python. Así el informe no depende de eso y se pueden comparar los dos veredictos.
    Devuelve (grupos, sitemaps, cantidad de líneas de comentario).
    """
    groups: list[RobotsGroup] = []
    sitemaps: list[str] = []
    comments = 0
    current: RobotsGroup | None = None
    last_was_agent = False
    for raw_line in text.splitlines():
        if raw_line.strip().startswith("#"):
            comments += 1
        line = raw_line.split("#", 1)[0].strip()
        if ":" not in line:
            continue
        key, value = (part.strip() for part in line.split(":", 1))
        key = key.lower()
        if key == "user-agent":
            # Varios User-agent seguidos comparten el mismo grupo de reglas.
            if current is None or not last_was_agent:
                current = RobotsGroup()
                groups.append(current)
            current.agents.append(value.lower())
            last_was_agent = True
            continue
        last_was_agent = False
        if key == "sitemap":
            sitemaps.append(value)
        elif current is None:
            continue  # regla fuera de un grupo: el estándar la ignora
        elif key in ("allow", "disallow"):
            current.rules.append((key, value))
        elif key == "crawl-delay":
            current.crawl_delay = value
    return groups, sitemaps, comments


def rules_for(groups: list[RobotsGroup], token: str) -> tuple[str, list[tuple[str, str]]]:
    """Elige las reglas que aplican a un bot: su grupo propio o, si no hay, el grupo '*'.

    Si el mismo agente aparece en varios grupos, el estándar dice que se combinan.
    """
    own = [g for g in groups if token != GENERIC_AGENT and token in g.agents]
    chosen = own or [g for g in groups if GENERIC_AGENT in g.agents]
    label = token if own else GENERIC_AGENT
    merged: list[tuple[str, str]] = []
    for group in chosen:
        merged.extend(group.rules)
    return label, merged


def _pattern_matches(pattern: str, path: str) -> bool:
    """Compara una ruta con un patrón de robots.txt (comodín `*` y ancla final `$`)."""
    anchored = pattern.endswith("$")
    body = pattern[:-1] if anchored else pattern
    regex = "".join(".*" if ch == "*" else re.escape(ch) for ch in body)
    return re.match(regex + ("$" if anchored else ""), path) is not None


def is_allowed(rules: list[tuple[str, str]], path: str) -> tuple[bool, str | None]:
    """Decide si una ruta está permitida: gana la regla más larga; si empatan, gana Allow."""
    if path == "/robots.txt":
        return True, None
    best: tuple[int, bool, str] | None = None
    for kind, pattern in rules:
        if not pattern:
            continue  # "Disallow:" vacío no prohíbe nada
        if _pattern_matches(pattern, path):
            candidate = (len(pattern), kind == "allow", f"{kind}: {pattern}")
            if best is None or candidate[:2] > best[:2]:
                best = candidate
    if best is None:
        return True, None
    return best[1], best[2]


def looks_like_challenge(result: FetchResult) -> bool:
    """Detecta una página de desafío anti-bots (por ejemplo Cloudflare) en vez de robots.txt."""
    head = result.text()[:2000].lower()
    return "text/html" in result.content_type.lower() and (
        "just a moment" in head or "cf-chl" in head or "captcha" in head
    )


def analyse_host(client: PoliteClient, host: str) -> tuple[dict[str, Any], bool]:
    """Descarga el robots.txt de un host y evalúa las rutas candidatas. Devuelve (informe, red)."""
    robots_url = f"https://{host}/robots.txt"
    entry: dict[str, Any] = {"robots_url": robots_url}
    try:
        # check_robots=False: robots.txt siempre se puede leer, y así el cliente no lo descarga
        # dos veces (una para chequearse a sí mismo y otra para devolverlo).
        result = client.get(robots_url, check_robots=False)
    except (FetchError, RetryableFetchError) as exc:
        entry["access_status"] = "error"
        entry["error"] = str(exc)
        return entry, True

    entry.update(
        {
            "status": result.status,
            "content_type": result.content_type,
            "bytes": len(result.body),
            "sha256": result.sha256,
            "from_cache": result.from_cache,
            "fetched_at": result.fetched_at,
        }
    )
    if result.status in (401, 403, 429) or looks_like_challenge(result):
        # Bloqueo o desafío: no se intenta esquivar, se registra y se sigue.
        entry["access_status"] = "bloqueado"
        entry["implication"] = (
            "robots.txt ilegible para nuestro User-Agent: el cliente compartido asume que NADA "
            "del sitio está permitido (ante la duda, no scrapeamos). Reglas reales: no verificado."
        )
        return entry, not result.from_cache
    if result.status == 404:
        entry["access_status"] = "sin_robots_txt (todo permitido por convención)"
    elif not 200 <= result.status < 300:
        entry["access_status"] = f"error_http_{result.status}"
        return entry, not result.from_cache
    else:
        entry["access_status"] = "funciona"

    groups, sitemaps, comments = parse_robots(result.text() if result.status == 200 else "")
    _, generic_rules = rules_for(groups, GENERIC_AGENT)
    ours_label, our_rules = rules_for(groups, OUR_AGENT)
    entry["groups_count"] = len(groups)
    entry["user_agents_named"] = sorted({a for g in groups for a in g.agents})
    entry["agents_fully_blocked"] = sorted(
        {a for g in groups for a in g.agents if ("disallow", "/") in g.rules}
    )
    entry["sitemaps_count"] = len(sitemaps)
    entry["comment_lines"] = comments
    entry["crawl_delays"] = {",".join(g.agents): g.crawl_delay for g in groups if g.crawl_delay is not None}
    entry["generic_bot_rules"] = [f"{k}: {p}" for k, p in generic_rules]
    entry["our_ua_group"] = ours_label
    entry["our_ua_has_own_group"] = ours_label != GENERIC_AGENT
    # Para cada bot nombrado: ¿puede pedir la raíz de la API? Muestra a quién se le hace excepción.
    api_root = CANDIDATE_PATHS[host][0][0]
    entry["api_root_checked"] = api_root
    entry["api_root_allowed_by_agent"] = {
        agent: is_allowed(rules_for(groups, agent)[1], api_root)[0] for agent in entry["user_agents_named"]
    }

    checks: list[dict[str, Any]] = []
    for path, description in CANDIDATE_PATHS.get(host, []):
        generic_ok, generic_rule = is_allowed(generic_rules, path)
        ours_ok, ours_rule = is_allowed(our_rules, path)
        checks.append(
            {
                "path": path,
                "description": description,
                "generic_bot_allowed": generic_ok,
                "generic_bot_rule": generic_rule,
                "our_ua_allowed": ours_ok,
                "our_ua_rule": ours_rule,
                # Lo que diría el cliente compartido (urllib.robotparser). Lee el robots.txt de
                # la caché, así que no suma requests.
                "shared_client_allows": client.robots_allows(f"https://{host}{path}"),
            }
        )
    entry["path_checks"] = checks
    return entry, not result.from_cache


def requests_in_manifest() -> int:
    """Cuenta las descargas reales de esta fuente en el manifiesto (incluye corridas anteriores)."""
    if not MANIFEST_PATH.exists():
        return 0
    total = 0
    for line in MANIFEST_PATH.read_text(encoding="utf-8").splitlines():
        if line.strip() and json.loads(line).get("source") == SOURCE:
            total += 1
    return total


def main() -> None:
    hosts_report: dict[str, Any] = {}
    network_requests = 0
    with PoliteClient(source=SOURCE) as client:
        for host in CANDIDATE_PATHS:
            entry, used_network = analyse_host(client, host)
            hosts_report[host] = entry
            network_requests += int(used_network)

    report: dict[str, Any] = {
        "source": SOURCE,
        "generated_at": datetime.now(UTC).isoformat(timespec="seconds"),
        "mode": "solo_revision_documental: no se pidió ningún endpoint de datos",
        "user_agent": USER_AGENT,
        "network_requests_this_run": network_requests,
        "network_requests_total_manifest": requests_in_manifest(),
        "robots": hosts_report,
        "robots_not_checked": [
            "https://api.sofascore.com/robots.txt (host real de la API de Sofascore)",
            "otros subdominios de FotMob (por ejemplo, de imágenes o datos)",
        ],
        "terms_reviewed": TERMS_REVIEW,
        "permissions": PERMISSIONS,
        "data_offered_unverified": DATA_OFFERED_UNVERIFIED,
        "ids_unverified": {
            "fotmob": {"boca_team_id": 10077, "liga_profesional_league_id": 112},
            "sofascore": {"boca_team_id": 3202, "liga_profesional_unique_tournament_id": 155},
        },
    }
    path = write_report(SOURCE, report)
    # Ruta relativa: la consola de Windows (cp1252) no puede imprimir la Θ del nombre del repo.
    print(f"Informe guardado en {path.relative_to(ROOT).as_posix()}")
    for host, entry in hosts_report.items():
        print(f"{host}: {entry.get('access_status')} (HTTP {entry.get('status', '-')})")
    print(f"Requests de red en esta corrida: {network_requests}")


if __name__ == "__main__":
    main()
