import type { Metadata } from 'next';
import Link from 'next/link';

import { ErrorNotice } from '@/components/error-notice';
import { DATASET_URL, listClubs } from '@/lib/data/parquet';

export const metadata: Metadata = {
  title: 'Clubes',
  description: 'Los clubes de la Primera Argentina con sus partidos y posiciones, desde el archivo abierto.',
};

/** Índice de clubes con ficha, leído del archivo abierto en Parquet. */
export default async function ClubsPage() {
  const clubs = await listClubs('ARG');
  return (
    <div className="grid gap-6">
      <div>
        <h1 className="page-title">
          <span className="title-trace">Clubes</span>
        </h1>
        <p className="mt-2 text-muted">Argentina · Primera División · partidos y posiciones desde el archivo abierto</p>
      </div>
      {clubs.ok ? (
        <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {clubs.data.map((c) => (
            <li key={c.uid}>
              <Link href={`/club/${c.uid}`} className="focus-ring underline">
                {c.name}
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <ErrorNotice code={clubs.code} />
      )}
      <p className="text-sm text-muted">
        Fuente: Promiedos (promiedos.com.ar). Los archivos están en{' '}
        <a href={DATASET_URL} className="focus-ring underline">
          Hugging Face
        </a>
        .
      </p>
    </div>
  );
}
