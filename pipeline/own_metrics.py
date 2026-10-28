"""Métricas propias del equipo y de los jugadores (secciones 5.6, 5.7 y 6): cálculo y carga.

Lee los valores ya cargados desde las vistas públicas de la base (así usa también los datos de
las fuentes que fallaron en esta corrida y se conservaron), aplica las fórmulas de
`pipeline.metrics` y escribe los resultados con `ingest.load_stat_values`:

- por partido (`core.stat_match_value`): Elo, probabilidades, xPts, rotación... calculados solo
  con datos anteriores al partido;
- por ventana (`core.stat_value`): cada competición y 'todas' (rachas, forma, NR, EWA, ELA...).

Uso: uv run python -m pipeline.own_metrics   (también corre al final de pipeline.run)
"""

from __future__ import annotations

import os
import statistics
import sys
import unicodedata
from collections import defaultdict
from collections.abc import Iterable
from dataclasses import dataclass, field
from typing import Any

import httpx

from pipeline import load
from pipeline import metrics as m
from pipeline import projection_data as pdata

PAGE = 1000
# Mínimo de minutos para entrar en el nivel de reemplazo de NR relativo (sección 6, configurable).
REPLACEMENT_MIN_MINUTES = 90
PLAYER_KEYS = (
    "minutes",
    "starts",
    "appearances",
    "goals",
    "assists",
    "goal_contributions",
    "team_goals_on",
    "team_goals_against_on",
    "rating",
    "clean_sheets",
    # Sección 6.1: estadísticas de los componentes del índice y de los sets de Mejoría α.
    "npg",
    "npxg",
    "xg",
    "xa",
    "shots_on_target",
    "shots_total",
    "key_passes",
    "big_chances_created",
    "tackles_won",
    "tackles_attempted",
    "interceptions",
    "clearances",
    "blocks",
    "aerials_won",
    "aerials_total",
    "recoveries",
    "passes",
    "passes_accurate",
    "dribbles_successful",
    "dribbles_attempted",
    "fouls_committed",
    "saves",
    "shots_on_target_faced",
    "xgot_faced",
    "goals_conceded",
)


@dataclass(frozen=True)
class Match:
    match_id: int
    date: str
    competition: str
    opponent: str
    home: bool
    goals_for: int
    goals_against: int
    referee: str | None

    @property
    def result(self) -> str:
        return (
            "G"
            if self.goals_for > self.goals_against
            else "E"
            if self.goals_for == self.goals_against
            else "P"
        )

    @property
    def points(self) -> int:
        return {"G": 3, "E": 1, "P": 0}[self.result]


@dataclass(frozen=True)
class Player:
    position: str | None
    age: int | None


@dataclass
class Inputs:
    matches: list[Match]
    team_values: dict[int, dict[str, float]]
    player_values: dict[tuple[int, int], dict[str, float]]
    players: dict[int, Player]
    league_games: list[m.Game]
    table: list[tuple[str, m.TableRow, int]]  # (equipo, fila, puesto) de la Tabla Anual
    zone_rank: dict[str, int]  # competición -> puesto de Boca en su zona o grupo
    referee_yellows: dict[str, float]
    boca_name: str = "Boca Juniors"
    params: dict[str, float] = field(default_factory=dict)


def _norm(name: str) -> str:
    text = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode().lower()
    return " ".join(text.split())


def _row(
    stat_id: str, value: float | None, code: str, player_id: int | None = None, **extra: Any
) -> dict[str, Any]:
    row: dict[str, Any] = {
        "entity": "player" if player_id is not None else "team",
        "competition_code": code,
        "stat_id": stat_id,
        "value": None if value is None else round(value, 4),
        **extra,
    }
    if player_id is not None:
        row["entity_id"] = player_id
    return row


def _match_row(stat_id: str, match_id: int, value: float | None) -> dict[str, Any]:
    return {
        "entity": "team",
        "match_id": match_id,
        "stat_id": stat_id,
        "value": None if value is None else round(value, 4),
    }


# --- Elo y probabilidades por partido -------------------------------------------------------


def _elo_timeline(
    games: list[m.Game],
) -> tuple[dict[tuple[str, str, str], tuple[float, float]], list[tuple[str, str, float]]]:
    """Elo antes de cada partido de liga y la historia (fecha, equipo, Elo después) de cada equipo."""
    ordered = sorted(games, key=lambda g: g.date)
    before = m.elo_run(ordered)
    pre: dict[tuple[str, str, str], tuple[float, float]] = {}
    after: list[tuple[str, str, float]] = []
    for g, (h, a) in zip(ordered, before, strict=True):
        pre[(g.date, _norm(g.home), _norm(g.away))] = (h, a)
        new_h, new_a = m.elo_update(h, a, g.home_goals, g.away_goals)
        after += [(g.date, _norm(g.home), new_h), (g.date, _norm(g.away), new_a)]
    return pre, after


