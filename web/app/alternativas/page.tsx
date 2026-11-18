import type { Metadata } from 'next';

import { ErrorNotice } from '@/components/error-notice';
import { AlternativesView } from '@/components/models/alternatives-view';
import { ModelHeader } from '@/components/models/common';
import { CURRENT_TEAM } from '@/config/teams';
import { getAlternatives, getModelRun } from '@/lib/data/models';

export const metadata: Metadata = {
  description:
    'Alternativas para cada jugador con K-means: de otro club 1 a 1, en dupla o dentro del plantel, de la más parecida a la menos.',
};

export default async function AlternativasPage() {
  const [run, data] = await Promise.all([
    getModelRun(CURRENT_TEAM.slug, 'alternativas'),
    getAlternatives(CURRENT_TEAM.slug),
  ]);
  return (
    <div className="grid gap-6">
      <ModelHeader
        title="Alternativas"
        subtitle={`${CURRENT_TEAM.name} · elegí un jugador y mirá quién juega parecido`}
      />
      {!run.ok ? (
        <ErrorNotice code={run.code} />
      ) : !data.ok ? (
        <ErrorNotice code={data.code} />
      ) : (
        <AlternativesView team={CURRENT_TEAM.name} run={run.data} {...data.data} />
      )}
    </div>
  );
}
