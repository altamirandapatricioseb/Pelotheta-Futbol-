'use client';

// Estadística desglosada (9.8): encabezado, ventanas de tiempo, gráficos, último partido, lista
// de partidos ordenable y filtrable, rendimiento por rival y estadísticas relacionadas.

import { ArrowDownIcon, ArrowLeftIcon, ArrowUpIcon, CaretRightIcon } from '@phosphor-icons/react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';

import { BarChart, LineChart } from '@/components/charts/primitives';
import { StatReading } from '@/components/stats/stat-reading';
import { bins, rolling } from '@/lib/charts/transform';
import type { StatDetail, StatWindow } from '@/lib/data/desglosada';
import { NOT_AVAILABLE } from '@/lib/format';
import { formatStat } from '@/lib/stats/catalog';
import { currentStreak } from '@/lib/stats/detail';

const TIME_WINDOWS: [string, string][] = [
  ['u1', 'Último partido'],
  ['u3', 'Últimos 3 partidos'],
  ['u5', 'Últimos 5 partidos'],
  ['u10', 'Últimos 10 partidos'],
  ['d7', 'Últimos 7 días'],
  ['d14', 'Últimos 14 días'],
  ['d30', 'Últimos 30 días'],
  ['d60', 'Últimos 60 días'],
  ['d90', 'Últimos 90 días'],
  ['mes', 'Mes en curso'],
  ['mes_anterior', 'Mes anterior'],
  ['temporada', 'Temporada'],
];
const SMALL_WINDOW = 3;
const day = (iso: string) => iso.split('-').reverse().slice(0, 2).join('/');
const fullDate = (iso: string) => iso.split('-').reverse().join('/');

