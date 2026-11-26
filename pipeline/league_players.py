"""Estadísticas por jugador de toda una liga (Bzzoiro) y perfiles derivados (etapa 5d).

Qué hace:
1. `collect`: lista los partidos terminados de la temporada de la liga y baja, por cada uno, las
   estadísticas por jugador y las alineaciones (dos consultas por partido, en caché una vez
   terminado). La Liga Profesional 2026 son ~500 partidos: ~1000 consultas de 7500 por día.
2. `profiles`: por jugador, minutos, partidos, el promedio cada 90 minutos de cada estadística clave
   y su percentil (0 a 100) contra los de su misma posición en la liga.

Licencia: el crudo (`league_player_match`) va solo al dataset privado; los perfiles son un
resultado propio y se publican (la licencia de Bzzoiro permite publicar derivados).
"""

from __future__ import annotations

from collections import Counter, defaultdict
from typing import Any

from pipeline.projection import percentile
from sources import bzzoiro as bz

PAGE = 100
MIN_MINUTES = 450  # cinco partidos completos: con menos, un percentil cambia con un solo partido
POSITIONS = {"G": "Arquero", "D": "Defensor", "M": "Mediocampista", "F": "Delantero"}
# Estadística → más es mejor. Elegidas para cubrir las cuatro zonas sin repetir lo mismo.
KEY_STATS = {
    "goals": True,
    "expected_goals": True,
    "expected_assists": True,
    "key_pass": True,
    "accurate_pass": True,
    "progressive_ball_carries_count": True,
    "won_contest": True,
    "won_tackle": True,
    "interception": True,
    "ball_recovery": True,
    "aerial_won": True,
    "duel_won": True,
    "saves": True,
    "goals_prevented": True,
    "possession_lost": False,
}
# Clave del catálogo (las de `similarity.FEATURES`) → campo de Bzzoiro, sumado en la temporada. Las
# definiciones coinciden con `data/stat_catalog.csv` (pases, largos y centros: intentados). Bzzoiro no
# informa penales: «goles_sin_penal» y «npxg» quedan sin dato, no en 0.
CATALOG_SUMS = {
    "remates": "total_shots",
    "xa": "expected_assists",
    "pases_clave": "key_pass",
    "regates_exitosos": "won_contest",
    "conducciones_progresivas": "progressive_ball_carries_count",
    "pases": "total_pass",
    "pases_completos": "accurate_pass",
    "pases_largos": "total_long_balls",
    "centros": "total_cross",
    "entradas_ganadas": "won_tackle",
    "intercepciones": "interception",
    "recuperaciones": "ball_recovery",
    "despejes": "total_clearance",
    "aereos_ganados": "aerial_won",
    "duelos_ganados": "duel_won",
    "duelos_perdidos": "duel_lost",
    "remates_arco": "shots_on_target",
    "ocasiones_claras_falladas": "big_chance_missed",
    "pases_campo_rival_completos": "accurate_opposition_half_passes",
    "veces_regateado": "challenge_lost",
    "errores_gol": "error_lead_to_a_goal",
    # Arqueros (las claves que usa el Ojeador en ese puesto).
    "goles_recibidos": "goals_conceded",
    "atajadas_dentro_area": "saved_shots_from_inside_the_box",
    "salidas_exitosas": "accurate_keeper_sweeper",
    "centros_atrapados": "good_high_claim",
}
GOALKEEPER_STATS = {"saves", "goals_prevented", "accurate_pass"}
OUTFIELD_STATS = set(KEY_STATS) - {"saves", "goals_prevented"}


def collect(
    client: bz.BzzoiroClient,
    league_id: int,
    season_year: int,
    max_new: int | None = None,
    report: dict[str, int] | None = None,
) -> list[dict[str, Any]]:
    """Filas crudas jugador × partido de los partidos terminados de la temporada.

    `max_new`: tope de consultas nuevas (las que no están en caché) en esta corrida; los partidos que
    no entran se piden en la próxima (la caché se guarda entre corridas). `report` recibe partidos,
    pendientes y consultas nuevas, para la cobertura."""
    events: list[bz.LeagueEvent] = []
    offset = 0
    while True:
        page = client.get(
            "/api/v2/events/",
            {
                "league_id": league_id,
                "status": "finished",
                "date_from": f"{season_year}-01-01",
                "limit": PAGE,
                "offset": offset,
            },
        )
        events.extend(bz.parse_league_events(page, season_year))
        offset += PAGE
        if not page.get("next"):
            break
    rows = []
    new = pending = 0
    for e in events:
        cached = all((client.cache_dir / f"{k}_{e.event_id}.json").exists() for k in ("ps", "lu"))
        if not cached:
            if max_new is not None and new + 2 > max_new:
                pending += 1
                continue
            new += 2
        stats = client.get(f"/api/v2/events/{e.event_id}/player-stats/", cache_key=f"ps_{e.event_id}")
        lineups = client.get(f"/api/v2/events/{e.event_id}/lineups/", cache_key=f"lu_{e.event_id}")
        date = e.kickoff.date().isoformat()
        for row in bz.parse_all_player_stats(stats, lineups):
            rows.append({"event_id": e.event_id, "match_date": date, "season_year": season_year, **row})
    if report is not None:
        report.update({"partidos": len(events), "pendientes": pending, "consultas_nuevas": new})
    return rows


