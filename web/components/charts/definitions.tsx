'use client';

// Definiciones de los gráficos de la Interfaz 1 (9.2.1). Cada una toma los datos ya filtrados
// (competición y localía globales) y devuelve el gráfico y su tabla equivalente, o el motivo por
// el que no hay datos. Los números de gráfico siguen `data/chart_catalog.csv`.

import { useState, type ReactNode } from 'react';

import type { LandingData } from '@/lib/data/landing';
import { bins, countMatrix, cumulative, pearson, rolling, spearman } from '@/lib/charts/transform';
import { playerValue, rankAndPercentile, type PlayerRow, type StatDef, type TeamMatchRow } from '@/lib/stats/catalog';
import { leagueComparison } from '@/lib/stats/league';

import type { ChartTable } from './chart-card';
import {
  BarChart,
  DonutChart,
  Heatmap,
  Legend,
  LineChart,
  Radar,
  ScatterChart,
  ShotMap,
  Strip,
  type ScatterPoint,
  type Series,
  type Slot,
} from './primitives';

export interface ChartContext {
  data: LandingData;
  matches: TeamMatchRow[];
  /** Jugadores con al menos 450 minutos (referencia de percentiles y rankings). */
  regulars: PlayerRow[];
}

export type ChartOutput = { node: ReactNode; table: ChartTable; coverage?: string } | { empty: string };
export type ChartRender = (ctx: ChartContext) => ChartOutput;

const RESULT_SLOT: Record<string, Slot> = { G: 1, E: 4, P: 2 };
// Color por posición en las dispersiones de jugadores: tres colores como máximo (slots 1, 2 y 4).
const positionSlot = (p: PlayerRow): Slot => (p.position === 'Delantero' ? 1 : p.position === 'Mediocampista' ? 3 : 2);
const POSITION_GROUPS: { label: string; slot: Slot }[] = [
  { label: 'Delanteros', slot: 1 },
  { label: 'Mediocampistas', slot: 3 },
  { label: 'Defensores y arqueros', slot: 2 },
];
const RESULT_NAME: Record<string, string> = { G: 'Ganado', E: 'Empatado', P: 'Perdido' };

const s = (m: TeamMatchRow, key: string): number | null => m.stats[key] ?? null;
const result = (m: TeamMatchRow) => (m.goalsFor > m.goalsAgainst ? 'G' : m.goalsFor === m.goalsAgainst ? 'E' : 'P');
const points = (m: TeamMatchRow) => ({ G: 3, E: 1, P: 0 })[result(m)];
const day = (m: TeamMatchRow) => m.date.slice(8, 10) + '/' + m.date.slice(5, 7);
const matchLabel = (m: TeamMatchRow) => `${day(m)} ${m.home ? 'vs' : 'en'} ${m.opponent}`;
const sum = (v: (number | null)[]) => v.reduce<number>((a, b) => a + (b ?? 0), 0);
const avg = (v: (number | null)[]) => {
  const n = v.filter((x): x is number => x !== null);
  return n.length ? n.reduce((a, b) => a + b, 0) / n.length : null;
};
const covered = (ms: TeamMatchRow[], key: string) => {
  const n = ms.filter((m) => s(m, key) !== null).length;
  return n < ms.length ? `dato en ${String(n)} de ${String(ms.length)} partidos` : undefined;
};
const competitions = (ms: TeamMatchRow[]) => [
  ...new Map(ms.map((m) => [m.competitionCode, m.competitionName])).entries(),
];
const shortComp = (name: string) =>
  name.replace('Liga Profesional: Torneo ', '').replace('CONMEBOL Copa ', '').replace('Copa Argentina', 'C. Argentina');
const statById = (catalog: StatDef[], id: string) => catalog.find((c) => c.id === id);
const pv = (p: PlayerRow, catalog: StatDef[], id: string, per90 = false): number | null => {
  const stat = statById(catalog, id);
  const v = stat ? playerValue(p, stat, per90) : null;
  return typeof v === 'number' ? v : null;
};

function perMatchLine(
  ms: TeamMatchRow[],
  series: { key: string; label: string; slot: Slot }[],
  window = 0,
): ChartOutput {
  const withData = ms.filter((m) => series.some((x) => s(m, x.key) !== null));
  if (withData.length < 2) return { empty: 'Menos de dos partidos con este dato en el filtro elegido.' };
  const lines: Series[] = series.map((x) => {
    const raw = withData.map((m) => s(m, x.key));
    return {
      id: x.key,
      label: window ? `${x.label} (media de ${String(window)})` : x.label,
      slot: x.slot,
      values: window ? rolling(raw, window) : raw,
    };
  });
  return {
    node: <LineChart labels={withData.map(day)} series={lines} label={series.map((x) => x.label).join(' y ')} />,
    table: {
      head: ['Partido', ...series.map((x) => x.label)],
      rows: withData.map((m) => [matchLabel(m), ...series.map((x) => s(m, x.key))]),
    },
    coverage: covered(ms, series[0]?.key ?? ''),
  };
}

function rankingChart(rows: { label: string; value: number | null }[], title: string, top = 12): ChartOutput {
  const list = rows
    .filter((r): r is { label: string; value: number } => r.value !== null)
    .sort((a, b) => b.value - a.value)
    .slice(0, top);
  if (!list.length) return { empty: 'No hay jugadores con este dato en el filtro elegido.' };
  return {
    node: (
      <BarChart
        horizontal
        labels={list.map((r) => r.label)}
        series={[{ id: 'v', label: title, slot: 1, values: list.map((r) => r.value) }]}
        label={title}
      />
    ),
    table: { head: ['Jugador', title], rows: list.map((r) => [r.label, r.value]) },
  };
}

function byCompetition(
  ms: TeamMatchRow[],
  series: { label: string; slot: Slot; value: (g: TeamMatchRow[]) => number | null }[],
  title: string,
  stacked = false,
): ChartOutput {
  const comps = competitions(ms);
  if (!comps.length) return { empty: 'No hay partidos en el filtro elegido.' };
  const groups = comps.map(([code]) => ms.filter((m) => m.competitionCode === code));
  return {
    node: (
      <BarChart
        stacked={stacked}
        labels={comps.map(([, name]) => shortComp(name))}
        series={series.map((x, i) => ({ id: String(i), label: x.label, slot: x.slot, values: groups.map(x.value) }))}
        label={title}
      />
    ),
    table: {
      head: ['Competición', ...series.map((x) => x.label)],
      rows: comps.map(([, name], i) => [name, ...series.map((x) => x.value(groups[i] ?? []))]),
    },
  };
}

/** Gráfico con un selector propio (jugador o estadística) dentro de la tarjeta. */
function Selectable<T extends string>({
  options,
  initial,
  label,
  render,
}: {
  options: { value: T; label: string }[];
  initial: T;
  label: string;
  render: (value: T) => ReactNode;
}) {
  const [value, setValue] = useState<T>(initial);
  return (
    <div className="grid gap-2">
      <label className="flex min-w-0 items-center gap-2 text-xs font-semibold text-muted">
        {label}
        <select
          aria-label={label}
          className="select focus-ring min-w-0 max-w-full flex-1 text-xs"
          value={value}
          onChange={(e) => {
            setValue(e.target.value as T);
          }}
        >
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
      {render(value)}
    </div>
  );
}

function outputNode(out: ChartOutput): ReactNode {
  return 'empty' in out ? <p className="text-sm text-muted">Sin datos: {out.empty}</p> : out.node;
}

const playerOptions = (ps: PlayerRow[]) => ps.map((p) => ({ value: String(p.playerId), label: p.name }));
const statOptions = (catalog: StatDef[]) =>
  catalog
    .filter((c) => c.available && ['suma', 'cociente', 'promedio', 'diferencia', 'adicion', 'metrica'].includes(c.rule))
    .map((c) => ({ value: c.id, label: c.name }));

