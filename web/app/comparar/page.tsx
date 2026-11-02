import type { Metadata } from 'next';
import { z } from 'zod';

import { ExcelDownloads } from '@/components/excel-downloads';
import { CompareView, type BreakdownData } from '@/components/compare/compare-view';
import { parseRefs, PERIODS, windowCode, type Period } from '@/lib/compare/compare';
import { getCatalog } from '@/lib/data/catalog';
import { getBreakdown, getPlayerPositions } from '@/lib/data/compare';
import { getCompetitions, getPlayerMaster } from '@/lib/data/players';
import { ErrorNotice } from '@/components/error-notice';

export const metadata: Metadata = {
  title: 'Comparar',
  description:
    'Comparación de un jugador de Boca Juniors contra la media del equipo, de una línea, de su posición u otro jugador, por categoría y con el desglose de cada estadística.',
};

const PERIOD_IDS = PERIODS.map((p) => p.id) as [Period, ...Period[]];

// Los parámetros de la URL vienen de afuera: se validan antes de usarlos (14.3).
const searchSchema = z.object({
  jugador: z.coerce.number().int().positive().optional().catch(undefined),
  con: z
    .string()
    .regex(/^[a-z0-9,-]{1,120}$/)
    .optional()
    .catch(undefined),
  vista: z
    .string()
    .regex(/^[a-z]{3,20}$/)
    .catch('resumen'),
  stat: z
    .string()
    .regex(/^[a-z][a-z0-9_]{0,60}$/)
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
  ver: z.enum(['todas', 'posicion']).catch('posicion'),
});

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

const one = (v: string | string[] | undefined) => (typeof v === 'string' ? v : undefined);

export default async function CompararPage({ searchParams }: PageProps) {
  const raw = await searchParams;
  const params = searchSchema.parse({
    jugador: one(raw.jugador),
    con: one(raw.con),
    vista: one(raw.vista),
    stat: one(raw.stat),
    periodo: one(raw.periodo),
    comp: one(raw.comp),
    modo: one(raw.modo),
    min: one(raw.min),
    prom: one(raw.prom),
    ver: one(raw.ver),
  });
  // Los últimos 5 o 10 partidos y el último mes son de todas las competiciones.
  const competition = params.periodo === 'temporada' ? params.comp : 'todas';
  const refs = parseRefs(params.con);
  const [players, catalog, positions, competitions] = await Promise.all([
    getPlayerMaster(windowCode(params.periodo, competition)),
    getCatalog('player'),
    getPlayerPositions(),
    getCompetitions(),
  ]);
  const failed = [players, catalog, positions].flatMap((r) => (r.ok ? [] : [r]))[0];
  const main = players.ok ? players.data.find((p) => p.playerId === params.jugador) : undefined;

  // El desglose necesita la serie partido a partido del jugador y, si hay, del otro jugador.
  let breakdown: BreakdownData | null = null;
  const stat = catalog.ok ? catalog.data.find((s) => s.id === params.stat && s.available) : undefined;
  if (params.vista === 'desglose' && main && stat) {
    const other = refs.find((r) => r.kind === 'jugador')?.playerId;
    const ids = [main.playerId, ...(other !== undefined && other !== main.playerId ? [other] : [])];
    const result = await getBreakdown(stat.id, ids);
    if (result.ok) breakdown = { statId: stat.id, playerIds: ids, ...result.data };
  }

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="page-title">
            <span className="title-trace">Comparar</span>
          </h1>
          <p className="mt-2 text-muted">
            Un jugador contra la media del equipo, de una línea, de su posición u otro jugador, por categoría
          </p>
        </div>
        <ExcelDownloads />
      </div>
      {failed ? (
        <ErrorNotice code={failed.code} />
      ) : players.ok && catalog.ok && positions.ok && players.data.length ? (
        <CompareView
          players={players.data}
          catalog={catalog.data}
          positions={positions.data}
          competitions={competitions.ok ? competitions.data : []}
          initial={{
            mainId: main?.playerId ?? null,
            refs,
            view: params.vista,
            stat: stat?.id ?? null,
            period: params.periodo,
            competition,
            per90: params.modo === 'por90',
            minMinutes: params.min,
            mode: params.prom,
            all: params.ver === 'todas',
          }}
          breakdown={breakdown}
        />
      ) : (
        <p className="under-construction text-muted">
          Todavía no hay partidos cargados para este período. Se completan con la próxima actualización.
        </p>
      )}
    </div>
  );
}
