"""Alternativas para un jugador: perfiles con K-means y los más parecidos, de otros clubes primero.

1. Cada jugador de campo con al menos `MIN_MINUTES` es un vector de estadísticas cada 90 minutos
   del sistema, estandarizadas (z = (x − media) / desvío): así «pases» y «goles» pesan lo mismo.
2. K-means agrupa los vectores en k perfiles; k se elige entre 2 y 6 por la silueta más alta.
3. Para cada jugador del equipo elegido, tres listas de mejor a peor (más parecido primero):
   - «externo»: un jugador de otro club, 1 a 1;
   - «dupla»: dos jugadores de otros clubes cuyo perfil promedio se le parece (y que, con precios,
     juntos cuestan menos: la idea de Moneyball);
   - «club»: un compañero del mismo equipo, aparte, para que no tape a los de afuera.

Los jugadores de otros clubes entran cuando tienen estadísticas para al menos `MIN_COVERAGE` de las
variables (lo que falta se completa con el promedio: queda neutro). Hoy solo Boca tiene
estadísticas, así que «externo» y «dupla» quedan vacías hasta que se carguen las de otros clubes.
Los arqueros quedan afuera: sus estadísticas no comparten espacio con las de campo.
"""

from __future__ import annotations

import itertools
from collections.abc import Mapping, Sequence
from typing import Any

from pipeline import projection as pj
from pipeline import stats

MIN_MINUTES = 450
MIN_COVERAGE = 0.7
K_RANGE = range(2, 7)
TOP_EXTERNAL = 10
TOP_PAIR = 5
TOP_CLUB = 5
PAIR_POOL = 15  # las duplas se arman entre los 15 externos más parecidos (105 pares por jugador)
SILHOUETTE_SAMPLE = 400  # shortcut: silueta sobre una muestra fija; con ligas enteras es O(n²)

# (clave del catálogo, etiqueta, nombre de perfil, cada 90). Las de porcentaje no se pasan a 90.
FEATURES: tuple[tuple[str, str, str, bool], ...] = (
    ("goles_sin_penal", "Goles sin penal", "Goleador", True),
    ("npxg", "npxG", "Rematador", True),
    ("remates", "Remates", "Rematador", True),
    ("xa", "xA", "Asistidor", True),
    ("pases_clave", "Pases clave", "Creador", True),
    ("regates_exitosos", "Regates exitosos", "Regateador", True),
    ("conducciones_progresivas", "Conducciones progresivas", "Conductor", True),
    ("pases", "Pases", "Distribuidor", True),
    ("pct_pases", "% de pases", "Preciso", False),
    ("pases_largos", "Pases largos", "Lanzador", True),
    ("centros", "Centros", "Centrador", True),
    ("entradas_ganadas", "Entradas ganadas", "Quitador", True),
    ("intercepciones", "Intercepciones", "Anticipador", True),
    ("recuperaciones", "Recuperaciones", "Recuperador", True),
    ("despejes", "Despejes", "Despejador", True),
    ("aereos_ganados", "Aéreos ganados", "Aéreo", True),
    ("duelos_ganados", "Duelos ganados", "Duelista", True),
)
KEYS = [k for k, _, _, _ in FEATURES]
NO_OTHERS = "Todavía no hay estadísticas de jugadores de otros clubes: por ahora solo aparecen compañeros."

Player = Mapping[str, Any]


def raw_features(p: Player) -> dict[str, float | None]:
    """Estadísticas cada 90 del jugador (None donde la fuente no la tiene)."""
    st = p.get("stats") or {}
    minutes = p.get("minutes") or 0
    out: dict[str, float | None] = {}
    for key, _, _, per90 in FEATURES:
        value = st.get(key)
        if value is None or minutes <= 0:
            out[key] = None
        else:
            out[key] = float(value) * 90 / minutes if per90 else float(value)
    return out


def _coverage(f: Mapping[str, float | None]) -> float:
    return sum(v is not None for v in f.values()) / len(f)


def _style_name(center: Sequence[float], used: set[str]) -> str:
    # Las dos variables con el z más alto del centro dan el nombre («Creador · Regateador»).
    words: list[str] = []
    for i in sorted(range(len(FEATURES)), key=lambda i: -center[i]):
        if FEATURES[i][2] not in words:
            words.append(FEATURES[i][2])
        if len(words) == 2:
            break
    name, n = " · ".join(words), 2
    while name in used:
        name = f"{' · '.join(words)} {n}"
        n += 1
    used.add(name)
    return name


