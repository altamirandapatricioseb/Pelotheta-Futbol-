import type { Metadata } from 'next';
import Link from 'next/link';
import { z } from 'zod';

import { ExcelDownloads } from '@/components/excel-downloads';
import { PlayerMasterView } from '@/components/players/player-master';
import { getCatalog, getStatSets } from '@/lib/data/catalog';
import { getCompetitions, getPlayerMaster } from '@/lib/data/players';

export const metadata: Metadata = {
  title: 'Jugadores',
  description:
    'Tabla maestra del plantel de Boca Juniors 2026: estadísticas por categoría, por 90 minutos, métricas propias y proyección.',
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
    .regex(/^[a-z][a-z0-9_]{0,60}$/)
    .optional()
    .catch(undefined),
  conjunto: z
    .string()
    .regex(/^[a-z][a-z0-9_]{0,40}$/)
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
    conjunto: raw.conjunto,
  });
  const [players, competitions, catalog, sets] = await Promise.all([
    getPlayerMaster(params.comp),
    getCompetitions(),
    getCatalog('player'),
    getStatSets('player'),
  ]);
  const options = competitions.ok ? competitions.data : [];
  const activeName = options.find((c) => c.code === params.comp)?.name ?? 'Todas las competiciones';
  const failed = [players, catalog, sets].flatMap((r) => (r.ok ? [] : [r]))[0];

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="page-title">
            <span className="title-trace">Jugadores</span>
          </h1>
          <p className="mt-2 text-muted">Plantel 2026 · partidos oficiales · una categoría por vez</p>
        </div>
        <ExcelDownloads />
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

      {failed ? (
        <div role="alert" className="under-construction">
          <p className="font-bold">{failed.code}: la base de datos no responde.</p>
          <p className="text-muted">Puede estar pausada por inactividad. Probá de nuevo en unos minutos.</p>
        </div>
      ) : players.ok && catalog.ok && sets.ok && players.data.length > 0 ? (
        <PlayerMasterView
          key={params.comp}
          players={players.data}
          catalog={catalog.data}
          sets={sets.data}
          competitionName={activeName}
          initialPlayerId={params.jugador ?? null}
          initialStat={params.estadistica ?? null}
          initialSet={params.conjunto ?? null}
        />
      ) : (
        <p className="under-construction text-muted">
          Todavía no hay partidos cargados para esta competición. Se completan con la próxima actualización.
        </p>
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
