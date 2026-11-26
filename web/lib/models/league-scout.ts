import type { MarketValue, PlayerProfile } from '@/lib/data/parquet';
import { PLAYER_STATS } from '@/lib/data/parquet';

// Ojeador y Alternativas para cualquier club con los perfiles públicos de su liga (percentil 0 a 100
// cada 90 contra su posición). Más simples que los de Boca: no hay estadísticas por partido.

const STATS = PLAYER_STATS.map(([stat]) => stat);
const MIN_COMMON = 4; // con menos estadísticas en común, el parecido es ruido
const pct = (p: PlayerProfile, stat: string) => p[`pct_${stat}`] ?? null;

/** 1 = mismo perfil, 0 = opuesto: 1 − diferencia media de percentiles en las estadísticas que tienen los dos. */
export function similarity(a: PlayerProfile, b: PlayerProfile): number | null {
  const diffs = STATS.flatMap((s) => {
    const x = pct(a, s);
    const y = pct(b, s);
    return x === null || y === null ? [] : [Math.abs(x - y)];
  });
  if (diffs.length < MIN_COMMON) return null;
  return 1 - diffs.reduce((t, d) => t + d, 0) / diffs.length / 100;
}

export interface Alternative {
  player: PlayerProfile;
  similar: { player: PlayerProfile; similarity: number }[];
}

/** Para cada jugador del plantel, los `n` más parecidos de su posición en otros clubes de la liga. */
export function alternatives(squad: readonly PlayerProfile[], league: readonly PlayerProfile[], n = 3): Alternative[] {
  return squad.map((player) => ({
    player,
    similar: league
      .filter((q) => q.team_name !== player.team_name && q.position === player.position)
      .flatMap((q) => {
        const sim = similarity(player, q);
        return sim === null ? [] : [{ player: q, similarity: sim }];
      })
      .toSorted((x, y) => y.similarity - x.similarity)
      .slice(0, n),
  }));
}

export interface Need {
  stat: string;
  label: string;
  /** Percentil medio del plantel en la estadística, pesado por minutos. */
  squadPct: number;
  picks: PlayerProfile[];
}

/** Las `n` estadísticas donde el plantel está más bajo y los mejores de otros clubes en cada una. */
export function needs(squad: readonly PlayerProfile[], league: readonly PlayerProfile[], n = 3, picks = 3): Need[] {
  return PLAYER_STATS.flatMap(([stat, label]): Need[] => {
    const rated = squad.filter((p) => pct(p, stat) !== null);
    const minutes = rated.reduce((t, p) => t + (p.minutes ?? 0), 0);
    if (rated.length < 3 || minutes === 0) return [];
    const squadPct = rated.reduce((t, p) => t + (pct(p, stat) ?? 0) * (p.minutes ?? 0), 0) / minutes;
    const team = squad[0]?.team_name;
    const best = league
      .filter((q) => q.team_name !== team && pct(q, stat) !== null)
      .toSorted((a, b) => (pct(b, stat) ?? 0) - (pct(a, stat) ?? 0))
      .slice(0, picks);
    return [{ stat, label, squadPct, picks: best }];
  })
    .toSorted((a, b) => a.squadPct - b.squadPct)
    .slice(0, n);
}

/** Jugadores de otros clubes que valen menos de lo que el modelo espera (`gap_pct` negativo), del más barato. */
export function opportunities(values: readonly MarketValue[], team: string, n = 8): MarketValue[] {
  return values
    .filter((v) => v.team_name !== team && v.gap_pct !== null && v.gap_pct < 0)
    .toSorted((a, b) => (a.gap_pct ?? 0) - (b.gap_pct ?? 0))
    .slice(0, n);
}

/** Jóvenes de otros clubes (hasta `maxAge` años), del que el modelo más valora. */
export function prospects(values: readonly MarketValue[], team: string, maxAge = 21, n = 8): MarketValue[] {
  return values
    .filter((v) => v.team_name !== team && v.age !== null && v.age <= maxAge)
    .toSorted((a, b) => (b.predicted_eur ?? 0) - (a.predicted_eur ?? 0))
    .slice(0, n);
}