def collect_from_env(season_year: int, warnings: list[str]) -> list[dict[str, Any]]:
    """`collect` de la Liga Profesional con la clave de `BZZOIRO_API_KEY`; vacío (con aviso) sin clave
    o si Bzzoiro no responde. Lo usan los modelos (`analytics`) y Mejoría y Potencial (`own_metrics`)."""
    import os

    key = os.environ.get("BZZOIRO_API_KEY", "")
    if not key:
        warnings.append("Sin BZZOIRO_API_KEY: sin estadísticas de jugadores de otros clubes")
        return []
    try:
        return collect(
            bz.BzzoiroClient(api_key=key), bz.LEAGUES["arg-liga-profesional-argentina"], season_year
        )
    except bz.BzzoiroError as exc:
        warnings.append(f"Bzzoiro no respondió: {exc}")
        return []


def season_stats(rows: list[dict[str, Any]]) -> dict[tuple[str, str], dict[str, Any]]:
    """(jugador, club) → minutos y totales de la temporada con las claves del catálogo, para
    `player_pool`: así el Ojeador y Alternativas comparan con jugadores de toda la liga."""
    acc: dict[tuple[str, str], dict[str, Any]] = {}
    for r in rows:
        a = acc.setdefault((r["player_name"], r["team_name"]), {"minutes": 0.0, "stats": {}, "rated": 0.0})
        minutes = r.get("minutes_played") or 0
        a["minutes"] += minutes
        st = a["stats"]
        for key, field in CATALOG_SUMS.items():
            if r.get(field) is not None:
                st[key] = st.get(key, 0.0) + r[field]
        if r.get("rating") is not None and minutes:
            st["_nota_x_min"] = st.get("_nota_x_min", 0.0) + r["rating"] * minutes
            a["rated"] += minutes
        if r.get("goals_conceded") is not None:  # partido completo sin goles en contra
            st["vallas_invictas"] = st.get("vallas_invictas", 0.0) + (
                minutes >= 90 and r["goals_conceded"] == 0
            )
    for a in acc.values():
        st = a["stats"]
        if st.get("pases"):
            st["pct_pases"] = (
                round(st["pases_completos"] / st["pases"] * 100, 1) if "pases_completos" in st else None
            )
        disputed = st.get("duelos_ganados", 0) + st.get("duelos_perdidos", 0)
        if disputed:
            st["pct_duelos"] = round(st.get("duelos_ganados", 0) / disputed * 100, 1)
        # Calificación: promedio de la nota de la fuente pesado por minutos (no se suma).
        rated, nota = a.pop("rated"), st.pop("_nota_x_min", None)
        st["calificacion"] = round(nota / rated, 2) if nota is not None and rated else None
        a["minutes"] = int(a["minutes"])
        a["stats"] = {k: round(v, 3) for k, v in st.items() if v is not None}
    return acc


def profiles(rows: list[dict[str, Any]], season_year: int) -> list[dict[str, Any]]:
    """Un perfil por jugador con al menos `MIN_MINUTES`: percentiles por 90 contra su posición."""
    by_player: dict[Any, list[dict[str, Any]]] = defaultdict(list)
    for r in rows:
        by_player[r["player_id"]].append(r)
    players = []
    for player_id, games in by_player.items():
        minutes = sum(g.get("minutes_played") or 0 for g in games)
        if minutes < MIN_MINUTES:
            continue
        position = Counter(g.get("position") for g in games if g.get("position")).most_common(1)
        last = max(games, key=lambda g: g["match_date"])
        per90 = {}
        for stat in KEY_STATS:
            # Solo partidos que traen la estadística: el faltante no cuenta como 0.
            with_stat = [g for g in games if g.get(stat) is not None]
            mins = sum(g.get("minutes_played") or 0 for g in with_stat)
            per90[stat] = sum(g[stat] for g in with_stat) / mins * 90 if mins else None
        players.append(
            {
                "player_id": str(player_id),
                "player_name": last["player_name"],
                "team_name": last["team_name"],
                "position": POSITIONS.get(position[0][0]) if position else None,
                "season_year": season_year,
                "matches": len(games),
                "minutes": minutes,
                "per90": per90,
            }
        )
    out = []
    for p in players:
        peers = [q for q in players if q["position"] == p["position"]]
        row = {k: v for k, v in p.items() if k != "per90"}
        relevant = GOALKEEPER_STATS if p["position"] == "Arquero" else OUTFIELD_STATS
        for stat, higher in KEY_STATS.items():
            value = p["per90"][stat] if stat in relevant else None
            reference = [q["per90"][stat] for q in peers if q["per90"][stat] is not None]
            row[f"pct_{stat}"] = None if value is None else round(percentile(value, reference, higher))
            # El promedio cada 90 también es un resultado propio: el crudo por partido no sale.
            row[f"per90_{stat}"] = None if value is None else round(value, 2)
        out.append(row)
    return sorted(out, key=lambda r: (r["team_name"], r["player_name"]))