export function StatDetailView({ detail, backHref, query }: { detail: StatDetail; backHref: string; query: string }) {
  const router = useRouter();
  const { stat, series, windows } = detail;
  const fmt = (v: number | null) => (v === null ? NOT_AVAILABLE : formatStat(v, stat, false));
  const season = windows.find((w) => w.key === 'temporada')?.value ?? null;
  const withValue = useMemo(() => series.filter((p) => p.value !== null), [series]);
  const last = withValue.at(-1);
  const lastDate = last?.date ?? null;

  const [rival, setRival] = useState('');
  const [competition, setCompetition] = useState('');
  const [sortBy, setSortBy] = useState<'fecha' | 'valor'>('fecha');
  const [desc, setDesc] = useState(true);
  const rivals = useMemo(() => [...new Set(withValue.map((p) => p.opponent))].sort(), [withValue]);
  const competitions = useMemo(
    () => [...new Map(withValue.map((p) => [p.competitionCode, p.competition])).entries()],
    [withValue],
  );
  const listed = useMemo(() => {
    const rows = withValue.filter(
      (p) => (!rival || p.opponent === rival) && (!competition || p.competitionCode === competition),
    );
    const key = (p: (typeof rows)[number]) =>
      sortBy === 'fecha' ? p.date : String((p.value ?? 0) + 1e6).padStart(20, '0');
    return rows.sort((a, b) => (desc ? key(b).localeCompare(key(a)) : key(a).localeCompare(key(b))));
  }, [withValue, rival, competition, sortBy, desc]);

  const values = withValue.map((p) => p.value ?? 0);
  const hist = bins(values, Math.min(8, Math.max(3, Math.ceil(Math.sqrt(values.length)))));
  const lastBin =
    last?.value !== null && last ? hist.findIndex((b, i) => (last.value ?? 0) <= b.to || i === hist.length - 1) : -1;
  const streak =
    season !== null
      ? currentStreak(
          withValue.map((p) => p.value),
          season,
        )
      : null;
  const sorted = [...withValue].sort((a, b) => (a.value ?? 0) - (b.value ?? 0));
  const best = stat.higherIsBetter ? sorted.at(-1) : sorted[0];
  const worst = stat.higherIsBetter ? sorted[0] : sorted.at(-1);
  const byRival = windows.filter((w) => w.key.startsWith('rival:'));
  const groups = windows.filter((w) => !TIME_WINDOWS.some(([k]) => k === w.key) && !w.key.startsWith('rival:'));
  const goodDelta = (d: number) => (stat.higherIsBetter ? d > 0 : d < 0);

  return (
    <div className="grid gap-8">
      <nav aria-label="Migas de pan" className="flex flex-wrap items-center gap-2 text-sm text-muted">
        <button
          type="button"
          className="chip focus-ring"
          onClick={() => {
            if (window.history.length > 1) router.back();
            else router.push(backHref);
          }}
        >
          <ArrowLeftIcon size={14} aria-hidden="true" /> Volver
        </button>
        <Link href="/" className="focus-ring hover:text-fg">
          Inicio
        </Link>
        <CaretRightIcon size={12} aria-hidden="true" />
        <Link href={backHref} className="focus-ring hover:text-fg">
          {detail.entity === 'jugador' ? 'Jugadores' : 'Equipo'}
        </Link>
        <CaretRightIcon size={12} aria-hidden="true" />
        <span className="font-semibold text-fg">{stat.name}</span>
      </nav>

      <header className="context-panel">
        <section className="grid content-start gap-3">
          <p className="text-xs font-semibold text-muted">
            {detail.entityName} · {stat.group}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-3xl font-extrabold tracking-tight">{stat.name}</h1>
            <span className="level-badge">Nivel {stat.level}</span>
            {stat.estimated ? <span className="level-badge">Estimada</span> : null}
          </div>
          <p className="max-w-[65ch] text-sm leading-relaxed">{stat.description}</p>
          <StatReading text={stat.reading} />
          {stat.formula && stat.rule !== 'suma' ? (
            <p className="text-sm text-muted">
              Fórmula: <span className="font-semibold text-fg">{stat.formula}</span>
            </p>
          ) : null}
          <p className="text-xs text-muted">
            Fuente: {stat.source.replaceAll('|', ', ')}
            {stat.level === 'B' ? '; cálculo propio' : ''}.
          </p>
        </section>
        <section className="grid content-start gap-2">
          <p className="text-xs font-semibold text-muted">Temporada (promedio por partido)</p>
          <p className="text-5xl font-extrabold tabular">{fmt(season)}</p>
          {detail.standing ? (
            <p className="text-sm text-muted">
              {detail.standing.rank > 0 ? (
                <>
                  <span className="font-bold text-fg">{detail.standing.rank}.º</span> de {detail.standing.of}{' '}
                </>
              ) : null}
              {detail.standing.group} · percentil{' '}
              <span className="font-bold text-fg">{detail.standing.percentile}</span>
            </p>
          ) : null}
          <p className="text-xs text-muted">
            {withValue.length} partidos con dato.
            {lastDate
              ? ` Las ventanas de días se cuentan hacia atrás desde el último partido cargado (${fullDate(lastDate)}), no desde hoy.`
              : ''}
          </p>
        </section>
      </header>

      <section aria-labelledby="ventanas" className="grid gap-3">
        <h2 id="ventanas" className="text-xl font-bold">
          Ventanas de tiempo
        </h2>
        <ul className="window-grid">
          {TIME_WINDOWS.map(([key, label]) => (
            <WindowCard key={key} label={label} w={windows.find((x) => x.key === key)} fmt={fmt} good={goodDelta} />
          ))}
        </ul>
        <h3 className="text-base font-bold">Por competición, localía y resultado</h3>
        <ul className="window-grid">
          {groups.map((w) => (
            <WindowCard key={w.key} label={w.label} w={w} fmt={fmt} good={goodDelta} />
          ))}
        </ul>
      </section>

      {withValue.length ? (
        <section aria-labelledby="graficos" className="grid gap-3">
          <h2 id="graficos" className="text-xl font-bold">
            Gráficos
          </h2>
          <div className="chart-grid-layout">
            <article className="chart-card">
              <h3 className="text-base font-bold">Partido a partido</h3>
              <BarChart
                labels={withValue.map((p) => day(p.date))}
                series={[{ id: 'v', label: stat.name, slot: 1, values: withValue.map((p) => p.value) }]}
                references={[
                  ...(season !== null ? [{ value: season, label: 'Temporada' }] : []),
                  ...(() => {
                    const l10 = windows.find((w) => w.key === 'u10')?.value;
                    return l10 !== null && l10 !== undefined ? [{ value: l10, label: 'Últimos 10' }] : [];
                  })(),
                ]}
                highlight={withValue.length - 1}
                format={(v) => formatStat(v, stat, false)}
                label={`${stat.name} en cada partido con el promedio de la temporada y de los últimos 10`}
              />
            </article>
            <article className="chart-card">
              <h3 className="text-base font-bold">Promedio móvil de 5 partidos</h3>
              <LineChart
                labels={withValue.map((p) => day(p.date))}
                series={[
                  { id: 'v', label: 'Partido', slot: 3, values: withValue.map((p) => p.value) },
                  {
                    id: 'r',
                    label: 'Media de 5',
                    slot: 1,
                    values: rolling(
                      withValue.map((p) => p.value),
                      5,
                    ),
                  },
                ]}
                includeZero={false}
                label={`${stat.name}: valor de cada partido y promedio móvil de 5`}
              />
            </article>
            <article className="chart-card">
              <h3 className="text-base font-bold">Distribución</h3>
              <BarChart
                labels={hist.map((b) => `${formatStat(b.from, stat, false)} a ${formatStat(b.to, stat, false)}`)}
                series={[{ id: 'n', label: 'Partidos', slot: 1, values: hist.map((b) => b.count) }]}
                highlight={lastBin >= 0 ? lastBin : undefined}
                label="Cantidad de partidos por rango de valor; resaltado, el rango del último partido"
              />
            </article>
            {detail.references.length > 1 ? (
              <article className="chart-card">
                <h3 className="text-base font-bold">Contra la referencia</h3>
                <BarChart
                  horizontal
                  labels={detail.references.map((r) => r.label)}
                  series={[{ id: 'r', label: stat.name, slot: 1, values: detail.references.map((r) => r.value) }]}
                  format={(v) => formatStat(v, stat, false)}
                  label={
                    detail.entity === 'jugador'
                      ? 'Comparado con el plantel y con su posición'
                      : 'Comparado con el promedio de la liga'
                  }
                />
              </article>
            ) : null}
          </div>
          {streak ? (
            <p className="text-sm">
              <span className="font-bold">Racha:</span> {streak.count} partido{streak.count === 1 ? '' : 's'} seguido
              {streak.count === 1 ? '' : 's'} {streak.above ? 'por encima' : 'por debajo'} del promedio de la temporada
              {stat.higherIsBetter === streak.above ? ' (bien)' : ' (mal)'}.
            </p>
          ) : null}
        </section>
      ) : (
        <p className="text-muted">Sin partidos con dato para esta estadística.</p>
      )}

      {last ? (
        <section aria-labelledby="ultimo" className="grid gap-2">
          <h2 id="ultimo" className="text-xl font-bold">
            Último partido
          </h2>
          <p className="text-sm">
            {fullDate(last.date)} · {last.home ? 'Boca vs' : 'Boca en cancha de'} {last.opponent} · {last.goalsFor}-
            {last.goalsAgainst} ({last.competition})
          </p>
          <p className="text-3xl font-extrabold tabular">
            {fmt(last.value)}{' '}
            {season !== null && last.value !== null ? (
              <span
                className={`text-base ${goodDelta(last.value - season) ? 'value-best' : last.value === season ? 'text-muted' : 'value-worst'}`}
              >
                ({last.value >= season ? '+' : '−'}
                {formatStat(Math.abs(last.value - season), stat, false)} contra su promedio)
              </span>
            ) : null}
          </p>
        </section>
      ) : null}

      {withValue.length ? (
        <section aria-labelledby="partidos" className="grid gap-3">
          <h2 id="partidos" className="text-xl font-bold">
            Partidos
          </h2>
          <div className="flex flex-wrap gap-2">
            <select
              aria-label="Filtrar por rival"
              className="select focus-ring"
              value={rival}
              onChange={(e) => {
                setRival(e.target.value);
              }}
            >
              <option value="">Todos los rivales</option>
              {rivals.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
            <select
              aria-label="Filtrar por competición"
              className="select focus-ring"
              value={competition}
              onChange={(e) => {
                setCompetition(e.target.value);
              }}
            >
              <option value="">Todas las competiciones</option>
              {competitions.map(([code, name]) => (
                <option key={code} value={code}>
                  {name}
                </option>
              ))}
            </select>
          </div>
          <div className="data-table-wrap max-h-[420px]">
            <table className="data-table">
              <caption className="sr-only">Partidos con {stat.name}</caption>
              <thead>
                <tr>
                  {(
                    [
                      ['fecha', 'Fecha'],
                      ['', 'Rival'],
                      ['', 'Localía'],
                      ['', 'Resultado'],
                      ['valor', stat.short],
                      ['', 'Contra el promedio'],
                    ] as const
                  ).map(([key, label]) => (
                    <th
                      key={label}
                      scope="col"
                      aria-sort={key && sortBy === key ? (desc ? 'descending' : 'ascending') : undefined}
                    >
                      {key ? (
                        <button
                          type="button"
                          className="sort-button focus-ring"
                          onClick={() => {
                            if (sortBy === key) setDesc((d) => !d);
                            else {
                              setSortBy(key);
                              setDesc(true);
                            }
                          }}
                        >
                          {label}
                        </button>
                      ) : (
                        label
                      )}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {listed.map((p) => {
                  const d = season !== null && p.value !== null ? p.value - season : null;
                  return (
                    <tr key={p.matchId}>
                      <th scope="row">{fullDate(p.date)}</th>
                      <td>{p.opponent}</td>
                      <td>{p.home ? 'Local' : 'Visitante'}</td>
                      <td>
                        {p.goalsFor}-{p.goalsAgainst} ({p.result})
                      </td>
                      <td className="tabular font-bold">{fmt(p.value)}</td>
                      <td
                        className={`tabular ${d === null || d === 0 ? 'text-muted' : goodDelta(d) ? 'value-best' : 'value-worst'}`}
                      >
                        {d === null ? NOT_AVAILABLE : `${d >= 0 ? '+' : '−'}${formatStat(Math.abs(d), stat, false)}`}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {best && worst ? (
        <section aria-labelledby="contra-quien" className="grid gap-3">
          <h2 id="contra-quien" className="text-xl font-bold">
            Contra quién
          </h2>
          <p className="text-sm">
            Mejor: <span className="value-best font-bold">{fmt(best.value)}</span> contra {best.opponent} (
            {fullDate(best.date)}). Peor: <span className="value-worst font-bold">{fmt(worst.value)}</span> contra{' '}
            {worst.opponent} ({fullDate(worst.date)}).
          </p>
          {byRival.length ? (
            <ul className="window-grid">
              {byRival.map((w) => (
                <WindowCard key={w.key} label={w.label} w={w} fmt={fmt} good={goodDelta} />
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted">Ningún rival se repite dos veces en la temporada.</p>
          )}
        </section>
      ) : null}

      <section aria-labelledby="relacionadas" className="grid gap-3">
        <h2 id="relacionadas" className="text-xl font-bold">
          Relacionadas
        </h2>
        <ul className="flex flex-wrap gap-2">
          {detail.related.map((r) => (
            <li key={r.id}>
              <Link href={`/estadistica/${r.id}${query}`} className="chip focus-ring">
                {r.name}
              </Link>
            </li>
          ))}
          <li>
            <Link href="/situaciones" className="chip focus-ring">
              Situaciones de partido
            </Link>
          </li>
        </ul>
      </section>
    </div>
  );
}

function WindowCard({
  label,
  w,
  fmt,
  good,
}: {
  label: string;
  w: StatWindow | undefined;
  fmt: (v: number | null) => string;
  good: (d: number) => boolean;
}) {
  if (!w) {
    return (
      <li className="window-card window-card--empty">
        <p className="text-xs font-semibold text-muted">{label}</p>
        <p className="text-sm text-muted">Sin partidos en este período.</p>
      </li>
    );
  }
  const d = w.delta;
  return (
    <li className="window-card">
      <p className="text-xs font-semibold text-muted">{label}</p>
      <p className="text-2xl font-extrabold tabular">{fmt(w.value)}</p>
      <p className="text-xs text-muted">
        {w.n} {w.n === 1 ? 'partido' : 'partidos'}
        {w.total !== null && w.n > 1 ? ` · total ${fmt(w.total)}` : ''}
        {w.n < SMALL_WINDOW ? ' · muestra pequeña' : ''}
      </p>
      {w.n > 1 ? (
        <p className="text-xs text-muted">
          Mejor {fmt(w.best)} · peor {fmt(w.worst)}
        </p>
      ) : null}
      {d !== null && w.key !== 'temporada' ? (
        <p
          className={`inline-flex items-center gap-1 text-xs font-bold ${d === 0 ? 'text-muted' : good(d) ? 'value-best' : 'value-worst'}`}
        >
          {d > 0 ? (
            <ArrowUpIcon size={12} weight="bold" aria-hidden="true" />
          ) : d < 0 ? (
            <ArrowDownIcon size={12} weight="bold" aria-hidden="true" />
          ) : null}
          {d >= 0 ? '+' : '−'}
          {fmt(Math.abs(d))} contra la temporada
        </p>
      ) : null}
    </li>
  );
}
