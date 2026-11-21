import type { Metadata } from 'next';

import { ErrorNotice } from '@/components/error-notice';
import { ModelHeader } from '@/components/models/common';
import { ScoutView } from '@/components/models/scout-view';
import { CURRENT_TEAM } from '@/config/teams';
import { getLeaguePool, getMarketValues } from '@/lib/data/models';
import { getPlayerMaster } from '@/lib/data/players';
import { scoutReports, type SquadPlayer, teamNeeds } from '@/lib/models/scouting';

export const metadata: Metadata = {
  description:
    'Informes de ojeador: qué le falta al plantel por puesto, oportunidades de mercado y jóvenes promesas de otros clubes, con nota de 0 a 10.',
};

const plain = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();

export default async function OjeadorPage() {
  const [master, values, pool] = await Promise.all([
    getPlayerMaster('todas'),
    getMarketValues(CURRENT_TEAM.slug),
    getLeaguePool(),
  ]);
  const failed = !master.ok ? master : !values.ok ? values : !pool.ok ? pool : null;
  if (failed) {
    return (
      <div className="grid gap-6">
        <ModelHeader title="Ojeador" subtitle={CURRENT_TEAM.name} />
        <ErrorNotice code={failed.code} />
      </div>
    );
  }
  const valueRows = new Map((values.ok ? values.data.rows : []).map((r) => [r.playerId, r]));
  const squad: SquadPlayer[] = (master.ok ? master.data : []).map((p) => {
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
  const own = plain(CURRENT_TEAM.name);
  const market = (pool.ok ? pool.data : []).filter((p) => !plain(p.team).includes(own));
  const needs = teamNeeds(squad, market);
  const reports = scoutReports(market, needs);
  return (
    <div className="grid gap-6">
      <ModelHeader
        title="Ojeador"
        subtitle={`${CURRENT_TEAM.name} · lo que le falta al plantel y a quién ir a buscar a otros clubes`}
      />
      <ScoutView needs={needs} reports={reports} marketSize={market.length} />
    </div>
  );
}