def _rating_on(history: list[tuple[str, str, float]], team: str, day: str) -> float | None:
    """Último Elo conocido de un equipo antes de una fecha (None si nunca jugó la liga)."""
    known = [r for d, t, r in history if t == team and d < day]
    return known[-1] if known else None


def team_match_values(inp: Inputs) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    pre, history = _elo_timeline(inp.league_games)
    boca = _norm(inp.boca_name)
    league_2026 = [g for g in inp.league_games if g.date >= "2026"]
    draw_rate = (
        sum(g.home_goals == g.away_goals for g in league_2026) / len(league_2026) if league_2026 else 0.25
    )
    inp.params["draw_rate"] = draw_rate
    previous_xi: set[int] | None = None
    for mt in sorted(inp.matches, key=lambda x: x.date):
        tv = inp.team_values.get(mt.match_id, {})
        # Puntos esperados por xG (Poisson), solo con el xG de los dos equipos.
        if "xg" in tv and "xg_against" in tv:
            xpts = m.expected_points(tv["xg"], tv["xg_against"])
            rows += [
                _match_row("eq_xpts", mt.match_id, xpts),
                _match_row("eq_puntos_menos_xpts", mt.match_id, mt.points - xpts),
            ]
        # Elo antes del partido: el del propio partido de liga o el último conocido.
        opp = _norm(mt.opponent)
        key = (mt.date, boca, opp) if mt.home else (mt.date, opp, boca)
        rival: float | None
        if key in pre:
            own, rival = pre[key] if mt.home else pre[key][::-1]
        else:
            own_known, rival = _rating_on(history, boca, mt.date), _rating_on(history, opp, mt.date)
            own = own_known if own_known is not None else m.ELO_START
        rows.append(_match_row("eq_elo", mt.match_id, own))
        if rival is not None:
            expected = m.elo_expected(own, rival, m.ELO_HOME_ADVANTAGE if mt.home else -m.ELO_HOME_ADVANTAGE)
            probs = m.outcome_probabilities(expected, draw_rate)
            score = {"G": 1.0, "E": 0.5, "P": 0.0}[mt.result]
            rows += [
                _match_row("eq_elo_rival", mt.match_id, rival),
                _match_row("eq_calidad_calendario", mt.match_id, rival),
                _match_row("eq_prob_victoria", mt.match_id, probs[0] * 100),
                _match_row("eq_prob_empate", mt.match_id, probs[1] * 100),
                _match_row("eq_prob_derrota", mt.match_id, probs[2] * 100),
                _match_row("eq_sorpresa", mt.match_id, score - expected),
                _match_row("eq_brier", mt.match_id, m.brier(probs, mt.result)),
            ]
        if mt.referee and _norm(mt.referee) in inp.referee_yellows:
            rows.append(
                _match_row("eq_arbitro_amarillas", mt.match_id, inp.referee_yellows[_norm(mt.referee)])
            )
        # Rotación y estabilidad del once respecto del partido anterior (de cualquier competición).
        xi = {p for (p, mid), v in inp.player_values.items() if mid == mt.match_id and v.get("starts") == 1}
        if previous_xi is not None and xi:
            rows += [
                _match_row("eq_rotacion", mt.match_id, len(xi - previous_xi)),
                _match_row("eq_estabilidad_once", mt.match_id, m.jaccard(xi, previous_xi)),
            ]
        if xi:
            previous_xi = xi
    return rows


# --- Valores por ventana --------------------------------------------------------------------


def _windows(matches: list[Match]) -> dict[str, list[Match]]:
    ordered = sorted(matches, key=lambda x: x.date)
    out: dict[str, list[Match]] = defaultdict(list)
    for mt in ordered:
        out[mt.competition].append(mt)
        out["todas"].append(mt)
    return dict(out)


def _ppp(matches: Iterable[Match]) -> float | None:
    ms = list(matches)
    return sum(x.points for x in ms) / len(ms) if ms else None


