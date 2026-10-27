import type { Metadata } from 'next';
import Link from 'next/link';
import { z } from 'zod';

import { PlayerSummaryView } from '@/components/players/player-summary';
import { getCompetitions, getPlayerSummary } from '@/lib/data/players';

export const metadata: Metadata = {
  title: 'Jugadores',
  description: 'Resumen del plantel de Boca Juniors 2026: partidos, minutos, goles, asistencias y tarjetas.',
};

// Los parámetros de la URL vienen de afuera: se validan antes de usarlos (14.3).
const searchSchema = z.object({
  comp: z
    .string()
    .regex(/^[a-z0-9_]{1,60}$/)
    .catch('todas'),
  jugador: z.coerce.number().int().positive().optional().catch(undefined),
  estadistica: z
    .string()
    .regex(/^[a-zA-Z]{1,30}$/)
    .optional()
    .catch(undefined),
});

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function JugadoresPage({ searchParams }: PageProps) {
  const raw = await searchParams;
  const params = searchSchema.parse({
    comp: typeof raw.comp === 'string' ? raw.comp : 'todas',
    jugador: raw.jugador,
    estadistica: raw.estadistica,
  });
  const [summary, competitions] = await Promise.all([getPlayerSummary(params.comp), getCompetitions()]);
  const options = competitions.ok ? competitions.data : [];
  const activeName = options.find((c) => c.code === params.comp)?.name ?? 'Todas las competiciones';

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="page-title">
            <span className="title-trace">Jugadores</span>
          </h1>
          <p className="mt-2 text-muted">Resumen del plantel 2026 · partidos oficiales</p>
        </div>
        <nav aria-label="Competición" className="flex flex-wrap gap-2">
          <CompetitionChip code="todas" label="Todas" active={params.comp === 'todas'} />
          {options.map((c) => (
            <CompetitionChip
              key={c.code}
              code={c.code}
              label={c.name}
              active={params.comp === c.code}
              matches={c.matches}
            />
          ))}
        </nav>
      </div>

      {summary.ok ? (
        summary.data.length > 0 ? (
          <PlayerSummaryView
            key={params.comp}
            players={summary.data}
            competitionName={activeName}
            initialPlayerId={params.jugador ?? null}
            initialStat={params.estadistica ?? null}
          />
        ) : (
          <p className="under-construction text-muted">
            Todavía no hay partidos cargados para esta competición. Se completan con la próxima actualización.
          </p>
        )
      ) : (
        <div role="alert" className="under-construction">
          <p className="font-bold">{summary.code}: la base de datos no responde.</p>
          <p className="text-muted">Puede estar pausada por inactividad. Probá de nuevo en unos minutos.</p>
        </div>
      )}
    </div>
  );
}

function CompetitionChip({
  code,
  label,
  active,
  matches,
}: {
  code: string;
  label: string;
  active: boolean;
  matches?: number;
}) {
  // Nombres largos de la fuente se acortan para que los chips entren en una línea.
  const short = label.replace('CONMEBOL ', '').replace('Liga Profesional Argentina', 'Liga Profesional');
  return (
    <Link
      href={code === 'todas' ? '/jugadores' : `/jugadores?comp=${code}`}
      className="chip focus-ring"
      aria-current={active ? 'true' : undefined}
      scroll={false}
    >
      {short}
      {matches !== undefined ? <span className="tabular opacity-70">{matches}</span> : null}
    </Link>
  );
}
