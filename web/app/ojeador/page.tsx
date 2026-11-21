import type { Metadata } from 'next';

import { ErrorNotice } from '@/components/error-notice';
import { ModelHeader } from '@/components/models/common';
import { MarketStatsView } from '@/components/models/scout-market';
import { ScoutView } from '@/components/models/scout-view';
import { CURRENT_TEAM } from '@/config/teams';
import { loadScouting } from '@/lib/data/scouting';
import { marketStats } from '@/lib/models/market-stats';
import { GROUPS, type Group, scoutReports } from '@/lib/models/scouting';

export const metadata: Metadata = {
  description:
    'Informes de ojeador: qué le falta al plantel por puesto, oportunidades de mercado y jóvenes promesas de otros clubes, con nota de 0 a 10.',
};

export default async function OjeadorPage() {
  const loaded = await loadScouting(CURRENT_TEAM);
  if (!loaded.ok) {
    return (
      <div className="grid gap-6">
        <ModelHeader title="Ojeador" subtitle={CURRENT_TEAM.name} />
        <ErrorNotice code={loaded.code} />
      </div>
    );
  }
  const { market, needs, squad } = loaded.data;
  const stats = marketStats(market, squad);
  return (
    <div className="grid gap-6">
      <ModelHeader
        title="Ojeador"
        subtitle={`${CURRENT_TEAM.name} · lo que le falta al plantel y a quién ir a buscar a otros clubes`}
      />
      <ScoutView needs={needs} reports={scoutReports(market, needs)} marketSize={market.length} />
      {stats ? (
        <section aria-labelledby="titulo-estadistica" className="grid gap-6">
          <div>
            <h2 id="titulo-estadistica" className="page-title text-2xl">
              Estadística del mercado
            </h2>
            <p className="mt-1 max-w-3xl text-sm text-muted">
              Descriptiva, ANOVA, tabla de contingencia, regresión múltiple y pruebas de hipótesis sobre los precios de
              la liga. Se recalcula con cada carga de datos.
            </p>
          </div>
          <MarketStatsView
            stats={stats}
            team={CURRENT_TEAM.name}
            points={market.flatMap((p) =>
              GROUPS.includes(p.position as Group) && p.value !== null && p.value > 0 && p.age !== null
                ? [{ name: p.name, team: p.team, group: p.position as Group, age: p.age, value: p.value }]
                : [],
            )}
          />
        </section>
      ) : null}
    </div>
  );
}
