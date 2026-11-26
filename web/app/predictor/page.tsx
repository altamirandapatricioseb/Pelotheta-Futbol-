import { StatsLab } from '@/components/stats/stats-lab';
import { predictorAnalyses } from '@/lib/models/analyses';
import { getTeamMatches } from '@/lib/data/team';
import type { Metadata } from 'next';

import { ErrorNotice } from '@/components/error-notice';
import { ModelHeader } from '@/components/models/common';
import { PredictorView } from '@/components/models/predictor-view';
import { CURRENT_TEAM } from '@/config/teams';
import { getModelRun, getPredictions, getStatTests } from '@/lib/data/models';
import { ClubInterface } from '@/components/club/club-interface';
import { getSelectedTeam } from '@/lib/selected-team';

export const metadata: Metadata = {
  description:
    'Predictor de partidos con Poisson: probabilidad de ganar, empatar y perder, marcadores posibles, backtest y pruebas de hipótesis.',
};

export default async function PredictorPage() {
  const team = await getSelectedTeam();
  if (!team.isBoca) return <ClubInterface view="predictor" uid={team.uid} />;
  const [run, data, tests, matches] = await Promise.all([
    getModelRun(CURRENT_TEAM.slug, 'predictor_partido'),
    getPredictions(CURRENT_TEAM.slug),
    getStatTests(CURRENT_TEAM.slug),
    getTeamMatches(),
  ]);
  return (
    <div className="grid gap-6">
      <ModelHeader title="Predictor" subtitle={`${CURRENT_TEAM.name} · liga 2026 · modelo de Poisson`} />
      {!run.ok ? (
        <ErrorNotice code={run.code} />
      ) : !data.ok ? (
        <ErrorNotice code={data.code} />
      ) : (
        <PredictorView
          team={CURRENT_TEAM.name}
          run={run.data}
          predictions={data.data.predictions}
          strengths={data.data.strengths}
          tests={tests.ok ? tests.data : []}
        />
      )}
      {matches.ok ? <StatsLab analyses={predictorAnalyses(matches.data)} /> : null}
    </div>
  );
}
