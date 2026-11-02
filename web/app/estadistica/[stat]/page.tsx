import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { z } from 'zod';

import { StatDetailView } from '@/components/stats/stat-detail';
import { parseRefs, refsToParam } from '@/lib/compare/compare';
import { getStatDetail } from '@/lib/data/desglosada';
import { ErrorNotice } from '@/components/error-notice';

export const metadata: Metadata = { title: 'Estadística desglosada' };

// Los parámetros de la URL vienen de afuera: se validan contra listas cerradas (14.3).
const paramsSchema = z.object({ stat: z.string().regex(/^[a-z][a-z0-9_]{0,60}$/) });
const searchSchema = z.object({
  entidad: z.enum(['jugador', 'equipo', 'rival', 'arbitro']).catch('equipo'),
  id: z.coerce.number().int().positive().optional().catch(undefined),
  // Desde Comparar (9.7): referencias elegidas, mínimo de minutos, promedio y la vuelta.
  ref: z
    .string()
    .regex(/^[a-z0-9,-]{1,80}$/)
    .optional()
    .catch(undefined),
  min: z.coerce.number().int().min(0).max(6000).catch(180),
  prom: z.enum(['simple', 'ponderado']).catch('simple'),
  // Solo una ruta interna de Comparar: nada de enlaces a otros sitios (14.3).
  volver: z
    .string()
    .regex(/^\/comparar\?[a-zA-Z0-9_=&%.,-]{0,400}$/)
    .optional()
    .catch(undefined),
});

interface PageProps {
  params: Promise<{ stat: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function Page({ params, searchParams }: PageProps) {
  const parsed = paramsSchema.safeParse(await params);
  if (!parsed.success) notFound();
  const raw = await searchParams;
  const search = searchSchema.parse({
    entidad: raw.entidad,
    id: raw.id,
    ref: raw.ref,
    min: raw.min,
    prom: raw.prom,
    volver: raw.volver,
  });
  // Un jugador, un rival o un árbitro necesitan su id; el equipo no.
  if (search.entidad !== 'equipo' && search.id === undefined) notFound();
  const chosen =
    search.entidad === 'jugador' && search.ref
      ? { refs: parseRefs(search.ref), minMinutes: search.min, mode: search.prom }
      : null;
  const detail = await getStatDetail(parsed.data.stat, search.entidad, search.id ?? null, chosen);
  if (detail === null) notFound();
  if (!detail.ok) {
    return <ErrorNotice code={detail.code} />;
  }
  // Las relacionadas conservan las referencias y la vuelta a Comparar.
  const fromCompare = chosen
    ? `&ref=${refsToParam(chosen.refs)}&min=${String(chosen.minMinutes)}&prom=${chosen.mode}${search.volver ? `&volver=${encodeURIComponent(search.volver)}` : ''}`
    : '';
  const query = `?entidad=${search.entidad}${search.id !== undefined ? `&id=${String(search.id)}` : ''}${fromCompare}`;
  const backHref =
    search.volver ??
    (search.entidad === 'jugador'
      ? `/jugadores?jugador=${String(search.id)}&estadistica=${parsed.data.stat}`
      : `/equipo?estadistica=${parsed.data.stat}`);
  return <StatDetailView detail={detail.data} backHref={backHref} query={query} />;
}