export const CHARTS: Record<string, ChartRender> = {
  // --- A. Forma y resultados -----------------------------------------------------------------
  g01: ({ matches }) => {
    if (!matches.length) return { empty: 'No hay partidos en el filtro elegido.' };
    const acc = cumulative(matches.map(points));
    return {
      node: (
        <>
          <LineChart
            labels={matches.map(day)}
            series={[{ id: 'pts', label: 'Puntos acumulados', slot: 2, values: acc }]}
            pointSlots={matches.map((m) => RESULT_SLOT[result(m)] ?? null)}
            label="Puntos acumulados partido a partido"
          />
          <Legend items={['G', 'E', 'P'].map((r) => ({ label: RESULT_NAME[r] ?? r, slot: RESULT_SLOT[r] ?? 1 }))} />
        </>
      ),
      table: {
        head: ['Partido', 'Resultado', 'Puntos acumulados'],
        rows: matches.map((m, i) => [matchLabel(m), `${String(m.goalsFor)}-${String(m.goalsAgainst)}`, acc[i] ?? null]),
      },
    };
  },
  g02: ({ matches, data }) => {
    if (!matches.length || data.leaguePpg === null) return { empty: 'Falta la Tabla Anual de la liga.' };
    const acc = cumulative(matches.map(points));
    const league = matches.map((_, i) => (i + 1) * (data.leaguePpg ?? 0));
    return {
      node: (
        <LineChart
          labels={matches.map(day)}
          series={[
            { id: 'boca', label: 'Boca', slot: 1, values: acc },
            { id: 'liga', label: 'Promedio de la liga', slot: 2, values: league },
          ]}
          label="Puntos acumulados de Boca contra el promedio de la liga"
        />
      ),
      table: {
        head: ['Partido', 'Boca', 'Promedio de la liga'],
        rows: matches.map((m, i) => [matchLabel(m), acc[i] ?? null, league[i] ?? null]),
      },
    };
  },
  g04: ({ matches }) => {
    const sides = [
      { label: 'Local', rows: matches.filter((m) => m.home) },
      { label: 'Visitante', rows: matches.filter((m) => !m.home) },
    ];
    return {
      node: (
        <BarChart
          stacked
          labels={sides.map((x) => x.label)}
          series={['G', 'E', 'P'].map((r) => ({
            id: r,
            label: RESULT_NAME[r] ?? r,
            slot: RESULT_SLOT[r] ?? 1,
            values: sides.map((x) => x.rows.filter((m) => result(m) === r).length),
          }))}
          label="Resultados de local y de visitante"
        />
      ),
      table: {
        head: ['Condición', 'Ganados', 'Empatados', 'Perdidos'],
        rows: sides.map((x) => [x.label, ...['G', 'E', 'P'].map((r) => x.rows.filter((m) => result(m) === r).length)]),
      },
    };
  },
  g05: ({ matches }) => ({
    node: (
      <>
        <Strip
          items={matches.map((m) => ({
            label: result(m),
            slot: RESULT_SLOT[result(m)] ?? null,
            title: `${matchLabel(m)}: ${String(m.goalsFor)}-${String(m.goalsAgainst)}`,
          }))}
          label="Resultados en orden"
        />
        <Legend items={['G', 'E', 'P'].map((r) => ({ label: RESULT_NAME[r] ?? r, slot: RESULT_SLOT[r] ?? 1 }))} />
      </>
    ),
    table: { head: ['Partido', 'Resultado'], rows: matches.map((m) => [matchLabel(m), result(m)]) },
  }),
  g06: ({ matches }) => {
    const maxGf = Math.max(0, ...matches.map((m) => m.goalsFor));
    const maxGa = Math.max(0, ...matches.map((m) => m.goalsAgainst));
    const rows = Array.from({ length: maxGf + 1 }, (_, i) => String(i));
    const cols = Array.from({ length: maxGa + 1 }, (_, j) => String(j));
    const values = rows.map((_, i) =>
      cols.map((_, j) => matches.filter((m) => m.goalsFor === i && m.goalsAgainst === j).length),
    );
    return {
      node: (
        <Heatmap
          rows={rows.map((r) => `Boca ${r}`)}
          cols={cols.map((c) => `Rival ${c}`)}
          values={values}
          label="Cantidad de partidos por marcador"
        />
      ),
      table: {
        head: ['Goles de Boca', ...cols.map((c) => `Rival ${c}`)],
        rows: rows.map((r, i) => [r, ...(values[i] ?? [])]),
      },
    };
  },
  g07: ({ matches }) =>
    perMatchLineFromValues(
      matches,
      cumulative(matches.map((m) => m.goalsFor - m.goalsAgainst)),
      'Diferencia de gol acumulada',
    ),
  g08: ({ matches, data }) =>
    byCompetition(
      matches,
      [
        { label: 'Puntos reales', slot: 1, value: (g) => sum(g.map(points)) },
        {
          label: 'Puntos pitagóricos',
          slot: 2,
          value: (g) =>
            sum(g.map((m) => s(m, 'eq_puntos_pitagoricos'))) ||
            data.windowValues[g[0]?.competitionCode ?? '']?.eq_puntos_pitagoricos ||
            null,
        },
      ],
      'Puntos reales frente a pitagóricos por competición',
    ),

  // --- B. Goles ------------------------------------------------------------------------------
  g09: ({ matches }) => {
    const bands = ['00_15', '16_30', '31_45', '46_60', '61_75', '76_90'];
    const labels = ['0-15', '16-30', '31-45+', '46-60', '61-75', '76-90+'];
    const gf = bands.map((b) => sum(matches.map((m) => s(m, `goals_for_${b}`))));
    const ga = bands.map((b) => sum(matches.map((m) => s(m, `goals_against_${b}`))));
    return {
      node: (
        <BarChart
          labels={labels}
          series={[
            { id: 'gf', label: 'A favor', slot: 1, values: gf },
            { id: 'ga', label: 'En contra', slot: 2, values: ga },
          ]}
          label="Goles por tramo de minutos"
        />
      ),
      table: { head: ['Tramo', 'A favor', 'En contra'], rows: labels.map((l, i) => [l, gf[i] ?? 0, ga[i] ?? 0]) },
    };
  },
  g10: ({ matches }) => ({
    node: (
      <BarChart
        stacked
        labels={matches.map(day)}
        series={[
          { id: 'gf', label: 'A favor', slot: 1, values: matches.map((m) => m.goalsFor) },
          { id: 'ga', label: 'En contra', slot: 2, values: matches.map((m) => -m.goalsAgainst) },
        ]}
        format={(v) => String(Math.abs(v))}
        label="Goles a favor (arriba) y en contra (abajo) por partido"
      />
    ),
    table: {
      head: ['Partido', 'A favor', 'En contra'],
      rows: matches.map((m) => [matchLabel(m), m.goalsFor, m.goalsAgainst]),
    },
  }),
  g11: ({ matches }) => goalTypes(matches, ''),
  g12: ({ matches }) => goalTypes(matches, '_against'),
  g13: ({ matches }) =>
    byCompetition(
      matches,
      [
        { label: 'Ganando', slot: 1, value: (g) => sum(g.map((m) => s(m, 'minutes_leading'))) },
        { label: 'Empatando', slot: 4, value: (g) => sum(g.map((m) => s(m, 'minutes_level'))) },
        { label: 'Perdiendo', slot: 2, value: (g) => sum(g.map((m) => s(m, 'minutes_trailing'))) },
      ],
      'Minutos con ventaja, empate y desventaja',
      true,
    ),
  g14: ({ data }) => {
    const rows = [...(data.situations.s132 ?? [])].sort((a, b) => a.order - b.order);
    if (!rows.length) return { empty: 'Sin goles con minuto cargados.' };
    return {
      node: (
        <BarChart
          stacked
          labels={rows.map((r) => r.param)}
          series={['G', 'E', 'P'].map((k) => ({
            id: k,
            label: RESULT_NAME[k] ?? k,
            slot: RESULT_SLOT[k] ?? 1,
            values: rows.map((r) => (k === 'G' ? r.w : k === 'E' ? r.d : r.l)),
          }))}
          label="Resultado final según quién marcó el primer gol"
        />
      ),
      table: {
        head: ['Primer gol', 'Partidos', 'Ganados', 'Empatados', 'Perdidos', 'Puntos por partido'],
        rows: rows.map((r) => [r.param, r.n, r.w, r.d, r.l, r.ppg]),
      },
    };
  },
  g15: ({ matches }) =>
    byCompetition(
      matches,
      [
        { label: 'Puntos ganados desde atrás', slot: 1, value: (g) => sum(g.map((m) => s(m, 'points_from_behind'))) },
        {
          label: 'Puntos perdidos desde la ventaja',
          slot: 2,
          value: (g) => sum(g.map((m) => s(m, 'points_dropped_from_ahead'))),
        },
      ],
      'Remontadas y ventajas perdidas',
    ),
  g16: ({ data }) =>
    rankingChart(
      data.players.map((p) => ({ label: p.name, value: pv(p, data.playerCatalog, 'goles') })),
      'Goles',
    ),

  // --- C. xG y tiros -------------------------------------------------------------------------
  g17: ({ matches }) =>
    perMatchLine(
      matches.filter((m) => s(m, 'xg') !== null),
      [
        { key: 'xg', label: 'xG a favor', slot: 1 },
        { key: 'xg_against', label: 'xG en contra', slot: 2 },
      ],
    ),
  g18: ({ matches }) => {
    const ms = matches.filter((m) => s(m, 'xg') !== null);
    return perMatchLineFromValues(
      ms,
      cumulative(ms.map((m) => m.goalsFor - (s(m, 'xg') ?? 0))),
      'Goles menos xG acumulado',
      covered(matches, 'xg'),
    );
  },
  g19: ({ data, matches }) => {
    const ids = new Set(matches.map((m) => m.matchId));
    const shots = data.shots.filter((x) => x.boca && ids.has(x.matchId));
    if (!shots.length) return { empty: 'Solo hay tiros con coordenadas en los partidos de liga (StrikerAPI).' };
    return {
      node: (
        <ShotMap
          shots={shots.map((x) => ({
            x: x.x,
            y: x.y,
            xg: x.xg,
            goal: x.outcome === 'goal',
            title: `${x.player ?? 'Jugador'} · min ${String(x.minute ?? '')} · xG ${x.xg.toFixed(2)} · ${x.outcome}`,
          }))}
          label="Remates de Boca: posición, xG (tamaño) y resultado"
        />
      ),
      table: {
        head: ['Jugador', 'Minuto', 'xG', 'Resultado', 'Zona'],
        rows: shots.map((x) => [x.player, x.minute, x.xg, x.outcome, x.zone]),
      },
      coverage: `${String(shots.length)} remates de liga`,
    };
  },
  g20: ({ matches }) =>
    perMatchLine(matches, [
      { key: 'shots_total', label: 'Remates', slot: 2 },
      { key: 'shots_on_target', label: 'Remates al arco', slot: 1 },
    ]),
  g21: ({ matches }) => {
    const ms = matches.filter((m) => s(m, 'shots_total'));
    const pct = ms.map((m) => ((s(m, 'shots_on_target') ?? 0) / (s(m, 'shots_total') ?? 1)) * 100);
    return perMatchLineFromValues(ms, rolling(pct, 5), 'Precisión de remate (%, media de 5)');
  },
  g22: ({ matches }) =>
    scatterMatches(
      matches.filter((m) => s(m, 'xg') !== null && s(m, 'shots_total')),
      (m) => s(m, 'shots_total'),
      (m) => (s(m, 'xg') ?? 0) / (s(m, 'shots_total') ?? 1),
      'Remates',
      'xG por remate',
    ),
  g23: ({ matches }) => {
    const values = matches.map((m) => s(m, 'xg')).filter((v): v is number => v !== null);
    const b = bins(values, 6);
    if (!b.length) return { empty: 'Sin xG en el filtro elegido.' };
    const labels = b.map((x) => `${x.from.toFixed(1)}-${x.to.toFixed(1)}`);
    return {
      node: (
        <BarChart
          labels={labels}
          series={[{ id: 'n', label: 'Partidos', slot: 1, values: b.map((x) => x.count) }]}
          label="Partidos según el xG generado"
        />
      ),
      table: { head: ['xG del partido', 'Partidos'], rows: labels.map((l, i) => [l, b[i]?.count ?? 0]) },
      coverage: covered(matches, 'xg'),
    };
  },

  // --- D. Posesión y circulación -----------------------------------------------------------
  g24: ({ matches }) =>
    scatterMatches(
      matches.filter((m) => s(m, 'possession_pct') !== null),
      (m) => s(m, 'possession_pct'),
      (m) => m.goalsFor - m.goalsAgainst,
      'Posesión (%)',
      'Diferencia de gol',
    ),
  g25: ({ matches }) => {
    const ms = matches.filter((m) => s(m, 'passes'));
    return perMatchLineFromValues(
      ms,
      rolling(
        ms.map((m) => ((s(m, 'passes_accurate') ?? 0) / (s(m, 'passes') ?? 1)) * 100),
        5,
      ),
      'Precisión de pase (%, media de 5)',
      covered(matches, 'passes'),
    );
  },
  g27: ({ matches }) => {
    const ms = matches.filter((m) => s(m, 'passes_against') !== null && s(m, 'defensive_actions_ppda'));
    return perMatchLineFromValues(
      ms,
      ms.map((m) => (s(m, 'passes_against') ?? 0) / (s(m, 'defensive_actions_ppda') ?? 1)),
      'PPDA (más bajo = más presión)',
      covered(matches, 'passes_against'),
    );
  },
  g28: ({ matches }) =>
    perMatchLine(
      matches,
      [
        { key: 'possession_lost_players', label: 'Pérdidas', slot: 2 },
        { key: 'recoveries_players', label: 'Recuperaciones', slot: 1 },
      ],
      5,
    ),
  g29: ({ matches }) =>
    byCompetition(
      matches,
      [
        { label: 'Goles tras centro', slot: 2, value: (g) => sum(g.map((m) => s(m, 'goals_from_cross'))) },
        { label: 'Goles de cabeza', slot: 1, value: (g) => sum(g.map((m) => s(m, 'goals_header'))) },
      ],
      'Goles tras centro y de cabeza (liga)',
    ),

  // --- E. Defensa ----------------------------------------------------------------------------
  g30: ({ matches }) =>
    perMatchLineFromValues(
      matches,
      cumulative(matches.map((m) => (m.goalsAgainst === 0 ? 1 : 0))),
      'Vallas invictas acumuladas',
    ),
  g31: ({ matches }) =>
    perMatchLine(
      matches,
      [
        { key: 'tackles', label: 'Entradas', slot: 1 },
        { key: 'interceptions', label: 'Intercepciones', slot: 2 },
      ],
      5,
    ),
  g32: ({ data, regulars }) =>
    rankingChart(
      regulars.map((p) => ({ label: p.name, value: pv(p, data.playerCatalog, 'pct_aereos') })),
      'Duelos aéreos ganados (%)',
    ),
  g34: ({ matches }) =>
    scatterMatches(
      matches.filter((m) => s(m, 'shots_total_against') !== null),
      (m) => s(m, 'shots_total_against'),
      (m) => m.goalsAgainst,
      'Remates del rival',
      'Goles recibidos',
    ),

  // --- F. Balón parado -----------------------------------------------------------------------
  g35: ({ matches }) =>
    perMatchLine(
      matches,
      [
        { key: 'corners', label: 'Córners a favor', slot: 1 },
        { key: 'corners_against', label: 'Córners en contra', slot: 2 },
      ],
      5,
    ),
  g36: ({ matches }) =>
    byCompetition(
      matches.filter((m) => s(m, 'goals_corner') !== null),
      [
        { label: 'Córner', slot: 1, value: (g) => sum(g.map((m) => s(m, 'goals_corner'))) },
        { label: 'Tiro libre', slot: 2, value: (g) => sum(g.map((m) => s(m, 'goals_free_kick'))) },
        { label: 'Penal', slot: 4, value: (g) => sum(g.map((m) => s(m, 'goals_penalty'))) },
      ],
      'Goles de pelota parada por tipo (liga)',
      true,
    ),
  g37: ({ matches }) => {
    const ms = matches.filter((m) => s(m, 'penalties_attempted') !== null);
    const rows = [
      ['A favor', sum(ms.map((m) => s(m, 'penalties_attempted'))), sum(ms.map((m) => s(m, 'penalties_scored')))],
      [
        'En contra',
        sum(ms.map((m) => s(m, 'penalties_attempted_against'))),
        sum(ms.map((m) => s(m, 'penalties_scored_against'))),
      ],
    ] as const;
    return {
      node: (
        <BarChart
          labels={rows.map((r) => r[0])}
          series={[
            { id: 'a', label: 'Pateados', slot: 2, values: rows.map((r) => r[1]) },
            { id: 'c', label: 'Convertidos', slot: 1, values: rows.map((r) => r[2]) },
          ]}
          label="Penales a favor y en contra (liga)"
        />
      ),
      table: { head: ['', 'Pateados', 'Convertidos'], rows: rows.map((r) => [...r]) },
      coverage: covered(matches, 'penalties_attempted'),
    };
  },
  g38: ({ matches }) =>
    perMatchLine(
      matches.filter((m) => s(m, 'xg_set_pieces') !== null),
      [
        { key: 'xg_set_pieces', label: 'xG de pelota parada a favor', slot: 1 },
        { key: 'xg_set_pieces_against', label: 'En contra', slot: 2 },
      ],
    ),

  // --- G. Jugadores --------------------------------------------------------------------------
  g39: ({ data, regulars }) => ({
    node: <ScatterConfig players={regulars} catalog={data.playerCatalog} />,
    table: {
      head: ['Jugador', 'xG cada 90', 'Goles cada 90'],
      rows: regulars.map((p) => [
        p.name,
        pv(p, data.playerCatalog, 'xg', true),
        pv(p, data.playerCatalog, 'goles', true),
      ]),
    },
  }),
  g40: ({ data, regulars }) => ({
    node: (
      <Selectable
        label="Estadística"
        options={statOptions(data.playerCatalog)}
        initial="goles_asistencias"
        render={(id) =>
          outputNode(
            rankingChart(
              regulars.map((p) => ({ label: p.name, value: pv(p, data.playerCatalog, id) })),
              statById(data.playerCatalog, id)?.name ?? id,
            ),
          )
        }
      />
    ),
    table: {
      head: ['Jugador', 'G+A'],
      rows: regulars.map((p) => [p.name, pv(p, data.playerCatalog, 'goles_asistencias')]),
    },
  }),
  g41: ({ data, regulars }) => ({
    node: (
      <Selectable
        label="Estadística"
        options={statOptions(data.playerCatalog)}
        initial="calificacion"
        render={(id) => {
          const values = regulars.map((p) => pv(p, data.playerCatalog, id)).filter((v): v is number => v !== null);
          const b = bins(values, 6);
          return b.length ? (
            <BarChart
              labels={b.map((x) => `${x.from.toFixed(1)}-${x.to.toFixed(1)}`)}
              series={[{ id: 'n', label: 'Jugadores', slot: 2, values: b.map((x) => x.count) }]}
              label="Distribución en el plantel"
            />
          ) : (
            <p className="text-sm text-muted">Sin datos.</p>
          );
        }}
      />
    ),
    table: {
      head: ['Jugador', 'Calificación'],
      rows: regulars.map((p) => [p.name, pv(p, data.playerCatalog, 'calificacion')]),
    },
  }),
  g42: ({ data, matches, regulars }) => ({
    node: (
      <Selectable
        label="Jugador"
        options={playerOptions(regulars)}
        initial={String(regulars[0]?.playerId ?? '')}
        render={(id) => playerSeries(data, matches, Number(id), 'goals', 'Goles', true)}
      />
    ),
    table: { head: ['Jugador', 'Goles'], rows: regulars.map((p) => [p.name, pv(p, data.playerCatalog, 'goles')]) },
  }),
  g43: ({ data, matches, regulars }) => ({
    node: (
      <Selectable
        label="Jugador"
        options={playerOptions(regulars)}
        initial={String(regulars[0]?.playerId ?? '')}
        render={(id) => {
          const byMatch = data.playerMatches[Number(id)] ?? {};
          const ms = matches.filter((m) => byMatch[m.matchId]);
          return (
            <BarChart
              stacked
              labels={ms.map(day)}
              series={[
                {
                  id: 't',
                  label: 'Como titular',
                  slot: 1,
                  values: ms.map((m) => (byMatch[m.matchId]?.starts ? (byMatch[m.matchId]?.minutes ?? 0) : null)),
                },
                {
                  id: 's',
                  label: 'Desde el banco',
                  slot: 4,
                  values: ms.map((m) => (!byMatch[m.matchId]?.starts ? (byMatch[m.matchId]?.minutes ?? 0) : null)),
                },
              ]}
              label="Minutos por partido"
            />
          );
        }}
      />
    ),
    table: { head: ['Jugador', 'Minutos'], rows: regulars.map((p) => [p.name, p.minutes]) },
  }),
  g44: ({ data, regulars }) => {
    const ids = [
      'goles',
      'asistencias',
      'xg',
      'xa',
      'pases_clave',
      'regates_exitosos',
      'intercepciones',
      'entradas',
      'calificacion',
    ];
    const stats = ids.flatMap((id) => statById(data.playerCatalog, id) ?? []);
    const rows = regulars.slice(0, 18);
    const values = rows.map((p) =>
      stats.map((st) => {
        const v = playerValue(p, st, st.per90);
        const all = regulars.map((q) => playerValue(q, st, st.per90)).filter((x): x is number => typeof x === 'number');
        return typeof v === 'number' ? rankAndPercentile(all, v, st.higherIsBetter).percentile : null;
      }),
    );
    return {
      node: (
        <Heatmap
          rows={rows.map((p) => p.name)}
          cols={stats.map((st) => st.short)}
          values={values}
          label="Percentil de cada jugador en el plantel (cada 90 minutos)"
        />
      ),
      table: {
        head: ['Jugador', ...stats.map((st) => st.name)],
        rows: rows.map((p, i) => [p.name, ...(values[i] ?? [])]),
      },
    };
  },
  g45: ({ data }) => {
    const list = data.players
      .map((p) => ({ p, g: pv(p, data.playerCatalog, 'goles') ?? 0, a: pv(p, data.playerCatalog, 'asistencias') ?? 0 }))
      .filter((x) => x.g + x.a > 0)
      .sort((x, y) => y.g + y.a - (x.g + x.a))
      .slice(0, 14);
    return {
      node: (
        <BarChart
          horizontal
          stacked
          labels={list.map((x) => x.p.name)}
          series={[
            { id: 'g', label: 'Goles', slot: 1, values: list.map((x) => x.g) },
            { id: 'a', label: 'Asistencias', slot: 2, values: list.map((x) => x.a) },
          ]}
          label="Goles y asistencias por jugador"
        />
      ),
      table: { head: ['Jugador', 'Goles', 'Asistencias'], rows: list.map((x) => [x.p.name, x.g, x.a]) },
    };
  },
  g46: ({ data, matches }) => {
    const ratings = matches.map((m) =>
      avg(Object.values(data.playerMatches).map((pm) => pm[m.matchId]?.rating ?? null)),
    );
    return perMatchLineFromValues(matches, ratings, 'Calificación media del equipo');
  },
  g47: ({ data, regulars }) => ({
    node: (
      <ScatterChart
        diagonal
        points={regulars.flatMap((p) => {
          const x = pv(p, data.playerCatalog, 'xg');
          const y = pv(p, data.playerCatalog, 'goles');
          return x === null || y === null ? [] : [{ x, y, label: p.name, slot: 1 }];
        })}
        xLabel="xG"
        yLabel="Goles"
        label="Goles frente a xG por jugador; arriba de la diagonal convierte más de lo esperado"
      />
    ),
    table: {
      head: ['Jugador', 'xG', 'Goles'],
      rows: regulars.map((p) => [p.name, pv(p, data.playerCatalog, 'xg'), pv(p, data.playerCatalog, 'goles')]),
    },
  }),
  g48: ({ data }) => {
    const ages = [...new Set(data.players.map((p) => p.age).filter((a): a is number => a !== null))].sort(
      (a, b) => a - b,
    );
    const minutes = ages.map((a) => sum(data.players.filter((p) => p.age === a).map((p) => p.minutes)));
    return {
      node: (
        <BarChart
          horizontal
          labels={ages.map((a) => `${String(a)} años`)}
          series={[{ id: 'm', label: 'Minutos', slot: 2, values: minutes }]}
          label="Minutos jugados por edad"
        />
      ),
      table: { head: ['Edad', 'Minutos'], rows: ages.map((a, i) => [a, minutes[i] ?? 0]) },
    };
  },

  // --- H. Plantel y carga --------------------------------------------------------------------
  g49: ({ data, regulars }) => {
    const list = regulars.slice(0, 12);
    const ids = ['carga_7d', 'carga_14d', 'carga_28d'];
    return {
      node: (
        <BarChart
          horizontal
          labels={list.map((p) => p.name)}
          series={ids.map((id, k) => ({
            id,
            label: `${['7', '14', '28'][k] ?? ''} días`,
            slot: ([1, 2, 4] as const)[k] ?? 1,
            values: list.map((p) => pv(p, data.playerCatalog, id)),
          }))}
          label="Minutos en los últimos 7, 14 y 28 días"
        />
      ),
      table: {
        head: ['Jugador', '7 días', '14 días', '28 días'],
        rows: list.map((p) => [p.name, ...ids.map((id) => pv(p, data.playerCatalog, id))]),
      },
    };
  },
  g50: ({ matches }) =>
    scatterMatches(
      matches.filter((m) => s(m, 'rest_days') !== null),
      (m) => s(m, 'rest_days'),
      points,
      'Días de descanso',
      'Puntos',
    ),
  g51: ({ matches }) => {
    const ms = matches.filter((m) => s(m, 'eq_rotacion') !== null);
    return {
      node: (
        <BarChart
          labels={ms.map(day)}
          series={[{ id: 'r', label: 'Cambios en el once', slot: 2, values: ms.map((m) => s(m, 'eq_rotacion')) }]}
          label="Titulares nuevos respecto del partido anterior"
        />
      ),
      table: { head: ['Partido', 'Cambios en el once'], rows: ms.map((m) => [matchLabel(m), s(m, 'eq_rotacion')]) },
    };
  },
  g52: ({ data }) => {
    const positions = ['Arquero', 'Defensor', 'Mediocampista', 'Delantero'];
    const starters = positions.map((pos) =>
      sum(data.players.filter((p) => p.position === pos).map((p) => pv(p, data.playerCatalog, 'minutos') ?? 0)),
    );
    const subs = positions.map((pos) =>
      sum(
        data.players
          .filter((p) => p.position === pos)
          .map((p) => pv(p, data.playerCatalog, 'minutos_como_suplente') ?? 0),
      ),
    );
    return {
      node: (
        <BarChart
          stacked
          labels={positions}
          series={[
            { id: 't', label: 'Como titular', slot: 1, values: starters.map((t, i) => t - (subs[i] ?? 0)) },
            { id: 's', label: 'Desde el banco', slot: 4, values: subs },
          ]}
          label="Minutos por posición"
        />
      ),
      table: {
        head: ['Posición', 'Como titular', 'Desde el banco'],
        rows: positions.map((p, i) => [p, (starters[i] ?? 0) - (subs[i] ?? 0), subs[i] ?? 0]),
      },
    };
  },

  // --- I. Competición ------------------------------------------------------------------------
  g53: ({ data }) => {
    const ids = [
      'eq_goles_favor',
      'eq_goles_contra',
      'eq_xg',
      'eq_xg_contra',
      'eq_remates',
      'eq_remates_contra',
      'eq_posesion',
      'eq_pct_pases',
      'eq_corners',
      'eq_faltas',
      'eq_pct_vallas',
    ];
    const rows = ids.flatMap((id) => {
      const st = statById(data.teamCatalog, id);
      const cmp = st ? leagueComparison(id, st.higherIsBetter, data.clubs) : null;
      return st && cmp?.bocaPercentile !== null && cmp ? [{ label: st.name, value: cmp.bocaPercentile }] : [];
    });
    if (!rows.length) return { empty: 'Sin promedios de la liga.' };
    return {
      node: (
        <BarChart
          horizontal
          labels={rows.map((r) => r.label)}
          series={[{ id: 'p', label: 'Percentil', slot: 1, values: rows.map((r) => r.value) }]}
          label="Percentil de Boca entre los 30 clubes (100 = el mejor)"
        />
      ),
      table: { head: ['Estadística', 'Percentil de Boca'], rows: rows.map((r) => [r.label, r.value]) },
    };
  },
  g54: ({ matches }) => perMatchLine(matches, [{ key: 'eq_elo', label: 'Elo de Boca', slot: 1 }]),
  g55: ({ matches }) => {
    const ms = matches.filter((m) => s(m, 'eq_elo_rival') !== null);
    return {
      node: (
        <BarChart
          labels={ms.map(day)}
          series={[
            { id: 'e', label: 'Elo del rival', slot: 2, values: ms.map((m) => (s(m, 'eq_elo_rival') ?? 1500) - 1500) },
          ]}
          format={(v) => String(Math.round(v + 1500))}
          label="Elo del rival (las barras parten de 1500, el promedio)"
        />
      ),
      table: { head: ['Partido', 'Elo del rival'], rows: ms.map((m) => [matchLabel(m), s(m, 'eq_elo_rival')]) },
      coverage: covered(matches, 'eq_elo_rival'),
    };
  },
  g56: ({ data }) => {
    const pts = data.clubs.flatMap((c): ScatterPoint[] =>
      c.stats.goals_for === undefined || c.stats.goals_against === undefined
        ? []
        : [{ x: c.stats.goals_for, y: c.stats.goals_against, label: c.team, slot: c.team === 'Boca Juniors' ? 1 : 2 }],
    );
    if (!pts.length) return { empty: 'Sin promedios de la liga.' };
    return {
      node: (
        <ScatterChart
          medians
          points={pts}
          groups={[
            { label: 'Boca', slot: 1 },
            { label: 'Resto de la liga', slot: 2 },
          ]}
          xLabel="Goles a favor por partido"
          yLabel="Goles en contra por partido"
          label="Ataque frente a defensa de los 30 clubes (abajo a la derecha es mejor)"
        />
      ),
      table: { head: ['Club', 'Goles a favor', 'Goles en contra'], rows: pts.map((p) => [p.label, p.x, p.y]) },
    };
  },
  g57: ({ data }) =>
    rankingChart(
      data.leaders.map((l) => ({ label: `${l.name} (${l.team})`, value: l.value })),
      'Goles en la liga',
      15,
    ),
  g58: ({ data }) =>
    rankingChart(
      data.referees.map((r) => ({ label: r.name, value: r.yellow })),
      'Amarillas por partido',
      15,
    ),

  // --- J. Disciplina -------------------------------------------------------------------------
  g59: ({ matches }) =>
    perMatchLine(
      matches,
      [
        { key: 'yellow_cards', label: 'Amarillas de Boca', slot: 4 },
        { key: 'yellow_cards_against', label: 'Amarillas del rival', slot: 2 },
      ],
      5,
    ),
  g60: ({ matches }) =>
    scatterMatches(
      matches.filter((m) => s(m, 'fouls') !== null),
      (m) => s(m, 'fouls'),
      points,
      'Faltas cometidas',
      'Puntos',
    ),
  g61: ({ data }) => {
    const list = data.players
      .map((p) => ({ p, y: pv(p, data.playerCatalog, 'amarillas') ?? 0, r: pv(p, data.playerCatalog, 'rojas') ?? 0 }))
      .filter((x) => x.y + x.r > 0)
      .sort((a, b) => b.y + 3 * b.r - (a.y + 3 * a.r))
      .slice(0, 14);
    return {
      node: (
        <BarChart
          horizontal
          stacked
          labels={list.map((x) => x.p.name)}
          series={[
            { id: 'y', label: 'Amarillas', slot: 4, values: list.map((x) => x.y) },
            { id: 'r', label: 'Rojas', slot: 2, values: list.map((x) => x.r) },
          ]}
          label="Tarjetas por jugador"
        />
      ),
      table: { head: ['Jugador', 'Amarillas', 'Rojas'], rows: list.map((x) => [x.p.name, x.y, x.r]) },
    };
  },

  // --- K. Métricas propias -------------------------------------------------------------------
  g62: ({ data, regulars }) => {
    const list = regulars.slice(0, 14);
    return {
      node: (
        <BarChart
          horizontal
          labels={list.map((p) => p.name)}
          series={[
            {
              id: 'ewa',
              label: 'EWA (victorias que suma)',
              slot: 1,
              values: list.map((p) => pv(p, data.playerCatalog, 'ewa')),
            },
            {
              id: 'ela',
              label: 'ELA (derrotas que suma; negativo es bueno)',
              slot: 2,
              values: list.map((p) => pv(p, data.playerCatalog, 'ela')),
            },
          ]}
          label="EWA y ELA por jugador frente a su reemplazo"
        />
      ),
      table: {
        head: ['Jugador', 'NR', 'EWA', 'ELA'],
        rows: list.map((p) => [
          p.name,
          pv(p, data.playerCatalog, 'nr'),
          pv(p, data.playerCatalog, 'ewa'),
          pv(p, data.playerCatalog, 'ela'),
        ]),
      },
    };
  },
  g63: ({ matches }) => ({
    node: (
      <BarChart
        labels={matches.map(day)}
        series={[
          { id: 'dg', label: 'Diferencia de gol', slot: 1, values: matches.map((m) => m.goalsFor - m.goalsAgainst) },
        ]}
        label="Diferencia de gol por partido"
      />
    ),
    table: {
      head: ['Partido', 'Diferencia de gol'],
      rows: matches.map((m) => [matchLabel(m), m.goalsFor - m.goalsAgainst]),
    },
  }),
  g64: ({ data, regulars }) => {
    const ids = ['goles', 'xg', 'remates', 'pases_clave', 'xa', 'regates_exitosos', 'intercepciones', 'calificacion'];
    const stats = ids.flatMap((id) => statById(data.playerCatalog, id) ?? []);
    const col = (st: StatDef) => regulars.map((p) => playerValue(p, st, st.per90));
    const values = stats.map((a) =>
      stats.map((b) => {
        const pairs = col(a).flatMap((v, i) => {
          const w = col(b)[i];
          return typeof v === 'number' && typeof w === 'number' ? [[v, w] as const] : [];
        });
        return pearson(
          pairs.map((p) => p[0]),
          pairs.map((p) => p[1]),
        );
      }),
    );
    return {
      node: (
        <Heatmap
          diverging
          rows={stats.map((st) => st.name)}
          cols={stats.map((st) => st.short)}
          values={values}
          label="Correlación entre estadísticas cada 90 minutos (verde positiva, naranja negativa)"
        />
      ),
      table: {
        head: ['', ...stats.map((st) => st.short)],
        rows: stats.map((st, i) => [st.name, ...(values[i] ?? [])]),
      },
    };
  },

  // --- L. Situaciones ------------------------------------------------------------------------
  g65: ({ matches }) => {
    const states = [
      {
        label: 'Ganando al descanso',
        test: (m: TeamMatchRow) => (s(m, 'goals_for_ht') ?? 0) > (s(m, 'goals_against_ht') ?? 0),
      },
      {
        label: 'Empatando',
        test: (m: TeamMatchRow) => (s(m, 'goals_for_ht') ?? 0) === (s(m, 'goals_against_ht') ?? 0),
      },
      { label: 'Perdiendo', test: (m: TeamMatchRow) => (s(m, 'goals_for_ht') ?? 0) < (s(m, 'goals_against_ht') ?? 0) },
    ];
    const ms = matches.filter((m) => s(m, 'goals_for_ht') !== null);
    return {
      node: (
        <BarChart
          stacked
          labels={states.map((x) => x.label)}
          series={['G', 'E', 'P'].map((r) => ({
            id: r,
            label: RESULT_NAME[r] ?? r,
            slot: RESULT_SLOT[r] ?? 1,
            values: states.map((x) => ms.filter((m) => x.test(m) && result(m) === r).length),
          }))}
          label="Resultado final según el marcador al descanso"
        />
      ),
      table: {
        head: ['Al descanso', 'Ganados', 'Empatados', 'Perdidos'],
        rows: states.map((x) => [
          x.label,
          ...['G', 'E', 'P'].map((r) => ms.filter((m) => x.test(m) && result(m) === r).length),
        ]),
      },
    };
  },
  g66: ({ data }) => {
    // Puntos por partido según cómo iba Boca en el 60, el 75 y el 85 (tarjetas s006 a s011).
    const ppg = (ids: string[], filter: (param: string) => boolean = () => true) => {
      const rows = ids.flatMap((id) => (data.situations[id] ?? []).filter((r) => filter(r.param)));
      const n = rows.reduce((a, r) => a + r.n, 0);
      return n ? rows.reduce((a, r) => a + r.ppg * r.n, 0) / n : null;
    };
    const minutes = ['Minuto 60', 'Minuto 75', 'Minuto 85'];
    const ahead = [ppg(['s006']), ppg(['s007']), ppg(['s008'])];
    const level = [null, ppg(['s011'], (p) => p.endsWith('75')), ppg(['s011'], (p) => p.endsWith('85'))];
    const behind = [ppg(['s009']), ppg(['s010']), null];
    if ([...ahead, ...level, ...behind].every((v) => v === null)) return { empty: 'Sin goles con minuto cargados.' };
    return {
      node: (
        <BarChart
          labels={minutes}
          series={[
            { id: 'g', label: 'Ganando', slot: 1, values: ahead },
            { id: 'e', label: 'Empatando', slot: 4, values: level },
            { id: 'p', label: 'Perdiendo', slot: 2, values: behind },
          ]}
          format={(v) => v.toFixed(2).replace('.', ',')}
          label="Puntos por partido según el marcador en los minutos 60, 75 y 85"
        />
      ),
      table: {
        head: ['Momento', 'Ganando', 'Empatando', 'Perdiendo'],
        rows: minutes.map((m, i) => [m, ahead[i] ?? null, level[i] ?? null, behind[i] ?? null]),
      },
      coverage: 'empate en el 60 y desventaja en el 85: sin tarjeta',
    };
  },
  g67: ({ matches }) => {
    const order = ['G', 'E', 'P'];
    const pairs = matches.slice(1).map((m, i) => [result(matches[i] ?? m), result(m)] as [string, string]);
    const values = countMatrix(pairs, order, order);
    return {
      node: (
        <Heatmap
          rows={order.map((r) => `Tras ${RESULT_NAME[r]?.toLowerCase() ?? r}`)}
          cols={order.map((r) => RESULT_NAME[r] ?? r)}
          values={values}
          label="Qué pasó en el partido siguiente según el resultado anterior"
        />
      ),
      table: {
        head: ['Resultado anterior', ...order.map((r) => RESULT_NAME[r] ?? r)],
        rows: order.map((r, i) => [RESULT_NAME[r] ?? r, ...(values[i] ?? [])]),
      },
    };
  },

  // --- M. Modelos, contexto y calendario -----------------------------------------------------
  g68: ({ matches }) => {
    const ms = matches.filter((m) => s(m, 'eq_prob_victoria') !== null).slice(-20);
    return {
      node: (
        <BarChart
          stacked
          labels={ms.map((m) => `${day(m)} ${result(m)}`)}
          series={[
            { id: 'v', label: 'Victoria', slot: 1, values: ms.map((m) => s(m, 'eq_prob_victoria')) },
            { id: 'e', label: 'Empate', slot: 4, values: ms.map((m) => s(m, 'eq_prob_empate')) },
            { id: 'd', label: 'Derrota', slot: 2, values: ms.map((m) => s(m, 'eq_prob_derrota')) },
          ]}
          format={(v) => `${String(Math.round(v))} %`}
          label="Probabilidades del Elo antes de cada partido; la letra es el resultado real"
        />
      ),
      table: {
        head: ['Partido', 'P(victoria)', 'P(empate)', 'P(derrota)', 'Resultado'],
        rows: ms.map((m) => [
          matchLabel(m),
          s(m, 'eq_prob_victoria'),
          s(m, 'eq_prob_empate'),
          s(m, 'eq_prob_derrota'),
          result(m),
        ]),
      },
      coverage: covered(matches, 'eq_prob_victoria'),
    };
  },
  g69: ({ matches }) => {
    const ms = matches.filter((m) => s(m, 'eq_prob_victoria') !== null);
    const groups = [0, 25, 50, 75].map((lo) =>
      ms.filter((m) => (s(m, 'eq_prob_victoria') ?? 0) >= lo && (s(m, 'eq_prob_victoria') ?? 0) < lo + 25),
    );
    const pts: ScatterPoint[] = groups.flatMap((g, i) =>
      g.length
        ? [
            {
              x: avg(g.map((m) => s(m, 'eq_prob_victoria'))) ?? 0,
              y: (g.filter((m) => result(m) === 'G').length / g.length) * 100,
              label: `${String(i * 25)}-${String(i * 25 + 25)} % (${String(g.length)} partidos)`,
              slot: 1,
              size: g.length / ms.length,
            },
          ]
        : [],
    );
    const brier = avg(ms.map((m) => s(m, 'eq_brier')));
    return {
      node: (
        <>
          <ScatterChart
            diagonal
            points={pts}
            xLabel="Probabilidad prevista (%)"
            yLabel="Victorias reales (%)"
            label="Calibración del Elo: sobre la diagonal, el modelo acierta"
          />
          <p className="text-xs text-muted">
            Brier promedio: {brier === null ? 'n/d' : brier.toFixed(3)} (0 es perfecto; 0,667 es tirar una moneda entre
            tres).
          </p>
        </>
      ),
      table: { head: ['Grupo', 'Prevista', 'Real'], rows: pts.map((p) => [p.label, p.x, p.y]) },
    };
  },
  g70: ({ matches }) =>
    byCompetition(
      matches,
      [
        { label: 'Local', slot: 1, value: (g) => avg(g.filter((m) => m.home).map(points)) },
        { label: 'Visitante', slot: 2, value: (g) => avg(g.filter((m) => !m.home).map(points)) },
      ],
      'Puntos por partido de local y de visitante',
    ),
  g71: ({ matches }) => ({
    node: (
      <Strip
        items={matches.map((m) => ({
          label: m.date.slice(8, 10),
          slot: RESULT_SLOT[result(m)] ?? null,
          title: `${matchLabel(m)}: ${String(m.goalsFor)}-${String(m.goalsAgainst)}`,
        }))}
        label="Calendario: día del mes y resultado de cada partido"
      />
    ),
    table: {
      head: ['Fecha', 'Rival', 'Resultado'],
      rows: matches.map((m) => [m.date, m.opponent, `${String(m.goalsFor)}-${String(m.goalsAgainst)}`]),
    },
  }),
  g72: ({ matches }) => {
    const kind = (m: TeamMatchRow): [string, Slot | null] =>
      m.goalsFor - m.goalsAgainst >= 3
        ? ['Goleada a favor', 1]
        : m.goalsAgainst - m.goalsFor >= 3
          ? ['Goleada en contra', 5]
          : (s(m, 'red_cards') ?? 0) > 0
            ? ['Expulsión de Boca', 2]
            : ['', null];
    return {
      node: (
        <>
          <Strip
            items={matches.map((m) => ({
              label: '',
              slot: kind(m)[1],
              title: `${matchLabel(m)}: ${kind(m)[0] || 'sin hitos'}`,
            }))}
            label="Hitos de la temporada"
          />
          <Legend
            items={[
              { label: 'Goleada a favor', slot: 1 },
              { label: 'Goleada en contra', slot: 2 },
              { label: 'Expulsión de Boca', slot: 3 },
            ]}
          />
        </>
      ),
      table: {
        head: ['Partido', 'Hito'],
        rows: matches.flatMap((m) => (kind(m)[0] ? [[matchLabel(m), kind(m)[0]]] : [])),
      },
    };
  },
  g73: ({ matches }) =>
    perMatchLine(matches, [{ key: 'eq_estabilidad_once', label: 'Repetición del once (Jaccard)', slot: 1 }]),
  g74: ({ data }) => {
    const ids = [
      ['eq_min_hasta_21', 'Hasta 21'],
      ['eq_min_22_26', '22 a 26'],
      ['eq_min_27_31', '27 a 31'],
      ['eq_min_32_mas', '32 o más'],
    ] as const;
    const values = ids.map(([id]) => data.windowValues.todas?.[id] ?? null);
    return {
      node: (
        <BarChart
          labels={ids.map(([, l]) => l)}
          series={[{ id: 'm', label: '% de los minutos', slot: 2, values }]}
          format={(v) => `${String(Math.round(v))} %`}
          label="Reparto de los minutos por edad"
        />
      ),
      table: { head: ['Edad', '% de los minutos'], rows: ids.map(([, l], i) => [l, values[i] ?? null]) },
    };
  },
  g75: ({ data }) =>
    rankingChart(
      data.players.map((p) => ({ label: p.name, value: pv(p, data.playerCatalog, 'racha_goles') })),
      'Partidos seguidos con gol',
      10,
    ),
  g76: ({ data, matches }) => {
    const current = cumulative(matches.filter((m) => m.competitionCode.startsWith('liga')).map(points));
    const previous = cumulative(data.previousSeason.map((p) => p.points));
    const n = Math.max(current.length, previous.length);
    if (!previous.length) return { empty: 'No se cargó la temporada anterior.' };
    const labels = Array.from({ length: n }, (_, i) => String(i + 1));
    return {
      node: (
        <LineChart
          labels={labels}
          series={[
            { id: '2026', label: '2026', slot: 1, values: labels.map((_, i) => current[i] ?? null) },
            { id: '2025', label: '2025', slot: 2, values: labels.map((_, i) => previous[i] ?? null) },
          ]}
          label="Puntos acumulados en la liga por partido jugado: 2026 contra 2025"
        />
      ),
      table: {
        head: ['Partido de liga', '2026', '2025'],
        rows: labels.map((l, i) => [l, current[i] ?? null, previous[i] ?? null]),
      },
    };
  },
  g77: ({ matches }) =>
    scatterMatches(
      matches.filter((m) => s(m, 'temperature_c') !== null),
      (m) => s(m, 'temperature_c'),
      points,
      'Temperatura (°C)',
      'Puntos',
    ),

  // --- O. Táctica ----------------------------------------------------------------------------
  g85: ({ data, matches }) =>
    formationChart(matches, (m) => data.formations[m.matchId]?.boca ?? null, 'Formación de Boca'),
  g86: ({ data, matches }) =>
    formationChart(matches, (m) => data.formations[m.matchId]?.rival ?? null, 'Formación del rival'),
  g87: ({ data }) => {
    if (!data.momentum.length) return { empty: 'Sin momentum cargado.' };
    return {
      node: (
        <LineChart
          area
          labels={data.momentum.map((x) => String(x.minute))}
          series={[{ id: 'm', label: 'Momentum de Boca', slot: 1, values: data.momentum.map((x) => x.value) }]}
          label="Momentum promedio por minuto (positivo: domina Boca)"
        />
      ),
      table: { head: ['Minuto', 'Momentum'], rows: data.momentum.map((x) => [x.minute, x.value]) },
    };
  },
  g88: ({ matches }) => {
    const ms = matches.filter((m) => s(m, 'passes_against') !== null && s(m, 'defensive_actions_ppda'));
    const ppda = ms.map((m) => (s(m, 'passes_against') ?? 0) / (s(m, 'defensive_actions_ppda') ?? 1));
    return {
      node: (
        <LineChart
          labels={ms.map(day)}
          series={[
            { id: 'p', label: 'PPDA', slot: 2, values: ppda },
            { id: 'r', label: 'Media de 5', slot: 1, values: rolling(ppda, 5) },
          ]}
          label="PPDA por partido con promedio móvil"
        />
      ),
      table: { head: ['Partido', 'PPDA'], rows: ms.map((m, i) => [matchLabel(m), ppda[i] ?? null]) },
      coverage: covered(matches, 'passes_against'),
    };
  },
  g89: ({ matches }) => {
    const axes = [
      ['Posesión', 'possession_pct'],
      ['Pases', 'passes'],
      ['Pases largos', 'long_passes'],
      ['Centros', 'crosses'],
      ['Regates', 'dribbles_successful'],
      ['Ataques peligrosos', 'dangerous_attacks'],
    ] as const;
    const boca = axes.map(([, k]) => avg(matches.map((m) => s(m, k))) ?? 0);
    const rival = axes.map(([, k]) => avg(matches.map((m) => s(m, `${k}_against`))) ?? 0);
    const norm = (v: number, i: number) => (v / Math.max(boca[i] ?? 1, rival[i] ?? 1, 1e-9)) * 100;
    return {
      node: (
        <Radar
          axes={axes.map(([l]) => l)}
          series={[
            { id: 'b', label: 'Boca', slot: 1, values: boca.map(norm) },
            { id: 'r', label: 'Sus rivales', slot: 2, values: rival.map(norm) },
          ]}
          label="Perfil de estilo: Boca frente al promedio de sus rivales (100 = el mayor de los dos)"
        />
      ),
      table: {
        head: ['Estadística', 'Boca', 'Rivales'],
        rows: axes.map(([l], i) => [l, boca[i] ?? null, rival[i] ?? null]),
      },
    };
  },
  g90: ({ matches }) => {
    const ms = matches.filter((m) => s(m, 'xg_open_play') !== null);
    return {
      node: (
        <BarChart
          stacked
          labels={ms.map(day)}
          series={[
            { id: 'j', label: 'De jugada', slot: 1, values: ms.map((m) => s(m, 'xg_open_play')) },
            { id: 'p', label: 'De pelota parada', slot: 4, values: ms.map((m) => s(m, 'xg_set_pieces')) },
          ]}
          label="xG de jugada y de pelota parada por partido"
        />
      ),
      table: {
        head: ['Partido', 'xG de jugada', 'xG de pelota parada'],
        rows: ms.map((m) => [matchLabel(m), s(m, 'xg_open_play'), s(m, 'xg_set_pieces')]),
      },
      coverage: covered(matches, 'xg_open_play'),
    };
  },
  g91: ({ matches }) => {
    const ms = matches.filter((m) => s(m, 'xgot') !== null && s(m, 'xg') !== null);
    return {
      node: (
        <BarChart
          labels={ms.map(day)}
          series={[
            {
              id: 'd',
              label: 'Calidad de definición (xGOT − xG)',
              slot: 1,
              values: ms.map((m) => (s(m, 'xgot') ?? 0) - (s(m, 'xg') ?? 0)),
            },
            {
              id: 'e',
              label: 'Goles evitados (xGOT rival − GC)',
              slot: 2,
              values: ms.map((m) => (s(m, 'xgot_against') ?? 0) - m.goalsAgainst),
            },
          ]}
          label="Calidad de definición y goles evitados por partido"
        />
      ),
      table: {
        head: ['Partido', 'xGOT − xG', 'Goles evitados'],
        rows: ms.map((m) => [
          matchLabel(m),
          (s(m, 'xgot') ?? 0) - (s(m, 'xg') ?? 0),
          (s(m, 'xgot_against') ?? 0) - m.goalsAgainst,
        ]),
      },
      coverage: covered(matches, 'xgot'),
    };
  },
  g92: ({ matches }) =>
    byCompetition(
      matches.filter((m) => s(m, 'big_chances') !== null),
      [
        { label: 'Creadas', slot: 1, value: (g) => avg(g.map((m) => s(m, 'big_chances'))) },
        { label: 'Falladas', slot: 4, value: (g) => avg(g.map((m) => s(m, 'big_chances_missed'))) },
        { label: 'Concedidas', slot: 2, value: (g) => avg(g.map((m) => s(m, 'big_chances_against'))) },
      ],
      'Ocasiones claras por partido',
    ),
  g93: ({ matches }) =>
    byCompetition(
      matches.filter((m) => s(m, 'shots_inside_box') !== null),
      [
        { label: 'Dentro del área', slot: 1, value: (g) => avg(g.map((m) => s(m, 'shots_inside_box'))) },
        { label: 'Fuera del área', slot: 2, value: (g) => avg(g.map((m) => s(m, 'shots_outside_box'))) },
      ],
      'Remates por partido según la zona',
      true,
    ),
  g94: ({ matches }) =>
    scatterMatches(
      matches.filter((m) => s(m, 'passes') && s(m, 'possession_pct') !== null),
      (m) => s(m, 'possession_pct'),
      (m) => ((s(m, 'long_passes') ?? 0) / (s(m, 'passes') ?? 1)) * 100,
      'Posesión (%)',
      'Pases largos (%)',
    ),
  g95: ({ matches }) => perMatchLine(matches, [{ key: 'duels_won', label: 'Duelos ganados', slot: 1 }], 5),
  g96: ({ matches }) =>
    scatterMatches(
      matches.filter((m) => s(m, 'eq_xpts') !== null && s(m, 'expected_points') !== null),
      (m) => s(m, 'expected_points'),
      (m) => s(m, 'eq_xpts'),
      'xPts de la fuente',
      'xPts propio',
      true,
    ),

  // --- P. Jugadores avanzados ----------------------------------------------------------------
  g97: ({ data, regulars }) => ({
    node: (
      <Selectable
        label="Jugador"
        options={playerOptions(regulars)}
        initial={String(regulars[0]?.playerId ?? '')}
        render={(id) => {
          const player = regulars.find((p) => String(p.playerId) === id);
          if (!player) return null;
          const ids = [
            'goles_sin_penal',
            'xg',
            'remates_arco',
            'asistencias',
            'pases_clave',
            'xa',
            'pct_pases',
            'regates_exitosos',
            'intercepciones',
            'entradas',
            'recuperaciones',
            'calificacion',
          ];
          const group = regulars.filter((p) => p.position === player.position);
          const rows = ids.flatMap((sid) => {
            const st = statById(data.playerCatalog, sid);
            if (!st) return [];
            const v = playerValue(player, st, st.per90);
            const all = group
              .map((p) => playerValue(p, st, st.per90))
              .filter((x): x is number => typeof x === 'number');
            return typeof v === 'number'
              ? [{ label: st.name, value: rankAndPercentile(all, v, st.higherIsBetter).percentile }]
              : [];
          });
          return (
            <BarChart
              horizontal
              labels={rows.map((r) => r.label)}
              series={[{ id: 'p', label: 'Percentil', slot: 1, values: rows.map((r) => r.value) }]}
              label={`Percentiles de ${player.name} frente a su posición (cada 90 minutos)`}
            />
          );
        }}
      />
    ),
    table: { head: ['Jugador', 'Posición'], rows: regulars.map((p) => [p.name, p.position]) },
  }),
  g98: ({ data, matches, regulars }) => ({
    node: (
      <Selectable
        label="Jugador"
        options={playerOptions(regulars)}
        initial={String(regulars[0]?.playerId ?? '')}
        render={(id) => playerSeries(data, matches, Number(id), 'rating', 'Calificación', false)}
      />
    ),
    table: {
      head: ['Jugador', 'Calificación media'],
      rows: regulars.map((p) => [p.name, pv(p, data.playerCatalog, 'calificacion')]),
    },
  }),
  g99: ({ data, regulars }) => ({
    node: (
      <ScatterChart
        medians
        points={regulars
          .filter((p) => p.position !== 'Arquero')
          .flatMap((p) => {
            const x = pv(p, data.playerCatalog, 'pases_clave', true);
            const y = pv(p, data.playerCatalog, 'remates', true);
            return x === null || y === null
              ? []
              : [
                  {
                    x,
                    y,
                    label: p.name,
                    slot: p.position === 'Delantero' ? 1 : p.position === 'Mediocampista' ? 3 : 2,
                  },
                ];
          })}
        groups={[
          { label: 'Delanteros', slot: 1 },
          { label: 'Mediocampistas', slot: 3 },
          { label: 'Defensores', slot: 2 },
        ]}
        xLabel="Pases clave cada 90"
        yLabel="Remates cada 90"
        label="Creadores (derecha) frente a definidores (arriba)"
      />
    ),
    table: {
      head: ['Jugador', 'Pases clave cada 90', 'Remates cada 90'],
      rows: regulars.map((p) => [
        p.name,
        pv(p, data.playerCatalog, 'pases_clave', true),
        pv(p, data.playerCatalog, 'remates', true),
      ]),
    },
  }),
  g100: ({ data, regulars }) =>
    rankingChart(
      regulars
        .filter((p) => p.position === 'Defensor' || p.position === 'Mediocampista')
        .map((p) => ({ label: p.name, value: pv(p, data.playerCatalog, 'acciones_defensivas', true) })),
      'Acciones defensivas cada 90',
    ),

  // --- Q. Tendencias -------------------------------------------------------------------------
  g101: ({ matches }) => {
    const sides = [
      { label: 'Local', rows: matches.filter((m) => m.home) },
      { label: 'Visitante', rows: matches.filter((m) => !m.home) },
    ];
    return {
      node: (
        <BarChart
          labels={sides.map((x) => x.label)}
          series={[
            {
              id: 'f',
              label: 'xG a favor por partido',
              slot: 1,
              values: sides.map((x) => avg(x.rows.map((m) => s(m, 'xg')))),
            },
            {
              id: 'c',
              label: 'xG en contra por partido',
              slot: 2,
              values: sides.map((x) => avg(x.rows.map((m) => s(m, 'xg_against')))),
            },
          ]}
          label="xG de local y de visitante"
        />
      ),
      table: {
        head: ['Condición', 'xG a favor', 'xG en contra'],
        rows: sides.map((x) => [
          x.label,
          avg(x.rows.map((m) => s(m, 'xg'))),
          avg(x.rows.map((m) => s(m, 'xg_against'))),
        ]),
      },
      coverage: covered(matches, 'xg'),
    };
  },
  g102: ({ matches }) => {
    const sides = [
      { label: 'Local', rows: matches.filter((m) => m.home) },
      { label: 'Visitante', rows: matches.filter((m) => !m.home) },
      { label: 'Total', rows: matches },
    ];
    const pct = (rows: TeamMatchRow[], test: (m: TeamMatchRow) => boolean) =>
      rows.length ? (rows.filter(test).length / rows.length) * 100 : null;
    const tests = [
      { label: 'Ambos marcan', slot: 2 as Slot, test: (m: TeamMatchRow) => m.goalsFor > 0 && m.goalsAgainst > 0 },
      { label: 'Más de 2,5 goles', slot: 4 as Slot, test: (m: TeamMatchRow) => m.goalsFor + m.goalsAgainst > 2.5 },
      { label: 'Valla invicta', slot: 1 as Slot, test: (m: TeamMatchRow) => m.goalsAgainst === 0 },
    ];
    return {
      node: (
        <BarChart
          labels={sides.map((x) => x.label)}
          series={tests.map((t) => ({
            id: t.label,
            label: t.label,
            slot: t.slot,
            values: sides.map((x) => pct(x.rows, t.test)),
          }))}
          format={(v) => `${String(Math.round(v))} %`}
          label="Porcentaje de partidos según condición"
        />
      ),
      table: {
        head: ['Condición', ...tests.map((t) => t.label)],
        rows: sides.map((x) => [x.label, ...tests.map((t) => pct(x.rows, t.test))]),
      },
    };
  },

  // --- N. Evolución y proyección (6.1) -------------------------------------------------------
  g78: ({ data, regulars }) => {
    const pts = regulars.flatMap((p) => {
      const x = pv(p, data.playerCatalog, 'mejoria_alpha');
      const y = pv(p, data.playerCatalog, 'potencial_alpha');
      return x === null || y === null
        ? []
        : [{ x, y, label: p.name, slot: positionSlot(p), size: Math.min(1, p.minutes / 3500) }];
    });
    if (pts.length < 3) return { empty: 'Pocos jugadores con Mejoría α y Potencial α.' };
    return {
      node: (
        <ScatterChart
          medians
          points={pts}
          groups={POSITION_GROUPS}
          xLabel="Mejoría α"
          yLabel="Potencial α"
          label="Mejoría α frente a Potencial α: arriba a la derecha, los que mejoran y tienen techo alto (tamaño: minutos). Estimado."
        />
      ),
      table: { head: ['Jugador', 'Mejoría α', 'Potencial α'], rows: pts.map((p) => [p.label, p.x, p.y]) },
    };
  },
  g79: ({ data }) => {
    const range = data.params.UNCERTAINTY ?? 8;
    const growth = data.params.GROWTH_PER_YEAR ?? 1.5;
    const peak = data.params.PEAK_AGE ?? 27;
    const pts = data.players.flatMap((p) => {
      const v = pv(p, data.playerCatalog, 'potencial_alpha');
      return v === null || p.age === null
        ? []
        : [
            {
              x: p.age,
              y: v,
              label: p.name,
              slot: positionSlot(p),
              low: Math.max(0, v - range),
              high: Math.min(100, v + range),
            },
          ];
    });
    if (pts.length < 3) return { empty: 'Pocos jugadores con Potencial α y edad.' };
    const ages = pts.map((p) => p.x);
    const curve = Array.from(
      { length: Math.max(...ages) - Math.min(...ages) + 1 },
      (_, i) => Math.min(...ages) + i,
    ).map((age) => ({
      x: age,
      y: growth * Math.max(0, peak - age),
    }));
    return {
      node: (
        <ScatterChart
          points={pts}
          groups={POSITION_GROUPS}
          curve={{
            label: `Margen esperado hasta el pico (${String(growth).replace('.', ',')} por año hasta los ${String(peak)})`,
            slot: 4,
            points: curve,
          }}
          xLabel="Edad"
          yLabel="Potencial α"
          label={`Potencial α por edad con su rango de ± ${String(range)} (parámetro del modelo). Estimado.`}
        />
      ),
      table: {
        head: ['Jugador', 'Edad', 'Potencial α', 'Mínimo', 'Máximo'],
        rows: pts.map((p) => [p.label, p.x, p.y, p.low, p.high]),
      },
    };
  },
  g80: ({ data, matches, regulars }) => {
    const withSeries = regulars.filter((p) => data.metricSeries[p.playerId]);
    if (!withSeries.length) return { empty: 'La serie partido a partido de 6.1 todavía no se cargó.' };
    return {
      node: (
        <Selectable
          label="Jugador"
          options={playerOptions(withSeries)}
          initial={String(withSeries[0]?.playerId ?? '')}
          render={(id) => {
            const byMatch = data.metricSeries[Number(id)] ?? {};
            const ms = matches.filter((m) => byMatch[m.matchId]);
            if (ms.length < 2) return <p className="text-sm text-muted">Sin datos: menos de dos partidos con valor.</p>;
            return (
              <LineChart
                labels={ms.map(day)}
                series={[
                  {
                    id: 'a',
                    label: 'Mejoría α',
                    slot: 1,
                    values: ms.map((m) => byMatch[m.matchId]?.mejoria_alpha ?? null),
                  },
                  {
                    id: 'b',
                    label: 'Mejoría β',
                    slot: 3,
                    values: ms.map((m) => byMatch[m.matchId]?.mejoria_beta ?? null),
                  },
                ]}
                includeZero={false}
                label="Mejoría α y β a la fecha de cada partido (sin datos futuros). Estimado."
              />
            );
          }}
        />
      ),
      table: {
        head: ['Jugador', 'Partidos con serie'],
        rows: withSeries.map((p) => [p.name, Object.keys(data.metricSeries[p.playerId] ?? {}).length]),
      },
    };
  },
  g83: ({ data }) => {
    const list = data.players
      .map((p) => ({
        p,
        v: pv(p, data.playerCatalog, 'potencial_beta'),
        c: pv(p, data.playerCatalog, 'rendimiento_cobertura'),
      }))
      .filter((x): x is { p: PlayerRow; v: number; c: number | null } => x.v !== null)
      .sort((a, b) => b.v - a.v)
      .slice(0, 15);
    if (!list.length) return { empty: 'Sin Potencial β calculado.' };
    return {
      node: (
        <BarChart
          horizontal
          labels={list.map((x) => `${x.p.name}${x.c === null ? '' : ` (${String(Math.round(x.c * 100))} %)`}`)}
          series={[{ id: 'p', label: 'Potencial β', slot: 1, values: list.map((x) => x.v) }]}
          label="Potencial β del plantel; entre paréntesis, la cobertura del índice de rendimiento. Estimado."
        />
      ),
      table: { head: ['Jugador', 'Potencial β', 'Cobertura del índice'], rows: list.map((x) => [x.p.name, x.v, x.c]) },
    };
  },
  g84: ({ data, regulars }) => {
    const pair = (a: string, b: string) =>
      regulars.flatMap((p): ScatterPoint[] => {
        const x = pv(p, data.playerCatalog, a);
        const y = pv(p, data.playerCatalog, b);
        return x === null || y === null ? [] : [{ x, y, label: p.name, slot: 1 }];
      });
    const mejoria = pair('mejoria_alpha', 'mejoria_beta');
    const potencial = pair('potencial_alpha', 'potencial_beta');
    if (mejoria.length < 3 && potencial.length < 3) return { empty: 'Pocos jugadores con las dos variantes.' };
    const rho = (pts: ScatterPoint[]) => {
      const r = spearman(
        pts.map((p) => p.x),
        pts.map((p) => p.y),
      );
      return r === null ? 'n/d' : r.toFixed(2).replace('.', ',');
    };
    return {
      node: (
        <div className="grid gap-3">
          <ScatterChart points={potencial} xLabel="Potencial α" yLabel="Potencial β" label="Potencial α frente a β" />
          <ScatterChart points={mejoria} xLabel="Mejoría α" yLabel="Mejoría β" label="Mejoría α frente a β" />
          <p className="text-xs text-muted">
            Correlación de Spearman (1 = mismo orden del plantel, 0 = sin relación): Potencial {rho(potencial)} ·
            Mejoría {rho(mejoria)}.
          </p>
        </div>
      ),
      table: {
        head: ['Jugador', 'Mejoría α', 'Mejoría β', 'Potencial α', 'Potencial β'],
        rows: regulars.map((p) => [
          p.name,
          ...['mejoria_alpha', 'mejoria_beta', 'potencial_alpha', 'potencial_beta'].map((id) =>
            pv(p, data.playerCatalog, id),
          ),
        ]),
      },
    };
  },
  g107: ({ data, regulars }) =>
    playerScatter(data, regulars, 'rendimiento_indice', 'potencial_beta', 'Índice de rendimiento', 'Potencial β'),
};

