import { StatsLab } from '@/components/stats/stats-lab';
import { teamAnalyses } from '@/lib/models/analyses';
import type { Metadata } from 'next';
import { z } from 'zod';

import { ExcelDownloads } from '@/components/excel-downloads';
import { TeamTableView } from '@/components/team/team-table';
import { getCatalog, getStatSets } from '@/lib/data/catalog';
import { getLeagueClubs, getTeamMatches, getTeamWindowValues } from '@/lib/data/team';
import { ErrorNotice } from '@/components/error-notice';
import { Section } from '@/components/models/common';
import { ProbabilityPanel } from '@/components/models/probability-panel';
import { CURRENT_TEAM } from '@/config/teams';
import { getStatTests } from '@/lib/data/models';

export const metadata: Metadata = {
  description:
    'Tablas de Boca Juniors 2026 por categoría: resultados, goles, remates, xG, posesión, defensa, balón parado, tramos y rachas.',
};

// Los parámetros de la URL vienen de afuera: se validan contra listas cerradas (14.3).
const searchSchema = z.object({
  conjunto: z
    .string()
    .regex(/^[a-z][a-z0-9_]{0,40}$/)
    .optional()
    .catch(undefined),
  vista: z.enum(['partido', 'rival', 'mes', 'competicion', 'acumulada']).catch('partido'),
});

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function EquipoPage({ searchParams }: PageProps) {
  const raw = await searchParams;
  const params = searchSchema.parse({ conjunto: raw.conjunto, vista: raw.vista });
  const [matches, catalog, sets, windowValues, clubs, tests] = await Promise.all([
    getTeamMatches(),
    getCatalog('team'),
    getStatSets('team'),
    getTeamWindowValues(),
    getLeagueClubs(),
    getStatTests(CURRENT_TEAM.slug),
  ]);
  const failed = [matches, catalog, sets, windowValues].flatMap((r) => (r.ok ? [] : [r]))[0];

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="page-title">
            <span className="title-trace">Equipo</span>
          </h1>
          <p className="mt-2 text-muted">Boca Juniors 2026 · partidos oficiales · una categoría por vez</p>
        </div>
        <ExcelDownloads />
      </div>
      {failed ? (
        <ErrorNotice code={failed.code} />
      ) : matches.ok && catalog.ok && sets.ok && windowValues.ok ? (
        <TeamTableView
          matches={matches.data}
          catalog={catalog.data}
          sets={sets.data}
          windowValues={windowValues.data}
          clubs={clubs.ok ? clubs.data : []}
          initialSet={params.conjunto ?? null}
          initialView={params.vista}
        />
      ) : null}
      {tests.ok && tests.data.length > 0 ? (
        <Section
          id="probabilidad"
          title="Probabilidad"
          intro="Pruebas de hipótesis e intervalos con los partidos de liga. El detalle y el predictor de partidos que se apoya en estas distribuciones están en Predictor."
        >
          <ProbabilityPanel tests={tests.data} updated={null} />
        </Section>
      ) : null}
      {matches.ok ? <StatsLab analyses={teamAnalyses(matches.data)} /> : null}
    </div>
  );
}
