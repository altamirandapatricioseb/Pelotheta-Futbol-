'use client';

import { ArrowLeftIcon, CaretRightIcon, CheckCircleIcon, InfoIcon, WarningCircleIcon } from '@phosphor-icons/react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { basisText, fillText } from '@/components/situations/board';
import { comparableStats, isGoalkeeper, lineOf, referencePool, sectionOf, sectionsFor } from '@/lib/compare/compare';
import type { PlayerDetail } from '@/lib/data/player';
import { NOT_AVAILABLE } from '@/lib/format';
import { formatStat, playerValue, rankAndPercentile } from '@/lib/stats/catalog';

const TONE = { positivo: 'A favor', negativo: 'A mejorar', neutral: 'Rasgo de estilo' } as const;
const FOOT: Record<string, string> = { R: 'derecho', L: 'izquierdo', B: 'ambos' };
const RESULT = (gf: number, ga: number) => (gf > ga ? 'Victoria' : gf < ga ? 'Derrota' : 'Empate');
const day = (iso: string) => iso.split('-').reverse().join('/');
const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/**
 * Detalle de un jugador: ficha, conclusiones, todas sus estadísticas por categoría (con percentil y
 * puesto en el plantel) y sus partidos. Se llega desde Jugadores (doble clic en el nombre o «Ver
 * detalle»), Comparar y la página de cada partido.
 */
