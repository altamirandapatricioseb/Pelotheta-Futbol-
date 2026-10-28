'use client';

import {
  CaretDownIcon,
  FileXlsIcon,
  ImageIcon,
  MagnifyingGlassIcon,
  PlusIcon,
  WarningCircleIcon,
  XIcon,
} from '@phosphor-icons/react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState, useTransition } from 'react';

import { download, downloadPng } from '@/components/charts/chart-card';
import { LineChart, Radar } from '@/components/charts/primitives';
import {
  comparableStats,
  compareStat,
  isGoalkeeper,
  lineOf,
  MAX_REFS,
  PERIODS,
  referenceLabel,
  referenceMembers,
  referencePerMatch,
  referencePool,
  refProblem,
  refsToParam,
  sameRef,
  SECTIONS,
  sectionOf,
  strengths,
  summarize,
  type AverageMode,
  type Period,
  type PlayerPosition,
  type RefKind,
  type RefSpec,
  type StatComparison,
} from '@/lib/compare/compare';
import type { ComparePoint } from '@/lib/data/compare';
import type { CompetitionOption } from '@/lib/data/players';
import { buildXlsx, type Cell } from '@/lib/export/xlsx';
import { formatStat, type PlayerRow, type StatDef } from '@/lib/stats/catalog';

import { REF_SLOTS } from './compare-charts';
import { CompareSection, diffText, pctText } from './compare-section';

export interface CompareState {
  mainId: number;
  refs: RefSpec[];
  period: Period;
  competition: string;
  per90: boolean;
  minMinutes: number;
  mode: AverageMode;
  serie: string;
}

interface CompareViewProps {
  players: PlayerRow[];
  catalog: StatDef[];
  positions: PlayerPosition[];
  competitions: CompetitionOption[];
  initial: CompareState;
  series: { playerId: number; statId: string; points: ComparePoint[] } | null;
}

const POSITION_FILTERS = ['Todas', 'Arquero', 'Defensor', 'Mediocampista', 'Delantero'] as const;
const POSITION_PLURAL: Record<(typeof POSITION_FILTERS)[number], string> = {
  Todas: 'Todas',
  Arquero: 'Arqueros',
  Defensor: 'Defensores',
  Mediocampista: 'Mediocampistas',
  Delantero: 'Delanteros',
};
// Muestra pequeña (9.1): menos de 900 minutos en la temporada; en períodos cortos, menos de 270.
const smallSample = (period: Period) => (period === 'temporada' ? 900 : 270);
const SMALL_GROUP = 3;

const name = (p: PlayerRow) => p.shortName ?? p.name;
const day = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

function queryOf(s: CompareState): string {
  const q = new URLSearchParams();
  q.set('jugador', String(s.mainId));
  q.set('refs', refsToParam(s.refs));
  if (s.period !== 'temporada') q.set('periodo', s.period);
  if (s.period === 'temporada' && s.competition !== 'todas') q.set('comp', s.competition);
  q.set('modo', s.per90 ? 'por90' : 'totales');
  q.set('min', String(s.minMinutes));
  q.set('prom', s.mode);
  q.set('serie', s.serie);
  return q.toString();
}

/**
 * Interfaz 5 (9.7): un jugador contra 1 a 3 referencias. Los controles que cambian los datos de
 * la base (jugador, período, competición y estadística partido a partido) navegan; los demás se
 * resuelven en el navegador y solo actualizan la URL. Todo el estado queda en la URL.
 */