def team_window_values(inp: Inputs) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    x = m.calibrate_pythagorean(r for _, r, _ in inp.table) if inp.table else 1.35
    inp.params["x"] = x
    rank_of = {_norm(team): rank for team, _, rank in inp.table}
    n_teams = len(inp.table)
    for code, ms in _windows(inp.matches).items():
        results = [mt.result for mt in ms]
        gf = sum(mt.goals_for for mt in ms)
        ga = sum(mt.goals_against for mt in ms)
        home, away = _ppp(mt for mt in ms if mt.home), _ppp(mt for mt in ms if not mt.home)
        rows += [
            _row("eq_forma_5", sum(mt.points for mt in ms[-5:]), code),
            _row("eq_racha_victorias", m.longest_streak(results, {"G"}), code),
            _row("eq_racha_invicto", m.longest_streak(results, {"G", "E"}), code),
            _row("eq_racha_derrotas", m.longest_streak(results, {"P"}), code),
            _row(
                "eq_racha_vallas",
                m.longest_streak(["VI" if mt.goals_against == 0 else "" for mt in ms], {"VI"}),
                code,
            ),
            _row("eq_consistencia_gf", m.stdev([mt.goals_for for mt in ms]), code),
            _row("eq_consistencia_gc", m.stdev([mt.goals_against for mt in ms]), code),
            _row("eq_exponente_pitagorico", x, code, detail={"supuesto": not inp.table}),
            _row("eq_puntos_pitagoricos", 3 * len(ms) * m.pythagorean_share(gf, ga, x), code),
        ]
        if home is not None and away is not None:
            rows.append(_row("eq_ventaja_localia", home - away, code))
        if code in inp.zone_rank:
            rows.append(_row("eq_posicion", inp.zone_rank[code], code))
        # Puntos por partido según el tercio de la Tabla Anual del rival (solo rivales de la liga).
        if n_teams:
            thirds: dict[str, list[Match]] = defaultdict(list)
            for mt in ms:
                rank = rank_of.get(_norm(mt.opponent))
                if rank is not None:
                    thirds[
                        "alto" if rank <= n_teams / 3 else "medio" if rank <= 2 * n_teams / 3 else "bajo"
                    ].append(mt)
            for third, games in thirds.items():
                rows.append(_row(f"eq_ppp_rival_{third}", _ppp(games), code))
        # Concentración de goles, edad ponderada y minutos por tramo de edad.
        ids = {mt.match_id for mt in ms}
        goals: dict[int, float] = defaultdict(float)
        minutes: dict[int, float] = defaultdict(float)
        for (pid, mid), v in inp.player_values.items():
            if mid in ids:
                goals[pid] += v.get("goals", 0)
                minutes[pid] += v.get("minutes", 0)
        rows.append(_row("eq_herfindahl", m.herfindahl([g for g in goals.values() if g > 0]), code))
        aged = {
            pid: (inp.players[pid].age, mins)
            for pid, mins in minutes.items()
            if pid in inp.players and inp.players[pid].age
        }
        total = sum(mins for _, mins in aged.values())
        if total:
            rows.append(
                _row("eq_edad_once", sum(age * mins for age, mins in aged.values() if age) / total, code)
            )
            for stat_id, low, high in (
                ("eq_min_hasta_21", 0, 21),
                ("eq_min_22_26", 22, 26),
                ("eq_min_27_31", 27, 31),
                ("eq_min_32_mas", 32, 99),
            ):
                share = sum(mins for age, mins in aged.values() if age and low <= age <= high) / total * 100
                rows.append(_row(stat_id, share, code))
    return rows