export function PlayerDetailView({ data }: { data: PlayerDetail }) {
  const router = useRouter();
  const { player, squad, catalog, conclusions, matches } = data;
  // Cálculos baratos (un plantel): sin memo, el compilador de React se encarga.
  const positions = new Map(data.positions.map((p) => [p.playerId, p]));
  const mine = positions.get(player.playerId);
  const line = lineOf(player, mine);
  const keeper = isGoalkeeper(player, mine);
  const pool = [player, ...referencePool(squad, player, positions, 450)];
  const stats = comparableStats(catalog, new Set(['arquero', 'defensor', 'mediocampista', 'delantero']), true).filter(
    (s) => keeper || sectionOf(s)?.id !== 'porteros',
  );
  const sections = sectionsFor(line?.toLocaleLowerCase('es-AR') ?? null).flatMap((s) => {
    const list = stats.filter((st) => sectionOf(st)?.id === s.id);
    return list.length ? [{ section: s, stats: list }] : [];
  });
  const [tab, setTab] = useState(sections[0]?.section.id ?? '');
  const active = sections.find((s) => s.section.id === tab) ?? sections[0];
  const byId = new Map(catalog.map((s) => [s.id, s]));
  const fact = (id: string) => {
    const s = byId.get(id);
    const v = s ? playerValue(player, s, false) : null;
    return s && v !== null ? formatStat(v, s, false) : NOT_AVAILABLE;
  };

  return (
    <div className="grid gap-8">
      <nav aria-label="Migas de pan" className="flex flex-wrap items-center gap-2 text-sm text-muted">
        <button
          type="button"
          className="chip focus-ring"
          onClick={() => {
            if (window.history.length > 1) router.back();
            else router.push('/jugadores');
          }}
        >
          <ArrowLeftIcon size={14} aria-hidden="true" /> Volver
        </button>
        <Link href="/jugadores" className="focus-ring hover:text-fg">
          Jugadores
        </Link>
        <CaretRightIcon size={12} aria-hidden="true" />
        <span className="font-semibold text-fg">{player.name}</span>
        <span className="ml-auto flex flex-wrap gap-2">
          <Link href={`/comparar?jugador=${String(player.playerId)}`} className="chip focus-ring">
            Comparar
          </Link>
          <Link href={`/jugadores?jugador=${String(player.playerId)}`} className="chip focus-ring">
            Ver en la tabla
          </Link>
        </span>
      </nav>

      <header className="match-head">
        <p className="text-xs font-semibold text-muted">
          {[player.shirtNumber !== null ? `#${String(player.shirtNumber)}` : null, mine?.role ?? line, mine?.zone]
            .filter(Boolean)
            .join(' · ')}
        </p>
        <h1 className="text-3xl font-extrabold tracking-tight">{player.name}</h1>
        <dl className="match-facts">
          {[
            ['Edad', player.age !== null ? `${String(player.age)} años` : NOT_AVAILABLE],
            [
              'Altura',
              player.heightCm !== null ? `${(player.heightCm / 100).toFixed(2).replace('.', ',')} m` : NOT_AVAILABLE,
            ],
            ['Peso', player.weightKg !== null ? `${String(Math.round(player.weightKg))} kg` : NOT_AVAILABLE],
            ['Pie', player.foot ? (FOOT[player.foot] ?? player.foot) : NOT_AVAILABLE],
            ['Nacionalidad', player.nationality ?? NOT_AVAILABLE],
            ['Partidos', String(player.matches)],
            ['Minutos', String(player.minutes)],
            ['Titularidades', fact('titularidades')],
            ['Goles', fact('goles')],
            ['Asistencias', fact('asistencias')],
            ['Calificación media', fact('calificacion')],
            ['NR', fact('nr')],
          ].map(([k, v]) => (
            <div key={k}>
              <dt>{k}</dt>
              <dd className="tabular">{v}</dd>
            </div>
          ))}
        </dl>
      </header>

      {conclusions.length ? (
        <section aria-labelledby="conclusiones" className="grid gap-3">
          <h2 id="conclusiones" className="text-xl font-bold">
            Conclusiones
          </h2>
          <ul className="concl-grid">
            {conclusions.map((c) => {
              const Icon =
                c.tone === 'positivo' ? CheckCircleIcon : c.tone === 'negativo' ? WarningCircleIcon : InfoIcon;
              return (
                <li key={c.id} className={`concl concl--${c.tone}`}>
                  <p className="concl__tag">
                    <Icon size={16} weight="fill" aria-hidden="true" />
                    {TONE[c.tone]} · {c.title}
                  </p>
                  <p className="concl__text">{fillText(c)}</p>
                  <p className="text-xs text-muted">{basisText(c)}</p>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      <section aria-labelledby="estadisticas" className="grid gap-3">
        <h2 id="estadisticas" className="text-xl font-bold">
          Todas sus estadísticas
        </h2>
        <p className="text-sm text-muted">
          Temporada, todas las competiciones. Percentil y puesto entre los {keeper ? 'arqueros' : 'jugadores de campo'}{' '}
          del plantel con 450 minutos o más ({pool.length - 1} más él). Tocá una estadística para ver su desglose.
        </p>
        <div className="view-switch cmp-cats__switch" role="group" aria-label="Categoría">
          {sections.map(({ section, stats: list }) => (
            <button
              key={section.id}
              type="button"
              className="view-switch__button focus-ring"
              aria-pressed={active?.section.id === section.id}
              onClick={() => {
                setTab(section.id);
              }}
            >
              {section.short}
              <span className="cmp-cats__count tabular">{list.length}</span>
            </button>
          ))}
        </div>
        {active ? (
          <div className="data-table-wrap">
            <table className="data-table tabular">
              <caption className="sr-only">
                {active.section.name} de {player.name}
              </caption>
              <thead>
                <tr>
                  <th scope="col">Estadística</th>
                  <th scope="col">Total o valor</th>
                  <th scope="col">Cada 90</th>
                  <th scope="col" title="100 = el mejor del grupo, según el sentido de la estadística">
                    Percentil
                  </th>
                  <th scope="col">Puesto</th>
                </tr>
              </thead>
              <tbody>
                {active.stats.map((s) => {
                  const total = playerValue(player, s, false);
                  const p90 = s.per90 ? playerValue(player, s, true) : null;
                  const values = pool.map((p) => playerValue(p, s, s.per90)).filter(num);
                  const mineValue = playerValue(player, s, s.per90);
                  const rank =
                    num(mineValue) && values.length > 1 ? rankAndPercentile(values, mineValue, s.higherIsBetter) : null;
                  return (
                    <tr key={s.id} className={total === null ? 'cmp-row--empty' : undefined}>
                      <th scope="row">
                        <Link
                          href={`/estadistica/${s.id}?entidad=jugador&id=${String(player.playerId)}`}
                          className="focus-ring hover:underline"
                          title={s.description}
                        >
                          {s.name}
                        </Link>
                        {!s.higherIsBetter ? <span className="ml-1 text-xs text-muted">(menos es mejor)</span> : null}
                      </th>
                      <td className="font-bold">{total === null ? 'sin datos' : formatStat(total, s, false)}</td>
                      <td>{p90 === null ? '—' : formatStat(p90, s, true)}</td>
                      <td>{rank ? rank.percentile : '—'}</td>
                      <td>{rank ? `${String(rank.rank)}.º de ${String(values.length)}` : '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>

      <section aria-labelledby="partidos" className="grid gap-3">
        <h2 id="partidos" className="text-xl font-bold">
          Sus partidos ({matches.filter((m) => (m.minutes ?? 0) > 0).length} jugados de {matches.length} convocados)
        </h2>
        <div className="data-table-wrap">
          <table className="data-table tabular">
            <caption className="sr-only">Partidos de {player.name}</caption>
            <thead>
              <tr>
                <th scope="col">Fecha</th>
                <th scope="col">Rival</th>
                <th scope="col">Competición</th>
                <th scope="col">Resultado</th>
                <th scope="col">Rol</th>
                <th scope="col">Minutos</th>
                <th scope="col">Calificación</th>
                <th scope="col">Goles</th>
                <th scope="col">Asist.</th>
              </tr>
            </thead>
            <tbody>
              {matches.map((m) => (
                <tr key={m.matchId}>
                  <th scope="row">
                    <Link href={`/partido/${String(m.matchId)}`} className="focus-ring hover:underline">
                      {day(m.date)}
                    </Link>
                  </th>
                  <td className="text-left">
                    {m.home ? 'vs' : 'en'} {m.opponent}
                  </td>
                  <td className="text-left text-muted">{m.competition}</td>
                  <td className="text-left">
                    {m.goalsFor}-{m.goalsAgainst} {RESULT(m.goalsFor, m.goalsAgainst)}
                  </td>
                  <td className="text-left">
                    {m.started === null
                      ? NOT_AVAILABLE
                      : m.started
                        ? 'Titular'
                        : (m.minutes ?? 0) > 0
                          ? `Entró${m.minuteIn !== null ? ` ${String(m.minuteIn)}'` : ''}`
                          : 'No entró'}
                  </td>
                  <td>{m.minutes ?? '—'}</td>
                  <td>{m.rating === null ? '—' : m.rating.toFixed(1).replace('.', ',')}</td>
                  <td>{m.goals ?? '—'}</td>
                  <td>{m.assists ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