export function CompareView({ players, catalog, positions, competitions, initial, series }: CompareViewProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [mainId, setMainId] = useState(initial.mainId);
  const [refs, setRefs] = useState<RefSpec[]>(initial.refs);
  const [per90, setPer90] = useState(initial.per90);
  const [minMinutes, setMinMinutes] = useState(initial.minMinutes);
  const [mode, setMode] = useState<AverageMode>(initial.mode);
  const [positionFilter, setPositionFilter] = useState<(typeof POSITION_FILTERS)[number]>('Todas');
  const [query, setQuery] = useState('');
  const [pickingPlayer, setPickingPlayer] = useState(false);
  const [summaryRef, setSummaryRef] = useState(0);
  const radarRef = useRef<HTMLDivElement>(null);
  const pickerRef = useRef<HTMLSelectElement>(null);
  // Barra fija: cuando queda pegada arriba se achica (jugador y referencias) y el resto se abre a pedido.
  const sentinelRef = useRef<HTMLDivElement>(null);
  const [stuck, setStuck] = useState(false);
  const [expanded, setExpanded] = useState(false);
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        const isStuck = entry ? !entry.isIntersecting && entry.boundingClientRect.top < 0 : false;
        setStuck(isStuck);
        if (!isStuck) setExpanded(false);
      },
      { rootMargin: '-72px 0px 0px 0px' },
    );
    observer.observe(el);
    return () => {
      observer.disconnect();
    };
  }, []);
  // Al elegir «Otro jugador…», el foco pasa a la lista de jugadores.
  useEffect(() => {
    if (pickingPlayer) pickerRef.current?.focus();
  }, [pickingPlayer]);

  const positionsById = useMemo(() => new Map(positions.map((p) => [p.playerId, p])), [positions]);
  const main = players.find((p) => p.playerId === mainId) ?? players[0];
  const state: CompareState = {
    mainId: main?.playerId ?? initial.mainId,
    refs,
    period: initial.period,
    competition: initial.competition,
    per90,
    minMinutes,
    mode,
    serie: initial.serie,
  };
  const url = (over: Partial<CompareState>) => `/comparar?${queryOf({ ...state, ...over })}`;
  // Lo que se resuelve en el navegador solo reescribe la URL; lo que pide datos navega.
  const rewrite = (over: Partial<CompareState>) => {
    window.history.replaceState(null, '', url(over));
  };
  const navigate = (over: Partial<CompareState>) => {
    startTransition(() => {
      router.replace(url(over), { scroll: false });
    });
  };

  const model = useMemo(() => {
    if (!main) return null;
    const mine = positionsById.get(main.playerId);
    const keeper = isGoalkeeper(main, mine);
    const pool = referencePool(players, main, positionsById, minMinutes);
    const dropped: string[] = [];
    const valid = refs.filter((r) => {
      const problem = refProblem(r, main, positionsById, players);
      if (problem) dropped.push(`${referenceLabel(r, mine, players).long}: ${problem}`);
      return problem === null;
    });
    const groups = valid.map((r) => referenceMembers(r, main, pool, positionsById, players));
    const labels = valid.map((r) => ({ ...referenceLabel(r, mine, players), player: r.kind === 'jugador' }));
    const stats = comparableStats(catalog, keeper);
    const rows = stats.map((s) => compareStat(s, main, groups, pool, per90, mode));
    return { mine, keeper, pool, valid, dropped, groups, labels, stats, rows };
  }, [main, positionsById, players, minMinutes, refs, catalog, per90, mode]);

  if (!main || !model) return null;
  const { mine, keeper, pool, valid, dropped, groups, labels, rows } = model;

  const detailHref = (statId: string) =>
    `/estadistica/${statId}?entidad=jugador&id=${String(main.playerId)}&ref=${refsToParam(valid)}&min=${String(minMinutes)}&prom=${mode}&volver=${encodeURIComponent(url({}))}`;
  const openDetail = (statId: string) => {
    router.push(detailHref(statId));
  };

  const setRefList = (next: RefSpec[]) => {
    setRefs(next);
    setSummaryRef((i) => Math.min(i, Math.max(0, next.length - 1)));
    rewrite({ refs: next });
  };
  const addRef = (spec: RefSpec) => {
    if (refs.length >= MAX_REFS || refs.some((r) => sameRef(r, spec))) return;
    setRefList([...refs, spec]);
  };

  // Selector del jugador principal: filtro por posición y búsqueda por nombre.
  const q = query.trim().toLocaleLowerCase('es-AR');
  const choices = players.filter(
    (p) =>
      p.playerId === main.playerId ||
      ((positionFilter === 'Todas' || lineOf(p, positionsById.get(p.playerId)) === positionFilter) &&
        (!q || p.name.toLocaleLowerCase('es-AR').includes(q))),
  );
  const sameType = players.filter(
    (p) =>
      p.playerId !== main.playerId &&
      isGoalkeeper(p, positionsById.get(p.playerId)) === keeper &&
      !refs.some((r) => r.kind === 'jugador' && r.playerId === p.playerId),
  );
  const options: { kind: RefKind; label: string }[] = [
    { kind: 'plantel' as const, label: 'Media del plantel' },
    ...(mine?.zone ? [{ kind: 'zona' as const, label: `Media de la zona (${mine.zone})` }] : []),
    ...(mine?.zone && mine.lane
      ? [{ kind: 'carril' as const, label: referenceLabel({ kind: 'carril' }, mine, players).long }]
      : []),
    ...(mine?.role ? [{ kind: 'posicion' as const, label: `Media de la posición (${mine.role})` }] : []),
  ].filter((o) => !refs.some((r) => r.kind === o.kind));

  const small = main.minutes < smallSample(initial.period);
  const periodLabel = PERIODS.find((p) => p.id === initial.period)?.label ?? 'Temporada';
  const competitionLabel =
    initial.period !== 'temporada'
      ? 'todas las competiciones'
      : initial.competition === 'todas'
        ? 'todas las competiciones'
        : (competitions.find((c) => c.code === initial.competition)?.name ?? initial.competition);

  const sections = SECTIONS.filter((s) => keeper || !s.goalkeepersOnly).flatMap((s) => {
    const list = rows.filter((r) => sectionOf(r.stat)?.id === s.id);
    return list.length ? [{ section: s, rows: list }] : [];
  });

  // Radar del resumen: percentil medio de cada categoría (3 a 8 ejes).
  const radarSections = sections
    .map(({ section, rows: list }) => {
      const mean = (vals: (number | null)[]) => {
        const nums = vals.filter((v): v is number => v !== null);
        return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : null;
      };
      return {
        section,
        count: list.filter((r) => r.percentile !== null).length,
        player: mean(list.map((r) => r.percentile)),
        refs: labels.map((_, k) => mean(list.map((r) => (r.missing ? null : (r.refs[k]?.percentile ?? null))))),
      };
    })
    .filter((s) => s.player !== null)
    .sort((a, b) => b.count - a.count)
    .slice(0, 8)
    .sort((a, b) => SECTIONS.indexOf(a.section) - SECTIONS.indexOf(b.section));

  const top = strengths(rows, summaryRef, 5);
  const serieStat = catalog.find((s) => s.id === initial.serie);
  const seriesReady = series !== null && series.playerId === main.playerId && series.statId === initial.serie;
  const points = seriesReady ? series.points : [];

  const exportExcel = () => {
    const sheet: Cell[][] = [
      ['Comparación', null],
      ['Jugador', main.name],
      ['Período', `${periodLabel} (${competitionLabel})`],
      ['Valores', per90 ? 'Cada 90 minutos (los porcentajes y promedios, tal cual)' : 'Totales'],
      ['Promedio de las referencias', mode === 'ponderado' ? 'Ponderado por minutos' : 'Simple'],
      ['Mínimo de minutos', minMinutes],
      ...labels.map((l, k): Cell[] => [
        `Referencia ${String(k + 1)}`,
        `${l.long} (${String(groups[k]?.length ?? 0)} jugadores)`,
      ]),
    ];
    const bold = [0];
    for (const { section, rows: list } of sections) {
      sheet.push([]);
      bold.push(sheet.length);
      sheet.push([section.name]);
      bold.push(sheet.length);
      sheet.push([
        'Estadística',
        name(main),
        ...labels.flatMap((l) => [l.short, `Dif. vs ${l.short}`, `Dif. % vs ${l.short}`]),
        'Percentil',
      ]);
      for (const r of list) {
        sheet.push([
          r.stat.name,
          r.player,
          ...r.refs.flatMap((c): Cell[] => [
            c.value,
            c.diff,
            c.diffPct === null ? null : Math.round(c.diffPct * 10) / 10,
          ]),
          r.percentile,
        ]);
      }
    }
    const bytes = buildXlsx([{ name: 'Comparación', rows: sheet, boldRows: bold }]);
    download(
      new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
      `pelotheta-comparacion-${String(main.playerId)}.xlsx`,
    );
  };

  return (
    <div className="grid gap-6" aria-busy={pending}>
      {/* Controles: barra fija arriba de la interfaz (9.7). */}
      <div ref={sentinelRef} aria-hidden="true" className="-mb-6 h-px" />
      <div
        className={`cmp-bar${stuck ? ' cmp-bar--stuck' : ''}${expanded ? ' cmp-bar--open' : ''}`}
        role="region"
        aria-label="Controles de la comparación"
      >
        <button
          type="button"
          className="cmp-bar__toggle chip focus-ring"
          aria-expanded={expanded}
          onClick={() => {
            setExpanded((v) => !v);
          }}
        >
          Período y filtros
          <CaretDownIcon size={14} aria-hidden="true" className={expanded ? 'rotate-180' : undefined} />
        </button>
        <div className="cmp-bar__row">
          <fieldset className="cmp-field">
            <legend>Jugador principal</legend>
            <div className="flex flex-wrap items-center gap-2">
              <select
                aria-label="Filtrar jugadores por posición"
                className="select focus-ring"
                value={positionFilter}
                onChange={(e) => {
                  setPositionFilter(e.target.value as (typeof POSITION_FILTERS)[number]);
                }}
              >
                {POSITION_FILTERS.map((p) => (
                  <option key={p} value={p}>
                    {POSITION_PLURAL[p]}
                  </option>
                ))}
              </select>
              <label className="chip focus-ring cursor-text" htmlFor="cmp-buscar">
                <MagnifyingGlassIcon size={16} aria-hidden="true" />
                <span className="sr-only">Buscar jugador</span>
                <input
                  id="cmp-buscar"
                  type="search"
                  placeholder="Buscar"
                  value={query}
                  onChange={(e) => {
                    setQuery(e.target.value);
                  }}
                  className="w-24 bg-transparent text-fg outline-none"
                />
              </label>
              <select
                aria-label="Jugador principal"
                className="select focus-ring min-w-0 flex-1 basis-56"
                value={main.playerId}
                onChange={(e) => {
                  const id = Number(e.target.value);
                  setMainId(id);
                  navigate({ mainId: id });
                }}
              >
                {choices.map((p) => (
                  <option key={p.playerId} value={p.playerId}>
                    {p.name} · {lineOf(p, positionsById.get(p.playerId)) ?? 'n/d'} · {p.minutes} min
                  </option>
                ))}
              </select>
            </div>
          </fieldset>

          <fieldset className="cmp-field">
            <legend>Referencias (hasta {MAX_REFS})</legend>
            <ul className="flex flex-wrap items-center gap-2">
              {refs.map((r, k) => {
                const label = referenceLabel(r, mine, players);
                const used = valid.indexOf(r);
                // Etiqueta corta en la barra; el nombre completo va en la ficha y en el título.
                const tag =
                  r.kind === 'plantel'
                    ? 'Plantel'
                    : r.kind === 'zona'
                      ? `Zona: ${label.short}`
                      : r.kind === 'posicion'
                        ? `Posición: ${label.short}`
                        : label.short;
                return (
                  <li key={refsToParam([r])} className={`cmp-tag${used < 0 ? ' cmp-tag--off' : ''}`}>
                    <span
                      className="chart-key chart-key--box"
                      style={{
                        background: used < 0 ? 'var(--color-border)' : `var(--series-${String(REF_SLOTS[used] ?? 3)})`,
                      }}
                      aria-hidden="true"
                    />
                    <span title={label.long}>{tag}</span>
                    <button
                      type="button"
                      className="cmp-tag__remove focus-ring"
                      aria-label={`Quitar ${label.long}`}
                      disabled={refs.length === 1}
                      onClick={() => {
                        setRefList(refs.filter((_, i) => i !== k));
                      }}
                    >
                      <XIcon size={14} aria-hidden="true" />
                    </button>
                  </li>
                );
              })}
              {refs.length < MAX_REFS ? (
                <li>
                  {pickingPlayer ? (
                    <select
                      ref={pickerRef}
                      aria-label="Elegir otro jugador como referencia"
                      className="select focus-ring max-w-72"
                      value=""
                      onChange={(e) => {
                        if (e.target.value) addRef({ kind: 'jugador', playerId: Number(e.target.value) });
                        setPickingPlayer(false);
                      }}
                      onBlur={() => {
                        setPickingPlayer(false);
                      }}
                    >
                      <option value="">Elegí un jugador…</option>
                      {sameType.map((p) => (
                        <option key={p.playerId} value={p.playerId}>
                          {p.name} · {lineOf(p, positionsById.get(p.playerId)) ?? 'n/d'} · {p.minutes} min
                        </option>
                      ))}
                    </select>
                  ) : (
                    <label className="cmp-add">
                      <PlusIcon size={14} aria-hidden="true" />
                      <span className="sr-only">Agregar referencia</span>
                      <select
                        aria-label="Agregar referencia"
                        className="select focus-ring max-w-56"
                        value=""
                        onChange={(e) => {
                          const v = e.target.value;
                          if (v === 'jugador') setPickingPlayer(true);
                          else if (v) addRef({ kind: v as RefKind });
                        }}
                      >
                        <option value="">Agregar referencia</option>
                        {options.map((o) => (
                          <option key={o.kind} value={o.kind}>
                            {o.label}
                          </option>
                        ))}
                        <option value="jugador">Otro jugador…</option>
                        <option value="liga" disabled>
                          Liga en su posición (sin datos de otros equipos)
                        </option>
                      </select>
                    </label>
                  )}
                </li>
              ) : null}
            </ul>
          </fieldset>
        </div>

        <div className="cmp-bar__row cmp-bar__row--compact">
          <label className="cmp-inline">
            <span>Período</span>
            <select
              className="select focus-ring"
              value={initial.period}
              onChange={(e) => {
                navigate({ period: e.target.value as Period });
              }}
            >
              {PERIODS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </label>
          <label className="cmp-inline">
            <span>Competición</span>
            <select
              className="select focus-ring max-w-52"
              value={initial.period === 'temporada' ? initial.competition : 'todas'}
              disabled={initial.period !== 'temporada'}
              title={initial.period !== 'temporada' ? 'Los últimos partidos y el último mes son de todas' : undefined}
              onChange={(e) => {
                navigate({ competition: e.target.value });
              }}
            >
              <option value="todas">Todas</option>
              {competitions.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.name.replace('CONMEBOL ', '').replace('Liga Profesional Argentina', 'Liga Profesional')}
                </option>
              ))}
            </select>
          </label>
          <div className="view-switch" role="group" aria-label="Totales o cada 90 minutos">
            {[false, true].map((v) => (
              <button
                key={String(v)}
                type="button"
                className="view-switch__button focus-ring"
                aria-pressed={per90 === v}
                onClick={() => {
                  setPer90(v);
                  rewrite({ per90: v });
                }}
              >
                {v ? 'Por 90' : 'Totales'}
              </button>
            ))}
          </div>
          <label className="chip focus-ring cursor-text" htmlFor="cmp-minimo">
            <span>Mín. minutos</span>
            <input
              id="cmp-minimo"
              type="number"
              min={0}
              step={90}
              value={minMinutes}
              onChange={(e) => {
                const v = Math.max(0, Math.min(6000, Number(e.target.value) || 0));
                setMinMinutes(v);
                rewrite({ minMinutes: v });
              }}
              className="w-12 bg-transparent text-fg outline-none tabular"
            />
          </label>
          <div className="cmp-inline">
            <span id="cmp-promedio" title="Cómo se promedian las referencias">
              Promedio
            </span>
            <div className="view-switch" role="group" aria-labelledby="cmp-promedio">
              {(['simple', 'ponderado'] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  className="view-switch__button focus-ring"
                  aria-pressed={mode === m}
                  onClick={() => {
                    setMode(m);
                    rewrite({ mode: m });
                  }}
                >
                  {m === 'simple' ? 'Simple' : 'Por minutos'}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Ficha del jugador y de las referencias. */}
      <section aria-labelledby="cmp-jugador" className="cmp-head">
        <div className="min-w-0">
          <p className="text-xs font-semibold text-muted">
            {[mine?.role ?? lineOf(main, mine) ?? 'Posición n/d', mine?.zone, mine?.lane ? `carril ${mine.lane}` : null]
              .filter(Boolean)
              .join(' · ')}
          </p>
          <h2 id="cmp-jugador" className="text-2xl font-extrabold tracking-tight">
            {main.name}
          </h2>
          <p className="text-sm text-muted">
            {periodLabel} · {competitionLabel} · {main.matches} partidos · {main.minutes} minutos ·{' '}
            {per90 ? 'cada 90 minutos' : 'totales'} · promedio{' '}
            {mode === 'ponderado' ? 'ponderado por minutos' : 'simple'}
          </p>
        </div>
        <ul className="cmp-ref-list">
          {labels.map((l, k) => {
            const n = groups[k]?.length ?? 0;
            return (
              <li key={l.long}>
                <span
                  className="chart-key chart-key--box"
                  style={{ background: `var(--series-${String(REF_SLOTS[k] ?? 3)})` }}
                  aria-hidden="true"
                />
                <span className="font-semibold">{l.long}</span>
                <span className="text-muted">
                  {valid[k]?.kind === 'jugador'
                    ? `${String(groups[k]?.[0]?.minutes ?? 0)} min`
                    : `${String(n)} jugador${n === 1 ? '' : 'es'}`}
                </span>
                {valid[k]?.kind !== 'jugador' && n < SMALL_GROUP ? (
                  <span className="text-warn text-xs font-semibold">muestra pequeña</span>
                ) : null}
              </li>
            );
          })}
        </ul>
        <div className="grid gap-1 text-xs">
          {small ? (
            <p className="text-warn">
              <WarningCircleIcon size={14} aria-hidden="true" className="mr-1 inline" />
              Muestra pequeña: {main.minutes} minutos en el período (menos de {smallSample(initial.period)}).
            </p>
          ) : null}
          {mine?.level === 'linea' ? (
            <p className="text-warn">
              <WarningCircleIcon size={14} aria-hidden="true" className="mr-1 inline" />
              La fuente solo informa su línea ({mine.positionRaw}): zona y posición coinciden.
            </p>
          ) : null}
          {dropped.map((d) => (
            <p key={d} className="text-warn">
              <WarningCircleIcon size={14} aria-hidden="true" className="mr-1 inline" />
              No se usa {d}.
            </p>
          ))}
          <p className="text-muted">
            {keeper
              ? 'Arquero: se compara solo con arqueros y suma la sección Porteros.'
              : 'Jugador de campo: los arqueros no entran en las medias.'}{' '}
            El jugador nunca entra en su propia referencia. Mínimo para entrar en las medias: {minMinutes} minutos (
            {pool.length} jugador{pool.length === 1 ? '' : 'es'}).
          </p>
        </div>
      </section>

      {/* Resumen arriba: mejor y peor contra cada referencia, fortalezas y debilidades, radar. */}
      <section aria-labelledby="cmp-resumen" className="grid gap-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="cmp-resumen" className="text-xl font-bold">
            Resumen
          </h2>
          <button type="button" className="chip focus-ring" onClick={exportExcel}>
            <FileXlsIcon size={16} aria-hidden="true" />
            Descargar Excel (hoja Comparación)
          </button>
        </div>
        <ul className="cmp-cards">
          {labels.map((l, k) => {
            const s = summarize(rows, k);
            const total = s.better + s.worse + s.equal;
            return (
              <li key={l.long} className="cmp-card">
                <p className="flex items-center gap-2 text-xs font-semibold text-muted">
                  <span
                    className="chart-key chart-key--box"
                    style={{ background: `var(--series-${String(REF_SLOTS[k] ?? 3)})` }}
                    aria-hidden="true"
                  />
                  Contra {l.long}
                </p>
                <p className="text-sm">
                  <span className="cmp-count value-best">{s.better}</span> mejor ·{' '}
                  <span className="cmp-count value-worst">{s.worse}</span> peor
                  {s.equal ? ` · ${String(s.equal)} igual` : ''}
                </p>
                <div className="cmp-split" aria-hidden="true">
                  <span className="cmp-split__better" style={{ flexGrow: s.better }} />
                  <span className="cmp-split__equal" style={{ flexGrow: s.equal }} />
                  <span className="cmp-split__worse" style={{ flexGrow: s.worse }} />
                </div>
                <p className="text-xs text-muted">
                  {total} estadísticas con dato{s.missing ? ` · ${String(s.missing)} sin datos (no cuentan)` : ''}
                </p>
              </li>
            );
          })}
        </ul>

        <div className="cmp-summary-grid">
          <article className="chart-card">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-base font-bold">Fortalezas y debilidades</h3>
              {labels.length > 1 ? (
                <select
                  aria-label="Referencia de las fortalezas y debilidades"
                  className="select focus-ring"
                  value={summaryRef}
                  onChange={(e) => {
                    setSummaryRef(Number(e.target.value));
                  }}
                >
                  {labels.map((l, k) => (
                    <option key={l.long} value={k}>
                      Contra {l.short}
                    </option>
                  ))}
                </select>
              ) : (
                <span className="text-sm text-muted">Contra {labels[0]?.short}</span>
              )}
            </div>
            <p className="text-xs text-muted">
              Las 5 mayores diferencias estandarizadas (en desvíos del grupo), con el sentido de cada estadística. No
              cuentan minutos, partidos ni carga física: dicen cuánto juega, no cómo.
            </p>
            <div className="grid gap-4 sm:grid-cols-2">
              <StrengthList
                title="Fortalezas"
                tone="best"
                rows={top.best}
                refIndex={summaryRef}
                per90={per90}
                href={detailHref}
              />
              <StrengthList
                title="Debilidades"
                tone="worst"
                rows={top.worst}
                refIndex={summaryRef}
                per90={per90}
                href={detailHref}
              />
            </div>
          </article>
          {radarSections.length >= 3 ? (
            <article className="chart-card">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h3 className="text-base font-bold">Percentil medio por categoría</h3>
                  <p className="text-xs text-muted">
                    0 a 100 dentro del grupo de comparación (100 = el mejor). Las referencias, donde cae su media.
                  </p>
                </div>
                <button
                  type="button"
                  className="icon-button focus-ring"
                  title="Descargar PNG"
                  onClick={() => {
                    const svg = radarRef.current?.querySelector('svg');
                    if (svg) void downloadPng(svg, `pelotheta-comparacion-radar-${String(main.playerId)}`);
                  }}
                >
                  <ImageIcon size={18} aria-hidden="true" />
                  <span className="sr-only">Descargar PNG</span>
                </button>
              </div>
              <div ref={radarRef}>
                <Radar
                  axes={radarSections.map((s) => s.section.short)}
                  series={[
                    { id: 'p', label: name(main), slot: 1, values: radarSections.map((s) => s.player) },
                    ...labels.map((l, k) => ({
                      id: `r${String(k)}`,
                      label: l.short,
                      slot: REF_SLOTS[k] ?? 3,
                      values: radarSections.map((s) => s.refs[k] ?? null),
                    })),
                  ]}
                  label={`Percentil medio de ${main.name} en cada categoría, con sus referencias`}
                />
              </div>
            </article>
          ) : null}
        </div>
      </section>

      {/* Partido a partido del jugador contra la media por partido de cada referencia. */}
      <section aria-labelledby="cmp-partidos" className="chart-card">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="cmp-partidos" className="text-base font-bold">
            Partido a partido
          </h2>
          <select
            aria-label="Estadística partido a partido"
            className="select focus-ring"
            value={initial.serie}
            onChange={(e) => {
              navigate({ serie: e.target.value });
            }}
          >
            {sections.map(({ section, rows: list }) => (
              <optgroup key={section.id} label={section.name}>
                {list.map((r) => (
                  <option key={r.stat.id} value={r.stat.id}>
                    {r.stat.name}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </div>
        {pending || !seriesReady ? (
          <p className="text-sm text-muted">Cargando los partidos…</p>
        ) : serieStat && points.some((p) => p.value !== null) ? (
          <div className="cmp-wide-chart">
            <LineChart
              labels={points.map((p) => day(p.date))}
              series={[
                { id: 'p', label: name(main), slot: 1, values: points.map((p) => p.value) },
                ...labels.map((l, k) => {
                  const v = referencePerMatch(groups[k] ?? [], serieStat, mode);
                  return {
                    id: `r${String(k)}`,
                    label: `${l.short} (media por partido)`,
                    slot: REF_SLOTS[k] ?? 3,
                    values: points.map(() => v),
                  };
                }),
              ]}
              includeZero={false}
              label={`${serieStat.name} de ${main.name} en cada partido del período, con la media por partido de cada referencia`}
            />
            <p className="text-xs text-muted">
              Valor de cada partido jugado en el período (sin pasar a 90). Las líneas planas son la media por partido de
              cada referencia. Doble clic en una fila de las tablas abre la estadística desglosada.
            </p>
          </div>
        ) : (
          <p className="text-sm text-muted">Sin partidos con dato para esta estadística en el período.</p>
        )}
      </section>

      {sections.map(({ section, rows: list }) => (
        <CompareSection
          key={section.id}
          section={section}
          rows={list}
          labels={labels}
          groups={groups}
          pool={pool}
          main={main}
          per90={per90}
          onOpen={openDetail}
          detailHref={detailHref}
        />
      ))}
    </div>
  );
}

function StrengthList({
  title,
  tone,
  rows,
  refIndex,
  per90,
  href,
}: {
  title: string;
  tone: 'best' | 'worst';
  rows: StatComparison[];
  refIndex: number;
  per90: boolean;
  href: (statId: string) => string;
}) {
  return (
    <div>
      <h4 className={`text-sm font-bold ${tone === 'best' ? 'value-best' : 'value-worst'}`}>{title}</h4>
      {rows.length ? (
        <ol className="cmp-strengths">
          {rows.map((r) => {
            const c = r.refs[refIndex];
            return (
              <li key={r.stat.id}>
                <Link href={href(r.stat.id)} className="focus-ring font-semibold hover:underline">
                  {r.stat.name}
                </Link>
                <span className="tabular text-sm">
                  {formatStat(r.player, r.stat, per90)} vs {formatStat(c?.value ?? null, r.stat, per90)}
                </span>
                <span className="tabular text-xs text-muted">
                  {c ? `${diffText(c.diff, r.stat, per90)} · ${pctText(c.diffPct)}` : ''}
                  {c?.z !== null && c?.z !== undefined
                    ? ` · ${Math.abs(c.z).toFixed(1).replace('.', ',')} desvíos`
                    : ''}
                </span>
              </li>
            );
          })}
        </ol>
      ) : (
        <p className="text-sm text-muted">Ninguna con estos filtros.</p>
      )}
    </div>
  );
}
