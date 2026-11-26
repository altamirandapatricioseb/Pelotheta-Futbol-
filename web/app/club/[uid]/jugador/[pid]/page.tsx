import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { z } from 'zod';

import { ErrorNotice } from '@/components/error-notice';
import { PlayerMatchTable } from '@/components/club/club-player-stats';
import {
  DATASET_URL,
  getClubPlayerMatches,
  getLeaguePlayer,
  PLAYER_STATS,
  type PlayerProfile,
} from '@/lib/data/parquet';
import { formatNumber, NOT_AVAILABLE } from '@/lib/format';

// Los ids vienen de la URL: club como en /club/[uid] y jugador con el id de su fuente (Bzzoiro o `ss…`).
const playerId = z.string().min(1).max(120);
const paramsSchema = z.object({ uid: z.string().regex(/^[a-z]{3}-[a-z0-9-]{1,80}$/), pid: playerId });
const searchSchema = z.object({ vs: playerId.optional().catch(undefined) });

interface PageProps {
  params: Promise<{ uid: string; pid: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

const decode = (s: string) => {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
};

async function load({ params, searchParams }: PageProps) {
  const parsed = paramsSchema.safeParse(await params);
  if (!parsed.success) return null;
  const { vs } = searchSchema.parse(await searchParams);
  return getLeaguePlayer(parsed.data.uid, decode(parsed.data.pid), vs);
}

export async function generateMetadata(props: PageProps): Promise<Metadata> {
  const result = await load(props);
  const name = result?.ok && result.data ? result.data.player.player_name : 'Jugador';
  return { title: name, description: `${name}: cada estadística cada 90 minutos y su percentil en la liga.` };
}

// Cada 90 hay valores chicos (0,15 goles): dos decimales.
const twoDecimals = new Intl.NumberFormat('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const per90 = (p: PlayerProfile, stat: string) => {
  const v = p[`per90_${stat}`];
  return v === null || v === undefined ? NOT_AVAILABLE : twoDecimals.format(v);
};

function Percentile({ p, stat, who }: { p: PlayerProfile; stat: string; who: string }) {
  const v = p[`pct_${stat}`];
  if (v === null || v === undefined) return <>{NOT_AVAILABLE}</>;
  return (
    <span className="inline-flex items-center gap-2">
      <meter min={0} max={100} value={v} aria-label={`Percentil de ${who}`} />
      {String(v)}
    </span>
  );
}

/** Ficha de un jugador de cualquier club, leída del perfil público (Parquet), con comparación. */
export default async function LeaguePlayerPage(props: PageProps) {
  const result = await load(props);
  if (result === null) notFound();
  if (!result.ok) return <ErrorNotice code={result.code} />;
  if (result.data === null) notFound();
  const { club, league, player, peers, versus } = result.data;
  const games = await getClubPlayerMatches(club.uid, club.name);
  const mine = games.ok ? (games.data ?? []).filter((g) => g.playerId === player.player_id) : [];
  const stats = PLAYER_STATS.filter(
    ([stat]) => player[`pct_${stat}`] != null || (versus !== null && versus[`pct_${stat}`] != null),
  );
  const self = `/club/${club.uid}/jugador/${encodeURIComponent(player.player_id ?? '')}`;

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="page-title">
          <span className="title-trace">{player.player_name}</span>
        </h1>
        <p className="mt-2 text-muted">
          <Link href={`/club/${club.uid}`} className="focus-ring underline">
            {club.name}
          </Link>{' '}
          · {player.position ?? NOT_AVAILABLE} · {formatNumber(player.minutes)} minutos en{' '}
          {formatNumber(player.matches)} partidos{league ? ` · ${league}` : ''}
        </p>
      </div>

      {peers.length ? (
        <form method="get" action={self} className="flex flex-wrap items-end gap-2">
          <label htmlFor="vs" className="grid gap-1">
            <span className="font-bold">Comparar con otro jugador de su posición en la liga</span>
            <select id="vs" name="vs" defaultValue={versus?.player_id ?? ''} className="focus-ring">
              <option value="">Nadie</option>
              {peers.map((p) => (
                <option key={p.player_id ?? p.player_name} value={p.player_id ?? ''}>
                  {p.player_name} ({p.team_name})
                </option>
              ))}
            </select>
          </label>
          <button type="submit" className="focus-ring underline">
            Comparar
          </button>
        </form>
      ) : null}

      {/* eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- región desplazable con nombre (axe) */}
      <div className="data-table-wrap" tabIndex={0} role="region" aria-label="Estadísticas">
        <table className="data-table tabular">
          <caption className="text-left font-bold">
            Cada 90 minutos y percentil contra los de su posición en la liga (100 = el mejor)
          </caption>
          <thead>
            <tr>
              <th scope="col">Estadística</th>
              <th scope="col">{player.player_name}</th>
              <th scope="col">Percentil</th>
              {versus ? (
                <>
                  <th scope="col">
                    {versus.player_name} ({versus.team_name})
                  </th>
                  <th scope="col">Percentil</th>
                </>
              ) : null}
            </tr>
          </thead>
          <tbody>
            {stats.map(([stat, label]) => (
              <tr key={stat}>
                <th scope="row" className="text-left">
                  {label}
                </th>
                <td>{per90(player, stat)}</td>
                <td>
                  <Percentile p={player} stat={stat} who={player.player_name} />
                </td>
                {versus ? (
                  <>
                    <td>{per90(versus, stat)}</td>
                    <td>
                      <Percentile p={versus} stat={stat} who={versus.player_name} />
                    </td>
                  </>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {mine.length ? <PlayerMatchTable rows={mine} /> : null}

      <p className="text-sm text-muted">
        Cálculo propio sobre las estadísticas por partido de Bzzoiro y ScoutingStats (el crudo no se publica). Solo
        jugadores con 450 minutos o más. En pérdidas de balón, percentil alto quiere decir que pierde menos. Los
        archivos están en{' '}
        <a href={DATASET_URL} className="focus-ring underline">
          Hugging Face
        </a>
        .
      </p>
    </div>
  );
}