function perMatchLineFromValues(
  ms: TeamMatchRow[],
  values: (number | null)[],
  name: string,
  coverage?: string,
): ChartOutput {
  if (ms.length < 2) return { empty: 'Menos de dos partidos con este dato en el filtro elegido.' };
  return {
    node: <LineChart labels={ms.map(day)} series={[{ id: 'v', label: name, slot: 1, values }]} label={name} />,
    table: { head: ['Partido', name], rows: ms.map((m, i) => [matchLabel(m), values[i] ?? null]) },
    coverage,
  };
}

function scatterMatches(
  ms: TeamMatchRow[],
  fx: (m: TeamMatchRow) => number | null,
  fy: (m: TeamMatchRow) => number | null,
  xLabel: string,
  yLabel: string,
  diagonal = false,
): ChartOutput {
  const pts = ms.flatMap((m) => {
    const x = fx(m);
    const y = fy(m);
    return x === null || y === null ? [] : [{ x, y, label: matchLabel(m), slot: RESULT_SLOT[result(m)] ?? 1 }];
  });
  if (pts.length < 3) return { empty: 'Menos de tres partidos con estos datos en el filtro elegido.' };
  return {
    node: (
      <ScatterChart
        medians={!diagonal}
        diagonal={diagonal}
        points={pts}
        groups={['G', 'E', 'P'].map((r) => ({ label: RESULT_NAME[r] ?? r, slot: RESULT_SLOT[r] ?? 1 }))}
        xLabel={xLabel}
        yLabel={yLabel}
        label={`${yLabel} frente a ${xLabel.toLowerCase()} por partido`}
      />
    ),
    table: { head: ['Partido', xLabel, yLabel], rows: pts.map((p) => [p.label, p.x, p.y]) },
  };
}

