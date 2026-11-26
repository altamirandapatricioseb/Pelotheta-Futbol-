"""Estadísticas por jugador de toda una liga (Bzzoiro) y perfiles derivados (etapa 5d).

Qué hace:
1. `collect`: lista los partidos terminados de la temporada de la liga y baja, por cada uno, las
   estadísticas por jugador y las alineaciones (dos consultas por partido, en caché una vez
   terminado). La Liga Profesional 2026 son ~500 partidos: ~1000 consultas de 7500 por día.
2. `profiles`: por jugador, minutos, partidos y el percentil (0 a 100) de cada estadística clave
   cada 90 minutos contra los de su misma posición en la liga.

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
GOALKEEPER_STATS = {"saves", "goals_prevented", "accurate_pass"}
OUTFIELD_STATS = set(KEY_STATS) - {"saves", "goals_prevented"}


def collect(client: bz.BzzoiroClient, league_id: int, season_year: int) -> list[dict[str, Any]]:
    """Filas crudas jugador × partido de los partidos terminados de la temporada."""
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
    for e in events:
        stats = client.get(f"/api/v2/events/{e.event_id}/player-stats/", cache_key=f"ps_{e.event_id}")
        lineups = client.get(f"/api/v2/events/{e.event_id}/lineups/", cache_key=f"lu_{e.event_id}")
        date = e.kickoff.date().isoformat()
        for row in bz.parse_all_player_stats(stats, lineups):
            rows.append({"event_id": e.event_id, "match_date": date, "season_year": season_year, **row})
    return rows


def profiles(rows: list[dict[str, Any]], season_year: int) -> list[dict[str, Any]]:
    """Un perfil por jugador con al menos `MIN_MINUTES`: percentiles por 90 contra su posición."""
    by_player: dict[Any, list[dict[str, Any]]] = defaultdict(list)
    for r in rows:
        by_player[r["player_id"]].append(r)
    players = []
    for games in by_player.values():
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
        out.append(row)
    return sorted(out, key=lambda r: (r["team_name"], r["player_name"]))
