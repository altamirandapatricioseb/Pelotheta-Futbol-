'use client';

import { ArrowDownIcon, ArrowUpIcon, EqualsIcon, ImageIcon, MagnifyingGlassPlusIcon } from '@phosphor-icons/react';
import { useRef, useState } from 'react';

import { downloadPng } from '@/components/charts/chart-card';
import { Radar, type Slot } from '@/components/charts/primitives';
import { quartiles, summarize, type Section, type StatComparison, type Verdict } from '@/lib/compare/compare';
import { formatStat, playerValue, type PlayerRow, type StatDef } from '@/lib/stats/catalog';

import { BulletChart, DivergingBars, GroupedBars } from './compare-charts';

type ChartKind = 'divergentes' | 'agrupadas' | 'bala';
const CHART_LABEL: Record<ChartKind, string> = {
  divergentes: 'Diferencia %',
  agrupadas: 'Barras lado a lado',
  bala: 'Sobre el rango del grupo',
};

export interface RefLabel {
  long: string;
  short: string;
  /** La referencia es otro jugador (no una media). */
  player: boolean;
  slot: Slot;
}

const one = new Intl.NumberFormat('es-AR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const whole = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 });

/** Diferencia con signo; en porcentajes, en puntos (5 puntos = de 80 % a 85 %). */
export function diffText(diff: number | null, stat: StatDef, per90: boolean): string {
  if (diff === null) return 'sin datos';
  const sign = diff > 0 ? '+' : diff < 0 ? '−' : '';
  if (stat.unit === '%') return `${sign}${one.format(Math.abs(diff))} puntos`;
  return `${sign}${formatStat(Math.abs(diff), stat, per90)}`;
}

export function pctText(diffPct: number | null): string {
  if (diffPct === null) return '—';
  const sign = diffPct > 0 ? '+' : diffPct < 0 ? '−' : '';
  return `${sign}${whole.format(Math.abs(diffPct))} %`;
}

export function VerdictIcon({ verdict }: { verdict: Verdict | null }) {
  if (verdict === 'mejor') {
    return (
      <span className="value-best" title="Mejor">
        <ArrowUpIcon size={14} weight="bold" aria-hidden="true" className="inline" />
        <span className="sr-only">mejor</span>
      </span>
    );
  }
  if (verdict === 'peor') {
    return (
      <span className="value-worst" title="Peor">
        <ArrowDownIcon size={14} weight="bold" aria-hidden="true" className="inline" />
        <span className="sr-only">peor</span>
      </span>
    );
  }
  if (verdict === 'igual') {
    return (
      <span className="text-muted" title="Igual">
        <EqualsIcon size={14} aria-hidden="true" className="inline" />
        <span className="sr-only">igual</span>
      </span>
    );
  }
  return null;
}

const numeric = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/**
 * Radares de la categoría: lo principal (estadísticas `clave` del catálogo), la eficacia
 * (porcentajes y cocientes) y el volumen (el resto). Cada uno de 3 a 8 ejes.
 */
export function categoryRadars(rows: readonly StatComparison[]): { title: string; rows: StatComparison[] }[] {
  const usable = rows.filter((r) => !r.missing && r.percentile !== null);
  const used = new Set<string>();
  const take = (list: StatComparison[]) => {
    const out = list.filter((r) => !used.has(r.stat.id)).slice(0, 8);
    for (const r of out) used.add(r.stat.id);
    return out;
  };
  let main = take(usable.filter((r) => r.stat.key));
  if (main.length < 3) {
    for (const r of main) used.delete(r.stat.id);
    main = take(usable);
  }
  const ratio = take(usable.filter((r) => r.stat.unit === '%' || r.stat.rule === 'cociente'));
  const volume = take(usable);
  return [
    { title: 'Lo principal', rows: main },
    { title: 'Eficacia (porcentajes)', rows: ratio },
    { title: 'Volumen y más', rows: volume },
  ].filter((g) => g.rows.length >= 3);
}

interface CompareSectionProps {
  section: Section;
  rows: StatComparison[];
  labels: RefLabel[];
  groups: PlayerRow[][];
  pool: PlayerRow[];
  main: PlayerRow;
  per90: boolean;
  /** Abre el desglose de la estadística dentro de Comparar. */
  onOpen: (statId: string) => void;
}

/** Una categoría de la comparación: radares, un gráfico a elección y la tabla (9.7). */
export function CompareSection({ section, rows, labels, groups, pool, main, per90, onOpen }: CompareSectionProps) {
  const withData = rows.filter((r) => !r.missing);
  const [chart, setChart] = useState<ChartKind>('divergentes');
  const chartRef = useRef<HTMLDivElement>(null);
  const radarRefs = useRef<(HTMLDivElement | null)[]>([]);
  const head = summarize(rows, 0);
  const refs = labels.map((l) => ({ label: l.short, slot: l.slot }));
  const fmt = (v: number | null, s: StatDef) => formatStat(v, s, per90);
  const playerName = main.shortName ?? main.name;
  const radars = categoryRadars(rows);
  const vs = labels[0];

  // El rango de la bala sale del grupo de la primera referencia (o del grupo base si es un jugador).
  const rangeMembers = (groups[0]?.length ?? 0) >= 2 ? (groups[0] ?? []) : pool;

  const onKeyDown = (e: React.KeyboardEvent<HTMLTableElement>) => {
    const row = (e.target as HTMLElement).closest<HTMLTableRowElement>('tr[data-stat]');
    if (!row) return;
    if (e.key === 'd' || e.key === 'D' || e.key === 'Enter') {
      e.preventDefault();
      const id = row.dataset.stat;
      if (id) onOpen(id);
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const next = e.key === 'ArrowDown' ? row.nextElementSibling : row.previousElementSibling;
      if (next instanceof HTMLElement) next.focus();
    }
  };

  const png = (el: HTMLElement | null | undefined, name: string) => {
    const svg = el?.querySelector('svg[role="img"]');
    if (svg instanceof SVGSVGElement) void downloadPng(svg, `pelotheta-comparacion-${name}-${String(main.playerId)}`);
  };

  return (
    <section className="grid gap-4" aria-labelledby={`cat-${section.id}`}>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 id={`cat-${section.id}`} className="text-xl font-bold">
          {section.name}
        </h2>
        <span className="text-sm text-muted">
          {rows.length} estadísticas
          {vs ? (
            <>
              {' '}
              · contra {vs.short}: <span className="value-best font-semibold">{head.better} mejor</span>,{' '}
              <span className="value-worst font-semibold">{head.worse} peor</span>
              {head.missing ? `, ${String(head.missing)} sin datos` : ''}
            </>
          ) : null}
        </span>
      </div>

      {radars.length ? (
        <div className="cmp-radars">
          {radars.map((g, gi) => (
            <article key={g.title} className="chart-card">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h3 className="text-base font-bold">{g.title}</h3>
                  <p className="text-xs text-muted">
                    Percentil en el grupo de comparación (100 = el mejor del plantel en su tipo).
                  </p>
                </div>
                <button
                  type="button"
                  className="icon-button focus-ring"
                  title="Descargar PNG"
                  onClick={() => {
                    png(radarRefs.current[gi], `${section.id}-radar-${String(gi + 1)}`);
                  }}
                >
                  <ImageIcon size={18} aria-hidden="true" />
                  <span className="sr-only">Descargar PNG</span>
                </button>
              </div>
              <div
                ref={(el) => {
                  radarRefs.current[gi] = el;
                }}
              >
                <Radar
                  axes={g.rows.map((r) => r.stat.short)}
                  series={[
                    { id: 'p', label: playerName, slot: 1, values: g.rows.map((r) => r.percentile) },
                    ...refs.map((ref, k) => ({
                      id: `r${String(k)}`,
                      label: ref.label,
                      slot: ref.slot,
                      values: g.rows.map((r) => r.refs[k]?.percentile ?? null),
                    })),
                  ]}
                  label={`${g.title} de ${section.name}: percentiles de ${main.name} y sus referencias`}
                />
              </div>
            </article>
          ))}
        </div>
      ) : null}

      {withData.length ? (
        <article className="chart-card">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="view-switch" role="group" aria-label={`Gráfico de ${section.name}`}>
              {(Object.keys(CHART_LABEL) as ChartKind[]).map((k) => (
                <button
                  key={k}
                  type="button"
                  className="view-switch__button focus-ring"
                  aria-pressed={chart === k}
                  onClick={() => {
                    setChart(k);
                  }}
                >
                  {CHART_LABEL[k]}
                </button>
              ))}
            </div>
            <button
              type="button"
              className="icon-button focus-ring"
              title="Descargar PNG"
              onClick={() => {
                png(chartRef.current, `${section.id}-${chart}`);
              }}
            >
              <ImageIcon size={18} aria-hidden="true" />
              <span className="sr-only">Descargar PNG</span>
            </button>
          </div>
          <p className="text-xs text-muted">
            {chart === 'divergentes'
              ? 'Cuánto más (verde) o menos (rojo) que cada referencia, en %. A la derecha siempre es mejor.'
              : chart === 'agrupadas'
                ? `Verde: ${playerName}. Cada referencia con su color. Cada fila con su propia escala.`
                : `Punto verde: ${playerName}. Línea: ${vs?.long ?? 'la referencia'}${vs?.player ? ' (rojo)' : ''}. A la derecha siempre es mejor.`}{' '}
            Doble clic en una fila: el desglose de esa estadística.
          </p>
          <div ref={chartRef}>
            {chart === 'divergentes' ? (
              <DivergingBars
                rows={withData.map((r) => ({
                  id: r.stat.id,
                  label: r.stat.name,
                  higherIsBetter: r.stat.higherIsBetter,
                  cells: r.refs.map((c) => ({
                    diffPct: c.diffPct,
                    text: c.value === null ? 'sin datos' : `${diffText(c.diff, r.stat, per90)} (${pctText(c.diffPct)})`,
                  })),
                }))}
                refs={refs}
                onOpen={onOpen}
                label={`Diferencia porcentual de ${main.name} contra cada referencia en ${section.name}`}
              />
            ) : chart === 'agrupadas' ? (
              <GroupedBars
                rows={withData.map((r) => ({
                  id: r.stat.id,
                  label: r.stat.name,
                  values: [r.player, ...r.refs.map((c) => c.value)],
                  texts: [fmt(r.player, r.stat), ...r.refs.map((c) => fmt(c.value, r.stat))],
                }))}
                refs={refs}
                player={playerName}
                onOpen={onOpen}
                label={`${main.name} contra cada referencia en ${section.name}`}
              />
            ) : (
              <BulletChart
                rows={withData.map((r) => {
                  const values = rangeMembers
                    .map((p) => playerValue(p, r.stat, per90))
                    .filter((v): v is number => numeric(v));
                  return {
                    id: r.stat.id,
                    label: r.stat.name,
                    higherIsBetter: r.stat.higherIsBetter,
                    player: r.player,
                    playerText: fmt(r.player, r.stat),
                    reference: r.refs[0]?.value ?? null,
                    referenceText: fmt(r.refs[0]?.value ?? null, r.stat),
                    range: vs?.player ? null : quartiles(values),
                  };
                })}
                reference={refs[0] ?? { label: 'Referencia', slot: 3 }}
                player={playerName}
                onOpen={onOpen}
                label={`${main.name} sobre el rango de ${vs?.long ?? 'la referencia'} en ${section.name}`}
              />
            )}
          </div>
        </article>
      ) : null}

      <div className="data-table-wrap">
        <table
          className="data-table tabular cmp-table"
          role="grid"
          aria-readonly="true"
          onKeyDown={onKeyDown}
          onDoubleClick={(e) => {
            // Doble clic en una fila: el desglose de la estadística dentro de Comparar.
            const id = (e.target as HTMLElement).closest<HTMLElement>('tr[data-stat]')?.dataset.stat;
            if (id) onOpen(id);
          }}
        >
          <caption className="sr-only">
            {section.name}: {main.name} contra {labels.map((l) => l.long).join(', ')}. Doble clic, Enter o la tecla D en
            una fila abre el desglose. En los porcentajes, la diferencia va en puntos.
          </caption>
          <thead>
            <tr className="band-row">
              <th scope="col" />
              <th scope="col" />
              {labels.map((l) => (
                <th key={l.long} scope="colgroup" colSpan={3} className="cmp-band">
                  <span
                    className="chart-key chart-key--box"
                    style={{ background: `var(--series-${String(l.slot)})` }}
                    aria-hidden="true"
                  />{' '}
                  {l.short}
                </th>
              ))}
              <th scope="col" />
            </tr>
            <tr>
              <th scope="col">Estadística</th>
              <th scope="col">
                <span
                  className="chart-key chart-key--box"
                  style={{ background: 'var(--series-1)' }}
                  aria-hidden="true"
                />{' '}
                {playerName}
              </th>
              {labels.map((l) => [
                <th key={`${l.long}-v`} scope="col">
                  {l.player ? 'Valor' : 'Media'}
                </th>,
                <th key={`${l.long}-d`} scope="col">
                  Dif.
                </th>,
                <th key={`${l.long}-p`} scope="col">
                  Dif. %
                </th>,
              ])}
              <th scope="col" title="Percentil del jugador en el grupo de comparación (100 = el mejor)">
                Percentil
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr
                key={r.stat.id}
                data-stat={r.stat.id}
                tabIndex={i === 0 ? 0 : -1}
                className={r.missing ? 'cmp-row--empty' : undefined}
                title="Doble clic: desglose de la estadística"
              >
                <th scope="row">
                  <span className="inline-flex items-center gap-1">
                    {r.stat.name}
                    {r.stat.estimated ? (
                      <span className="est-mark" aria-label="estimada">
                        *
                      </span>
                    ) : null}
                    {!r.stat.higherIsBetter ? (
                      <span className="text-xs font-normal text-muted" title="En esta estadística, menos es mejor">
                        (menos es mejor)
                      </span>
                    ) : null}
                    <button
                      type="button"
                      className="cmp-row__open focus-ring"
                      tabIndex={-1}
                      aria-label={`Desglose: ${r.stat.name}`}
                      onClick={() => {
                        onOpen(r.stat.id);
                      }}
                    >
                      <MagnifyingGlassPlusIcon size={14} aria-hidden="true" />
                    </button>
                  </span>
                </th>
                <td className="font-bold">{r.missing ? 'sin datos' : fmt(r.player, r.stat)}</td>
                {r.refs.map((c, k) =>
                  c.value === null || r.missing ? (
                    <td key={String(k)} colSpan={3} className="cmp-cell--empty">
                      sin datos
                    </td>
                  ) : (
                    [
                      <td key={`${String(k)}-v`}>
                        {fmt(c.value, r.stat)}
                        {c.n < 3 && !labels[k]?.player ? (
                          <span className="est-mark" title={`Solo ${String(c.n)} jugadores con dato`}>
                            n={c.n}
                          </span>
                        ) : null}
                      </td>,
                      <td key={`${String(k)}-d`}>
                        <span className="inline-flex items-center gap-1">
                          <VerdictIcon verdict={c.verdict} />
                          {diffText(c.diff, r.stat, per90)}
                        </span>
                      </td>,
                      <td key={`${String(k)}-p`}>{pctText(c.diffPct)}</td>,
                    ]
                  ),
                )}
                <td>{r.percentile ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
