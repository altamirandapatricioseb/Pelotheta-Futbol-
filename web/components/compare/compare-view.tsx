'use client';

import { CaretDownIcon, EraserIcon, FileXlsIcon, ImageIcon, WarningCircleIcon } from '@phosphor-icons/react';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState, useTransition } from 'react';

import { download, downloadPng } from '@/components/charts/chart-card';
import { Radar } from '@/components/charts/primitives';
import type { BreakdownPoint } from '@/lib/compare/breakdown';
import {
  comparableStats,
  comparedLines,
  compareStat,
  isGoalkeeper,
  lineOf,
  LINES,
  MEDIAS,
  PERIODS,
  referenceLabel,
  referenceMembers,
  referencePerMatch,
  referencePool,
  refProblem,
  refSlot,
  refsToParam,
  sameRef,
  sectionOf,
  sectionsFor,
  SECTIONS,
  strengths,
  summarize,
  type AverageMode,
  type Line,
  type Period,
  type PlayerPosition,
  type RefSpec,
  type Section,
  type StatComparison,
} from '@/lib/compare/compare';
import type { CompetitionOption } from '@/lib/data/players';
import { buildXlsx, type Cell } from '@/lib/export/xlsx';
import { formatStat, type PlayerRow, type StatDef } from '@/lib/stats/catalog';

import { CompareBreakdown } from './compare-breakdown';
import { CompareSection, diffText, pctText, type RefLabel } from './compare-section';
import { PlayerPicker } from './player-picker';

export interface CompareState {
  mainId: number | null;
  refs: RefSpec[];
  /** 'resumen', el id de una categoría o 'desglose'. */
  view: string;
  /** Estadística del desglose. */
  stat: string | null;
  period: Period;
  competition: string;
  per90: boolean;
  minMinutes: number;
  mode: AverageMode;
  /** Todas las estadísticas (no solo las de las posiciones que se comparan). */
  all: boolean;
}

export interface BreakdownData {
  statId: string;
  playerIds: number[];
  lastDate: string;
  series: Record<number, BreakdownPoint[]>;
}

interface CompareViewProps {
  players: PlayerRow[];
  catalog: StatDef[];
  positions: PlayerPosition[];
  competitions: CompetitionOption[];
  initial: CompareState;
  breakdown: BreakdownData | null;
}

// Muestra pequeña (9.1): menos de 900 minutos en la temporada; en períodos cortos, menos de 270.
const smallSample = (period: Period) => (period === 'temporada' ? 900 : 270);
const SMALL_GROUP = 3;

type Con = '' | 'jugador' | 'equipo' | 'posicion' | Line;

const name = (p: PlayerRow) => p.shortName ?? p.name;

function queryOf(s: CompareState): string {
  const q = new URLSearchParams();
  if (s.mainId !== null) q.set('jugador', String(s.mainId));
  if (s.refs.length) q.set('con', refsToParam(s.refs));
  if (s.view !== 'resumen') q.set('vista', s.view);
  if (s.view === 'desglose' && s.stat) q.set('stat', s.stat);
  if (s.period !== 'temporada') q.set('periodo', s.period);
  if (s.period === 'temporada' && s.competition !== 'todas') q.set('comp', s.competition);
  q.set('modo', s.per90 ? 'por90' : 'totales');
  q.set('min', String(s.minMinutes));
  q.set('prom', s.mode);
  if (s.all) q.set('ver', 'todas');
  return q.toString();
}

/** Estado del control «Comparar con» a partir de las referencias de la URL. */
function conOf(refs: readonly RefSpec[]): Con {
  const first = refs[0];
  if (!first) return '';
  if (first.kind === 'jugador') return 'jugador';
  if (first.kind === 'linea') return first.line ?? '';
  return first.kind;
}

function mediaOf(con: Con): RefSpec | null {
  if (con === 'equipo' || con === 'posicion') return { kind: con };
  const line = LINES.find((l) => l.id === con);
  return line ? { kind: 'linea', line: line.id } : null;
}

