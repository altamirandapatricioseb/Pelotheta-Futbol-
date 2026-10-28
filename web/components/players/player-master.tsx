'use client';

import { CaretDownIcon, InfoIcon, MagnifyingGlassIcon } from '@phosphor-icons/react';
import { motion } from 'motion/react';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { AnimatedNumber } from '@/components/animated-number';
import { NOT_AVAILABLE } from '@/lib/format';
import {
  formatStat,
  playerValue,
  extremeOf,
  rankAndPercentile,
  type PlayerRow,
  type StatDef,
  type StatSet,
} from '@/lib/stats/catalog';
import { nextSort, type SortState } from '@/lib/stats/sort';
import { StatReading } from '@/components/stats/stat-reading';

const NAME_SORT = '__nombre';
const POSITIONS = ['Todas', 'Arquero', 'Defensor', 'Mediocampista', 'Delantero'] as const;
// Encabezado de la primera columna según el filtro de posición.
const POSITION_HEADER: Record<(typeof POSITIONS)[number], string> = {
  Todas: 'Jugadores',
  Arquero: 'Arqueros',
  Defensor: 'Defensores',
  Mediocampista: 'Mediocampistas',
  Delantero: 'Delanteros',
};
const ROW_LAYOUT = { type: 'spring', stiffness: 520, damping: 44 } as const;
const CUSTOM_SET = 'personalizado';
// Sección 6: por debajo de 900 minutos las métricas propias se muestran con aviso.
const SMALL_SAMPLE_MINUTES = 900;
const GOALKEEPER_SET = 'porteros';
const LEVEL_TEXT = { A: 'dato directo de una fuente', B: 'calculado', C: 'no disponible en fuentes gratuitas' };
// Métricas propias que se muestran en la ficha si existen (9.1 y 6.1).
const CARD_METRICS = [
  'calificacion',
  'nr',
  'ewa',
  'ela',
  'mejoria_alpha',
  'mejoria_beta',
  'potencial_alpha',
  'potencial_beta',
];

interface PlayerMasterProps {
  players: PlayerRow[];
  catalog: StatDef[];
  sets: StatSet[];
  competitionName: string;
  initialPlayerId: number | null;
  initialStat: string | null;
  initialSet: string | null;
}

function initials(name: string): string {
  const parts = name.split(' ').filter(Boolean);
  return `${parts[0]?.[0] ?? ''}${parts.length > 1 ? (parts.at(-1)?.[0] ?? '') : ''}`.toUpperCase();
}

const numeric = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/**
 * Interfaz 3 (9.1): tabla maestra del plantel. Panel alto con la ficha del jugador actual y la
 * descripción de la estadística actual; debajo, una tabla por vez según el conjunto elegido en
 * el desplegable. Las columnas, descripciones y fórmulas salen del catálogo de la base.
 */