def player_window_values(inp: Inputs) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    league_goals = _league_goals_per_team(inp.league_games)
    inp.params["L"] = league_goals
    x = inp.params.get("x", 1.35)
    for code, ms in _windows(inp.matches).items():
        ids = [mt.match_id for mt in ms]
        date_of = {mt.match_id: mt.date for mt in ms}
        team_goals = sum(mt.goals_for for mt in ms)
        per_player: dict[int, list[tuple[str, dict[str, float]]]] = defaultdict(list)
        for (pid, mid), v in inp.player_values.items():
            if mid in date_of and v.get("minutes", 0) > 0:
                per_player[pid].append((date_of[mid], v))
        # Totales en cancha por jugador: base de NR, EWA, ELA y del nivel de reemplazo.
        on: dict[int, tuple[float, float, float]] = {}
        for pid, games in per_player.items():
            games.sort(key=lambda t: t[0])
            mins = sum(v["minutes"] for _, v in games)
            on[pid] = (
                mins,
                sum(v.get("team_goals_on", 0) for _, v in games),
                sum(v.get("team_goals_against_on", 0) for _, v in games),
            )
        for pid, games in per_player.items():
            mins, gf_on, ga_on = on[pid]
            ga_total = sum(v.get("goal_contributions", 0) for _, v in games)
            ratings = [v["rating"] for _, v in games if "rating" in v]
            rows += [
                _row("pct_minutos", mins / (90 * len(ids)) * 100, code, pid),
                _row("carga_7d", m.minutes_in_last_days([(d, v["minutes"]) for d, v in games], 7), code, pid),
                _row(
                    "carga_14d", m.minutes_in_last_days([(d, v["minutes"]) for d, v in games], 14), code, pid
                ),
                _row(
                    "carga_28d", m.minutes_in_last_days([(d, v["minutes"]) for d, v in games], 28), code, pid
                ),
                _row("dependencia_goleador", ga_total / team_goals * 100 if team_goals else None, code, pid),
                _row(
                    "racha_goles",
                    m.longest_streak(["g" if v.get("goals", 0) > 0 else "" for _, v in games], {"g"}),
                    code,
                    pid,
                ),
                _row(
                    "racha_asistencias",
                    m.longest_streak(["a" if v.get("assists", 0) > 0 else "" for _, v in games], {"a"}),
                    code,
                    pid,
                ),
                _row("consistencia_calificacion", m.stdev(ratings), code, pid),
            ]
            position = inp.players[pid].position if pid in inp.players else None
            if position == "Arquero":
                rows.append(
                    _row(
                        "racha_vallas",
                        m.longest_streak(["v" if v.get("clean_sheets", 0) else "" for _, v in games], {"v"}),
                        code,
                        pid,
                    )
                )
            if mins <= 0:
                continue
            gf90, ga90 = gf_on * 90 / mins, ga_on * 90 / mins
            rows.append(_row("nr", gf90 - ga90, code, pid))
            rep = _replacement(pid, position, on, inp.players)
            if rep is not None:
                gf_rep, ga_rep = rep
                rows += [
                    _row("nr_relativo", (gf90 - ga90) - (gf_rep - ga_rep), code, pid),
                    _row("ewa", m.ewa(mins, gf90, gf_rep, league_goals, x), code, pid),
                    _row("ela", m.ela(mins, ga90, ga_rep, league_goals, x), code, pid),
                ]
    return rows


def _replacement(
    pid: int, position: str | None, on: dict[int, tuple[float, float, float]], players: dict[int, Player]
) -> tuple[float, float] | None:
    """Nivel de reemplazo: goles a favor y en contra cada 90 con los suplentes de su posición.

    Suplentes = compañeros de la misma posición (sin el jugador) con al menos 90 minutos y
    menos minutos que la mediana de la posición. Se suman goles y minutos (suma sobre suma).
    """
    same = {
        p: v
        for p, v in on.items()
        if p != pid and p in players and players[p].position == position and position
    }
    if not same:
        return None
    median = statistics.median(v[0] for v in same.values())
    bench = [v for v in same.values() if REPLACEMENT_MIN_MINUTES <= v[0] <= median]
    minutes = sum(v[0] for v in bench)
    if minutes <= 0:
        return None
    return sum(v[1] for v in bench) * 90 / minutes, sum(v[2] for v in bench) * 90 / minutes


def _league_goals_per_team(games: list[m.Game]) -> float:
    """L: goles promedio por equipo y partido en la liga 2026 (para EWA y ELA)."""
    current = [g for g in games if g.date >= "2026"]
    return sum(g.home_goals + g.away_goals for g in current) / (2 * len(current)) if current else 1.2


def compute(inp: Inputs) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """(valores por ventana, valores por partido) de todas las métricas propias."""
    per_match = team_match_values(inp)
    window = team_window_values(inp) + player_window_values(inp)
    # Sección 6.1 con la temporada completa ("todas"), a la fecha del último partido cargado.
    seasons = pdata.seasons_from(
        inp.player_values,
        {mt.match_id: mt.date for mt in inp.matches},
        {pid: (p.position, p.age) for pid, p in inp.players.items()},
    )
    window += pdata.projection_rows(seasons, len(inp.matches))
    return [r for r in window if r["value"] is not None], [r for r in per_match if r["value"] is not None]


# --- Lectura de la base y carga --------------------------------------------------------------


def _fetch(
    view: str, select: str, url: str, key: str, client: httpx.Client, filters: dict[str, str] | None = None
) -> list[dict[str, Any]]:
    """Todas las filas de una vista pública, de a 1000 (el tope de la Data API)."""
    rows: list[dict[str, Any]] = []
    offset = 0
    while True:
        response = client.get(
            f"{url.rstrip('/')}/rest/v1/{view}",
            params={"select": select, "limit": str(PAGE), "offset": str(offset), **(filters or {})},
            headers={"apikey": key, "Accept-Profile": "api"},
        )
        if response.status_code >= 400:
            raise load.LoadError(f"Supabase respondió {response.status_code} al leer {view}")
        page = response.json()
        rows += page
        if len(page) < PAGE:
            return rows
        offset += PAGE


