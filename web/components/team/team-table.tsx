'use client';

import { CaretDownIcon, InfoIcon, MagnifyingGlassIcon } from '@phosphor-icons/react';
import { motion } from 'motion/react';
import { useEffect, useMemo, useState } from 'react';

import { NOT_AVAILABLE } from '@/lib/format';
import {
  aggregateTeam,
  extremeOf,
  formatStat,
  type StatDef,
  type StatSet,
  type StatValue,
  type TeamMatchRow,
} from '@/lib/stats/catalog';
import { leagueComparison, type ClubRow } from '@/lib/stats/league';
import { nextSort, type SortState } from '@/lib/stats/sort';
import { groupMatches, resultLabel, TEAM_VIEWS, type MatchGroup, type TeamView } from '@/lib/stats/team-groups';

import { StatReading } from '@/components/stats/stat-reading';

import { SeasonBoard } from './season-board';

const GROUP_SORT = '__grupo';
const ROW_LAYOUT = { type: 'spring', stiffness: 520, damping: 44 } as const;
const LEVEL_TEXT = { A: 'dato directo de una fuente', B: 'calculado', C: 'no disponible en fuentes gratuitas' };

interface TeamTableProps {
  matches: TeamMatchRow[];
  catalog: StatDef[];
  sets: StatSet[];
  windowValues: Record<string, Record<string, number>>;
  clubs: ClubRow[];
  initialSet: string | null;
  initialView: TeamView;
}

const numeric = (v: StatValue): v is number => typeof v === 'number' && Number.isFinite(v);

/**
 * Interfaz 2 (9.5): tablas del equipo por categoría, una a la vez. Cada fila es un partido o un
 * grupo de partidos (rival, mes, competición o temporada) y cada columna una estadística del
 * conjunto elegido. Panel alto con el partido (o grupo) actual y la estadística actual.
 */
