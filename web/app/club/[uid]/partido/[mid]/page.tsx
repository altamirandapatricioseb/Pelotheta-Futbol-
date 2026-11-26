import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { z } from 'zod';

import { ErrorNotice } from '@/components/error-notice';
import { DATASET_URL, getLeagueMatch, type LeagueResult } from '@/lib/data/parquet';
import { NOT_AVAILABLE } from '@/lib/format';

// Club como en /club/[uid]; el partido con el id de su fuente (letras de Promiedos, `wp-…` de Wikipedia).
const paramsSchema = z.object({
  uid: z.string().regex(/^[a-z]{3}-[a-z0-9-]{1,80}$/),
  mid: z.string().regex(/^[A-Za-z0-9_-]{1,160}$/),
});

interface PageProps {
  params: Promise<{ uid: string; mid: string }>;
}

const day = (iso: string) => iso.slice(0, 10).split('-').reverse().join('/');
const score = (a: number | null, b: number | null) =>
  a === null || b === null ? NOT_AVAILABLE : `${String(a)} – ${String(b)}`;
const SOURCES: Record<string, string> = {
  promiedos: 'Promiedos (promiedos.com.ar)',
  wikipedia: 'Wikipedia (CC BY-SA)',
};

async function load({ params }: PageProps) {
  const parsed = paramsSchema.safeParse(await params);
  return parsed.success ? getLeagueMatch(parsed.data.uid, parsed.data.mid) : null;
}

export async function generateMetadata(props: PageProps): Promise<Metadata> {
  const result = await load(props);
  const r = result?.ok ? result.data?.result : undefined;
  const name = r ? `${r.home_team} ${score(r.home_goals, r.away_goals)} ${r.away_team}` : 'Partido';
  return { title: name, description: `${name}: goles, tarjetas, árbitro y cruces de la temporada.` };
}

// Filas de la planilla: solo las que la fuente trae para al menos un equipo.
const SHEET: [string, (r: LeagueResult) => [number | null | undefined, number | null | undefined]][] = [
  ['Amarillas', (r) => [r.yellow_home, r.yellow_away]],
  ['Rojas', (r) => [r.red_home, r.red_away]],
  ['Faltas', (r) => [r.fouls_home, r.fouls_away]],
  ['Lesionados', (r) => [r.injured_home, r.injured_away]],
  ['Suspendidos', (r) => [r.suspended_home, r.suspended_away]],
];
const cell = (v: number | null | undefined) => (v === null || v === undefined ? NOT_AVAILABLE : String(v));

/** Ficha de un partido de liga de cualquier club, leída del archivo abierto en Parquet. */
export default async function LeagueMatchPage(props: PageProps) {
  const result = await load(props);
  if (result === null) notFound();
  if (!result.ok) return <ErrorNotice code={result.code} />;
  if (result.data === null) notFound();
  const { result: r, league, home, away, goals, headToHead } = result.data;
  const sheet = SHEET.map(([label, pick]) => [label, ...pick(r)] as const).filter(([, h, a]) => h != null || a != null);
  // Marcador parcial después de cada gol.
  const partial = goals.map((_, i) => {
    const upTo = goals.slice(0, i + 1);
    return `${String(upTo.filter((g) => g.home).length)} – ${String(upTo.filter((g) => !g.home).length)}`;
  });

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="page-title">
          <span className="title-trace">
            {r.home_team} {score(r.home_goals, r.away_goals)} {r.away_team}
          </span>
        </h1>
        <p className="mt-2 text-muted">
          {day(r.match_date)}
          {r.stage ? ` · ${r.stage}` : ''}
          {league ? ` · ${league}` : ''}
          {r.referee ? ` · Árbitro: ${r.referee}` : ''}
        </p>
        <p className="mt-1">
          <Link href={`/club/${home.uid}`} className="focus-ring underline">
            {home.name}
          </Link>{' '}
          ·{' '}
          <Link href={`/club/${away.uid}`} className="focus-ring underline">
            {away.name}
          </Link>
        </p>
      </div>

      <section className="grid gap-2" aria-labelledby="goles">
        <h2 id="goles" className="text-xl font-bold">
          Goles
        </h2>
        {goals.length ? (
          <ol className="grid gap-1">
            {goals.map((g, i) => (
              <li key={`${String(g.minute)}-${String(i)}`}>
                <strong>{g.minute}&apos;</strong> {g.home ? r.home_team : r.away_team} ({partial[i]})
              </li>
            ))}
          </ol>
        ) : (
          <p className="text-sm text-muted">
            {r.home_goals === 0 && r.away_goals === 0
              ? 'Sin goles.'
              : 'La fuente de este partido no da los minutos de los goles.'}
          </p>
        )}
      </section>

      {sheet.length ? (
        // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- región desplazable con nombre (axe)
        <div className="data-table-wrap" tabIndex={0} role="region" aria-label="Planilla">
          <table className="data-table tabular">
            <caption className="text-left font-bold">Planilla</caption>
            <thead>
              <tr>
                <th scope="col">Dato</th>
                <th scope="col">{r.home_team}</th>
                <th scope="col">{r.away_team}</th>
              </tr>
            </thead>
            <tbody>
              {sheet.map(([label, h, a]) => (
                <tr key={label}>
                  <th scope="row" className="text-left">
                    {label}
                  </th>
                  <td>{cell(h)}</td>
                  <td>{cell(a)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {(home.standing ?? away.standing) ? (
        <section className="grid gap-2" aria-labelledby="tabla">
          <h2 id="tabla" className="text-xl font-bold">
            En la tabla hoy
          </h2>
          <ul className="grid gap-1">
            {[home, away].map((t) =>
              t.standing ? (
                <li key={t.uid}>
                  <strong>{t.name}:</strong> puesto {cell(t.standing.rank)} con {cell(t.standing.points)} puntos en{' '}
                  {cell(t.standing.played)} partidos ({t.standing.table_name})
                </li>
              ) : null,
            )}
          </ul>
        </section>
      ) : null}

      {headToHead.length ? (
        // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- región desplazable con nombre (axe)
        <div className="data-table-wrap" tabIndex={0} role="region" aria-label="Otros cruces">
          <table className="data-table tabular">
            <caption className="text-left font-bold">Otros cruces entre los dos en el archivo</caption>
            <thead>
              <tr>
                <th scope="col">Fecha</th>
                <th scope="col">Local</th>
                <th scope="col">Resultado</th>
                <th scope="col">Visitante</th>
              </tr>
            </thead>
            <tbody>
              {headToHead.map((m) => (
                <tr key={m.ext_id ?? `${m.match_date}-${m.home_team}`}>
                  <td>{day(m.match_date)}</td>
                  <td className="text-left">{m.home_team}</td>
                  <td>
                    {m.ext_id ? (
                      <Link href={`/club/${home.uid}/partido/${m.ext_id}`} className="focus-ring underline">
                        {score(m.home_goals, m.away_goals)}
                      </Link>
                    ) : (
                      score(m.home_goals, m.away_goals)
                    )}
                  </td>
                  <td className="text-left">{m.away_team}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      <p className="text-sm text-muted">
        Fuente: {SOURCES[r.source] ?? r.source}. Los archivos están en{' '}
        <a href={DATASET_URL} className="focus-ring underline">
          Hugging Face
        </a>
        .
      </p>
    </div>
  );
}
