import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { z } from 'zod';

import { PlayerDetailView } from '@/components/players/player-detail';
import { getAlternatives, getMarketValues } from '@/lib/data/models';
import { getPlayerDetail } from '@/lib/data/player';
import { CURRENT_TEAM } from '@/config/teams';
import { ErrorNotice } from '@/components/error-notice';

export const metadata: Metadata = {
  description: 'Un jugador de Boca Juniors: ficha, conclusiones, todas sus estadísticas y sus partidos.',
};

// El id viene de la URL: se valida antes de usarlo (14.3).
const paramsSchema = z.object({ id: z.coerce.number().int().positive().max(1_000_000_000) });

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function JugadorPage({ params }: PageProps) {
  const parsed = paramsSchema.safeParse(await params);
  if (!parsed.success) notFound();
  const id = parsed.data.id;
  const [detail, values, alternatives] = await Promise.all([
    getPlayerDetail(id),
    getMarketValues(CURRENT_TEAM.slug),
    getAlternatives(CURRENT_TEAM.slug),
  ]);
  if (detail === null) notFound();
  if (!detail.ok) {
    return <ErrorNotice code={detail.code} />;
  }
  return (
    <PlayerDetailView
      data={detail.data}
      market={values.ok ? values.data.rows.find((r) => r.playerId === id) : undefined}
      alternatives={
        alternatives.ok
          ? alternatives.data.alternatives.filter((a) => a.playerId === id).sort((a, b) => b.similarity - a.similarity)
          : []
      }
    />
  );
}
