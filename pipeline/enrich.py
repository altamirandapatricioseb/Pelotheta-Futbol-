"""Cruce de fuentes: agrega a los partidos de Promiedos los datos que solo trae otra fuente.

Orden y prioridad: Promiedos, después ScoutingStats y al final NoFluffPicks. Una clave que ya
cargó una fuente para ese equipo y partido no se pisa con la siguiente; así cada número tiene
una sola fuente y el xG sale del mismo modelo en todos los partidos donde se pueda.

El cruce es por fecha (Boca juega como mucho un partido por día) y se verifica que Boca sea
local en las dos fuentes: si no coincide, el dato no se usa y queda un aviso. Los remates, que
traen todas, sirven de control de calidad entre fuentes (validación cruzada, regla 8b).
"""

from __future__ import annotations

import difflib
from datetime import UTC

from pydantic import ValidationError

from pipeline.models import (
    FormationRecord,
    MomentumRecord,
    PlayerStatRecord,
    ShotRecord,
    TeamStatRecord,
)
from sources import nofluffpicks as nfp
from sources import promiedos as pd
from sources import scoutingstats as ss
from sources import strikerapi as st

# Solo estas claves se toman de NoFluffPicks; el resto lo trae Promiedos o ScoutingStats.
NFP_KEYS = ("xg", "dangerous_attacks")
MAX_SHOT_GAP = 3  # diferencia de remates entre fuentes que se informa como aviso
NAME_CUTOFF = 0.85  # parecido mínimo de nombres para emparejar un jugador entre fuentes


def _add_team_stats(
    parsed: pd.ParsedGame, stats: dict[str, tuple[float, float]], keys: tuple[str, ...] | None, source: str
) -> None:
    home, away = parsed.match.home_source_id, parsed.match.away_source_id
    present = {(s.team_source_id, s.stat_key) for s in parsed.team_stats}
    for key, (home_value, away_value) in stats.items():
        if keys is not None and key not in keys:
            continue
        for team, value in ((home, home_value), (away, away_value)):
            if (team, key) not in present:
                parsed.team_stats.append(
                    TeamStatRecord(
                        match_source_id=parsed.match.source_id,
                        team_source_id=team,
                        stat_key=key,
                        value=value,
                        source=source,
                    )
                )


def _check_shots(
    parsed: pd.ParsedGame, stats: dict[str, tuple[float, float]], label: str, warnings: list[str]
) -> None:
    promiedos_shots = {
        s.team_source_id: s.value
        for s in parsed.team_stats
        if s.stat_key == "shots_total" and s.source is None
    }
    home = parsed.match.home_source_id
    if "shots_total" in stats and home in promiedos_shots:
        gap = abs(promiedos_shots[home] - stats["shots_total"][0])
        if gap > MAX_SHOT_GAP:
            warnings.append(f"{label}: los remates difieren en {gap:.0f} con Promiedos")


def _boca_lineup_ids(parsed: pd.ParsedGame) -> list[str]:
    return [lu.player_source_id for lu in parsed.lineups if lu.team_source_id == pd.BOCA_ID]


def match_player(name: str, candidates: list[str]) -> str | None:
    """Id de Promiedos del jugador con ese nombre en la alineación de Boca, o None.

    Primero el nombre normalizado exacto; después el apellido si es único en la alineación
    («C. Nueve» -> «carlos nueve»); por último el nombre más parecido por encima del umbral.
    """
    key = pd.player_key(name)
    if key in candidates:
        return key
    last = key.split()[-1] if key else ""
    by_last = [c for c in candidates if c.split()[-1] == last]
    if len(by_last) == 1:
        return by_last[0]
    close = difflib.get_close_matches(key, candidates, n=1, cutoff=NAME_CUTOFF)
    return close[0] if close else None


def attach_scoutingstats(
    games: list[pd.ParsedGame], matches: list[ss.ParsedMatch], warnings: list[str]
) -> int:
    """Agrega estadísticas de equipo, formaciones y estadísticas por jugador. Devuelve cuántos."""
    by_date = {g.match.match_date: g for g in games}
    attached = 0
    for found in matches:
        parsed = by_date.get(found.local_date)
        if parsed is None:
            continue
        label = f"ScoutingStats {found.local_date.isoformat()}"
        if (parsed.match.home_source_id == pd.BOCA_ID) != found.boca_home:
            warnings.append(f"{label}: local y visitante no coinciden con Promiedos")
            continue
        _add_team_stats(parsed, found.team_stats, None, ss.SOURCE)
        _check_shots(parsed, found.team_stats, label, warnings)
        if found.formations:
            sides = (parsed.match.home_source_id, parsed.match.away_source_id)
            have = {f.team_source_id for f in parsed.formations}  # Promiedos va primero
            parsed.formations.extend(
                FormationRecord(
                    match_source_id=parsed.match.source_id,
                    team_source_id=team,
                    formation=formation,
                    source=ss.SOURCE,
                )
                for team, formation in zip(sides, found.formations, strict=True)
                if team not in have
            )
        _add_player_stats(parsed, [(p.name, p.stats) for p in found.boca_players], ss.SOURCE, label, warnings)
        parsed.momentum.extend(
            MomentumRecord(
                match_source_id=parsed.match.source_id,
                minute=minute,
                side=side,
                value=value,
                source=ss.SOURCE,
            )
            for minute, side, value in found.momentum
        )
        attached += 1
    return attached