function goalTypes(ms: TeamMatchRow[], suffix: string): ChartOutput {
  const liga = ms.filter((m) => s(m, `goals_header${suffix}`) !== null);
  const total = sum(liga.map((m) => (suffix ? m.goalsAgainst : m.goalsFor)));
  const header = sum(liga.map((m) => s(m, `goals_header${suffix}`)));
  const outside = sum(liga.map((m) => s(m, `goals_outside_box${suffix}`)));
  const penalty = sum(liga.map((m) => s(m, `goals_penalty${suffix}`)));
  const slices = [
    { label: 'De cabeza', value: header },
    { label: 'De afuera del área', value: outside },
    { label: 'De penal', value: penalty },
    { label: 'Resto (pie, dentro del área)', value: Math.max(0, total - header - outside - penalty) },
  ];
  if (!total) return { empty: 'Sin goles de liga con relato en el filtro elegido.' };
  return {
    node: <DonutChart slices={slices} label={suffix ? 'Goles recibidos por tipo (liga)' : 'Goles por tipo (liga)'} />,
    table: { head: ['Tipo', 'Goles'], rows: slices.map((x) => [x.label, x.value]) },
    coverage: `${String(liga.length)} partidos de liga`,
  };
}

function formationChart(ms: TeamMatchRow[], f: (m: TeamMatchRow) => string | null, what: string): ChartOutput {
  const groups = new Map<string, TeamMatchRow[]>();
  for (const m of ms) {
    const k = f(m);
    if (k) groups.set(k, [...(groups.get(k) ?? []), m]);
  }
  const list = [...groups.entries()].sort((a, b) => b[1].length - a[1].length).slice(0, 8);
  if (!list.length) return { empty: 'Sin formaciones cargadas.' };
  return {
    node: (
      <BarChart
        horizontal
        labels={list.map(([k, g]) => `${k} (${String(g.length)} PJ)`)}
        series={[{ id: 'p', label: 'Puntos por partido', slot: 1, values: list.map(([, g]) => avg(g.map(points))) }]}
        label={`Puntos por partido según la ${what.toLowerCase()}`}
      />
    ),
    table: {
      head: [what, 'Partidos', 'Puntos por partido'],
      rows: list.map(([k, g]) => [k, g.length, avg(g.map(points))]),
    },
  };
}

