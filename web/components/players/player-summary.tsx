'use client';

import { CaretDownIcon, InfoIcon, MagnifyingGlassIcon } from '@phosphor-icons/react';
import { motion } from 'motion/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { AnimatedNumber } from '@/components/animated-number';
import type { PlayerSummary } from '@/lib/data/players';
import { formatNumber, NOT_AVAILABLE } from '@/lib/format';
import {
  columnValue,
  getColumn,
  rankAndPercentile,
  SUMMARY_COLUMNS,
  type SummaryColumn,
} from '@/lib/stats/summary-columns';

type SortDir = 'asc' | 'desc';
const POSITIONS = ['Todas', 'Arquero', 'Defensor', 'Mediocampista', 'Delantero'] as const;
const ROW_LAYOUT = { type: 'spring', stiffness: 520, damping: 44 } as const;

interface PlayerSummaryViewProps {
  players: PlayerSummary[];
  competitionName: string;
  initialPlayerId: number | null;
  initialStat: string | null;
}

function initials(name: string): string {
  const parts = name.split(' ').filter(Boolean);
  return `${parts[0]?.[0] ?? ''}${parts.length > 1 ? (parts.at(-1)?.[0] ?? '') : ''}`.toUpperCase();
}

function display(value: number | null, per90: boolean, column: SummaryColumn): string {
  return formatNumber(value, per90 && column.per90 ? 1 : 0);
}

/**
 * Interfaz 3, conjunto «Resumen» (9.1): panel alto con la ficha del jugador actual y la
 * descripción de la estadística actual, y debajo la tabla (un jugador por fila).
 * Jugador actual = fila seleccionada (clic o flechas arriba/abajo); estadística actual =
 * columna seleccionada (clic en el encabezado o flechas izquierda/derecha).
 */
