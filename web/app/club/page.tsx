import type { Metadata } from 'next';
import Link from 'next/link';

import { ErrorNotice } from '@/components/error-notice';
import { COUNTRIES, DATASET_URL, listClubs } from '@/lib/data/parquet';

export const metadata: Metadata = {
  title: 'Clubes',
  description:
    'Los clubes de las ligas de la Conmebol con sus partidos, posiciones y jugadores, desde el archivo abierto.',
};

/** Índice de clubes de todos los países y ligas del sistema, leído del archivo abierto en Parquet. */
export default async function ClubsPage() {
  const codes = Object.keys(COUNTRIES);
  const lists = await Promise.all(codes.map((code) => listClubs(code)));
  const failed = lists.flatMap((l) => (l.ok ? [] : [l]))[0];
  return (
    <div className="grid gap-6">
      <div>
        <h1 className="page-title">
          <span className="title-trace">Clubes</span>
        </h1>
        <p className="mt-2 text-muted">Conmebol · partidos, posiciones y jugadores desde el archivo abierto</p>
      </div>
      {failed ? <ErrorNotice code={failed.code} /> : null}
      {codes.map((code, i) => {
        const list = lists[i];
        const clubs = list?.ok ? list.data : [];
        const leagues = [...new Set(clubs.map((c) => c.league ?? 'Otras'))];
        return (
          <section key={code} className="grid gap-3" aria-labelledby={`pais-${code}`}>
            <h2 id={`pais-${code}`} className="text-xl font-bold">
              {COUNTRIES[code]}
            </h2>
            {clubs.length === 0 ? (
              <p className="text-sm text-muted">Todavía sin datos en el archivo abierto.</p>
            ) : (
              leagues.map((league) => (
                <div key={league} className="grid gap-1">
                  <h3 className="font-bold">{league}</h3>
                  <ul className="grid gap-1 sm:grid-cols-2 lg:grid-cols-3">
                    {clubs
                      .filter((c) => (c.league ?? 'Otras') === league)
                      .map((c) => (
                        <li key={c.uid}>
                          <Link href={`/club/${c.uid}`} className="focus-ring underline">
                            {c.name}
                          </Link>
                        </li>
                      ))}
                  </ul>
                </div>
              ))
            )}
          </section>
        );
      })}
      <p className="text-sm text-muted">
        Fuentes: Promiedos (promiedos.com.ar) y cálculo propio sobre Bzzoiro y ScoutingStats. Los archivos están en{' '}
        <a href={DATASET_URL} className="focus-ring underline">
          Hugging Face
        </a>
        .
      </p>
    </div>
  );
}