export function TeamTableView({
  matches,
  catalog,
  sets,
  windowValues,
  clubs,
  initialSet,
  initialView,
}: TeamTableProps) {
  const byId = useMemo(() => new Map(catalog.map((s) => [s.id, s])), [catalog]);
  const [setId, setSetId] = useState(sets.some((s) => s.id === initialSet) ? (initialSet ?? '') : (sets[0]?.id ?? ''));
  const [view, setView] = useState<TeamView>(initialView);
  const [perMatch, setPerMatch] = useState(false);
  const [query, setQuery] = useState('');
  const columns = useMemo(
    () =>
      (sets.find((s) => s.id === setId)?.statIds ?? []).flatMap((id) => {
        const s = byId.get(id);
        return s ? [s] : [];
      }),
    [setId, sets, byId],
  );
  const [statId, setStatId] = useState(columns[0]?.id ?? '');
  const column = columns.find((c) => c.id === statId) ?? columns[0];
  const [sort, setSort] = useState<SortState | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLocaleLowerCase('es-AR');
    return q ? matches.filter((m) => m.opponent.toLocaleLowerCase('es-AR').includes(q)) : matches;
  }, [matches, query]);

  // Las métricas de ventana (rachas, forma, Elo final) solo existen para una competición o la temporada.
  const windowFor = (group: MatchGroup): Record<string, number> | undefined =>
    view === 'acumulada' && !query
      ? windowValues.todas
      : view === 'competicion' && !query
        ? windowValues[group.key]
        : undefined;

  const valueOf = (group: MatchGroup, stat: StatDef): StatValue =>
    aggregateTeam(group.rows, stat, byId, {
      perMatch: perMatch && view !== 'partido',
      windowValue: windowFor(group)?.[stat.id] ?? null,
    });

  const groups = useMemo(() => {
    // Sin orden elegido: por partido, del más reciente al más viejo; el resto, en su orden natural.
    const list = groupMatches(filtered, view);
    if (!sort) return view === 'partido' ? list.toReversed() : list;
    // Primera columna: por fecha (partido y mes) o por nombre (rival y competición).
    if (sort.id === GROUP_SORT) return sort.dir === 'asc' ? list : list.toReversed();
    const stat = byId.get(sort.id);
    if (!stat) return list;
    return list.toSorted((a, b) => {
      const va = valueOf(a, stat);
      const vb = valueOf(b, stat);
      // `n/d` siempre al final, sin importar el sentido del orden (9.10).
      if (va === null || vb === null) return va === vb ? 0 : va === null ? 1 : -1;
      const cmp = numeric(va) && numeric(vb) ? va - vb : String(va).localeCompare(String(vb), 'es');
      return sort.dir === 'asc' ? cmp : -cmp;
    });
    // valueOf depende de los mismos estados que la lista de dependencias.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtered, view, sort, byId, perMatch, windowValues]);

  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [previewKey, setPreviewKey] = useState<string | null>(null);
  const current = groups.find((g) => g.key === (previewKey ?? selectedKey)) ?? groups[0] ?? null;

  useEffect(() => {
    const url = new URL(window.location.href);
    url.searchParams.set('conjunto', setId);
    url.searchParams.set('vista', view);
    if (column) url.searchParams.set('estadistica', column.id);
    window.history.replaceState(null, '', url);
  }, [setId, view, column]);

  // Primer clic: elige la estadística (se lee su definición); los siguientes ordenan de menor a
  // mayor, de mayor a menor y vuelven al orden original (lib/stats/sort.ts).
  const onHeaderClick = (id: string) => {
    const next = nextSort(sort, id, column?.id ?? null);
    setStatId(next.selected);
    setSort(next.sort);
  };
  const onGroupHeaderClick = () => {
    setSort(nextSort(sort, GROUP_SORT, GROUP_SORT).sort);
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    const rowIndex = groups.findIndex((g) => g.key === current?.key);
    const colIndex = columns.findIndex((c) => c.id === column?.id);
    const actions: Record<string, () => void> = {
      ArrowDown: () => {
        setSelectedKey((groups[rowIndex + 1] ?? current)?.key ?? null);
      },
      ArrowUp: () => {
        setSelectedKey((groups[rowIndex - 1] ?? current)?.key ?? null);
      },
      ArrowRight: () => {
        setStatId((columns[colIndex + 1] ?? column)?.id ?? '');
      },
      ArrowLeft: () => {
        setStatId((columns[colIndex - 1] ?? column)?.id ?? '');
      },
    };
    const action = actions[event.key];
    if (action) {
      event.preventDefault();
      action();
    }
  };

  // Panel: valor en el grupo actual, promedio por partido de la temporada y de los últimos 5.
  const all: MatchGroup = { key: 'todas', label: 'Temporada', rows: matches };
  const last5: MatchGroup = { key: 'ultimos5', label: 'Últimos 5', rows: matches.slice(-5) };
  const panelValue = current && column ? valueOf(current, column) : null;
  const seasonAvg = column ? aggregateTeam(all.rows, column, byId, { perMatch: true }) : null;
  const last5Avg = column ? aggregateTeam(last5.rows, column, byId, { perMatch: true }) : null;
  const single = current?.rows.length === 1 ? current.rows[0] : undefined;
  // Mejor o peor fila de la tabla (partido, rival, mes o competición) para la estadística, y
  // mejor o peor de los 30 clubes de la liga para el promedio de la temporada.
  const panelExtreme =
    column && typeof panelValue === 'number'
      ? extremeOf(
          groups.map((g) => valueOf(g, column)).filter((v): v is number => typeof v === 'number'),
          panelValue,
          column.higherIsBetter,
        )
      : null;
  const league = column ? leagueComparison(column.id, column.higherIsBetter, clubs) : null;
  const leagueExtreme = league?.bocaPercentile === 100 ? 'best' : league?.bocaPercentile === 0 ? 'worst' : null;
  const rowName = (
    { partido: 'partido', rival: 'rival', mes: 'mes', competicion: 'competición', acumulada: 'fila' } as const
  )[view];

  return (
    <div className="grid gap-6">
      <div className="context-panel" aria-live="polite">
        <section aria-label="Partido actual">
          {current ? (
            <div className="relative grid gap-4">
              <p className="text-xs font-semibold text-muted">
                {single ? single.competitionName : `${String(current.rows.length)} partidos`}
                {previewKey !== null && previewKey !== selectedKey ? ' · vista previa' : ''}
              </p>
              <h2 className="text-2xl font-extrabold tracking-tight">
                {single ? `${single.home ? 'Boca vs' : 'Boca en cancha de'} ${single.opponent}` : current.label}
              </h2>
              {single ? (
                <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
                  <div>
                    <dt className="text-xs text-muted">Fecha</dt>
                    <dd className="font-bold">{single.date.split('-').reverse().join('/')}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted">Resultado</dt>
                    <dd className="font-bold">{resultLabel(single)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted">Localía</dt>
                    <dd className="font-bold">{single.home ? 'Local' : 'Visitante'}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted">Árbitro</dt>
                    <dd className="font-bold">{single.referee ?? NOT_AVAILABLE}</dd>
                  </div>
                </dl>
              ) : (
                <GroupRecord rows={current.rows} />
              )}
            </div>
          ) : (
            <p className="text-muted">No hay partidos con estos filtros.</p>
          )}
        </section>

        {column ? (
          <section aria-label="Estadística actual" className="grid content-start gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-xl font-extrabold tracking-tight">{column.name}</h2>
              <span className="level-badge" title={LEVEL_TEXT[column.level]}>
                Nivel {column.level}
              </span>
              {column.estimated ? (
                <span className="level-badge" title="Calculada con un supuesto: es una estimación">
                  Estimada
                </span>
              ) : null}
            </div>
            <p className="max-w-[60ch] text-sm leading-relaxed">{column.description}</p>
            <StatReading text={column.reading} />
            {column.formula && column.rule !== 'suma' ? (
              <p className="text-sm text-muted">
                Fórmula: <span className="font-semibold text-fg">{column.formula}</span>
              </p>
            ) : null}
            <div className="mt-1 flex flex-wrap items-end gap-x-8 gap-y-2">
              <p
                className={`text-4xl font-extrabold tabular${panelExtreme === 'best' ? ' value-best' : panelExtreme === 'worst' ? ' value-worst' : ''}`}
              >
                {panelValue === null ? (
                  <span className="text-muted">{NOT_AVAILABLE}</span>
                ) : (
                  formatStat(panelValue, column, false)
                )}
              </p>
              <p className="pb-1 text-sm text-muted">
                {column.per90 ? 'Promedio por partido' : 'Temporada'}:{' '}
                <span
                  className={`font-bold ${leagueExtreme === 'best' ? 'value-best' : leagueExtreme === 'worst' ? 'value-worst' : 'text-fg'}`}
                >
                  {formatStat(seasonAvg, column, column.per90)}
                </span>{' '}
                · últimos 5: <span className="font-bold text-fg">{formatStat(last5Avg, column, column.per90)}</span>
              </p>
            </div>
            {panelExtreme || leagueExtreme ? (
              <div className="flex flex-wrap gap-2">
                {panelExtreme ? (
                  <p className={`rank-flag ${panelExtreme === 'best' ? 'value-best' : 'value-worst'}`}>
                    {panelExtreme === 'best' ? `Mejor ${rowName} de la tabla` : `Peor ${rowName} de la tabla`}
                  </p>
                ) : null}
                {leagueExtreme ? (
                  <p className={`rank-flag ${leagueExtreme === 'best' ? 'value-best' : 'value-worst'}`}>
                    {leagueExtreme === 'best'
                      ? 'En la liga: el mejor de los 30 clubes'
                      : 'En la liga: el peor de los 30 clubes'}
                  </p>
                ) : null}
              </div>
            ) : null}
            <p className="text-xs text-muted">
              Fuente: {column.source.replaceAll('|', ', ')}
              {column.level === 'B' ? '; cálculo propio' : ''}.
            </p>
          </section>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-sm font-semibold">
          <span>Categoría</span>
          <select
            aria-label="Categoría de estadísticas"
            className="select focus-ring"
            value={setId}
            onChange={(e) => {
              setSetId(e.target.value);
            }}
          >
            {sets.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <div role="group" aria-label="Vista" className="flex flex-wrap gap-2">
          {TEAM_VIEWS.map((v) => (
            <button
              key={v.id}
              type="button"
              className="chip focus-ring"
              aria-current={view === v.id}
              onClick={() => {
                setView(v.id);
                setSelectedKey(null);
                setSort(null);
              }}
            >
              {v.label}
            </button>
          ))}
        </div>
        <label className="chip focus-ring ml-auto cursor-text" htmlFor="buscar-rival">
          <MagnifyingGlassIcon size={16} aria-hidden="true" />
          <span className="sr-only">Buscar rival</span>
          <input
            id="buscar-rival"
            type="search"
            placeholder="Buscar rival"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
            }}
            className="w-32 bg-transparent text-fg outline-none placeholder:text-muted"
          />
        </label>
        {view !== 'partido' ? (
          <button
            type="button"
            className="chip focus-ring"
            aria-pressed={perMatch}
            aria-current={perMatch}
            onClick={() => {
              setPerMatch((v) => !v);
            }}
          >
            Promedio por partido
          </button>
        ) : null}
      </div>

      {view === 'acumulada' ? (
        <SeasonBoard
          rows={filtered}
          columns={columns}
          byId={byId}
          windowValues={query ? {} : (windowValues.todas ?? {})}
          selectedId={column?.id ?? null}
          onSelect={setStatId}
          clubs={clubs}
        />
      ) : (
        <div className="data-table-wrap">
          <table className="data-table tabular" role="grid" aria-readonly="true" onKeyDown={onKeyDown}>
            <caption className="sr-only">
              Tabla del equipo, {sets.find((s) => s.id === setId)?.name}. Flechas arriba y abajo cambian la fila;
              izquierda y derecha, la estadística.
            </caption>
            <thead>
              <tr>
                <th
                  scope="col"
                  aria-sort={sort?.id === GROUP_SORT ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
                >
                  <button
                    type="button"
                    className="sort-button focus-ring"
                    title={view === 'partido' || view === 'mes' ? 'Ordenar por fecha' : 'Ordenar por nombre'}
                    onClick={onGroupHeaderClick}
                  >
                    {view === 'partido'
                      ? 'Fecha y rival'
                      : (TEAM_VIEWS.find((v) => v.id === view)?.label.replace('Por ', '') ?? 'Grupo')}
                    {sort?.id === GROUP_SORT ? (
                      <CaretDownIcon
                        size={12}
                        weight="bold"
                        className="sort-arrow"
                        data-dir={sort.dir}
                        aria-hidden="true"
                      />
                    ) : null}
                  </button>
                </th>
                {view === 'partido' ? <th scope="col">Res.</th> : <th scope="col">PJ</th>}
                {columns.map((c) => {
                  const sorted = sort?.id === c.id;
                  return (
                    <th
                      key={c.id}
                      scope="col"
                      title={c.name}
                      data-current-stat={c.id === column?.id || undefined}
                      aria-sort={sorted ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
                    >
                      <button
                        type="button"
                        className="sort-button focus-ring"
                        onClick={() => {
                          onHeaderClick(c.id);
                        }}
                      >
                        {c.short}
                        {c.estimated ? (
                          <span className="est-mark" aria-label="estimada">
                            *
                          </span>
                        ) : null}
                        {sorted ? (
                          <CaretDownIcon
                            size={12}
                            weight="bold"
                            className="sort-arrow"
                            data-dir={sort.dir}
                            aria-hidden="true"
                          />
                        ) : null}
                      </button>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody
              onMouseLeave={() => {
                setPreviewKey(null);
              }}
            >
              {groups.map((g, i) => {
                const selected = g.key === current?.key && previewKey === null;
                return (
                  <motion.tr
                    key={g.key}
                    layout="position"
                    transition={ROW_LAYOUT}
                    className="row-enter"
                    style={{ '--i': Math.min(i, 24) } as React.CSSProperties}
                    aria-selected={selected}
                    tabIndex={g.key === current?.key ? 0 : -1}
                    onClick={() => {
                      setSelectedKey(g.key);
                    }}
                    onMouseEnter={() => {
                      setPreviewKey(g.key);
                    }}
                    onFocus={() => {
                      setSelectedKey(g.key);
                    }}
                  >
                    <th scope="row" className="font-semibold">
                      {g.label}
                    </th>
                    <td>{view === 'partido' && g.rows[0] ? resultLabel(g.rows[0]) : g.rows.length}</td>
                    {columns.map((c) => {
                      const v = valueOf(g, c);
                      return (
                        <td key={c.id} data-current-stat={c.id === column?.id || undefined}>
                          {v === null ? (
                            <span
                              className="text-muted"
                              title="No disponible para este grupo o en las fuentes gratuitas"
                            >
                              {NOT_AVAILABLE}
                            </span>
                          ) : (
                            formatStat(v, c, perMatch && view !== 'partido')
                          )}
                        </td>
                      );
                    })}
                  </motion.tr>
                );
              })}
            </tbody>
            <tfoot>
              {/* Fila fija al pie: total de los partidos visibles y promedio por partido (9.5). */}
              {[false, true].map((avg) => (
                <tr key={String(avg)}>
                  <td>{avg ? 'Promedio por partido' : 'Total'}</td>
                  <td>{avg ? '' : filtered.length}</td>
                  {columns.map((c) => (
                    <td key={c.id}>
                      {avg && !c.per90
                        ? ''
                        : formatStat(
                            aggregateTeam(filtered, c, byId, {
                              perMatch: avg,
                              windowValue: query ? null : (windowValues.todas?.[c.id] ?? null),
                            }),
                            c,
                            avg,
                          )}
                    </td>
                  ))}
                </tr>
              ))}
              {/* Liga Profesional 2026: promedio por partido de los 30 clubes y puesto de Boca. */}
              <tr>
                <td>Promedio de la liga</td>
                <td />
                {columns.map((c) => {
                  const cmp = leagueComparison(c.id, c.higherIsBetter, clubs);
                  return <td key={c.id}>{cmp ? formatStat(cmp.average, c, true) : ''}</td>;
                })}
              </tr>
              <tr>
                <td title="Percentil de Boca entre los 30 clubes de la liga (100 = el mejor)">
                  Boca vs liga (percentil)
                </td>
                <td />
                {columns.map((c) => {
                  const cmp = leagueComparison(c.id, c.higherIsBetter, clubs);
                  return <td key={c.id}>{cmp?.bocaPercentile ?? ''}</td>;
                })}
              </tr>
            </tfoot>
          </table>
        </div>
      )}
      <p className="flex items-center gap-2 text-xs text-muted">
        <InfoIcon size={14} aria-hidden="true" />
        Partidos oficiales de 2026. Los porcentajes y cocientes se calculan sumando numeradores y denominadores (solo
        con los partidos que tienen los dos datos). * = estimada. n/d = no disponible.
      </p>
    </div>
  );
}

function GroupRecord({ rows }: { rows: TeamMatchRow[] }) {
  const won = rows.filter((r) => r.goalsFor > r.goalsAgainst).length;
  const drawn = rows.filter((r) => r.goalsFor === r.goalsAgainst).length;
  const gf = rows.reduce((a, r) => a + r.goalsFor, 0);
  const ga = rows.reduce((a, r) => a + r.goalsAgainst, 0);
  return (
    <dl className="fact-grid">
      <div>
        <dt>PJ</dt>
        <dd>{rows.length}</dd>
      </div>
      <div>
        <dt>G-E-P</dt>
        <dd>
          {won}-{drawn}-{rows.length - won - drawn}
        </dd>
      </div>
      <div>
        <dt>Goles</dt>
        <dd>
          {gf}-{ga}
        </dd>
      </div>
      <div>
        <dt>Puntos</dt>
        <dd>{won * 3 + drawn}</dd>
      </div>
    </dl>
  );
}
