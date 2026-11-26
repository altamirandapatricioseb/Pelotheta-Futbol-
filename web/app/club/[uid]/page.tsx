import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { z } from 'zod';

import { ErrorNotice } from '@/components/error-notice';
import { ClubSections } from '@/components/club/club-sections';
import { getClub } from '@/lib/data/parquet';

// El id viene de la URL: país FIFA en minúscula + nombre (`arg-boca-juniors`), validado antes de usarlo.
const paramsSchema = z.object({ uid: z.string().regex(/^[a-z]{3}-[a-z0-9-]{1,80}$/) });

interface PageProps {
  params: Promise<{ uid: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const parsed = paramsSchema.safeParse(await params);
  const club = parsed.success ? await getClub(parsed.data.uid) : null;
  const name = club?.ok && club.data ? club.data.name : 'Club';
  return { title: name, description: `${name}: partidos y posiciones desde el archivo abierto de Pelotheta Θ.` };
}

/** Ficha de un club leída del archivo abierto en Parquet (Hugging Face), con el club como parámetro. */
export default async function ClubPage({ params }: PageProps) {
  const parsed = paramsSchema.safeParse(await params);
  if (!parsed.success) notFound();
  const result = await getClub(parsed.data.uid);
  if (!result.ok) return <ErrorNotice code={result.code} />;
  const club = result.data;
  if (club === null) notFound();

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="page-title">
          <span className="title-trace">{club.name}</span>
        </h1>
        <p className="mt-2 text-muted">{club.country ?? 'Conmebol'} · partidos y posiciones desde el archivo abierto</p>
      </div>

      <ClubSections club={club} />
    </div>
  );
}
