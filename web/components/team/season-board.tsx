'use client';

import { motion } from 'motion/react';

import { StatReading } from '@/components/stats/stat-reading';
import { NOT_AVAILABLE } from '@/lib/format';
import { aggregateTeam, formatStat, type StatDef, type TeamMatchRow } from '@/lib/stats/catalog';

interface SeasonBoardProps {
  rows: TeamMatchRow[];
  columns: StatDef[];
  byId: ReadonlyMap<string, StatDef>;
  windowValues: Record<string, number>;
  selectedId: string | null;
  onSelect: (id: string) => void;
}

/**
 * Vista acumulada de la Interfaz 2 (pedido del dueño, 28-oct): con una sola fila, una tabla no
 * aporta. Cada estadística es una tarjeta con el valor de la temporada, el promedio por partido,
 * la línea partido a partido y cómo leerla. Al elegir una tarjeta, el panel muestra su definición.
 */
export function SeasonBoard({ rows, columns, byId, windowValues, selectedId, onSelect }: SeasonBoardProps) {
  return (
    <ul className="board" aria-label="Estadísticas de la temporada">
      {columns.map((stat, i) => {
        const total = aggregateTeam(rows, stat, byId, { windowValue: windowValues[stat.id] ?? null });
        const average = stat.per90 ? aggregateTeam(rows, stat, byId, { perMatch: true }) : null;
        const series = rows.map((r) => aggregateTeam([r], stat, byId));
        const selected = stat.id === selectedId;
        return (
          <li key={stat.id} className="contents">
            <motion.button
              type="button"
              className="stat-card focus-ring"
              aria-pressed={selected}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: Math.min(i, 20) * 0.025, duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
              onClick={() => {
                onSelect(stat.id);
              }}
            >
              <span className="flex items-baseline justify-between gap-2">
                <span className="text-xs font-bold uppercase tracking-wide text-muted">{stat.short}</span>
                <span className="text-[0.65rem] font-semibold text-muted">
                  Nivel {stat.level}
                  {stat.estimated ? ' · estimada' : ''}
                </span>
              </span>
              <span className="text-sm font-bold leading-tight">{stat.name}</span>
              <span className="text-3xl font-extrabold tabular">
                {total === null ? <span className="text-muted">{NOT_AVAILABLE}</span> : formatStat(total, stat, false)}
              </span>
              {average !== null ? (
                <span className="text-xs text-muted">
                  Promedio por partido: <span className="font-bold text-fg">{formatStat(average, stat, true)}</span>
                </span>
              ) : null}
              <Sparkline values={series} />
              <StatReading text={stat.reading} compact />
            </motion.button>
          </li>
        );
      })}
    </ul>
  );
}

/** Línea partido a partido (solo los partidos con dato), con el promedio como referencia. */
function Sparkline({ values }: { values: (number | string | null)[] }) {
  const points = values.flatMap((v, i) => (typeof v === 'number' && Number.isFinite(v) ? [{ i, v }] : []));
  if (points.length < 2) return <span className="sparkline sparkline--empty" aria-hidden="true" />;
  const width = 200;
  const height = 36;
  const min = Math.min(...points.map((p) => p.v));
  const max = Math.max(...points.map((p) => p.v));
  const span = max - min || 1;
  const x = (i: number) => (i / Math.max(1, values.length - 1)) * width;
  const y = (v: number) => height - 3 - ((v - min) / span) * (height - 6);
  const mean = points.reduce((a, p) => a + p.v, 0) / points.length;
  const path = points.map((p, k) => `${k === 0 ? 'M' : 'L'}${x(p.i).toFixed(1)},${y(p.v).toFixed(1)}`).join(' ');
  return (
    <svg
      className="sparkline"
      viewBox={`0 0 ${String(width)} ${String(height)}`}
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <line x1="0" x2={width} y1={y(mean)} y2={y(mean)} className="sparkline-mean" />
      <path d={path} className="sparkline-line" />
    </svg>
  );
}