export function PlayerMasterView({
  players,
  catalog,
  sets,
  competitionName,
  initialPlayerId,
  initialStat,
  initialSet,
}: PlayerMasterProps) {
  const byId = useMemo(() => new Map(catalog.map((s) => [s.id, s])), [catalog]);
  const [setId, setSetId] = useState(
    initialSet === CUSTOM_SET || sets.some((s) => s.id === initialSet) ? (initialSet ?? '') : (sets[0]?.id ?? ''),
  );
  const [custom, setCustom] = useState<string[]>(() => sets[0]?.statIds ?? []);
  const columns = useMemo(() => {
    const ids = setId === CUSTOM_SET ? custom : (sets.find((s) => s.id === setId)?.statIds ?? []);
    return ids.flatMap((id) => {
      const s = byId.get(id);
      return s ? [s] : [];
    });
  }, [setId, custom, sets, byId]);

  const [per90, setPer90] = useState(false);
  const [showPct, setShowPct] = useState(true);
  const [position, setPosition] = useState<(typeof POSITIONS)[number]>('Todas');
  const [minMinutes, setMinMinutes] = useState(0);
  const [query, setQuery] = useState('');
  const [statId, setStatId] = useState<string>(
    columns.some((c) => c.id === initialStat) ? (initialStat ?? '') : (columns[0]?.id ?? ''),
  );
  const [sort, setSort] = useState<SortState | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(
    players.some((p) => p.playerId === initialPlayerId) ? initialPlayerId : (players[0]?.playerId ?? null),
  );
  const [previewId, setPreviewId] = useState<number | null>(null);
  const tableRef = useRef<HTMLTableSectionElement>(null);

  // Si cambia el conjunto y la estadística actual no está, pasa a la primera columna.
  const column = columns.find((c) => c.id === statId) ?? columns[0];

  const visible = useMemo(() => {
    const q = query.trim().toLocaleLowerCase('es-AR');
    // Los arqueros tienen su propia tabla y no se mezclan con los jugadores de campo (9.1).
    const goalkeepers = setId === GOALKEEPER_SET;
    const filtered = players
      .filter((p) => (goalkeepers ? p.position === 'Arquero' : position === 'Todas' || p.position === position))
      .filter((p) => p.minutes >= minMinutes)
      .filter((p) => !q || p.name.toLocaleLowerCase('es-AR').includes(q));
    // Sin orden elegido: el original de la base (de más a menos minutos).
    if (!sort) return filtered;
    const sortStat = byId.get(sort.id);
    return filtered.toSorted((a, b) => {
      const va = sort.id === NAME_SORT ? a.name : sortStat ? playerValue(a, sortStat, per90) : a.minutes;
      const vb = sort.id === NAME_SORT ? b.name : sortStat ? playerValue(b, sortStat, per90) : b.minutes;
      // `n/d` siempre al final, sin importar el sentido del orden (9.10).
      if (va === null || vb === null) return va === vb ? 0 : va === null ? 1 : -1;
      const cmp = numeric(va) && numeric(vb) ? va - vb : String(va).localeCompare(String(vb), 'es');
      return sort.dir === 'asc' ? cmp : -cmp;
    });
  }, [players, position, minMinutes, query, sort, per90, setId, byId]);

  // Si el jugador elegido no está en la tabla visible (por ejemplo, un defensor en Porteros),
  // el panel muestra al primero de la tabla.
  const current = visible.find((p) => p.playerId === (previewId ?? selectedId)) ?? visible[0] ?? null;

  // El estado vive en la URL para poder compartir la vista exacta (9.1).
  useEffect(() => {
    const url = new URL(window.location.href);
    if (selectedId !== null) url.searchParams.set('jugador', String(selectedId));
    if (column) url.searchParams.set('estadistica', column.id);
    url.searchParams.set('conjunto', setId);
    window.history.replaceState(null, '', url);
  }, [selectedId, column, setId]);

  const valuesOf = useCallback(
    (stat: StatDef) => visible.map((p) => playerValue(p, stat, per90)).filter(numeric),
    [visible, per90],
  );
  const currentValue = current && column ? playerValue(current, column, per90) : null;
  const standing =
    column && numeric(currentValue) ? rankAndPercentile(valuesOf(column), currentValue, column.higherIsBetter) : null;
  // Mejor o peor del plantel visible: el valor del panel cambia de color y lleva una etiqueta.
  const extreme =
    column && numeric(currentValue) ? extremeOf(valuesOf(column), currentValue, column.higherIsBetter) : null;

  // Primer clic: elige la estadística (se lee su definición); los siguientes ordenan de menor a
  // mayor, de mayor a menor y vuelven al orden original (lib/stats/sort.ts).
  const onHeaderClick = (id: string) => {
    const next = nextSort(sort, id, column?.id ?? null);
    setStatId(next.selected);
    setSort(next.sort);
  };
  const onNameHeaderClick = () => {
    setSort(nextSort(sort, NAME_SORT, NAME_SORT).sort);
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

  const router = useRouter();
  const openDetail = (statId: string, playerId: number) => {
    router.push(`/estadistica/${statId}?entidad=jugador&id=${String(playerId)}`);
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    const colIndex = columns.findIndex((c) => c.id === column?.id);
    const keyActions: Record<string, () => void> = {
      ArrowDown: () => {
        moveSelection(1);
      },
      ArrowUp: () => {
        moveSelection(-1);
      },
      ArrowRight: () => {
        setStatId((columns[colIndex + 1] ?? column)?.id ?? '');
      },
      ArrowLeft: () => {
        setStatId((columns[colIndex - 1] ?? column)?.id ?? '');
      },
    };
    if ((event.key === 'd' || event.key === 'D') && column && selectedId !== null) {
      event.preventDefault();
      openDetail(column.id, selectedId);
      return;
    }
    const action = keyActions[event.key];
    if (action) {
      event.preventDefault();
      action();
    }
  };

  const average = (stat: StatDef) => {
    const values = valuesOf(stat);
    return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
  };

  // Percentil de cada celda en el grupo visible, para la mini barra (se puede apagar).
  const percentileOf = (stat: StatDef, value: number) => rankAndPercentile(valuesOf(stat), value, stat.higherIsBetter);

  // En Personalizado, los encabezados se agrupan en bandas por grupo temático (9.1).
  const bands = useMemo(() => {
    if (setId !== CUSTOM_SET) return [];
    const out: { group: string; span: number }[] = [];
    for (const c of columns) {
      const last = out.at(-1);
      if (last?.group === c.group) last.span += 1;
      else out.push({ group: c.group, span: 1 });
    }
    return out;
  }, [setId, columns]);

  const activeSet = sets.find((s) => s.id === setId);

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
                    {[
                      current.age !== null ? `${String(current.age)} años` : 'Edad n/d',
                      current.heightCm !== null ? `${(current.heightCm / 100).toFixed(2).replace('.', ',')} m` : null,
                      current.weightKg !== null ? `${String(Math.round(current.weightKg))} kg` : null,
                      current.foot ? `pie ${current.foot === 'L' ? 'izquierdo' : 'derecho'}` : null,
                      current.nationality,
                      competitionName,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </p>
                </div>
              </div>
              <dl className="fact-grid">
                <Fact label="Partidos" value={current.matches} />
                <Fact label="Minutos" value={current.minutes} />
                {CARD_METRICS.flatMap((id) => {
                  const stat = byId.get(id);
                  const value = stat ? playerValue(current, stat, false) : null;
                  return stat && value !== null ? (
                    <div key={id}>
                      <dt title={stat.name}>{stat.short}</dt>
                      <dd>{formatStat(value, stat, false)}</dd>
                    </div>
                  ) : (
                    []
                  );
                })}
              </dl>
              {current.minutes < SMALL_SAMPLE_MINUTES ? (
                <p className="text-xs text-warn">
                  Muestra pequeña: menos de {SMALL_SAMPLE_MINUTES} minutos. NR, EWA, ELA, Mejoría y Potencial se leen
                  con cautela.
                </p>
              ) : null}
            </div>
          ) : (
            <p className="relative text-muted">No hay jugadores con estos filtros.</p>
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
            <p className="text-xs font-semibold text-muted">{column.group}</p>
            <p className="max-w-[60ch] text-sm leading-relaxed">{column.description}</p>
            <StatReading text={column.reading} />
            {column.formula && column.rule !== 'suma' ? (
              <p className="text-sm text-muted">
                Fórmula: <span className="font-semibold text-fg">{column.formula}</span>
              </p>
            ) : null}
            <p className="text-sm text-muted">
              Unidad: {per90 && column.per90 ? `${column.unit} cada 90 minutos` : column.unit}
            </p>
            {current ? (
              <div className="mt-2 flex flex-wrap items-end gap-x-6 gap-y-2">
                <p
                  className={`text-4xl font-extrabold tabular${extreme === 'best' ? ' value-best' : extreme === 'worst' ? ' value-worst' : ''}`}
                >
                  {numeric(currentValue) ? (
                    <AnimatedNumber value={currentValue} format={(v) => formatStat(v, column, per90)} />
                  ) : currentValue !== null ? (
                    currentValue
                  ) : (
                    <span className="text-muted">{NOT_AVAILABLE}</span>
                  )}
                </p>
                {standing ? (
                  <p className="pb-1 text-sm text-muted">
                    <span className="font-bold text-fg">{standing.rank}.º</span> de {valuesOf(column).length} en el
                    plantel · percentil <span className="font-bold text-fg">{standing.percentile}</span>
                  </p>
                ) : null}
                {extreme ? (
                  <p className={`mb-1 rank-flag ${extreme === 'best' ? 'value-best' : 'value-worst'}`}>
                    {extreme === 'best' ? 'Mejor del plantel' : 'Peor del plantel'}
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

      {/* Controles de la tabla. */}
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
            <option value={CUSTOM_SET}>Personalizado</option>
          </select>
        </label>
        {setId === GOALKEEPER_SET ? (
          <span className="text-sm text-muted">Solo arqueros</span>
        ) : (
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
        )}
        <label className="chip focus-ring cursor-text" htmlFor="minimo-minutos">
          <span>Mín. minutos</span>
          <input
            id="minimo-minutos"
            type="number"
            min={0}
            step={90}
            value={minMinutes}
            onChange={(e) => {
              setMinMinutes(Math.max(0, Number(e.target.value) || 0));
            }}
            className="w-16 bg-transparent text-fg outline-none tabular"
          />
        </label>
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
        <button
          type="button"
          className="chip focus-ring"
          aria-pressed={showPct}
          aria-current={showPct}
          onClick={() => {
            setShowPct((v) => !v);
          }}
        >
          Barras de percentil
        </button>
      </div>

      {activeSet ? <p className="-mt-3 text-sm text-muted">{activeSet.description}</p> : null}

      {setId === CUSTOM_SET ? (
        <CustomPicker
          catalog={catalog}
          selected={custom}
          onChange={(ids) => {
            setCustom(ids);
          }}
        />
      ) : null}

      <div className="data-table-wrap">
        <table
          className={`data-table tabular${bands.length ? ' has-bands' : ''}`}
          role="grid"
          aria-readonly="true"
          onKeyDown={onKeyDown}
          onDoubleClick={(e) => {
            // Doble clic en una celda: la estadística desglosada de ese jugador (9.8).
            const cell = (e.target as HTMLElement).closest<HTMLElement>('td[data-stat]');
            const row = cell?.closest<HTMLElement>('tr[data-player]');
            if (cell?.dataset.stat && row?.dataset.player) openDetail(cell.dataset.stat, Number(row.dataset.player));
          }}
        >
          <caption className="sr-only">
            {activeSet?.name ?? 'Personalizado'}, {competitionName}. Doble clic en una celda o la tecla D abre la
            estadística desglosada. Flechas arriba y abajo cambian el jugador; izquierda y derecha, la estadística.
          </caption>
          <thead>
            {bands.length ? (
              <tr className="band-row">
                <th scope="colgroup" />
                {bands.map((b, i) => (
                  <th key={`${b.group}-${String(i)}`} scope="colgroup" colSpan={b.span}>
                    {b.group}
                  </th>
                ))}
              </tr>
            ) : null}
            <tr>
              <th
                scope="col"
                aria-sort={sort?.id === NAME_SORT ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
              >
                <button type="button" className="sort-button focus-ring" onClick={onNameHeaderClick}>
                  {POSITION_HEADER[position]}
                  {sort?.id === NAME_SORT ? (
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
                  {columns.map((c) => {
                    const v = playerValue(p, c, per90);
                    const pct = showPct && numeric(v) ? percentileOf(c, v).percentile : null;
                    return (
                      <td
                        key={c.id}
                        data-stat={c.id}
                        data-current-stat={c.id === column?.id || undefined}
                        className={pct !== null ? 'pct-cell' : undefined}
                        style={pct !== null ? ({ '--pct': `${String(pct)}%` } as React.CSSProperties) : undefined}
                      >
                        {v === null ? (
                          <span className="text-muted" title="No disponible en las fuentes gratuitas">
                            {NOT_AVAILABLE}
                          </span>
                        ) : (
                          formatStat(v, c, per90)
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
              {columns.map((c) => (
                <td key={c.id}>{formatStat(average(c), { ...c, unit: c.unit === '%' ? '%' : 'promedio' }, per90)}</td>
              ))}
            </tr>
          </tfoot>
        </table>
      </div>
      <p className="flex items-center gap-2 text-xs text-muted">
        <InfoIcon size={14} aria-hidden="true" />
        Minutos sin contar el descuento. Partidos oficiales de 2026. * = estimada (calculada con un supuesto). n/d = no
        disponible en las fuentes gratuitas.
      </p>
    </div>
  );
}

function CustomPicker({
  catalog,
  selected,
  onChange,
}: {
  catalog: StatDef[];
  selected: string[];
  onChange: (ids: string[]) => void;
}) {
  const groups = useMemo(() => {
    const map = new Map<string, StatDef[]>();
    for (const s of catalog) map.set(s.group, [...(map.get(s.group) ?? []), s]);
    return [...map.entries()];
  }, [catalog]);
  return (
    <div className="custom-picker">
      {groups.map(([group, stats]) => (
        <fieldset key={group}>
          <legend className="mb-1 font-bold">{group}</legend>
          {stats.map((s) => (
            <label key={s.id} className="flex items-center gap-2 py-0.5">
              <input
                type="checkbox"
                checked={selected.includes(s.id)}
                onChange={(e) => {
                  onChange(e.target.checked ? [...selected, s.id] : selected.filter((id) => id !== s.id));
                }}
              />
              <span>{s.name}</span>
            </label>
          ))}
        </fieldset>
      ))}
    </div>
  );
}

function Fact({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>
        <AnimatedNumber value={value} format={(v) => new Intl.NumberFormat('es-AR').format(Math.round(v))} />
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