def fetch_inputs(url: str, key: str) -> Inputs:
    with httpx.Client(timeout=60) as client:
        team = _fetch(
            "team_match_master",
            "match_id,match_date,competition_code,opponent,boca_home,goals_for,goals_against,referee",
            url,
            key,
            client,
            {"order": "kickoff_at"},
        )
        team_values: dict[int, dict[str, float]] = defaultdict(dict)
        for r in _fetch(
            "team_match_value", "match_id,key,value", url, key, client, {"key": "in.(xg,xg_against)"}
        ):
            team_values[r["match_id"]][r["key"]] = float(r["value"])
        player_values: dict[tuple[int, int], dict[str, float]] = defaultdict(dict)
        keys = ",".join(PLAYER_KEYS)
        for r in _fetch(
            "player_match_value",
            "match_id,player_id,key,value",
            url,
            key,
            client,
            {"key": f"in.({keys})", "order": "match_id,player_id,key"},
        ):
            player_values[(r["player_id"], r["match_id"])][r["key"]] = float(r["value"])
        players = {
            r["player_id"]: Player(position=r["position_group"], age=r["age"])
            for r in _fetch(
                "player_master",
                "player_id,position_group,age",
                url,
                key,
                client,
                {"competition_code": "eq.todas"},
            )
        }
        seen: set[tuple[str, str, str]] = set()
        league: list[m.Game] = []
        # Promiedos primero: si StrikerAPI trae el mismo partido, se queda uno solo.
        results = _fetch(
            "league_result",
            "source,season,match_date,home_team,away_team,home_goals,away_goals",
            url,
            key,
            client,
        )
        for r in sorted(results, key=lambda r: r["source"] != "promiedos"):
            if r["home_goals"] is None or r["away_goals"] is None:
                continue
            ident = (r["match_date"], _norm(r["home_team"]), _norm(r["away_team"]))
            if ident not in seen:
                seen.add(ident)
                league.append(
                    m.Game(r["match_date"], r["home_team"], r["away_team"], r["home_goals"], r["away_goals"])
                )
        standings = _fetch(
            "league_standing",
            "table_name,rank,team_name,played,goals_for,goals_against,points",
            url,
            key,
            client,
            {"season": "eq.2026"},
        )
        refs = _fetch(
            "referee_stats", "referee,season,yellow_per_game", url, key, client, {"season": "eq.2026"}
        )
    table = [
        (s["team_name"], m.TableRow(s["played"], s["goals_for"], s["goals_against"], s["points"]), s["rank"])
        for s in standings
        if s["table_name"].startswith("Tabla Anual")
    ]
    zone_rank: dict[str, int] = {}
    for s in standings:
        if _norm(s["team_name"]) == _norm("Boca Juniors"):
            if s["table_name"].startswith("Apertura"):
                zone_rank["liga_profesional_apertura"] = s["rank"]
            elif s["table_name"].startswith("Clausura"):
                zone_rank["liga_profesional_clausura"] = s["rank"]
            elif s["table_name"].startswith("Tabla Anual"):
                zone_rank["todas"] = s["rank"]
    return Inputs(
        matches=[
            Match(
                r["match_id"],
                r["match_date"],
                r["competition_code"],
                r["opponent"],
                r["boca_home"],
                r["goals_for"],
                r["goals_against"],
                r["referee"],
            )
            for r in team
        ],
        team_values=dict(team_values),
        player_values=dict(player_values),
        players=players,
        league_games=league,
        table=table,
        zone_rank=zone_rank,
        referee_yellows={
            _norm(r["referee"]): float(r["yellow_per_game"]) for r in refs if r["yellow_per_game"] is not None
        },
    )


def run(url: str, key: str) -> dict[str, Any]:
    inp = fetch_inputs(url, key)
    window, per_match = compute(inp)
    stat_ids = sorted({r["stat_id"] for r in window + per_match})
    result = load._rpc(
        "load_stat_values",
        {"p_stat_ids": stat_ids, "p_values": window, "p_match_values": per_match},
        url,
        key,
        None,
    )
    load.refresh_stats(url, key)
    return {"params": inp.params, **(result or {})}


def main() -> int:
    # Import local: pipeline.run importa este módulo, así se evita el import circular.
    from pipeline.run import load_dotenv, secret_key

    load_dotenv()
    url, key = os.environ.get("SUPABASE_URL", "").strip(), secret_key()
    try:
        print(run(url, key))
    except load.LoadError as exc:
        print(f"Métricas propias: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
