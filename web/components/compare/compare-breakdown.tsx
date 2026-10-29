'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';

import { BarChart, LineChart, type Slot } from '@/components/charts/primitives';
import { bins, rolling } from '@/lib/charts/transform';
import {
  aggregate,
  breakdownWindows,
  mergeMatches,
  type BreakdownPoint,
  type Window,
  type WindowGroup,
} from '@/lib/compare/breakdown';
import { sectionOf, SECTIONS } from '@/lib/compare/compare';
import { NOT_AVAILABLE } from '@/lib/format';
import { formatStat, type PlayerRow, type StatDef } from '@/lib/stats/catalog';

import type { RefLabel } from './compare-section';
import { VerdictIcon } from './compare-section';

interface Media {
  label: RefLabel;
  /** Media por partido de la referencia (para las líneas planas). */
  perMatch: number | null;
}

interface CompareBreakdownProps {
  stats: StatDef[];
  stat: StatDef | null;
  onStat: (statId: string) => void;
  main: PlayerRow;
  other: PlayerRow | null;
  medias: Media[];
  data: { lastDate: string; series: Record<number, BreakdownPoint[]> } | null;
  loading: boolean;
}

type Side = 'a' | 'b';
const RESULTS: Record<string, string> = { G: 'Victoria', E: 'Empate', P: 'Derrota' };
const day = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
const fullDate = (iso: string) => iso.split('-').reverse().join('/');

/**
 * Desglose de una estadística dentro de Comparar (9.7 y 9.8): el jugador principal (verde) y, si
 * se eligió, el otro jugador (rojo), con las medias elegidas como líneas de referencia. Tiene su
 * propio filtro (competición, localía, resultado), ventanas lado a lado, gráficos y los partidos
 * de los dos (cada columna dice de quién es).
 */
