import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { z } from 'zod';

import { ErrorNotice } from '@/components/error-notice';
import { BUCKETS, DATASET_URL, getClub } from '@/lib/data/parquet';
import { formatNumber, NOT_AVAILABLE } from '@/lib/format';

// El id viene de la URL: país FIFA en minúscula + nombre (`arg-boca-juniors`), validado antes de usarlo.
const paramsSchema = z.object({ uid: z.string().regex(/^[a-z]{3}-[a-z0-9-]{1,80}$/) });

interface PageProps {
  params: Promise<{ uid: string }>;
}

const day = (iso: string) => iso.slice(0, 10).split('-').reverse().join('/');
const score = (a: number | null, b: number | null) =>
  a === null || b === null ? NOT_AVAILABLE : `${String(a)} – ${String(b)}`;
const cell = (v: number | null | undefined) => (v === null || v === undefined ? NOT_AVAILABLE : String(v));
// Fuerza contra el promedio de la liga (1 = promedio): «+12 %» convierte o recibe 12 % más que el promedio.
const vsAverage = (v: number | null) =>
  v === null ? NOT_AVAILABLE : `${v >= 1 ? '+' : '−'}${String(Math.round(Math.abs(v - 1) * 100))} %`;
const percent = (p: number) => `${String(Math.round(p * 100))} %`;
const millions = (eur: number | null) => (eur === null ? NOT_AVAILABLE : `€ ${formatNumber(eur / 1e6, 1)} M`);
const STATS: Record<string, string> = { goles: 'Goles', asistencias: 'Asistencias' };

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
  const minutes = (club.situation?.con_minutos ?? 0) > 0;

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="page-title">
          <span className="title-trace">{club.name}</span>
        </h1>
        <p className="mt-2 text-muted">{club.country ?? 'Conmebol'} · partidos y posiciones desde el archivo abierto</p>
      </div>

      {club.next ? (
        <section className="grid gap-2" aria-labelledby="proximo">
          <h2 id="proximo" className="text-xl font-bold">
            Próximo partido
          </h2>
          <p>
            {day(club.next.date)} · {club.next.home ? 'de local' : 'de visitante'} contra{' '}
            <strong>{club.next.opponent}</strong>
            {club.next.stage ? ` · ${club.next.stage}` : ''}
          </p>
          <ul className="grid gap-1">
            <li>
              <strong>Gana:</strong> {percent(club.next.win)} · <strong>Empata:</strong> {percent(club.next.draw)} ·{' '}
              <strong>Pierde:</strong> {percent(club.next.loss)}
            </li>
            <li>
              <strong>Goles esperados:</strong> {formatNumber(club.next.goalsOwn, 1)} a{' '}
              {formatNumber(club.next.goalsRival, 1)}
            </li>
          </ul>
          <p className="text-sm text-muted">
            Modelo de Poisson propio (el del Predictor) con ataque, defensa, valor del plantel, Elo y forma de los dos
            equipos. Es una probabilidad, no un resultado.
          </p>
        </section>
      ) : null}

      {club.strength ? (
        <section className="grid gap-2" aria-labelledby="nivel">
          <h2 id="nivel" className="text-xl font-bold">
            Nivel en la liga
          </h2>
          <ul className="grid gap-1">
            <li>
              <strong>Elo:</strong> {formatNumber(club.strength.elo)} (1500 es un equipo promedio)
            </li>
            <li>
              <strong>Forma:</strong> {formatNumber(club.strength.form, 1)} puntos por partido en los últimos partidos
            </li>
            <li>
              <strong>Goles que convierte</strong> frente al promedio: de local {vsAverage(club.strength.attack_home)},
              de visitante {vsAverage(club.strength.attack_away)}
            </li>
            <li>
              <strong>Goles que recibe</strong> frente al promedio: de local {vsAverage(club.strength.defense_home)}, de
              visitante {vsAverage(club.strength.defense_away)}
            </li>
            {club.strength.squad_value_eur !== null ? (
              <li>
                <strong>Valor del plantel:</strong> € {formatNumber(club.strength.squad_value_eur / 1e6, 1)} M
              </li>
            ) : null}
          </ul>
          <p className="text-sm text-muted">
            Cálculo propio con los partidos de liga, el mismo que usa el predictor. El valor del plantel sale de
            transfermarkt-datasets (CC0).
          </p>
        </section>
      ) : null}

      {club.situation ? (
        <section className="grid gap-2" aria-labelledby="situaciones">
          <h2 id="situaciones" className="text-xl font-bold">
            Situaciones
          </h2>
          <ul className="grid gap-1">
            <li>
              <strong>Últimos partidos:</strong> {club.situation.racha ?? NOT_AVAILABLE} (G gana, E empata, P pierde; el
              último a la derecha)
            </li>
            <li>
              <strong>Puntos por partido:</strong> de local {formatNumber(club.situation.ppp_local, 1)}, de visitante{' '}
              {formatNumber(club.situation.ppp_visitante, 1)}
            </li>
            {minutes ? (
              <>
                <li>
                  <strong>Cuando marca primero</strong> ({cell(club.situation.marco_primero)} partidos):{' '}
                  {formatNumber(club.situation.ppp_marco_primero, 1)} puntos por partido.{' '}
                  <strong>Cuando le marcan primero</strong> ({cell(club.situation.recibio_primero)}):{' '}
                  {formatNumber(club.situation.ppp_recibio_primero, 1)}
                </li>
                <li>
                  <strong>Al descanso:</strong> ganando {cell(club.situation.descanso_ganando)} veces (
                  {formatNumber(club.situation.ppp_descanso_ganando, 1)} pts/partido), empatando{' '}
                  {cell(club.situation.descanso_empatando)} ({formatNumber(club.situation.ppp_descanso_empatando, 1)}),
                  perdiendo {cell(club.situation.descanso_perdiendo)} (
                  {formatNumber(club.situation.ppp_descanso_perdiendo, 1)}) · remontadas:{' '}
                  {cell(club.situation.remontadas)}
                </li>
              </>
            ) : null}
            <li>
              <strong>Vallas invictas:</strong> {cell(club.situation.vallas_invictas)} ·{' '}
              <strong>Partidos sin marcar:</strong> {cell(club.situation.sin_marcar)}
            </li>
          </ul>
          {minutes ? (
            // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- región desplazable con nombre (axe)
            <div className="data-table-wrap" tabIndex={0} role="region" aria-label="Goles por tramo">
              <table className="data-table tabular">
                <caption className="text-left font-bold">Goles por tramo de 15 minutos</caption>
                <thead>
                  <tr>
                    <th scope="col">Goles</th>
                    {BUCKETS.map((b) => (
                      <th key={b} scope="col">
                        {b === '76_90' ? '76-90+' : b.replace('_', '-')}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(['favor', 'contra'] as const).map((side) => (
                    <tr key={side}>
                      <th scope="row" className="text-left">
                        {side === 'favor' ? 'A favor' : 'En contra'}
                      </th>
                      {BUCKETS.map((b) => (
                        <td key={b}>{cell(club.situation?.[`${side}_${b}`])}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
          <p className="text-sm text-muted">
            {minutes ? (
              <>
                Cálculo propio con los resultados y los minutos de gol. Lo que depende del minuto usa{' '}
                {cell(club.situation.con_minutos)} de {cell(club.situation.partidos)} partidos: los que tienen todos los
                goles con su minuto.
              </>
            ) : (
              'Cálculo propio con los resultados. La fuente de esta liga no publica los minutos de gol.'
            )}
          </p>
        </section>
      ) : null}

      {club.leaders.length ? (
        <section className="grid gap-2" aria-labelledby="destacados">
          <h2 id="destacados" className="text-xl font-bold">
            Jugadores destacados del torneo
          </h2>
          <ul className="grid gap-1">
            {club.leaders.map((l) => (
              <li key={`${l.stat}-${l.player_name}`}>
                <strong>{STATS[l.stat] ?? l.stat.replaceAll('_', ' ')}:</strong> {l.player_name},{' '}
                {formatNumber(l.value)} (puesto {cell(l.rank)} de la liga)
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {club.squad.length ? (
        // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- región desplazable con nombre (axe)
        <div className="data-table-wrap" tabIndex={0} role="region" aria-label="Plantel">
          <table className="data-table tabular">
            <caption className="text-left font-bold">
              Plantel · percentil cada 90 minutos contra los de su posición en la liga (100 = el mejor)
            </caption>
            <thead>
              <tr>
                <th scope="col">Jugador</th>
                <th scope="col">Posición</th>
                <th scope="col">Min</th>
                <th scope="col">Goles</th>
                <th scope="col">xG</th>
                <th scope="col">xA</th>
                <th scope="col">Pases clave</th>
                <th scope="col">Entradas</th>
                <th scope="col">Recuperaciones</th>
                <th scope="col">Atajadas</th>
              </tr>
            </thead>
            <tbody>
              {club.squad.map((p) => (
                <tr key={p.player_name}>
                  <th scope="row" className="text-left">
                    {p.player_id ? (
                      <Link
                        href={`/club/${club.uid}/jugador/${encodeURIComponent(p.player_id)}`}
                        className="focus-ring underline"
                      >
                        {p.player_name}
                      </Link>
                    ) : (
                      p.player_name
                    )}
                  </th>
                  <td className="text-left">{p.position ?? NOT_AVAILABLE}</td>
                  <td>{formatNumber(p.minutes)}</td>
                  <td>{cell(p.pct_goals)}</td>
                  <td>{cell(p.pct_expected_goals)}</td>
                  <td>{cell(p.pct_expected_assists)}</td>
                  <td>{cell(p.pct_key_pass)}</td>
                  <td>{cell(p.pct_won_tackle)}</td>
                  <td>{cell(p.pct_ball_recovery)}</td>
                  <td>{cell(p.pct_saves)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {club.values.length ? (
        <section className="grid gap-2" aria-labelledby="valor">
          {/* eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- región desplazable con nombre (axe) */}
          <div className="data-table-wrap" tabIndex={0} role="region" aria-labelledby="valor">
            <table className="data-table tabular">
              <caption id="valor" className="text-left font-bold">
                Valor de mercado · real y esperado por el modelo
              </caption>
              <thead>
                <tr>
                  <th scope="col">Jugador</th>
                  <th scope="col">Posición</th>
                  <th scope="col">Edad</th>
                  <th scope="col">Valor</th>
                  <th scope="col">Esperado</th>
                  <th scope="col">Diferencia</th>
                </tr>
              </thead>
              <tbody>
                {club.values.map((v) => (
                  <tr key={v.player_name}>
                    <th scope="row" className="text-left">
                      {v.player_name}
                    </th>
                    <td className="text-left">{v.position_group ?? NOT_AVAILABLE}</td>
                    <td>{cell(v.age)}</td>
                    <td>{millions(v.value_eur)}</td>
                    <td>{millions(v.predicted_eur)}</td>
                    <td>
                      {v.gap_pct === null
                        ? NOT_AVAILABLE
                        : `${v.gap_pct >= 0 ? '+' : '−'}${formatNumber(Math.abs(v.gap_pct))} %`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-sm text-muted">
            Valor: transfermarkt-datasets (CC0). Esperado: regresión propia con edad, posición, contrato, si es
            extranjero y el valor del resto del plantel, ajustada sin el jugador (validación cruzada).
            {club.valueError !== null
              ? ` En toda la liga erra ${formatNumber(club.valueError)} % en la mediana: una diferencia grande dice que el mercado lo paga por algo que el modelo no ve (juventud, rendimiento, proyección), no que esté mal tasado.`
              : ''}
          </p>
        </section>
      ) : null}

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
                <tr key={`${m.date}-${m.opponent ?? ''}`}>
                  <th scope="row">{day(m.date)}</th>
                  <td className="text-left">{m.competition ?? NOT_AVAILABLE}</td>
                  <td className="text-left">{m.opponent ?? NOT_AVAILABLE}</td>
                  <td className="text-left">{m.home === null ? NOT_AVAILABLE : m.home ? 'Local' : 'Visitante'}</td>
                  <td>
                    {m.id ? (
                      <Link href={`/club/${club.uid}/partido/${m.id}`} className="focus-ring underline">
                        {score(m.goalsFor, m.goalsAgainst)}
                      </Link>
                    ) : (
                      score(m.goalsFor, m.goalsAgainst)
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="text-muted">Todavía no hay partidos de este club en el archivo abierto.</p>
      )}
      {club.leagueOnly && club.matches.length ? (
        <p className="text-sm text-muted">
          Solo partidos de liga, los que ya están cargados: pueden faltar fechas. Las copas y el detalle de cada partido
          se suman con la carga de toda la Primera.
        </p>
      ) : null}

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
        <Link href="/club" className="focus-ring underline">
          Todos los clubes
        </Link>
        . Fuentes: Promiedos (promiedos.com.ar), Wikipedia (CC BY-SA) y cálculo propio. Los archivos están en{' '}
        <a href={DATASET_URL} className="focus-ring underline">
          Hugging Face
        </a>{' '}
        para descargar o consultar.
      </p>
    </div>
  );
}
