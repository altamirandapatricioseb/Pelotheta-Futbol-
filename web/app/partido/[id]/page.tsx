import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { z } from 'zod';

import { MatchView } from '@/components/match/match-view';
import { getMatchPage } from '@/lib/data/match';

export const metadata: Metadata = {
  title: 'Partido',
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
  const page = await getMatchPage(parsed.data.id);
  if (page === null) notFound();
  if (!page.ok) {
    return (
      <div role="alert" className="under-construction">
        <p className="font-bold">{page.code}: la base de datos no responde.</p>
        <p className="text-muted">Puede estar pausada por inactividad. Probá de nuevo en unos minutos.</p>
      </div>
    );
  }
  return <MatchView data={page.data} />;
}