export function CompareBreakdown({ stats, stat, onStat, main, other, medias, data, loading }: CompareBreakdownProps) {
  const [competition, setCompetition] = useState('');
  const [venue, setVenue] = useState<'' | 'local' | 'visitante'>('');
  const [result, setResult] = useState('');
  const [both, setBoth] = useState(false);

  const nameA = main.shortName ?? main.name;
  const nameB = other ? (other.shortName ?? other.name) : '';
  const raw = useMemo(
    () => ({ a: data?.series[main.playerId] ?? [], b: other ? (data?.series[other.playerId] ?? []) : [] }),
    [data, main.playerId, other],
  );
  const competitions = useMemo(
    () => [...new Map([...raw.a, ...raw.b].map((p) => [p.competitionCode, p.competition])).entries()],
    [raw],
  );
  const keep = (p: BreakdownPoint) =>
    (!competition || p.competitionCode === competition) &&
    (!venue || (venue === 'local') === p.home) &&
    (!result || p.result === result);
  const series = { a: raw.a.filter(keep), b: raw.b.filter(keep) };

  const grouped = useMemo(() => {
    const out = new Map<string, StatDef[]>();
    for (const s of stats) {
      const sec = sectionOf(s);
      if (sec) out.set(sec.id, [...(out.get(sec.id) ?? []), s]);
    }
    return SECTIONS.flatMap((s) => (out.has(s.id) ? [{ section: s, stats: out.get(s.id) ?? [] }] : []));
  }, [stats]);

  const picker = (
    <label className="cmp-inline">
      <span>Estadística</span>
      <select
        className="select focus-ring max-w-80"
        value={stat?.id ?? ''}
        onChange={(e) => {
          if (e.target.value) onStat(e.target.value);
        }}
      >
        <option value="">Elegí una estadística…</option>
        {grouped.map((g) => (
          <optgroup key={g.section.id} label={g.section.name}>
            {g.stats.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
    </label>
  );

  if (!stat) {
    return (
      <section className="grid gap-4" aria-label="Desglose de una estadística">
        {picker}
        <p className="under-construction text-muted">
          Elegí una estadística (o hacé doble clic en una fila de cualquier categoría) para ver su desglose partido a
          partido, por ventanas de tiempo, por competición, por resultado y más.
        </p>
      </section>
    );
  }

  const fmt = (v: number | null) => (v === null ? NOT_AVAILABLE : formatStat(v, stat, false));
  const windows: Record<Side, WindowGroup[]> = {
    a: breakdownWindows(series.a, stat, data?.lastDate ?? ''),
    b: other ? breakdownWindows(series.b, stat, data?.lastDate ?? '') : [],
  };
  const season = { a: aggregate(series.a, stat), b: aggregate(series.b, stat) };
  const merged = mergeMatches(series.a, series.b).filter((m) => !both || (m.playedA && m.playedB));
  const chrono = mergeMatches(series.a, series.b).toReversed();
  const groupIds = [...new Set([...windows.a, ...windows.b].map((g) => g.id))];
  const groupOf = (side: Side, id: string) => windows[side].find((g) => g.id === id);
  const better = (a: number | null, b: number | null) =>
    a === null || b === null || a === b
      ? a === b && a !== null
        ? 'igual'
        : null
      : (stat.higherIsBetter ? a > b : a < b)
        ? 'mejor'
        : 'peor';

  const mediaLines = medias.flatMap((m) =>
    m.perMatch === null ? [] : [{ id: m.label.long, label: m.label.short, slot: m.label.slot, value: m.perMatch }],
  );
  const players: { side: Side; name: string; slot: Slot }[] = [
    { side: 'a', name: nameA, slot: 1 },
    ...(other ? [{ side: 'b' as const, name: nameB, slot: 2 as Slot }] : []),
  ];
  const groupBars = (id: string) => {
    const keys = [
      ...new Map(
        [...(groupOf('a', id)?.windows ?? []), ...(groupOf('b', id)?.windows ?? [])].map((w) => [w.key, w.label]),
      ),
    ];
    return {
      labels: keys.map(([, label]) => label),
      series: players.map((p) => ({
        id: p.side,
        label: p.name,
        slot: p.slot,
        values: keys.map(([key]) => groupOf(p.side, id)?.windows.find((w) => w.key === key)?.value ?? null),
      })),
    };
  };
  const allValues = [...series.a, ...series.b].flatMap((p) => (p.value === null ? [] : [p.value]));
  const common = bins(allValues, Math.min(8, Math.max(3, Math.ceil(Math.sqrt(allValues.length || 1)))));
  const histogram = players.map((p) => ({
    id: p.side,
    label: p.name,
    slot: p.slot,
    values: common.map(
      (b, i) =>
        series[p.side].filter(
          (x) => x.value !== null && x.value >= b.from && (x.value < b.to || i === common.length - 1),
        ).length,
    ),
  }));

  return (
    <section className="grid gap-5" aria-label={`Desglose de ${stat.name}`}>
      <div className="flex flex-wrap items-center gap-3">
        {picker}
        <label className="cmp-inline">
          <span>Competición</span>
          <select
            className="select focus-ring max-w-52"
            value={competition}
            onChange={(e) => {
              setCompetition(e.target.value);
            }}
          >
            <option value="">Todas</option>
            {competitions.map(([code, name]) => (
              <option key={code} value={code}>
                {name.replace('CONMEBOL ', '').replace('Liga Profesional Argentina', 'Liga Profesional')}
              </option>
            ))}
          </select>
        </label>
        <label className="cmp-inline">
          <span>Localía</span>
          <select
            className="select focus-ring"
            value={venue}
            onChange={(e) => {
              setVenue(e.target.value as '' | 'local' | 'visitante');
            }}
          >
            <option value="">Las dos</option>
            <option value="local">Local</option>
            <option value="visitante">Visitante</option>
          </select>
        </label>
        <label className="cmp-inline">
          <span>Resultado</span>
          <select
            className="select focus-ring"
            value={result}
            onChange={(e) => {
              setResult(e.target.value);
            }}
          >
            <option value="">Todos</option>
            <option value="G">Victorias</option>
            <option value="E">Empates</option>
            <option value="P">Derrotas</option>
          </select>
        </label>
      </div>

      <header className="cmp-breakdown-head">
        <div className="grid content-start gap-2">
          <h2 className="text-2xl font-extrabold tracking-tight">{stat.name}</h2>
          <p className="max-w-[60ch] text-sm leading-relaxed">{stat.description}</p>
          {stat.formula && stat.rule !== 'suma' ? (
            <p className="text-sm text-muted">
              Fórmula: <span className="font-semibold text-fg">{stat.formula}</span>
            </p>
          ) : null}
          <p className="text-xs text-muted">
            Valor por partido (sin pasar a 90).{' '}
            {stat.higherIsBetter ? 'Más alto es mejor.' : 'En esta estadística, menos es mejor.'}
          </p>
        </div>
        <div className="grid content-start gap-2">
          <p className="text-xs font-semibold text-muted">Se compara</p>
          <ul className="cmp-who">
            {players.map((p) => (
              <li key={p.side}>
                <span className="chart-key chart-key--box" style={{ background: `var(--series-${String(p.slot)})` }} />
                <span className="font-semibold">{p.name}</span>
                <span className="tabular font-extrabold">{fmt(season[p.side].value)}</span>
                <span className="text-xs text-muted">{season[p.side].n} partidos</span>
              </li>
            ))}
            {mediaLines.map((m) => (
              <li key={m.id}>
                <span className="chart-key chart-key--line" style={{ background: `var(--series-${String(m.slot)})` }} />
                <span className="font-semibold">{m.id}</span>
                <span className="tabular font-extrabold">{fmt(m.value)}</span>
                <span className="text-xs text-muted">media por partido</span>
              </li>
            ))}
          </ul>
        </div>
      </header>

      {loading || !data ? (
        <p className="text-sm text-muted">Cargando los partidos…</p>
      ) : series.a.length + series.b.length === 0 ? (
        <p className="under-construction text-muted">Sin partidos con dato para esta estadística con estos filtros.</p>
      ) : (
        <>
          <section aria-labelledby="desglose-graficos" className="grid gap-3">
            <h3 id="desglose-graficos" className="text-lg font-bold">
              Gráficos
            </h3>
            <div className="cmp-breakdown-charts">
              <article className="chart-card cmp-breakdown-wide">
                <h4 className="text-base font-bold">Partido a partido</h4>
                <LineChart
                  labels={chrono.map((m) => day(m.date))}
                  series={[
                    ...players.map((p) => ({
                      id: p.side,
                      label: p.name,
                      slot: p.slot,
                      values: chrono.map((m) => (p.side === 'a' ? m.a : m.b)),
                    })),
                    ...mediaLines.map((m) => ({
                      id: m.id,
                      label: `${m.label} (media)`,
                      slot: m.slot,
                      values: chrono.map(() => m.value),
                    })),
                  ]}
                  includeZero={false}
                  label={`${stat.name} en cada partido: ${players.map((p) => p.name).join(' y ')}, con las medias elegidas`}
                />
                <p className="text-xs text-muted">
                  Cada punto es un partido de Boca; si un jugador no jugó, su línea salta ese partido. Las líneas planas
                  son las medias por partido.
                </p>
              </article>
              <article className="chart-card">
                <h4 className="text-base font-bold">Promedio móvil de 5 partidos</h4>
                <LineChart
                  labels={chrono.map((m) => day(m.date))}
                  series={players.map((p) => ({
                    id: p.side,
                    label: p.name,
                    slot: p.slot,
                    values: rolling(
                      chrono.map((m) => (p.side === 'a' ? m.a : m.b)),
                      5,
                    ),
                  }))}
                  includeZero={false}
                  label={`Promedio de los últimos 5 partidos de ${stat.name}`}
                />
              </article>
              {common.length ? (
                <article className="chart-card">
                  <h4 className="text-base font-bold">Distribución</h4>
                  <BarChart
                    labels={common.map((b) => `${fmt(b.from)} a ${fmt(b.to)}`)}
                    series={histogram}
                    label="Cantidad de partidos por rango de valor"
                  />
                </article>
              ) : null}
              {(['competicion', 'resultado', 'localia', 'titularidad', 'mes'] as const).flatMap((id) => {
                const g = groupBars(id);
                const title = groupOf('a', id)?.title ?? groupOf('b', id)?.title;
                return g.labels.length >= 2 && title ? (
                  <article key={id} className="chart-card">
                    <h4 className="text-base font-bold">{title}</h4>
                    <BarChart
                      labels={g.labels}
                      series={g.series}
                      format={(v) => fmt(v)}
                      label={`${stat.name} ${title.toLocaleLowerCase('es-AR')}`}
                    />
                  </article>
                ) : (
                  []
                );
              })}
            </div>
          </section>

          <section aria-labelledby="desglose-ventanas" className="grid gap-3">
            <h3 id="desglose-ventanas" className="text-lg font-bold">
              Ventanas
            </h3>
            <p className="text-sm text-muted">
              Promedio por partido de cada ventana (los porcentajes, sobre el total), con la cantidad de partidos. Las
              de días se cuentan hacia atrás desde el último partido cargado (
              {data.lastDate ? fullDate(data.lastDate) : NOT_AVAILABLE}
              ).
            </p>
            <div className="cmp-windows">
              {groupIds.map((id) => {
                const ga = groupOf('a', id);
                const gb = groupOf('b', id);
                const keys = [
                  ...new Map([...(ga?.windows ?? []), ...(gb?.windows ?? [])].map((w) => [w.key, w.label])),
                ];
                const find = (g: WindowGroup | undefined, key: string): Window | undefined =>
                  g?.windows.find((w) => w.key === key);
                return (
                  <div key={id} className="data-table-wrap">
                    <table className="data-table tabular">
                      <caption className="match-caption">{ga?.title ?? gb?.title}</caption>
                      <thead>
                        <tr>
                          <th scope="col">Ventana</th>
                          <th scope="col">
                            <span className="chart-key chart-key--box" style={{ background: 'var(--series-1)' }} />{' '}
                            {nameA}
                          </th>
                          {other ? (
                            <>
                              <th scope="col">
                                <span className="chart-key chart-key--box" style={{ background: 'var(--series-2)' }} />{' '}
                                {nameB}
                              </th>
                              <th scope="col">
                                <span className="sr-only">
                                  {nameA} contra {nameB}
                                </span>
                              </th>
                            </>
                          ) : (
                            <th scope="col">Mejor / peor</th>
                          )}
                        </tr>
                      </thead>
                      <tbody>
                        {keys.map(([key, label]) => {
                          const wa = find(ga, key);
                          const wb = find(gb, key);
                          return (
                            <tr key={key}>
                              <th scope="row">{label}</th>
                              <td>
                                {wa ? (
                                  <>
                                    <span className="font-bold">{fmt(wa.value)}</span>{' '}
                                    <span className="text-xs text-muted">
                                      ({wa.n}){wa.n < 3 ? ' · muestra pequeña' : ''}
                                    </span>
                                  </>
                                ) : (
                                  <span className="text-muted">sin partidos</span>
                                )}
                              </td>
                              {other ? (
                                <>
                                  <td>
                                    {wb ? (
                                      <>
                                        <span className="font-bold">{fmt(wb.value)}</span>{' '}
                                        <span className="text-xs text-muted">
                                          ({wb.n}){wb.n < 3 ? ' · muestra pequeña' : ''}
                                        </span>
                                      </>
                                    ) : (
                                      <span className="text-muted">sin partidos</span>
                                    )}
                                  </td>
                                  <td>
                                    <VerdictIcon verdict={better(wa?.value ?? null, wb?.value ?? null)} />
                                  </td>
                                </>
                              ) : (
                                <td className="text-muted">
                                  {wa && wa.n > 1 ? `${fmt(wa.best)} / ${fmt(wa.worst)}` : '—'}
                                </td>
                              )}
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                );
              })}
            </div>
            {other ? (
              <p className="text-xs text-muted">
                La flecha compara a {nameA} con {nameB} en cada ventana: verde, mejor; rojo, peor (según el sentido de
                la estadística).
              </p>
            ) : null}
          </section>

          <section aria-labelledby="desglose-partidos" className="grid gap-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 id="desglose-partidos" className="text-lg font-bold">
                Partidos de {other ? `${nameA} y ${nameB}` : nameA}
              </h3>
              {other ? (
                <label className="chip focus-ring cursor-pointer">
                  <input
                    type="checkbox"
                    checked={both}
                    onChange={(e) => {
                      setBoth(e.target.checked);
                    }}
                  />
                  Solo los partidos que jugaron los dos
                </label>
              ) : null}
            </div>
            <div className="data-table-wrap">
              <table className="data-table tabular">
                <caption className="sr-only">
                  Partidos con el valor de {stat.name} de {other ? `${nameA} y de ${nameB}` : nameA}.
                </caption>
                <thead>
                  <tr>
                    <th scope="col">Fecha</th>
                    <th scope="col">Rival</th>
                    <th scope="col">Competición</th>
                    <th scope="col">Resultado</th>
                    <th scope="col">{nameA}</th>
                    {other ? (
                      <>
                        <th scope="col">{nameB}</th>
                        <th scope="col">
                          <span className="sr-only">Quién rindió mejor</span>
                        </th>
                      </>
                    ) : null}
                  </tr>
                </thead>
                <tbody>
                  {merged.map((m) => (
                    <tr key={m.matchId}>
                      <th scope="row">
                        <Link href={`/partido/${String(m.matchId)}`} className="focus-ring hover:underline">
                          {fullDate(m.date)}
                        </Link>
                      </th>
                      <td className="text-left">
                        {m.home ? 'vs' : 'en'} {m.opponent}
                      </td>
                      <td className="text-left text-muted">{m.competition}</td>
                      <td className="text-left">{RESULTS[m.result] ?? m.result}</td>
                      <td className={m.playedA ? 'font-bold' : 'text-muted'}>{m.playedA ? fmt(m.a) : 'no jugó'}</td>
                      {other ? (
                        <>
                          <td className={m.playedB ? 'font-bold' : 'text-muted'}>{m.playedB ? fmt(m.b) : 'no jugó'}</td>
                          <td>{m.playedA && m.playedB ? <VerdictIcon verdict={better(m.a, m.b)} /> : null}</td>
                        </>
                      ) : null}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </section>
  );
}
