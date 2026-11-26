import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { z } from 'zod';

import { ErrorNotice } from '@/components/error-notice';
import { DATASET_URL, getClub } from '@/lib/data/parquet';
import { NOT_AVAILABLE } from '@/lib/format';

// El id viene de la URL: país FIFA en minúscula + nombre (`arg-boca-juniors`), validado antes de usarlo.
const paramsSchema = z.object({ uid: z.string().regex(/^[a-z]{3}-[a-z0-9-]{1,80}$/) });

interface PageProps {
  params: Promise<{ uid: string }>;
}

const day = (iso: string) => iso.slice(0, 10).split('-').reverse().join('/');
const score = (a: number | null, b: number | null) =>
  a === null || b === null ? NOT_AVAILABLE : `${String(a)} – ${String(b)}`;
const cell = (v: number | null) => (v === null ? NOT_AVAILABLE : String(v));

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

      {club.matches.length ? (
        // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- región desplazable con nombre (axe)
        <div className="data-table-wrap" tabIndex={0} role="region" aria-label="Partidos">
          <table className="data-table tabular">
            <caption className="text-left font-bold">Partidos</caption>
            <thead>
              <tr>
                <th scope="col">Fecha</th>
                <th scope="col">Competición</th>
                <th scope="col">Rival</th>
                <th scope="col">Condición</th>
                <th scope="col">Resultado</th>
              </tr>
            </thead>
            <tbody>
              {club.matches.map((m) => (
                <tr key={`${m.match_date}-${m.opponent ?? ''}`}>
                  <th scope="row">{day(m.match_date)}</th>
                  <td className="text-left">
                    {[m.competition_name, m.round_label].filter(Boolean).join(' · ') || NOT_AVAILABLE}
                  </td>
                  <td className="text-left">{m.opponent ?? NOT_AVAILABLE}</td>
                  <td className="text-left">
                    {m.boca_home === null ? NOT_AVAILABLE : m.boca_home ? 'Local' : 'Visitante'}
                  </td>
                  <td>{score(m.goals_for, m.goals_against)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="text-muted">Todavía no hay partidos de este club en el archivo abierto.</p>
      )}

      {club.standings.map((t) => (
        // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- región desplazable con nombre (axe)
        <div key={t.name} className="data-table-wrap" tabIndex={0} role="region" aria-label={`Posiciones: ${t.name}`}>
          <table className="data-table tabular">
            <caption className="text-left font-bold">Posiciones · {t.name}</caption>
            <thead>
              <tr>
                <th scope="col">#</th>
                <th scope="col">Equipo</th>
                <th scope="col">PJ</th>
                <th scope="col">G</th>
                <th scope="col">E</th>
                <th scope="col">P</th>
                <th scope="col">GF</th>
                <th scope="col">GC</th>
                <th scope="col">Pts</th>
              </tr>
            </thead>
            <tbody>
              {t.rows.map((r) => (
                <tr key={r.team_name} className={r.team_name === club.name ? 'font-bold' : undefined}>
                  <td>{cell(r.rank)}</td>
                  <th scope="row" className="text-left">
                    {r.team_name}
                  </th>
                  <td>{cell(r.played)}</td>
                  <td>{cell(r.won)}</td>
                  <td>{cell(r.drawn)}</td>
                  <td>{cell(r.lost)}</td>
                  <td>{cell(r.goals_for)}</td>
                  <td>{cell(r.goals_against)}</td>
                  <td>{cell(r.points)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}

      <p className="text-sm text-muted">
        Fuente: Promiedos (promiedos.com.ar) y cálculo propio. Los archivos están en{' '}
        <a href={DATASET_URL} className="focus-ring underline">
          Hugging Face
        </a>{' '}
        para descargar o consultar.
      </p>
    </div>
  );
}
