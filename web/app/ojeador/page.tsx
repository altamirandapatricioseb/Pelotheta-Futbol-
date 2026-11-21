import type { Metadata } from 'next';

import { ErrorNotice } from '@/components/error-notice';
import { ModelHeader } from '@/components/models/common';
import { ScoutView } from '@/components/models/scout-view';
import { CURRENT_TEAM } from '@/config/teams';
import { loadScouting } from '@/lib/data/scouting';
import { scoutReports } from '@/lib/models/scouting';

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
  const { market, needs } = loaded.data;
  return (
    <div className="grid gap-6">
      <ModelHeader
        title="Ojeador"
        subtitle={`${CURRENT_TEAM.name} · lo que le falta al plantel y a quién ir a buscar a otros clubes`}
      />
      <ScoutView needs={needs} reports={scoutReports(market, needs)} marketSize={market.length} />
    </div>
  );
}
