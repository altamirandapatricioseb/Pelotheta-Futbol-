import type { Metadata } from 'next';
import { z } from 'zod';

import { CompareView } from '@/components/compare/compare-view';
import { parseRefs, PERIODS, windowCode, type Period } from '@/lib/compare/compare';
import { getCatalog } from '@/lib/data/catalog';
import { getCompareSeries, getPlayerPositions } from '@/lib/data/compare';
import { getCompetitions, getPlayerMaster } from '@/lib/data/players';

export const metadata: Metadata = {
  title: 'Comparar',
  description:
    'Comparación de un jugador de Boca Juniors contra la media del plantel, de su zona, de su posición u otro jugador, por categoría.',
};

const PERIOD_IDS = PERIODS.map((p) => p.id) as [Period, ...Period[]];

// Los parámetros de la URL vienen de afuera: se validan antes de usarlos (14.3).
const searchSchema = z.object({
  jugador: z.coerce.number().int().positive().optional().catch(undefined),
  refs: z
    .string()
    .regex(/^[a-z0-9,-]{1,80}$/)
    .optional()
    .catch(undefined),
  periodo: z.enum(PERIOD_IDS).catch('temporada'),
  comp: z
    .string()
    .regex(/^[a-z0-9_]{1,60}$/)
    .catch('todas'),
  modo: z.enum(['totales', 'por90']).catch('por90'),
  min: z.coerce.number().int().min(0).max(6000).catch(180),
  prom: z.enum(['simple', 'ponderado']).catch('simple'),
  serie: z
    .string()
    .regex(/^[a-z][a-z0-9_]{0,60}$/)
    .catch('calificacion'),
});

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

const one = (v: string | string[] | undefined) => (typeof v === 'string' ? v : undefined);

export default async function CompararPage({ searchParams }: PageProps) {
  const raw = await searchParams;
  const params = searchSchema.parse({
    jugador: one(raw.jugador),
    refs: one(raw.refs),
    periodo: one(raw.periodo),
    comp: one(raw.comp),
    modo: one(raw.modo),
    min: one(raw.min),
    prom: one(raw.prom),
    serie: one(raw.serie),
  });
  // Los últimos 5 o 10 partidos y el último mes son de todas las competiciones.
  const competition = params.periodo === 'temporada' ? params.comp : 'todas';
  const [players, catalog, positions, competitions] = await Promise.all([
    getPlayerMaster(windowCode(params.periodo, competition)),
    getCatalog('player'),
    getPlayerPositions(),
    getCompetitions(),
  ]);
  const failed = [players, catalog, positions].flatMap((r) => (r.ok ? [] : [r]))[0];
  const main = players.ok ? (players.data.find((p) => p.playerId === params.jugador) ?? players.data[0]) : undefined;
  const serieStat = catalog.ok
    ? (catalog.data.find((s) => s.id === params.serie && s.available) ??
      catalog.data.find((s) => s.id === 'calificacion'))
    : undefined;
  const series =
    main && serieStat ? await getCompareSeries(serieStat.id, main.playerId, params.periodo, competition) : null;

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="page-title">
          <span className="title-trace">Comparar</span>
        </h1>
        <p className="mt-2 text-muted">
          Un jugador contra el plantel, su zona, su posición u otro jugador, estadística por estadística
        </p>
      </div>
      {failed ? (
        <div role="alert" className="under-construction">
          <p className="font-bold">{failed.code}: la base de datos no responde.</p>
          <p className="text-muted">Puede estar pausada por inactividad. Probá de nuevo en unos minutos.</p>
        </div>
      ) : players.ok && catalog.ok && positions.ok && main ? (
        <CompareView
          players={players.data}
          catalog={catalog.data}
          positions={positions.data}
          competitions={competitions.ok ? competitions.data : []}
          initial={{
            mainId: main.playerId,
            refs: parseRefs(params.refs),
            period: params.periodo,
            competition,
            per90: params.modo === 'por90',
            minMinutes: params.min,
            mode: params.prom,
            serie: serieStat?.id ?? 'calificacion',
          }}
          series={series?.ok ? { playerId: main.playerId, statId: serieStat?.id ?? '', points: series.data } : null}
        />
      ) : (
        <p className="under-construction text-muted">
          Todavía no hay partidos cargados para este período. Se completan con la próxima actualización.
        </p>
      )}
    </div>
  );
}
