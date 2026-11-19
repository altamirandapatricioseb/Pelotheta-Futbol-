import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { z } from 'zod';

import { MatchView } from '@/components/match/match-view';
import { getMatchPage } from '@/lib/data/match';
import { getPredictions } from '@/lib/data/models';
import { CURRENT_TEAM } from '@/config/teams';
import { ErrorNotice } from '@/components/error-notice';

export const metadata: Metadata = {
  description: 'Un partido de Boca Juniors: marcador, goles, cara a cara, jugadores y estadísticas contra su promedio.',
};

// El id viene de la URL: se valida antes de usarlo (14.3).
const paramsSchema = z.object({ id: z.coerce.number().int().positive().max(1_000_000_000) });

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function PartidoPage({ params }: PageProps) {
  const parsed = paramsSchema.safeParse(await params);
  if (!parsed.success) notFound();
  const [page, predictions] = await Promise.all([getMatchPage(parsed.data.id), getPredictions(CURRENT_TEAM.slug)]);
  if (page === null) notFound();
  if (!page.ok) {
    return <ErrorNotice code={page.code} />;
  }
  // El backtest del predictor guarda la previa de cada partido de liga; la fecha puede diferir en un
  // día entre fuentes (StrikerAPI fecha en UTC).
  const day = Date.parse(page.data.match.date);
  const pre = predictions.ok
    ? predictions.data.predictions.find(
        (p) => p.kind === 'backtest' && p.date !== null && Math.abs(Date.parse(p.date) - day) <= 86_400_000,
      )
    : undefined;
  return <MatchView data={page.data} pre={pre} />;
}
