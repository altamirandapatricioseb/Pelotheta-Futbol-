import 'server-only';

import { getLeaguePool, getMarketValues } from '@/lib/data/models';
import { getPlayerMaster } from '@/lib/data/players';
import { type MarketPlayer, type Need, type SquadPlayer, teamNeeds } from '@/lib/models/scouting';

const plain = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export interface ScoutingData {
  squad: SquadPlayer[];
  market: MarketPlayer[];
  needs: Need[];
}

/** Plantel con valor y contrato, mercado de la liga sin el propio club y necesidades: lo que usan las dos páginas del Ojeador. */
export async function loadScouting(team: {
  slug: string;
  name: string;
}): Promise<{ ok: true; data: ScoutingData } | { ok: false; code: 'PEL-DB-001' }> {
  const [master, values, pool] = await Promise.all([
    getPlayerMaster('todas'),
    getMarketValues(team.slug),
    getLeaguePool(),
  ]);
  if (!master.ok || !values.ok || !pool.ok) return { ok: false, code: 'PEL-DB-001' };
  const valueRows = new Map(values.data.rows.map((r) => [r.playerId, r]));
  const squad: SquadPlayer[] = master.data.map((p) => {
    const v = valueRows.get(p.playerId);
    return {
      id: p.playerId,
      name: p.shortName ?? p.name,
      position: p.position,
      age: p.age,
      minutes: p.minutes,
      stats: p.stats,
      contractYears: v?.detail.contractYears ?? null,
      value: v?.actual ?? null,
    };
  });
  const own = plain(team.name);
  const market = pool.data.filter((p) => !plain(p.team).includes(own));
  return { ok: true, data: { squad, market, needs: teamNeeds(squad, market) } };
}