def _add_player_stats(
    parsed: pd.ParsedGame,
    lines: list[tuple[str, dict[str, float]]],
    source: str,
    label: str,
    warnings: list[str],
) -> None:
    candidates = _boca_lineup_ids(parsed)
    present = {(s.player_source_id, s.stat_key) for s in parsed.player_stats}
    for name, stats in lines:
        player_id = match_player(name, candidates)
        if player_id is None:
            warnings.append(f"{label}: jugador sin pareja en Promiedos: {name}")
            continue
        parsed.player_stats.extend(
            PlayerStatRecord(
                match_source_id=parsed.match.source_id,
                player_source_id=player_id,
                stat_key=key,
                value=value,
                source=source,
            )
            for key, value in stats.items()
            if (player_id, key) not in present
        )


def _boca_goal_types(goals: list[st.GoalInfo]) -> dict[str, dict[str, float]]:
    """Goles por situación de cada goleador de Boca y asistencias por tipo de cada asistidor."""
    by_player: dict[str, dict[str, float]] = {}
    for goal in goals:
        if goal.team_id != st.BOCA_ID:
            continue
        if goal.scorer and goal.situation:
            stats = by_player.setdefault(goal.scorer, {})
            key = f"goals_{goal.situation}"
            stats[key] = stats.get(key, 0) + 1
        if goal.assister and goal.assist_type:
            stats = by_player.setdefault(goal.assister, {})
            key = f"assists_{goal.assist_type}"
            stats[key] = stats.get(key, 0) + 1
    return by_player


def attach_strikerapi(
    games: list[pd.ParsedGame], lines: list[st.GameLine], shots: list[st.Shot], warnings: list[str]
) -> int:
    """Agrega despejes, entradas ganadas, faltas por jugador y los tiros ubicados. Devuelve cuántos.

    El cruce es por fecha UTC del inicio (la API publica la fecha en UTC) y se verifica el lado
    de Boca. Los tiros se asignan por el id de partido de la API.
    """
    by_utc_date = {g.match.kickoff_at.astimezone(UTC).date(): g for g in games}
    by_game_id: dict[str, pd.ParsedGame] = {}
    for line in lines:
        parsed = by_utc_date.get(line.utc_date)
        if parsed is None:
            continue
        label = f"StrikerAPI {line.utc_date.isoformat()}"
        if (parsed.match.home_source_id == pd.BOCA_ID) != line.boca_home:
            warnings.append(f"{label}: local y visitante no coinciden con Promiedos")
            continue
        _add_team_stats(parsed, line.team_stats, None, st.SOURCE)
        _add_player_stats(parsed, [(p.name, p.stats) for p in line.boca_players], st.SOURCE, label, warnings)
        _add_player_stats(parsed, list(_boca_goal_types(line.goals).items()), st.SOURCE, label, warnings)
        by_game_id[line.game_id] = parsed
    for shot in shots:
        parsed = by_game_id.get(shot.game_id)
        if parsed is None:
            continue
        boca_team = pd.BOCA_ID
        rival_team = (
            parsed.match.away_source_id
            if parsed.match.home_source_id == boca_team
            else parsed.match.home_source_id
        )
        player_id = match_player(shot.player, _boca_lineup_ids(parsed)) if shot.boca and shot.player else None
        try:
            record = ShotRecord(
                match_source_id=parsed.match.source_id,
                team_source_id=boca_team if shot.boca else rival_team,
                player_source_id=player_id,
                minute=shot.minute,
                outcome=shot.outcome,
                body_part=shot.body_part,
                penalty=shot.penalty,
                zone=shot.zone,
                xg=shot.xg,
                x=shot.x,
                y=shot.y,
                end_x=shot.end_x,
                end_y=shot.end_y,
                source=st.SOURCE,
            )
        except ValidationError:
            warnings.append(f"StrikerAPI {shot.game_id}: tiro con valores fuera de rango, omitido")
            continue
        parsed.shots.append(record)
    return len(by_game_id)


def attach_nofluffpicks(
    games: list[pd.ParsedGame],
    fixtures_with_stats: list[tuple[nfp.Fixture, dict[str, tuple[float, float]]]],
    warnings: list[str],
) -> int:
    """Agrega las estadísticas de NoFluffPicks a los partidos que coinciden. Devuelve cuántos."""
    by_date = {g.match.match_date: g for g in games}
    attached = 0
    for fixture, stats in fixtures_with_stats:
        parsed = by_date.get(fixture.local_date)
        if parsed is None or not stats:
            continue
        boca_home_pd = parsed.match.home_source_id == pd.BOCA_ID
        boca_home_nfp = fixture.home_id == nfp.BOCA_ID
        if boca_home_pd != boca_home_nfp:
            warnings.append(f"NoFluffPicks {fixture.slug}: local y visitante no coinciden con Promiedos")
            continue
        _add_team_stats(parsed, stats, NFP_KEYS, nfp.SOURCE)
        _check_shots(parsed, stats, f"NoFluffPicks {fixture.slug}", warnings)
        attached += 1
    return attached
