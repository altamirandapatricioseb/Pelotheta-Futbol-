"""Cruce de fuentes: agrega a los partidos de Promiedos los datos que solo trae otra fuente.

NoFluffPicks aporta el xG y los ataques peligrosos por partido. El cruce es por fecha (Boca
juega como mucho un partido por día) y se verifica que Boca sea local en las dos fuentes: si no
coincide, el dato no se usa y queda un aviso. Los remates, que traen ambas, sirven de control
de calidad entre fuentes (validación cruzada, regla 8b).
"""

from __future__ import annotations

from pipeline.models import TeamStatRecord
from sources import nofluffpicks as nfp
from sources import promiedos as pd

# Solo estas claves se toman de NoFluffPicks; el resto lo trae Promiedos.
NFP_KEYS = ("xg", "dangerous_attacks")
MAX_SHOT_GAP = 3  # diferencia de remates entre fuentes que se informa como aviso


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
        home, away = parsed.match.home_source_id, parsed.match.away_source_id
        for key in NFP_KEYS:
            if key in stats:
                for team, value in ((home, stats[key][0]), (away, stats[key][1])):
                    parsed.team_stats.append(
                        TeamStatRecord(
                            match_source_id=parsed.match.source_id,
                            team_source_id=team,
                            stat_key=key,
                            value=value,
                            source=nfp.SOURCE,
                        )
                    )
        promiedos_shots = {
            s.team_source_id: s.value for s in parsed.team_stats if s.stat_key == "shots_total"
        }
        if "shots_total" in stats and home in promiedos_shots:
            gap = abs(promiedos_shots[home] - stats["shots_total"][0])
            if gap > MAX_SHOT_GAP:
                warnings.append(
                    f"{fixture.slug}: los remates difieren en {gap:.0f} entre Promiedos y NoFluffPicks"
                )
        attached += 1
    return attached
