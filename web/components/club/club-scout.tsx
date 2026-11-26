import Link from 'next/link';

import type { Club, MarketValue, PlayerProfile } from '@/lib/data/parquet';
import { formatNumber, NOT_AVAILABLE } from '@/lib/format';
import { alternatives, needs, opportunities, prospects } from '@/lib/models/league-scout';

const percent = (x: number) => `${String(Math.round(x * 100))} %`;
const millions = (eur: number | null) => (eur === null ? NOT_AVAILABLE : `€ ${formatNumber(eur / 1e6, 1)} M`);
const playerHref = (club: Club, p: PlayerProfile) =>
  p.player_id ? `/club/${club.uid}/jugador/${encodeURIComponent(p.player_id)}` : null;

function Name({ club, p }: { club: Club; p: PlayerProfile }) {
  const href = p.team_name === club.name ? playerHref(club, p) : null;
  return href ? (
    <Link href={href} className="focus-ring underline">
      {p.player_name}
    </Link>
  ) : (
    <>{p.player_name}</>
  );
}

/** Alternativas de un club cualquiera: los más parecidos de otros clubes de la liga, por jugador. */
export function ClubAlternatives({ club, league }: { club: Club; league: readonly PlayerProfile[] }) {
  const rows = alternatives(club.squad, league).filter((r) => r.similar.length > 0);
  if (rows.length === 0) {
    return <p className="text-muted">Todavía no hay jugadores de {club.name} con perfil en el archivo abierto.</p>;
  }
  return (
    <>
      {/* eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- región desplazable con nombre (axe) */}
      <div className="data-table-wrap" tabIndex={0} role="region" aria-label="Alternativas">
        <table className="data-table tabular">
          <caption className="text-left font-bold">Los tres más parecidos de otros clubes, por jugador</caption>
          <thead>
            <tr>
              <th scope="col">Jugador</th>
              <th scope="col">Posición</th>
              <th scope="col">Alternativas (parecido)</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ player, similar }) => (
              <tr key={player.player_id ?? player.player_name}>
                <th scope="row" className="text-left">
                  <Name club={club} p={player} />
                </th>
                <td className="text-left">{player.position ?? NOT_AVAILABLE}</td>
                <td className="text-left">
                  {similar
                    .map((s) => `${s.player.player_name} (${s.player.team_name}, ${percent(s.similarity)})`)
                    .join(' · ')}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-sm text-muted">
        Parecido: 100 % menos la diferencia media de percentiles cada 90 minutos en las estadísticas que tienen los dos
        (cuatro como mínimo), contra jugadores de la misma posición de la liga.
      </p>
    </>
  );
}

function ValueTable({ caption, rows }: { caption: string; rows: readonly MarketValue[] }) {
  if (rows.length === 0) return null;
  return (
    // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- región desplazable con nombre (axe)
    <div className="data-table-wrap" tabIndex={0} role="region" aria-label={caption}>
      <table className="data-table tabular">
        <caption className="text-left font-bold">{caption}</caption>
        <thead>
          <tr>
            <th scope="col">Jugador</th>
            <th scope="col">Club</th>
            <th scope="col">Edad</th>
            <th scope="col">Valor</th>
            <th scope="col">Esperado</th>
            <th scope="col">Diferencia</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((v) => (
            <tr key={`${v.team_name}-${v.player_name}`}>
              <th scope="row" className="text-left">
                {v.player_name}
              </th>
              <td className="text-left">{v.team_name}</td>
              <td>{formatNumber(v.age)}</td>
              <td>{millions(v.value_eur)}</td>
              <td>{millions(v.predicted_eur)}</td>
              <td>{v.gap_pct === null ? NOT_AVAILABLE : `${formatNumber(v.gap_pct)} %`}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Ojeador de un club cualquiera: lo que le falta al plantel, oportunidades de mercado y jóvenes. */
export function ClubScout({ club, league }: { club: Club; league: readonly PlayerProfile[] }) {
  const gaps = needs(club.squad, league);
  return (
    <>
      <section className="grid gap-2" aria-labelledby="falta">
        <h2 id="falta" className="text-xl font-bold">
          Lo que le falta al plantel
        </h2>
        {gaps.length ? (
          <ul className="grid gap-2">
            {gaps.map((g) => (
              <li key={g.stat}>
                <strong>{g.label}:</strong> el plantel está en el percentil {formatNumber(g.squadPct)} de la liga
                (pesado por minutos). Los mejores de otros clubes:{' '}
                {g.picks
                  .map((p) => `${p.player_name} (${p.team_name}, percentil ${String(p[`pct_${g.stat}`] ?? '')})`)
                  .join(' · ')}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-muted">Todavía no hay jugadores de {club.name} con perfil en el archivo abierto.</p>
        )}
      </section>
      <ValueTable
        caption="Oportunidades de mercado · valen menos de lo que el modelo espera"
        rows={opportunities(club.leagueValues, club.name)}
      />
      <ValueTable
        caption="Jóvenes promesas de otros clubes · 21 años o menos"
        rows={prospects(club.leagueValues, club.name)}
      />
      <p className="text-sm text-muted">
        Percentiles cada 90 minutos contra la misma posición en la liga (cálculo propio). Valor real de
        transfermarkt-datasets (CC0) y esperado por la regresión propia, estimado sin el jugador.
      </p>
    </>
  );
}
