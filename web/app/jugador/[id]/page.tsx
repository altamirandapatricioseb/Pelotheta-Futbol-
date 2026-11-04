import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { z } from 'zod';

import { PlayerDetailView } from '@/components/players/player-detail';
import { getPlayerDetail } from '@/lib/data/player';
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
  const detail = await getPlayerDetail(parsed.data.id);
  if (detail === null) notFound();
  if (!detail.ok) {
    return <ErrorNotice code={detail.code} />;
  }
  return <PlayerDetailView data={detail.data} />;
}