function playerSeries(
  data: LandingData,
  ms: TeamMatchRow[],
  playerId: number,
  key: string,
  label: string,
  smooth: boolean,
): ReactNode {
  const byMatch = data.playerMatches[playerId] ?? {};
  const played = ms.filter((m) => (byMatch[m.matchId]?.minutes ?? 0) > 0);
  if (played.length < 2)
    return <p className="text-sm text-muted">Sin datos: jugó menos de dos partidos en el filtro elegido.</p>;
  const values = played.map((m) => byMatch[m.matchId]?.[key] ?? null);
  return (
    <LineChart
      labels={played.map(day)}
      series={[
        { id: 'v', label, slot: 2, values },
        { id: 'r', label: 'Media de 5', slot: 1, values: rolling(values, 5) },
      ]}
      label={smooth ? `${label} por partido` : label}
    />
  );
}

function playerScatter(
  data: LandingData,
  regulars: PlayerRow[],
  xId: string,
  yId: string,
  xLabel: string,
  yLabel: string,
): ChartOutput {
  const pts = regulars.flatMap((p): ScatterPoint[] => {
    const x = pv(p, data.playerCatalog, xId);
    const y = pv(p, data.playerCatalog, yId);
    return x === null || y === null ? [] : [{ x, y, label: p.name, slot: 1, size: Math.min(1, p.minutes / 3500) }];
  });
  if (pts.length < 3) return { empty: 'Pocos jugadores con estas métricas.' };
  return {
    node: (
      <ScatterChart
        medians
        points={pts}
        xLabel={xLabel}
        yLabel={yLabel}
        label={`${yLabel} frente a ${xLabel} (tamaño: minutos). Estimado.`}
      />
    ),
    table: { head: ['Jugador', xLabel, yLabel], rows: pts.map((p) => [p.label, p.x, p.y]) },
  };
}