export function PlayerSummaryView({ players, competitionName, initialPlayerId, initialStat }: PlayerSummaryViewProps) {
  const [per90, setPer90] = useState(false);
  const [position, setPosition] = useState<(typeof POSITIONS)[number]>('Todas');
  const [query, setQuery] = useState('');
  const [statKey, setStatKey] = useState<SummaryColumn['key']>(getColumn(initialStat).key);
  const [sort, setSort] = useState<{ key: SummaryColumn['key']; dir: SortDir }>({ key: 'minutes', dir: 'desc' });
  // Al arrancar, el jugador actual es el de más minutos (9.1).
  const [selectedId, setSelectedId] = useState<number | null>(
    players.some((p) => p.playerId === initialPlayerId) ? initialPlayerId : (players[0]?.playerId ?? null),
  );
  const [previewId, setPreviewId] = useState<number | null>(null);
  const tableRef = useRef<HTMLTableSectionElement>(null);

  const column = getColumn(statKey);

  const visible = useMemo(() => {
    const q = query.trim().toLocaleLowerCase('es-AR');
    const sortColumn = getColumn(sort.key);
    return players
      .filter((p) => position === 'Todas' || p.position === position)
      .filter((p) => !q || p.name.toLocaleLowerCase('es-AR').includes(q))
      .toSorted((a, b) => {
        const va = columnValue(a, sortColumn, per90);
        const vb = columnValue(b, sortColumn, per90);
        // `n/d` siempre al final, sin importar el sentido del orden (9.10).
        if (va === null || vb === null) return va === vb ? 0 : va === null ? 1 : -1;
        return sort.dir === 'asc' ? va - vb : vb - va;
      });
  }, [players, position, query, sort, per90]);

  const current = players.find((p) => p.playerId === (previewId ?? selectedId)) ?? visible[0] ?? null;

  // El estado vive en la URL para poder compartir la vista exacta (9.1).
  useEffect(() => {
    const url = new URL(window.location.href);
    if (selectedId !== null) url.searchParams.set('jugador', String(selectedId));
    url.searchParams.set('estadistica', statKey);
    window.history.replaceState(null, '', url);
  }, [selectedId, statKey]);

  const squadValues = useMemo(
    () => visible.map((p) => columnValue(p, column, per90)).filter((v): v is number => v !== null),
    [visible, column, per90],
  );
  const currentValue = current ? columnValue(current, column, per90) : null;
  const standing = currentValue === null ? null : rankAndPercentile(squadValues, currentValue);

  const onHeaderClick = (key: SummaryColumn['key']) => {
    setStatKey(key);
    // Primer clic: de menor a mayor; segundo clic sobre la misma columna: al revés (9.10).
    setSort((s) => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }));
  };

  const moveSelection = useCallback(
    (step: number) => {
      const index = visible.findIndex((p) => p.playerId === selectedId);
      const next = visible[Math.min(visible.length - 1, Math.max(0, index + step))];
      if (!next) return;
      setSelectedId(next.playerId);
      tableRef.current?.querySelector<HTMLElement>(`[data-player="${String(next.playerId)}"]`)?.focus();
    },
    [visible, selectedId],
  );

  const onKeyDown = (event: React.KeyboardEvent) => {
    const colIndex = SUMMARY_COLUMNS.findIndex((c) => c.key === statKey);
    const keyActions: Record<string, () => void> = {
      ArrowDown: () => {
        moveSelection(1);
      },
      ArrowUp: () => {
        moveSelection(-1);
      },
      ArrowRight: () => {
        setStatKey((SUMMARY_COLUMNS[colIndex + 1] ?? column).key);
      },
      ArrowLeft: () => {
        setStatKey((SUMMARY_COLUMNS[colIndex - 1] ?? column).key);
      },
    };
    const action = keyActions[event.key];
    if (action) {
      event.preventDefault();
      action();
    }
  };

  const average = (col: SummaryColumn) => {
    const values = visible.map((p) => columnValue(p, col, per90)).filter((v): v is number => v !== null);
    return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
  };

  return (
    <div className="grid gap-6">
      {/* Panel de contexto: ficha del jugador y descripción de la estadística actual. */}
      <div className="context-panel" aria-live="polite">
        <section aria-label="Jugador actual">
          <PitchTexture />
          {current ? (
            <div className="relative grid gap-5">
              <div className="flex items-center gap-4">
                <span className="avatar" aria-hidden="true">
                  {initials(current.name)}
                </span>
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-muted">
                    {current.shirtNumber !== null ? `#${String(current.shirtNumber)} · ` : ''}
                    {current.position ?? 'Posición n/d'}
                    {previewId !== null && previewId !== selectedId ? ' · vista previa' : ''}
                  </p>
                  <h2 className="truncate text-2xl font-extrabold tracking-tight">{current.name}</h2>
                  <p className="text-sm text-muted">
                    {current.age !== null ? `${String(current.age)} años` : 'Edad n/d'} ·{' '}
                    {current.heightCm !== null ? `${formatNumber(current.heightCm / 100, 1)} m` : 'Altura n/d'} ·{' '}
                    {competitionName}
                  </p>
                </div>
              </div>
              <dl className="fact-grid">
                <Fact label="Partidos" value={current.matches} />
                <Fact label="Minutos" value={current.minutes} />
                <Fact label="Goles" value={current.goals} />
                <Fact label="Asistencias" value={current.assists} />
                <div>
                  <dt>Calificación</dt>
                  <dd className="text-muted" title="No disponible en las fuentes gratuitas">
                    {NOT_AVAILABLE}
                  </dd>
                </div>
              </dl>
            </div>
          ) : (
            <p className="relative text-muted">No hay jugadores con estos filtros.</p>
          )}
        </section>

        <section aria-label="Estadística actual" className="grid content-start gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-xl font-extrabold tracking-tight">{column.name}</h2>
            <span className="level-badge" title="A: dato directo · B: calculado · C: no disponible">
              Nivel {column.level}
            </span>
          </div>
          <p className="max-w-[60ch] text-sm leading-relaxed">{column.description}</p>
          {column.formula ? (
            <p className="text-sm text-muted">
              Fórmula: <span className="font-semibold text-fg">{column.formula}</span>
            </p>
          ) : null}
          <p className="text-sm text-muted">
            Unidad: {per90 && column.per90 ? `${column.unit} cada 90 minutos` : column.unit}
          </p>
          {current ? (
            <div className="mt-2 flex flex-wrap items-end gap-x-6 gap-y-2">
              <p className="text-4xl font-extrabold tabular">
                {currentValue === null ? (
                  <span className="text-muted">{NOT_AVAILABLE}</span>
                ) : (
                  <AnimatedNumber value={currentValue} format={(v) => display(v, per90, column)} />
                )}
              </p>
              {standing ? (
                <p className="pb-1 text-sm text-muted">
                  <span className="font-bold text-fg">{standing.rank}.º</span> de {squadValues.length} en el plantel ·
                  percentil <span className="font-bold text-fg">{standing.percentile}</span>
                </p>
              ) : null}
            </div>
          ) : null}
          <p className="text-xs text-muted">Fuente: Promiedos (alineaciones y eventos), cálculo propio.</p>
        </section>
      </div>

      {/* Controles de la tabla. */}
      <div className="flex flex-wrap items-center gap-3">
        <div role="group" aria-label="Filtrar por posición" className="flex flex-wrap gap-2">
          {POSITIONS.map((p) => (
            <button
              key={p}
              type="button"
              className="chip focus-ring"
              aria-current={position === p}
              onClick={() => {
                setPosition(p);
              }}
            >
              {p}
            </button>
          ))}
        </div>
        <label className="chip focus-ring ml-auto cursor-text" htmlFor="buscar-jugador">
          <MagnifyingGlassIcon size={16} aria-hidden="true" />
          <span className="sr-only">Buscar jugador</span>
          <input
            id="buscar-jugador"
            type="search"
            placeholder="Buscar jugador"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
            }}
            className="w-36 bg-transparent text-fg outline-none placeholder:text-muted"
          />
        </label>
        <button
          type="button"
          className="chip focus-ring"
          aria-pressed={per90}
          aria-current={per90}
          onClick={() => {
            setPer90((v) => !v);
          }}
        >
          Cada 90 minutos
        </button>
      </div>

      <div className="data-table-wrap">
        <table className="data-table tabular" role="grid" aria-readonly="true" onKeyDown={onKeyDown}>
          <caption className="sr-only">
            Resumen del plantel, {competitionName}. Flechas arriba y abajo cambian el jugador; izquierda y derecha, la
            estadística.
          </caption>
          <thead>
            <tr>
              <th scope="col">Jugador</th>
              {SUMMARY_COLUMNS.map((c) => {
                const sorted = sort.key === c.key;
                return (
                  <th
                    key={c.key}
                    scope="col"
                    title={c.name}
                    data-current-stat={c.key === statKey || undefined}
                    aria-sort={sorted ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
                  >
                    <button
                      type="button"
                      className="sort-button focus-ring"
                      onClick={() => {
                        onHeaderClick(c.key);
                      }}
                    >
                      {c.short}
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
            ref={tableRef}
            onMouseLeave={() => {
              setPreviewId(null);
            }}
          >
            {visible.map((p, i) => {
              const selected = p.playerId === selectedId;
              return (
                <motion.tr
                  key={p.playerId}
                  layout="position"
                  transition={ROW_LAYOUT}
                  className="row-enter"
                  style={{ '--i': Math.min(i, 24) } as React.CSSProperties}
                  aria-selected={selected}
                  data-player={p.playerId}
                  tabIndex={selected ? 0 : -1}
                  onClick={() => {
                    setSelectedId(p.playerId);
                  }}
                  onMouseEnter={() => {
                    setPreviewId(p.playerId);
                  }}
                  onFocus={() => {
                    setSelectedId(p.playerId);
                  }}
                >
                  <th scope="row" className="font-semibold">
                    <span className="flex items-center gap-2">
                      <span className="w-6 text-right text-xs text-muted">{p.shirtNumber ?? ''}</span>
                      {p.name}
                    </span>
                  </th>
                  {SUMMARY_COLUMNS.map((c) => {
                    const v = columnValue(p, c, per90);
                    return (
                      <td key={c.key} data-current-stat={c.key === statKey || undefined}>
                        {v === null ? (
                          <span className="text-muted" title="No disponible en las fuentes gratuitas">
                            {NOT_AVAILABLE}
                          </span>
                        ) : (
                          display(v, per90, c)
                        )}
                      </td>
                    );
                  })}
                </motion.tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr>
              <td>Promedio del plantel</td>
              {SUMMARY_COLUMNS.map((c) => (
                <td key={c.key}>{formatNumber(average(c), 1)}</td>
              ))}
            </tr>
          </tfoot>
        </table>
      </div>
      <p className="flex items-center gap-2 text-xs text-muted">
        <InfoIcon size={14} aria-hidden="true" />
        Minutos sin contar el descuento. Partidos oficiales de 2026 (sin amistosos). Fuente: Promiedos; cálculo propio.
      </p>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>
        <AnimatedNumber value={value} format={(v) => formatNumber(Math.round(v))} />
      </dd>
    </div>
  );
}

/** Media cancha dibujada en SVG: textura sutil del panel (9.10). */
function PitchTexture() {
  return (
    <svg className="pitch-texture" viewBox="0 0 400 260" preserveAspectRatio="xMaxYMid slice" aria-hidden="true">
      <g fill="none" stroke="currentColor" strokeWidth="2">
        <rect x="8" y="8" width="384" height="244" />
        <circle cx="400" cy="130" r="56" />
        <rect x="8" y="62" width="70" height="136" />
        <rect x="8" y="98" width="24" height="64" />
        <path d="M78 104 A 40 40 0 0 1 78 156" />
      </g>
    </svg>
  );
}