/**
 * Interfaz 5 (9.7): se elige un jugador y con qué compararlo (la media del equipo, de una línea o
 * de su posición, u otro jugador más las medias que se tilden). Arranca vacía. Las estadísticas
 * se ven de a una categoría (como las tarjetas y conclusiones de Situaciones) y el desglose de
 * una estadística es una vista más. Todo el estado queda en la URL.
 */
export function CompareView({ players, catalog, positions, competitions, initial, breakdown }: CompareViewProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [mainId, setMainId] = useState<number | null>(initial.mainId);
  const [con, setCon] = useState<Con>(conOf(initial.refs));
  const [otherId, setOtherId] = useState<number | null>(
    initial.refs.find((r) => r.kind === 'jugador')?.playerId ?? null,
  );
  const [extra, setExtra] = useState<RefSpec[]>(
    initial.refs.some((r) => r.kind === 'jugador') ? initial.refs.filter((r) => r.kind !== 'jugador') : [],
  );
  const [view, setView] = useState(initial.view);
  const [stat, setStat] = useState<string | null>(initial.stat);
  const [per90, setPer90] = useState(initial.per90);
  const [minMinutes, setMinMinutes] = useState(initial.minMinutes);
  const [mode, setMode] = useState<AverageMode>(initial.mode);
  const [all, setAll] = useState(initial.all);
  const [summaryRef, setSummaryRef] = useState(0);

  // Barra fija: cuando queda pegada arriba se achica (jugadores) y el resto se abre a pedido.
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

  const positionsById = useMemo(() => new Map(positions.map((p) => [p.playerId, p])), [positions]);
  const main = players.find((p) => p.playerId === mainId) ?? null;
  const mine = main ? positionsById.get(main.playerId) : undefined;
  const other = otherId !== null ? (players.find((p) => p.playerId === otherId) ?? null) : null;
  const refsFor = (c: Con, o: number | null, e: RefSpec[]): RefSpec[] => {
    if (c === 'jugador') return [...(o !== null ? [{ kind: 'jugador' as const, playerId: o }] : []), ...e];
    const media = mediaOf(c);
    return media ? [media] : [];
  };
  const refs = useMemo(() => refsFor(con, otherId, extra), [con, otherId, extra]);

  const state: CompareState = {
    mainId,
    refs,
    view,
    stat,
    period: initial.period,
    competition: initial.competition,
    per90,
    minMinutes,
    mode,
    all,
  };
  const url = (over: Partial<CompareState>) => `/comparar?${queryOf({ ...state, ...over })}`;
  // Lo que se resuelve en el navegador solo reescribe la URL; lo que pide datos a la base
  // (período, competición y la serie del desglose) navega.
  const apply = (over: Partial<CompareState>) => {
    const next = { ...state, ...over };
    const ids = [next.mainId, ...next.refs.filter((r) => r.kind === 'jugador').map((r) => r.playerId ?? null)];
    const needsServer =
      next.view === 'desglose' &&
      next.stat !== null &&
      next.mainId !== null &&
      (breakdown?.statId !== next.stat || ids.some((id) => id !== null && !breakdown.playerIds.includes(id)));
    if (needsServer) {
      startTransition(() => {
        router.replace(url(over), { scroll: false });
      });
    } else {
      window.history.replaceState(null, '', url(over));
    }
  };
  const navigate = (over: Partial<CompareState>) => {
    startTransition(() => {
      router.replace(url(over), { scroll: false });
    });
  };

  const clear = () => {
    setMainId(null);
    setCon('');
    setOtherId(null);
    setExtra([]);
    setView('resumen');
    setStat(null);
    window.history.replaceState(null, '', url({ mainId: null, refs: [], view: 'resumen', stat: null }));
  };

  const model = useMemo(() => {
    if (!main || refs.length === 0) return null;
    const own = positionsById.get(main.playerId);
    const pool = referencePool(players, main, positionsById, minMinutes);
    const dropped: string[] = [];
    const valid = refs.filter((r) => {
      const problem = refProblem(r, main, positionsById, players);
      if (problem) dropped.push(`${referenceLabel(r, own, players).long}: ${problem}`);
      return problem === null;
    });
    const groups = valid.map((r) => referenceMembers(r, main, players, positionsById, minMinutes));
    const labels: RefLabel[] = valid.map((r) => ({
      ...referenceLabel(r, own, players),
      player: r.kind === 'jugador',
      slot: refSlot(r),
    }));
    const lines = comparedLines(main, valid, positionsById, players);
    const stats = comparableStats(catalog, lines, all);
    const rows = stats.map((s) => compareStat(s, main, groups, pool, per90, mode));
    return { pool, valid, dropped, groups, labels, lines, stats, rows };
  }, [main, refs, positionsById, players, minMinutes, catalog, all, per90, mode]);

  const periodLabel = PERIODS.find((p) => p.id === initial.period)?.label ?? 'Temporada';
  const competitionLabel =
    initial.period !== 'temporada' || initial.competition === 'todas'
      ? 'todas las competiciones'
      : (competitions.find((c) => c.code === initial.competition)?.name ?? initial.competition);

  const mainLine = main ? (lineOf(main, mine)?.toLocaleLowerCase('es-AR') ?? null) : null;
  const sections = model
    ? sectionsFor(mainLine).flatMap((s) => {
        const list = model.rows.filter((r) => sectionOf(r.stat)?.id === s.id);
        return list.length ? [{ section: s, rows: list }] : [];
      })
    : [];
  const activeView = view === 'desglose' || sections.some((s) => s.section.id === view) ? view : 'resumen';

  const showView = (v: string) => {
    setView(v);
    apply({ view: v });
  };
  const openBreakdown = (statId: string) => {
    setView('desglose');
    setStat(statId);
    apply({ view: 'desglose', stat: statId });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const conOptions: { value: Con; label: string }[] = [
    { value: 'equipo', label: 'Media del equipo (sin arqueros)' },
    ...LINES.map((l) => ({ value: l.id, label: `Media de ${l.plural.toLocaleLowerCase('es-AR')}` })),
    { value: 'posicion', label: mine?.role ? `Media de su posición (${mine.role})` : 'Media de su posición' },
    { value: 'jugador', label: 'Otro jugador' },
  ];

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
        <div className="cmp-bar__row cmp-bar__row--pick">
          <div className="cmp-field">
            <span className="cmp-field__label">Jugador</span>
            <PlayerPicker
              label="Jugador a comparar"
              players={players}
              positions={positionsById}
              value={mainId}
              slot={1}
              onChange={(id) => {
                const nextOther = id !== null && id === otherId ? null : otherId;
                setMainId(id);
                setOtherId(nextOther);
                apply({ mainId: id, refs: refsFor(con, nextOther, extra) });
              }}
            />
          </div>
          <div className="cmp-field">
            <label className="cmp-field__label" htmlFor="cmp-con">
              Comparar con
            </label>
            <select
              id="cmp-con"
              className="select focus-ring"
              value={con}
              onChange={(e) => {
                const next = e.target.value as Con;
                setCon(next);
                apply({ refs: refsFor(next, otherId, extra) });
              }}
            >
              <option value="">Elegí con qué compararlo…</option>
              {conOptions.map((o) => (
                <option key={o.value} value={o.value} disabled={o.value === 'posicion' && !mine?.role}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
          {con === 'jugador' ? (
            <div className="cmp-field">
              <span className="cmp-field__label">Otro jugador</span>
              <PlayerPicker
                label="Otro jugador"
                players={players}
                positions={positionsById}
                value={otherId}
                exclude={mainId !== null ? [mainId] : []}
                slot={2}
                placeholder="Buscá con quién compararlo"
                onChange={(id) => {
                  setOtherId(id);
                  apply({ refs: refsFor('jugador', id, extra) });
                }}
              />
            </div>
          ) : null}
          <button type="button" className="chip focus-ring cmp-clear" onClick={clear}>
            <EraserIcon size={16} aria-hidden="true" />
            Limpiar
          </button>
        </div>

        {con === 'jugador' ? (
          <fieldset className="cmp-medias">
            <legend>Sumar medias</legend>
            {MEDIAS.map((m) => {
              const label = referenceLabel(m, mine, players);
              const checked = extra.some((r) => sameRef(r, m));
              const disabled = m.kind === 'posicion' && !mine?.role;
              return (
                <label key={label.long} className={`cmp-check${disabled ? ' cmp-check--off' : ''}`}>
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={disabled}
                    onChange={(e) => {
                      const next = e.target.checked ? [...extra, m] : extra.filter((r) => !sameRef(r, m));
                      setExtra(next);
                      apply({ refs: refsFor('jugador', otherId, next) });
                    }}
                  />
                  <span
                    className="chart-key chart-key--box"
                    style={{ background: `var(--series-${String(refSlot(m))})` }}
                    aria-hidden="true"
                  />
                  {m.kind === 'posicion' ? `Posición${mine?.role ? ` (${mine.role})` : ''}` : label.short}
                </label>
              );
            })}
          </fieldset>
        ) : null}

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
                  apply({ per90: v });
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
                apply({ minMinutes: v });
              }}
              className="w-12 bg-transparent text-fg outline-none tabular"
            />
          </label>
          <div className="cmp-inline">
            <span id="cmp-promedio" title="Cómo se promedian las medias">
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
                    apply({ mode: m });
                  }}
                >
                  {m === 'simple' ? 'Simple' : 'Por minutos'}
                </button>
              ))}
            </div>
          </div>
          <div className="cmp-inline">
            <span id="cmp-ver">Estadísticas</span>
            <div className="view-switch" role="group" aria-labelledby="cmp-ver">
              {[false, true].map((v) => (
                <button
                  key={String(v)}
                  type="button"
                  className="view-switch__button focus-ring"
                  aria-pressed={all === v}
                  title={v ? 'Todas las del catálogo' : 'Las de las posiciones que se comparan'}
                  onClick={() => {
                    setAll(v);
                    apply({ all: v });
                  }}
                >
                  {v ? 'Todas' : 'Por posición'}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {!main || !model ? (
        <div className="under-construction cmp-empty">
          <p className="text-lg font-bold">{!main ? 'Elegí un jugador para empezar.' : 'Elegí con qué compararlo.'}</p>
          <p className="text-muted">
            Podés compararlo con la media del equipo, con la media de una línea (arqueros, defensores, mediocampistas o
            delanteros), con la media de su posición o con otro jugador; con otro jugador también podés sumar medias.
            Cada uno tiene su color: el jugador en verde, el otro jugador en violeta, el equipo en azul.
          </p>
        </div>
      ) : (
        <CompareBody
          main={main}
          mine={mine}
          other={other}
          otherKeeper={other ? isGoalkeeper(other, positionsById.get(other.playerId)) : false}
          model={model}
          sections={sections}
          activeView={activeView}
          setView={showView}
          per90={per90}
          minMinutes={minMinutes}
          mode={mode}
          all={all}
          period={initial.period}
          periodLabel={periodLabel}
          competitionLabel={competitionLabel}
          summaryRef={summaryRef}
          setSummaryRef={setSummaryRef}
          openBreakdown={openBreakdown}
          stat={stat}
          catalog={catalog}
          breakdown={breakdown}
          pending={pending}
        />
      )}
    </div>
  );
}

interface Model {
  pool: PlayerRow[];
  valid: RefSpec[];
  dropped: string[];
  groups: PlayerRow[][];
  labels: RefLabel[];
  lines: Set<string>;
  stats: StatDef[];
  rows: StatComparison[];
}

interface CompareBodyProps {
  main: PlayerRow;
  mine: PlayerPosition | undefined;
  other: PlayerRow | null;
  otherKeeper: boolean;
  model: Model;
  sections: { section: Section; rows: StatComparison[] }[];
  activeView: string;
  setView: (v: string) => void;
  per90: boolean;
  minMinutes: number;
  mode: AverageMode;
  all: boolean;
  period: Period;
  periodLabel: string;
  competitionLabel: string;
  summaryRef: number;
  setSummaryRef: (n: number) => void;
  openBreakdown: (statId: string) => void;
  stat: string | null;
  catalog: StatDef[];
  breakdown: BreakdownData | null;
  pending: boolean;
}

function CompareBody({
  main,
  mine,
  other,
  otherKeeper,
  model,
  sections,
  activeView,
  setView,
  per90,
  minMinutes,
  mode,
  all,
  period,
  periodLabel,
  competitionLabel,
  summaryRef,
  setSummaryRef,
  openBreakdown,
  stat,
  catalog,
  breakdown,
  pending,
}: CompareBodyProps) {
  const { pool, valid, dropped, groups, labels, lines, stats, rows } = model;
  const radarRef = useRef<HTMLDivElement>(null);
  const keeper = isGoalkeeper(main, mine);
  const crossType = valid.some(
    (r) =>
      (r.kind === 'jugador' && otherKeeper !== keeper) || (r.kind === 'linea' && (r.line === 'arquero') !== keeper),
  );
  const small = main.minutes < smallSample(period);
  const lineNames = [...lines].map((l) => LINES.find((x) => x.id === l)?.plural ?? l).join(', ');
  const ref = Math.min(summaryRef, Math.max(0, labels.length - 1));
  const top = strengths(rows, ref, 5);

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

  const breakdownStat = stat ? (catalog.find((s) => s.id === stat) ?? null) : null;
  const hasOther = valid.some((r) => r.kind === 'jugador');
  const breakdownReady =
    breakdown !== null &&
    breakdown.statId === stat &&
    breakdown.playerIds.includes(main.playerId) &&
    (!hasOther || !other || breakdown.playerIds.includes(other.playerId));

  const exportExcel = () => {
    const sheet: Cell[][] = [
      ['Comparación', null],
      ['Jugador', main.name],
      ['Período', `${periodLabel} (${competitionLabel})`],
      ['Valores', per90 ? 'Cada 90 minutos (los porcentajes y promedios, tal cual)' : 'Totales'],
      ['Promedio de las medias', mode === 'ponderado' ? 'Ponderado por minutos' : 'Simple'],
      ['Mínimo de minutos', minMinutes],
      ...labels.map((l, k): Cell[] => [
        `Referencia ${String(k + 1)}`,
        l.player ? l.long : `${l.long} (${String(groups[k]?.length ?? 0)} jugadores)`,
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
    <>
      {/* Quién contra quién. */}
      <section aria-labelledby="cmp-jugador" className="cmp-head">
        <div className="min-w-0">
          <p className="text-xs font-semibold text-muted">
            {[mine?.role ?? lineOf(main, mine) ?? 'Posición n/d', mine?.zone].filter(Boolean).join(' · ')}
          </p>
          <h2 id="cmp-jugador" className="flex items-center gap-2 text-2xl font-extrabold tracking-tight">
            <span className="chart-key chart-key--box" style={{ background: 'var(--series-1)' }} aria-hidden="true" />
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
                  style={{ background: `var(--series-${String(l.slot)})` }}
                  aria-hidden="true"
                />
                <span className="font-semibold">{l.long}</span>
                <span className="text-muted">
                  {l.player
                    ? `${String(groups[k]?.[0]?.minutes ?? 0)} min`
                    : `${String(n)} jugador${n === 1 ? '' : 'es'}`}
                </span>
                {!l.player && n < SMALL_GROUP ? (
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
              Muestra pequeña: {main.minutes} minutos en el período (menos de {smallSample(period)}).
            </p>
          ) : null}
          {crossType ? (
            <p className="text-warn">
              <WarningCircleIcon size={14} aria-hidden="true" className="mr-1 inline" />
              Comparás un arquero con jugadores de campo: se muestran las estadísticas de las dos posiciones.
            </p>
          ) : null}
          {dropped.map((d) => (
            <p key={d} className="text-warn">
              <WarningCircleIcon size={14} aria-hidden="true" className="mr-1 inline" />
              No se usa {d}.
            </p>
          ))}
          <p className="text-muted">
            {all
              ? `Todas las estadísticas del catálogo (${String(stats.length)}).`
              : `Estadísticas de ${lineNames.toLocaleLowerCase('es-AR')} (${String(stats.length)}); «Todas» muestra el resto.`}{' '}
            El jugador nunca entra en una media. Mínimo para entrar en las medias: {minMinutes} minutos. Percentiles
            entre los {keeper ? 'arqueros' : 'jugadores de campo'} del plantel ({pool.length}).
          </p>
        </div>
      </section>

      {/* Una categoría por vez, como las tarjetas y conclusiones de Situaciones. */}
      <nav className="cmp-cats" aria-label="Qué comparar">
        <div className="view-switch cmp-cats__switch" role="group">
          <button
            type="button"
            className="view-switch__button focus-ring"
            aria-pressed={activeView === 'resumen'}
            onClick={() => {
              setView('resumen');
            }}
          >
            Resumen
          </button>
          {sections.map(({ section, rows: list }) => {
            const s = summarize(list, 0);
            return (
              <button
                key={section.id}
                type="button"
                className="view-switch__button focus-ring"
                aria-pressed={activeView === section.id}
                title={`${String(list.length)} estadísticas · ${String(s.better)} mejor y ${String(s.worse)} peor contra ${labels[0]?.short ?? ''}`}
                onClick={() => {
                  setView(section.id);
                }}
              >
                {section.short}
                <span className="cmp-cats__count tabular">{list.length}</span>
              </button>
            );
          })}
          <button
            type="button"
            className="view-switch__button view-switch__button--insight focus-ring"
            aria-pressed={activeView === 'desglose'}
            onClick={() => {
              setView('desglose');
            }}
          >
            Desglose
          </button>
        </div>
      </nav>

      {activeView === 'resumen' ? (
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
                      style={{ background: `var(--series-${String(l.slot)})` }}
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
                    value={ref}
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
                cuentan minutos, partidos ni carga física: dicen cuánto juega, no cómo. Tocá una para ver su desglose.
              </p>
              <div className="grid gap-4 sm:grid-cols-2">
                <StrengthList
                  title="Fortalezas"
                  tone="best"
                  rows={top.best}
                  refIndex={ref}
                  per90={per90}
                  onOpen={openBreakdown}
                />
                <StrengthList
                  title="Debilidades"
                  tone="worst"
                  rows={top.worst}
                  refIndex={ref}
                  per90={per90}
                  onOpen={openBreakdown}
                />
              </div>
            </article>
            {radarSections.length >= 3 ? (
              <article className="chart-card">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <h3 className="text-base font-bold">Percentil medio por categoría</h3>
                    <p className="text-xs text-muted">
                      0 a 100 dentro del grupo de comparación (100 = el mejor). Las medias, donde cae su valor.
                    </p>
                  </div>
                  <button
                    type="button"
                    className="icon-button focus-ring"
                    title="Descargar PNG"
                    onClick={() => {
                      const svg = radarRef.current?.querySelector('svg[role="img"]');
                      if (svg instanceof SVGSVGElement) {
                        void downloadPng(svg, `pelotheta-comparacion-radar-${String(main.playerId)}`);
                      }
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
                        slot: l.slot,
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
      ) : activeView === 'desglose' ? (
        <CompareBreakdown
          stats={stats}
          stat={breakdownStat}
          onStat={openBreakdown}
          main={main}
          other={hasOther ? other : null}
          medias={labels.flatMap((l, k) =>
            l.player || !breakdownStat
              ? []
              : [{ label: l, perMatch: referencePerMatch(groups[k] ?? [], breakdownStat, mode) }],
          )}
          data={breakdownReady ? breakdown : null}
          loading={pending || (breakdownStat !== null && !breakdownReady)}
        />
      ) : (
        sections
          .filter((s) => s.section.id === activeView)
          .map(({ section, rows: list }) => (
            <CompareSection
              key={section.id}
              section={section}
              rows={list}
              labels={labels}
              groups={groups}
              pool={pool}
              main={main}
              per90={per90}
              onOpen={openBreakdown}
            />
          ))
      )}
    </>
  );
}

function StrengthList({
  title,
  tone,
  rows,
  refIndex,
  per90,
  onOpen,
}: {
  title: string;
  tone: 'best' | 'worst';
  rows: StatComparison[];
  refIndex: number;
  per90: boolean;
  onOpen: (statId: string) => void;
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
                <button
                  type="button"
                  className="focus-ring text-left font-semibold hover:underline"
                  onClick={() => {
                    onOpen(r.stat.id);
                  }}
                >
                  {r.stat.name}
                </button>
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