def _best_k(
    points: list[list[float]],
) -> tuple[int, list[int], list[list[float]], float, list[dict[str, float]]]:
    step = max(1, len(points) // SILHOUETTE_SAMPLE)
    sample = list(range(0, len(points), step))
    trials = []
    for k in K_RANGE:
        if k >= len(points):
            break
        labels, centers, inertia = stats.kmeans(points, k)
        score = stats.silhouette([points[i] for i in sample], [labels[i] for i in sample])
        trials.append((score, k, labels, centers, inertia))
    score, k, labels, centers, _ = max(trials, key=lambda t: t[0])
    return k, labels, centers, score, [{"k": t[1], "silhouette": t[0], "inertia": t[4]} for t in trials]


def _member(c: Player, label: str) -> dict[str, Any]:
    return {
        "name": c["name"],
        "team": c["team"],
        "player_id": c.get("player_id"),
        "position": c.get("position_group"),
        "profile": label,
        "value_eur": c.get("value_eur"),
    }


def fit(own: Sequence[Player], others: Sequence[Player], team_slug: str) -> dict[str, Any]:
    """Run del modelo: {'run', 'styles', 'alternatives'} listo para la base.

    `own`: jugadores del equipo elegido (player_id, name, team, position_group, minutes, stats,
    value_eur). `others`: jugadores de otros clubes con la misma forma (sin player_id).
    """
    params: dict[str, Any] = {
        "features": [{"id": k, "label": label, "style": style} for k, label, style, _ in FEATURES],
        "min_minutes": MIN_MINUTES,
        "min_coverage": MIN_COVERAGE,
    }

    def eligible(p: Player, need: float) -> dict[str, float | None] | None:
        if p.get("position_group") == "Arquero" or (p.get("minutes") or 0) < MIN_MINUTES:
            return None
        f = raw_features(p)
        return f if _coverage(f) >= need else None

    mine = [(p, f) for p in own if (f := eligible(p, 1.0)) is not None]
    outside = [(p, f) for p in others if (f := eligible(p, MIN_COVERAGE)) is not None]
    params["others_total"] = len(others)
    params["others_with_stats"] = len(outside)
    if len(mine) < 6:
        return {
            "run": {
                "model": "alternativas",
                "team_slug": team_slug,
                "status": "sin_datos",
                "n": len(mine),
                "metrics": {},
                "params": params,
                "message": f"Hay {len(mine)} jugadores de campo propios con {MIN_MINUTES} minutos o más.",
            },
            "styles": [],
            "alternatives": [],
        }
    everyone = mine + outside
    # Lo que le falta a un jugador de afuera se completa con el promedio de los que sí lo tienen.
    means = {k: stats.mean([v for _, f in everyone if (v := f[k]) is not None]) for k in KEYS}
    columns = [[v if (v := f[k]) is not None else means[k] for _, f in everyone] for k in KEYS]
    points = [list(row) for row in zip(*stats.zscores(columns), strict=True)]
    k, labels, centers, score, curve = _best_k(points)
    used: set[str] = set()
    names = {c: _style_name(centers[c], used) for c in range(k)}
    n_mine = len(mine)
    coords, shares = stats.pca2(points[:n_mine])
    center = [stats.mean(col) for col in zip(*points, strict=True)]
    # «% de parecido»: distancia contra el doble del punto más lejano al centro (cota del par más
    # lejano, sin calcular las n² distancias).
    d_ref = 2 * max(stats.dist(p, center) for p in points) or 1.0

    def similarity(d: float) -> float:
        return round(max(0.0, 100 * (1 - d / d_ref)), 1)

    styles = [
        {
            "player_id": p["player_id"],
            "cluster": labels[i],
            "cluster_label": names[labels[i]],
            "pc1": coords[i][0],
            "pc2": coords[i][1],
            "features": {key: round(columns[j][i], 3) for j, key in enumerate(KEYS)},
            "z": {key: round(points[i][j], 3) for j, key in enumerate(KEYS)},
            "percentiles": {
                key: round(pj.percentile(columns[j][i], columns[j][:n_mine], True), 1)
                for j, key in enumerate(KEYS)
            },
        }
        for i, (p, _) in enumerate(mine)
    ]
    alternatives: list[dict[str, Any]] = []
    for i, (target, _) in enumerate(mine):
        value = target.get("value_eur")
        club = sorted((j for j in range(n_mine) if j != i), key=lambda j: stats.dist(points[i], points[j]))
        ext = sorted(range(n_mine, len(everyone)), key=lambda j: stats.dist(points[i], points[j]))
        for section, picks in (("club", club[:TOP_CLUB]), ("externo", ext[:TOP_EXTERNAL])):
            for rank, j in enumerate(picks, start=1):
                cand = everyone[j][0]
                price = cand.get("value_eur")
                alternatives.append(
                    {
                        "player_id": target["player_id"],
                        "section": section,
                        "rank": rank,
                        "members": [_member(cand, names[labels[j]])],
                        "similarity": similarity(stats.dist(points[i], points[j])),
                        "total_value_eur": price,
                        "savings_eur": value - price if value and price else None,
                    }
                )
        pairs = []
        for a, b in itertools.combinations(ext[:PAIR_POOL], 2):
            pa, pb = everyone[a][0].get("value_eur"), everyone[b][0].get("value_eur")
            total = pa + pb if pa and pb else None
            if value and total is not None and total > value:
                continue  # Moneyball: la dupla tiene que costar menos que el jugador que se va
            profile = [(x + y) / 2 for x, y in zip(points[a], points[b], strict=True)]
            pairs.append((stats.dist(points[i], profile), a, b, total))
        pairs.sort(key=lambda t: t[0])
        for rank, (d, a, b, total) in enumerate(pairs[:TOP_PAIR], start=1):
            alternatives.append(
                {
                    "player_id": target["player_id"],
                    "section": "dupla",
                    "rank": rank,
                    "members": [
                        _member(everyone[a][0], names[labels[a]]),
                        _member(everyone[b][0], names[labels[b]]),
                    ],
                    "similarity": similarity(d),
                    "total_value_eur": total,
                    "savings_eur": value - total if value and total is not None else None,
                }
            )
    corr = [[round(stats.pearson(a[:n_mine], b[:n_mine]), 3) for b in columns] for a in columns]
    return {
        "run": {
            "model": "alternativas",
            "team_slug": team_slug,
            "status": "ok",
            "n": len(everyone),
            "metrics": {
                "k": k,
                "silhouette": score,
                "k_curve": curve,
                "pca_share": list(shares),
                "correlation": corr,
                "own_players": n_mine,
                "other_players": len(outside),
            },
            "params": params,
            "message": None if outside else NO_OTHERS,
        },
        "styles": styles,
        "alternatives": alternatives,
    }
