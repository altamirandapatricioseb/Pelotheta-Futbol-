import Link from 'next/link';

import type { PlayerMatchStat } from '@/lib/data/parquet';
import { formatNumber, NOT_AVAILABLE } from '@/lib/format';

// Estadísticas por jugador de cualquier club, del crudo de Bzzoiro y ScoutingStats (etapa 5k-3).
const STATS: readonly [key: string, label: string][] = [
  ['goals', 'Goles'],
  ['goal_assist', 'Asist.'],
  ['expected_goals', 'xG'],
  ['expected_assists', 'xA'],
  ['total_shots', 'Remates'],
  ['shots_on_target', 'Al arco'],
  ['key_pass', 'Pases clave'],
  ['accurate_pass', 'Pases completos'],
  ['won_tackle', 'Entradas ganadas'],
  ['interception', 'Intercep.'],
  ['ball_recovery', 'Recup.'],
  ['saves', 'Atajadas'],
];
const DECIMALS = new Set(['expected_goals', 'expected_assists']);
const twoDecimals = new Intl.NumberFormat('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const show = (key: string, v: number | undefined) =>
  v === undefined ? NOT_AVAILABLE : DECIMALS.has(key) ? twoDecimals.format(v) : formatNumber(v);
const day = (iso: string) => iso.slice(0, 10).split('-').reverse().join('/');
// Solo las columnas que la fuente trae para alguien de la tabla.
const present = (rows: readonly { stats: Record<string, number> }[]) =>
  STATS.filter(([k]) => rows.some((r) => r.stats[k] !== undefined));

export interface SeasonLine {
  playerId: string;
  playerName: string;
  position: string | null;
  matches: number;
  minutes: number;
  /** Nota promedio pesada por minutos (solo partidos con nota). */
  rating: number | null;
  stats: Record<string, number>;
}

/** Totales de la temporada por jugador desde sus partidos, del que más jugó al que menos. */
export function seasonLines(rows: readonly PlayerMatchStat[]): SeasonLine[] {
  const by = new Map<string, SeasonLine & { rated: number; ratingSum: number }>();
  for (const r of rows) {
    const line = by.get(r.playerId) ?? {
      playerId: r.playerId,
      playerName: r.playerName,
      position: r.position,
      matches: 0,
      minutes: 0,
      rating: null,
      stats: {},
      rated: 0,
      ratingSum: 0,
    };
    line.matches += 1;
    line.minutes += r.minutes;
    for (const [k] of STATS) {
      const v = r.stats[k];
      if (v !== undefined) line.stats[k] = (line.stats[k] ?? 0) + v;
    }
    const rating = r.stats.rating;
    if (rating !== undefined && r.minutes > 0) {
      line.rated += r.minutes;
      line.ratingSum += rating * r.minutes;
    }
    by.set(r.playerId, line);
  }
  return [...by.values()]
    .map(({ rated, ratingSum, ...line }) => ({ ...line, rating: rated ? ratingSum / rated : null }))
    .toSorted((a, b) => b.minutes - a.minutes);
}

/** Jugadores de un club con sus totales de la temporada (la misma idea que el plantel de Boca). */
export function ClubSeasonTable({ uid, rows }: { uid: string; rows: readonly PlayerMatchStat[] }) {
  const lines = seasonLines(rows);
  const cols = present(lines);
  return (
    // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- región desplazable con nombre (axe)
    <div className="data-table-wrap" tabIndex={0} role="region" aria-label="Plantel con totales">
      <table className="data-table tabular">
        <caption className="text-left font-bold">Plantel · totales de la temporada en la liga</caption>
        <thead>
          <tr>
            <th scope="col">Jugador</th>
            <th scope="col">Posición</th>
            <th scope="col">PJ</th>
            <th scope="col">Min</th>
            <th scope="col">Nota</th>
            {cols.map(([k, label]) => (
              <th key={k} scope="col">
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {lines.map((l) => (
            <tr key={l.playerId}>
              <th scope="row" className="text-left">
                <Link href={`/club/${uid}/jugador/${encodeURIComponent(l.playerId)}`} className="focus-ring underline">
                  {l.playerName}
                </Link>
              </th>
              <td className="text-left">{l.position ?? NOT_AVAILABLE}</td>
              <td>{formatNumber(l.matches)}</td>
              <td>{formatNumber(l.minutes)}</td>
              <td>{formatNumber(l.rating, 1)}</td>
              {cols.map(([k]) => (
                <td key={k}>{show(k, l.stats[k])}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Un jugador partido a partido. */
export function PlayerMatchTable({ rows }: { rows: readonly PlayerMatchStat[] }) {
  const cols = present(rows);
  return (
    // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- región desplazable con nombre (axe)
    <div className="data-table-wrap" tabIndex={0} role="region" aria-label="Partido a partido">
      <table className="data-table tabular">
        <caption className="text-left font-bold">Partido a partido</caption>
        <thead>
          <tr>
            <th scope="col">Fecha</th>
            <th scope="col">Rival</th>
            <th scope="col">Min</th>
            <th scope="col">Nota</th>
            {cols.map(([k, label]) => (
              <th key={k} scope="col">
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.toReversed().map((r) => (
            <tr key={`${r.date}-${r.opponent ?? ''}`}>
              <th scope="row">{day(r.date)}</th>
              <td className="text-left">{r.opponent ?? NOT_AVAILABLE}</td>
              <td>{formatNumber(r.minutes)}</td>
              <td>{formatNumber(r.stats.rating, 1)}</td>
              {cols.map(([k]) => (
                <td key={k}>{show(k, r.stats[k])}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
