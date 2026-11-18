import type { Metadata } from 'next';

import { ErrorNotice } from '@/components/error-notice';
import { AlternativesView } from '@/components/models/alternatives-view';
import { ModelHeader } from '@/components/models/common';
import { CURRENT_TEAM } from '@/config/teams';
import { getAlternatives, getMarketValues, getModelRun } from '@/lib/data/models';
import { getPlayerMaster } from '@/lib/data/players';

export const metadata: Metadata = {
  description:
    'Alternativas para cada jugador con K-means: de otro club 1 a 1, en dupla o dentro del plantel, de la más parecida a la menos.',
};

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function AlternativasPage({ searchParams }: PageProps) {
  const raw = await searchParams;
  const requested = Number(Array.isArray(raw.jugador) ? raw.jugador[0] : raw.jugador);
  const [run, data, values, master] = await Promise.all([
    getModelRun(CURRENT_TEAM.slug, 'alternativas'),
    getAlternatives(CURRENT_TEAM.slug),
    getMarketValues(CURRENT_TEAM.slug),
    getPlayerMaster('todas'),
  ]);
  const valueOf = new Map((values.ok ? values.data.rows : []).map((r) => [r.playerId, r.actual]));
  const facts = Object.fromEntries(
    (master.ok ? master.data : []).map((p) => [
      p.playerId,
      { value: valueOf.get(p.playerId) ?? null, age: p.age, minutes: p.minutes },
    ]),
  );
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
        <AlternativesView
          key={Number.isInteger(requested) ? requested : 'inicio'}
          team={CURRENT_TEAM.name}
          run={run.data}
          {...data.data}
          initialPlayer={Number.isInteger(requested) && requested > 0 ? requested : null}
          facts={facts}
        />
      )}
    </div>
  );
}