function ScatterConfig({ players, catalog }: { players: PlayerRow[]; catalog: StatDef[] }) {
  const options = statOptions(catalog);
  const [xId, setX] = useState('xg');
  const [yId, setY] = useState('goles');
  const xs = statById(catalog, xId);
  const ys = statById(catalog, yId);
  const pts = players.flatMap((p): ScatterPoint[] => {
    const x = xs ? playerValue(p, xs, xs.per90) : null;
    const y = ys ? playerValue(p, ys, ys.per90) : null;
    return typeof x === 'number' && typeof y === 'number'
      ? [
          {
            x,
            y,
            label: p.name,
            slot: p.position === 'Delantero' ? 1 : p.position === 'Mediocampista' ? 3 : 2,
            size: Math.min(1, p.minutes / 3500),
          },
        ]
      : [];
  });
  const select = (label: string, value: string, set: (v: string) => void) => (
    <label className="flex min-w-0 items-center gap-2 text-xs font-semibold text-muted">
      {label}
      <select
        aria-label={label}
        className="select focus-ring min-w-0 max-w-full flex-1 text-xs"
        value={value}
        onChange={(e) => {
          set(e.target.value);
        }}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap gap-3">
        {select('Eje X', xId, setX)}
        {select('Eje Y', yId, setY)}
      </div>
      <ScatterChart
        medians
        points={pts}
        groups={[
          { label: 'Delanteros', slot: 1 },
          { label: 'Mediocampistas', slot: 3 },
          { label: 'Defensores y arqueros', slot: 2 },
        ]}
        xLabel={`${xs?.short ?? xId}${xs?.per90 ? ' /90' : ''}`}
        yLabel={`${ys?.short ?? yId}${ys?.per90 ? ' /90' : ''}`}
        label="Dispersión configurable: un punto por jugador (tamaño: minutos)"
      />
    </div>
  );
}
