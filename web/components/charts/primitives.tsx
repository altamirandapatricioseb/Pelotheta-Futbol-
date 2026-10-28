'use client';

// Primitivas de gráficos en SVG propio (etapa 5). Reglas de la skill dataviz: marcas finas
// (líneas de 2px, barras de hasta 24px con punta redondeada, puntos de 8px con aro de superficie),
// grilla de una línea fina, un solo eje Y, leyenda desde dos series, texto siempre con tinta de
// texto (nunca con el color de la serie) y tooltip al pasar el cursor. Los colores son variables
// CSS (--series-1 a --series-5) validadas en modo claro y oscuro.

import { useId, useState, type ReactNode } from 'react';

export type Slot = 1 | 2 | 3 | 4 | 5;
export interface Series {
  id: string;
  label: string;
  slot: Slot;
  values: (number | null)[];
}

const W = 560;
const H = 240;
const M = { l: 44, r: 14, t: 14, b: 30 };
const PLOT_W = W - M.l - M.r;
const PLOT_H = H - M.t - M.b;

const fmt = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 2 });
export const formatValue = (v: number | null | undefined) => (v === null || v === undefined ? 'n/d' : fmt.format(v));
const color = (slot: Slot) => `var(--series-${String(slot)})`;

/** Marcas «redondas» del eje: 0, 5, 10... según el rango (sin decimales feos). */
export function niceTicks(min: number, max: number, count = 4): number[] {
  if (min === max) return [min];
  const raw = (max - min) / count;
  const power = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * power).find((s) => s >= raw) ?? raw;
  const start = Math.floor(min / step) * step;
  const ticks: number[] = [];
  for (let t = start; t <= max + step / 2; t += step) ticks.push(Number(t.toFixed(10)));
  return ticks;
}

function domain(values: (number | null)[], includeZero = true): [number, number] {
  const nums = values.filter((v): v is number => v !== null && Number.isFinite(v));
  if (nums.length === 0) return [0, 1];
  let lo = Math.min(...nums);
  let hi = Math.max(...nums);
  if (includeZero) {
    lo = Math.min(lo, 0);
    hi = Math.max(hi, 0);
  }
  if (lo === hi) hi = lo + 1;
  const ticks = niceTicks(lo, hi);
  return [ticks[0] ?? lo, ticks.at(-1) ?? hi];
}

interface Tip {
  x: number;
  y: number;
  content: ReactNode;
}

function Frame({ tip, children, label }: { tip: Tip | null; children: ReactNode; label: string }) {
  return (
    <div className="chart-frame">
      {children}
      {tip ? (
        <div
          className="chart-tip"
          aria-hidden="true"
          style={{ left: `${String((tip.x / W) * 100)}%`, top: `${String((tip.y / H) * 100)}%` }}
        >
          {tip.content}
        </div>
      ) : null}
      <span className="sr-only">{label}</span>
    </div>
  );
}

function YAxis({
  ticks,
  y,
  format = formatValue,
}: {
  ticks: number[];
  y: (v: number) => number;
  format?: (v: number) => string;
}) {
  return (
    <g className="chart-axis">
      {ticks.map((t) => (
        <g key={t}>
          <line x1={M.l} x2={W - M.r} y1={y(t)} y2={y(t)} className={t === 0 ? 'chart-baseline' : 'chart-grid'} />
          <text x={M.l - 6} y={y(t)} dy="0.32em" textAnchor="end">
            {format(t)}
          </text>
        </g>
      ))}
    </g>
  );
}

function XLabels({ labels, x }: { labels: string[]; x: (i: number) => number }) {
  // Pocas etiquetas: la primera, la última y algunas en el medio (el tooltip da el resto).
  const every = Math.max(1, Math.ceil(labels.length / 7));
  return (
    <g className="chart-axis">
      {labels.map((l, i) =>
        // La última siempre; una intermedia muy pegada a la última se omite para que no se pisen.
        (i % every === 0 && labels.length - 1 - i >= every / 2) || i === labels.length - 1 ? (
          <text key={`${l}-${String(i)}`} x={x(i)} y={H - 8} textAnchor="middle">
            {l}
          </text>
        ) : null,
      )}
    </g>
  );
}

export function Legend({ items }: { items: { label: string; slot: Slot; kind?: 'line' | 'box' }[] }) {
  if (items.length < 2) return null;
  return (
    <ul className="chart-legend">
      {items.map((it) => (
        <li key={it.label}>
          <span className={`chart-key chart-key--${it.kind ?? 'box'}`} style={{ background: color(it.slot) }} />
          {it.label}
        </li>
      ))}
    </ul>
  );
}

/** Líneas en el tiempo con línea guía y tooltip con todas las series en ese punto. */
export function LineChart({
  labels,
  series,
  pointSlots,
  area = false,
  includeZero = true,
  label,
}: {
  labels: string[];
  series: Series[];
  /** Color por punto de la primera serie (por ejemplo, resultado G/E/P). */
  pointSlots?: (Slot | null)[];
  area?: boolean;
  includeZero?: boolean;
  label: string;
}) {
  const [tip, setTip] = useState<Tip | null>(null);
  const [hover, setHover] = useState<number | null>(null);
  const [lo, hi] = domain(
    series.flatMap((s) => s.values),
    includeZero,
  );
  const x = (i: number) => M.l + (labels.length > 1 ? (i / (labels.length - 1)) * PLOT_W : PLOT_W / 2);
  const y = (v: number) => M.t + PLOT_H - ((v - lo) / (hi - lo)) * PLOT_H;
  const onMove = (e: React.PointerEvent<SVGRectElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * PLOT_W;
    const i = Math.max(0, Math.min(labels.length - 1, Math.round((px / PLOT_W) * (labels.length - 1))));
    setHover(i);
    setTip({
      x: x(i),
      y: M.t + 8,
      content: (
        <>
          <strong>{labels[i]}</strong>
          {series.map((s) => (
            <span key={s.id}>
              <i className="chart-key chart-key--line" style={{ background: color(s.slot) }} /> {s.label}:{' '}
              {formatValue(s.values[i])}
            </span>
          ))}
        </>
      ),
    });
  };
  return (
    <Frame tip={tip} label={label}>
      <svg viewBox={`0 0 ${String(W)} ${String(H)}`} className="chart-svg" role="img" aria-label={label}>
        <YAxis ticks={niceTicks(lo, hi)} y={y} />
        <XLabels labels={labels} x={x} />
        {hover !== null ? (
          <line x1={x(hover)} x2={x(hover)} y1={M.t} y2={M.t + PLOT_H} className="chart-crosshair" />
        ) : null}
        {series.map((s) => {
          const pts = s.values.flatMap((v, i) => (v === null ? [] : [[x(i), y(v)] as const]));
          const d = pts.map(([px, py], k) => `${k ? 'L' : 'M'}${px.toFixed(1)},${py.toFixed(1)}`).join(' ');
          return (
            <g key={s.id}>
              {area && pts.length > 1 ? (
                <path
                  d={`${d} L${(pts.at(-1)?.[0] ?? 0).toFixed(1)},${y(Math.max(lo, 0)).toFixed(1)} L${(pts[0]?.[0] ?? 0).toFixed(1)},${y(Math.max(lo, 0)).toFixed(1)} Z`}
                  className="chart-area"
                  style={{ fill: color(s.slot) }}
                />
              ) : null}
              <path d={d} className="chart-line" style={{ stroke: color(s.slot) }} />
            </g>
          );
        })}
        {pointSlots && series[0]
          ? series[0].values.map((v, i) => {
              const slot = pointSlots[i];
              return v === null || !slot ? null : (
                <circle key={i} cx={x(i)} cy={y(v)} r={4.5} className="chart-dot" style={{ fill: color(slot) }} />
              );
            })
          : null}
        <rect
          x={M.l}
          y={M.t}
          width={PLOT_W}
          height={PLOT_H}
          fill="transparent"
          onPointerMove={onMove}
          onPointerLeave={() => {
            setTip(null);
            setHover(null);
          }}
        />
      </svg>
      <Legend items={series.map((s) => ({ label: s.label, slot: s.slot, kind: 'line' }))} />
    </Frame>
  );
}

/** Barras verticales u horizontales; agrupadas o apiladas; admite negativos (divergentes). */
export function BarChart({
  labels,
  series,
  stacked = false,
  horizontal = false,
  label,
  format = formatValue,
}: {
  labels: string[];
  series: Series[];
  stacked?: boolean;
  horizontal?: boolean;
  label: string;
  format?: (v: number) => string;
}) {
  const [tip, setTip] = useState<Tip | null>(null);
  const totals = labels.map((_, i) =>
    stacked
      ? series.reduce((a, s) => a + Math.max(0, s.values[i] ?? 0), 0)
      : Math.max(...series.map((s) => s.values[i] ?? 0)),
  );
  const mins = labels.map((_, i) => Math.min(0, ...series.map((s) => s.values[i] ?? 0)));
  const [lo, hi] = domain([...totals, ...mins]);
  const n = labels.length;
  const height = horizontal ? Math.max(H, M.t + M.b + n * 22) : H;
  const plotH = height - M.t - M.b;
  const left = horizontal ? 128 : M.l;
  const plotW = W - left - M.r;
  const band = (horizontal ? plotH : plotW) / Math.max(1, n);
  const groups = stacked ? 1 : series.length;
  const thick = Math.min(24, (band * 0.7) / groups);
  const scale = (v: number) => ((v - lo) / (hi - lo)) * (horizontal ? plotW : plotH);
  const zero = scale(0);
  const show = (i: number, s: Series, cx: number, cy: number) => {
    setTip({
      x: cx,
      y: (cy / height) * H,
      content: (
        <>
          <strong>{labels[i]}</strong>
          <span>
            {series.length > 1 ? `${s.label}: ` : ''}
            {format(s.values[i] ?? 0)}
          </span>
        </>
      ),
    });
  };
  return (
    <Frame tip={tip} label={label}>
      <svg viewBox={`0 0 ${String(W)} ${String(height)}`} className="chart-svg" role="img" aria-label={label}>
        <g className="chart-axis">
          {niceTicks(lo, hi).map((t) =>
            horizontal ? (
              <g key={t}>
                <line
                  x1={left + scale(t)}
                  x2={left + scale(t)}
                  y1={M.t}
                  y2={M.t + plotH}
                  className={t === 0 ? 'chart-baseline' : 'chart-grid'}
                />
                <text x={left + scale(t)} y={height - 8} textAnchor="middle">
                  {format(t)}
                </text>
              </g>
            ) : (
              <g key={t}>
                <line
                  x1={left}
                  x2={W - M.r}
                  y1={M.t + plotH - scale(t)}
                  y2={M.t + plotH - scale(t)}
                  className={t === 0 ? 'chart-baseline' : 'chart-grid'}
                />
                <text x={left - 6} y={M.t + plotH - scale(t)} dy="0.32em" textAnchor="end">
                  {format(t)}
                </text>
              </g>
            ),
          )}
          {labels.map((l, i) =>
            horizontal ? (
              <text key={`${l}-${String(i)}`} x={left - 8} y={M.t + band * (i + 0.5)} dy="0.32em" textAnchor="end">
                {l.length > 20 ? `${l.slice(0, 19)}…` : l}
              </text>
            ) : n <= 16 || i % Math.ceil(n / 8) === 0 ? (
              <text key={`${l}-${String(i)}`} x={left + band * (i + 0.5)} y={height - 8} textAnchor="middle">
                {l.length > 12 ? `${l.slice(0, 11)}…` : l}
              </text>
            ) : null,
          )}
        </g>
        {labels.map((_, i) => {
          let stackPos = 0;
          let stackNeg = 0;
          return series.map((s, k) => {
            const v = s.values[i];
            if (v === null || v === undefined) return null;
            const length = Math.abs(scale(v) - zero);
            let start: number;
            if (stacked) {
              start = v >= 0 ? zero + stackPos : zero - stackNeg - length;
              if (v >= 0) stackPos += length + (length > 0 ? 2 : 0);
              else stackNeg += length + (length > 0 ? 2 : 0);
            } else {
              start = v >= 0 ? zero : zero - length;
            }
            const offset = stacked ? (band - thick) / 2 : (band - thick * groups) / 2 + k * thick;
            const across = (horizontal ? M.t : left) + band * i + offset;
            const rect = horizontal
              ? { x: left + start, y: across, width: Math.max(0, length), height: Math.max(1, thick - 2) }
              : {
                  x: across,
                  y: M.t + plotH - start - length,
                  width: Math.max(1, thick - 2),
                  height: Math.max(0, length),
                };
            return (
              <rect
                key={`${s.id}-${String(i)}`}
                {...rect}
                rx={2}
                className="chart-bar"
                style={{ fill: color(s.slot) }}
                onPointerEnter={() => {
                  show(i, s, rect.x + rect.width / 2, rect.y);
                }}
                onPointerLeave={() => {
                  setTip(null);
                }}
              />
            );
          });
        })}
      </svg>
      <Legend items={series.map((s) => ({ label: s.label, slot: s.slot }))} />
    </Frame>
  );
}

export interface ScatterPoint {
  x: number;
  y: number;
  label: string;
  slot?: Slot;
  /** Radio extra según una tercera variable (por ejemplo, minutos), de 0 a 1. */
  size?: number;
  low?: number;
  high?: number;
}

/** Dispersión con medianas que dividen en cuadrantes y, opcional, la diagonal y = x. */
export function ScatterChart({
  points,
  xLabel,
  yLabel,
  groups,
  medians = false,
  diagonal = false,
  curve,
  label,
}: {
  points: ScatterPoint[];
  xLabel: string;
  yLabel: string;
  groups?: { label: string; slot: Slot }[];
  medians?: boolean;
  diagonal?: boolean;
  /** Curva de referencia en la misma escala (por ejemplo, el margen esperado por edad). */
  curve?: { label: string; slot: Slot; points: { x: number; y: number }[] };
  label: string;
}) {
  const [tip, setTip] = useState<Tip | null>(null);
  const [xlo, xhi] = domain([...points.map((p) => p.x), ...(curve?.points.map((p) => p.x) ?? [])], false);
  const [ylo, yhi] = domain(
    [...points.flatMap((p) => [p.y, p.low ?? null, p.high ?? null]), ...(curve?.points.map((p) => p.y) ?? [])],
    false,
  );
  const x = (v: number) => M.l + ((v - xlo) / (xhi - xlo)) * PLOT_W;
  const y = (v: number) => M.t + PLOT_H - ((v - ylo) / (yhi - ylo)) * PLOT_H;
  const median = (vals: number[]) => {
    const s = [...vals].sort((a, b) => a - b);
    return s.length ? (s[Math.floor((s.length - 1) / 2)] ?? 0) : 0;
  };
  return (
    <Frame tip={tip} label={label}>
      <svg viewBox={`0 0 ${String(W)} ${String(H)}`} className="chart-svg" role="img" aria-label={label}>
        <YAxis ticks={niceTicks(ylo, yhi)} y={y} />
        <g className="chart-axis">
          {niceTicks(xlo, xhi).map((t) => (
            <text key={t} x={x(t)} y={H - 8} textAnchor="middle">
              {formatValue(t)}
            </text>
          ))}
          <text x={W - M.r} y={H - 18} textAnchor="end" className="chart-axis-title">
            {xLabel}
          </text>
          <text x={M.l + 4} y={M.t + 10} className="chart-axis-title">
            {yLabel}
          </text>
        </g>
        {diagonal ? (
          <line
            x1={x(Math.max(xlo, ylo))}
            y1={y(Math.max(xlo, ylo))}
            x2={x(Math.min(xhi, yhi))}
            y2={y(Math.min(xhi, yhi))}
            className="chart-reference"
          />
        ) : null}
        {medians && points.length > 2 ? (
          <>
            <line
              x1={x(median(points.map((p) => p.x)))}
              x2={x(median(points.map((p) => p.x)))}
              y1={M.t}
              y2={M.t + PLOT_H}
              className="chart-reference"
            />
            <line
              x1={M.l}
              x2={W - M.r}
              y1={y(median(points.map((p) => p.y)))}
              y2={y(median(points.map((p) => p.y)))}
              className="chart-reference"
            />
          </>
        ) : null}
        {curve && curve.points.length > 1 ? (
          <path
            d={curve.points.map((p, k) => `${k ? 'L' : 'M'}${x(p.x).toFixed(1)},${y(p.y).toFixed(1)}`).join(' ')}
            className="chart-line"
            style={{ stroke: color(curve.slot) }}
          />
        ) : null}
        {points.map((p, i) => (
          <g key={`${p.label}-${String(i)}`}>
            {p.low !== undefined && p.high !== undefined ? (
              <line
                x1={x(p.x)}
                x2={x(p.x)}
                y1={y(p.low)}
                y2={y(p.high)}
                className="chart-range"
                style={{ stroke: color(p.slot ?? 1) }}
              />
            ) : null}
            <circle
              cx={x(p.x)}
              cy={y(p.y)}
              r={4 + (p.size ?? 0) * 6}
              className="chart-dot"
              style={{ fill: color(p.slot ?? 1) }}
              onPointerEnter={() => {
                setTip({
                  x: x(p.x),
                  y: y(p.y),
                  content: (
                    <>
                      <strong>{p.label}</strong>
                      <span>
                        {xLabel}: {formatValue(p.x)}
                      </span>
                      <span>
                        {yLabel}: {formatValue(p.y)}
                      </span>
                    </>
                  ),
                });
              }}
              onPointerLeave={() => {
                setTip(null);
              }}
            />
          </g>
        ))}
      </svg>
      {groups || curve ? (
        <Legend
          items={[
            ...(groups ?? []),
            ...(curve ? [{ label: curve.label, slot: curve.slot, kind: 'line' as const }] : []),
          ]}
        />
      ) : null}
    </Frame>
  );
}

/** Anillo de partes de un total (pocas categorías; la tabla da los valores exactos). */
export function DonutChart({ slices, label }: { slices: { label: string; value: number }[]; label: string }) {
  const [tip, setTip] = useState<Tip | null>(null);
  const total = slices.reduce((a, s) => a + s.value, 0);
  // Ángulo de inicio de cada porción: suma de las anteriores (sin reasignar durante el render).
  const starts = slices.map(
    (_, i) => -Math.PI / 2 + slices.slice(0, i).reduce((a, s) => a + (total ? (s.value / total) * Math.PI * 2 : 0), 0),
  );
  const cx = W / 2;
  const cy = H / 2;
  const r = 92;
  const inner = 58;
  return (
    <Frame tip={tip} label={label}>
      <svg viewBox={`0 0 ${String(W)} ${String(H)}`} className="chart-svg" role="img" aria-label={label}>
        {slices.map((s, i) => {
          const sweep = total ? (s.value / total) * Math.PI * 2 : 0;
          const angle = starts[i] ?? 0;
          const a0 = angle + 0.01;
          const a1 = angle + sweep - 0.01;
          if (sweep <= 0.02) return null;
          const large = sweep > Math.PI ? 1 : 0;
          const p = (rad: number, a: number) =>
            `${(cx + rad * Math.cos(a)).toFixed(1)},${(cy + rad * Math.sin(a)).toFixed(1)}`;
          const d = `M${p(r, a0)} A${String(r)},${String(r)} 0 ${String(large)} 1 ${p(r, a1)} L${p(inner, a1)} A${String(inner)},${String(inner)} 0 ${String(large)} 0 ${p(inner, a0)} Z`;
          return (
            <path
              key={s.label}
              d={d}
              className="chart-bar"
              style={{ fill: color(((i % 5) + 1) as Slot) }}
              onPointerEnter={() => {
                setTip({
                  x: cx,
                  y: cy - 10,
                  content: (
                    <>
                      <strong>{s.label}</strong>
                      <span>
                        {formatValue(s.value)} ({formatValue(total ? (s.value / total) * 100 : 0)} %)
                      </span>
                    </>
                  ),
                });
              }}
              onPointerLeave={() => {
                setTip(null);
              }}
            />
          );
        })}
        <text x={cx} y={cy} textAnchor="middle" dy="0.32em" className="chart-center">
          {formatValue(total)}
        </text>
      </svg>
      <Legend
        items={slices.map((s, i) => ({ label: `${s.label} (${formatValue(s.value)})`, slot: ((i % 5) + 1) as Slot }))}
      />
    </Frame>
  );
}

/** Mapa de calor con una sola tonalidad (verde de marca), de claro a oscuro. */
export function Heatmap({
  rows,
  cols,
  values,
  label,
  diverging = false,
}: {
  rows: string[];
  cols: string[];
  values: (number | null)[][];
  label: string;
  diverging?: boolean;
}) {
  const [tip, setTip] = useState<Tip | null>(null);
  const flat = values.flat().filter((v): v is number => v !== null);
  const max = Math.max(1e-9, ...flat.map(Math.abs));
  const left = 120;
  const cell = Math.min(46, (W - left - M.r) / Math.max(1, cols.length));
  const rowH = Math.min(30, 200 / Math.max(1, rows.length) + 8);
  const height = Math.max(H, M.t + 40 + rows.length * rowH);
  return (
    <Frame tip={tip} label={label}>
      <svg viewBox={`0 0 ${String(W)} ${String(height)}`} className="chart-svg" role="img" aria-label={label}>
        <g className="chart-axis">
          {cols.map((c, j) => (
            <text key={c} x={left + cell * (j + 0.5)} y={M.t + 8} textAnchor="middle">
              {c.length > 7 ? `${c.slice(0, 6)}…` : c}
            </text>
          ))}
          {rows.map((r, i) => (
            <text key={r} x={left - 8} y={M.t + 22 + rowH * (i + 0.5)} dy="0.32em" textAnchor="end">
              {r.length > 18 ? `${r.slice(0, 17)}…` : r}
            </text>
          ))}
        </g>
        {values.map((row, i) =>
          row.map((v, j) => {
            const t = v === null ? 0 : Math.abs(v) / max;
            const fill =
              v === null
                ? 'var(--chart-empty)'
                : diverging && v < 0
                  ? `color-mix(in oklab, var(--series-5) ${String(Math.round(15 + t * 85))}%, var(--chart-surface))`
                  : `color-mix(in oklab, var(--series-1) ${String(Math.round(15 + t * 85))}%, var(--chart-surface))`;
            return (
              <rect
                key={`${String(i)}-${String(j)}`}
                x={left + cell * j + 1}
                y={M.t + 22 + rowH * i + 1}
                width={cell - 2}
                height={rowH - 2}
                rx={3}
                style={{ fill }}
                onPointerEnter={() => {
                  setTip({
                    x: left + cell * (j + 0.5),
                    y: ((M.t + 22 + rowH * i) / height) * H,
                    content: (
                      <>
                        <strong>
                          {rows[i]} · {cols[j]}
                        </strong>
                        <span>{formatValue(v)}</span>
                      </>
                    ),
                  });
                }}
                onPointerLeave={() => {
                  setTip(null);
                }}
              />
            );
          }),
        )}
      </svg>
    </Frame>
  );
}

/** Franja de resultados o eventos en orden (un cuadrado por partido). */
export function Strip({
  items,
  label,
}: {
  items: { label: string; slot: Slot | null; title: string }[];
  label: string;
}) {
  const [tip, setTip] = useState<Tip | null>(null);
  const per = Math.max(1, Math.ceil(items.length / 2));
  const size = Math.min(26, (W - 20) / per);
  return (
    <Frame tip={tip} label={label}>
      <svg viewBox={`0 0 ${String(W)} 90`} className="chart-svg" role="img" aria-label={label}>
        {items.map((it, i) => {
          const row = Math.floor(i / per);
          const col = i % per;
          return (
            <g key={`${it.title}-${String(i)}`}>
              <rect
                x={10 + col * size}
                y={10 + row * (size + 8)}
                width={size - 3}
                height={size - 3}
                rx={4}
                style={{ fill: it.slot ? color(it.slot) : 'var(--chart-empty)' }}
                onPointerEnter={() => {
                  setTip({ x: 10 + col * size, y: 10 + row * (size + 8), content: <span>{it.title}</span> });
                }}
                onPointerLeave={() => {
                  setTip(null);
                }}
              />
              <text
                x={10 + col * size + (size - 3) / 2}
                y={10 + row * (size + 8) + (size - 3) / 2}
                dy="0.35em"
                textAnchor="middle"
                className="chart-strip-text"
              >
                {it.label}
              </text>
            </g>
          );
        })}
      </svg>
    </Frame>
  );
}

/** Media cancha con los tiros: tamaño por xG, relleno si fue gol. */
export function ShotMap({
  shots,
  label,
}: {
  shots: { x: number; y: number; xg: number; goal: boolean; title: string }[];
  label: string;
}) {
  const [tip, setTip] = useState<Tip | null>(null);
  const clip = useId();
  // Coordenadas de StrikerAPI: x = distancia al arco como fracción de media cancha (0 = línea de
  // gol), y = ancho de 0 a 1. Escala real: 500 px son los 68 m de ancho (7,35 px por metro) y se
  // dibuja hasta 3/4 de media cancha (39 m), donde caen todos los remates.
  const PX_PER_M = 500 / 68;
  const depth = 0.75 * 52.5 * PX_PER_M;
  const px = (y: number) => 30 + y * 500;
  const py = (x: number) => 20 + x * 52.5 * PX_PER_M;
  const height = 20 + depth + 16;
  return (
    <Frame tip={tip} label={label}>
      <svg viewBox={`0 0 ${String(W)} ${String(height)}`} className="chart-svg" role="img" aria-label={label}>
        <clipPath id={clip}>
          <rect x={30} y={20} width={500} height={depth} />
        </clipPath>
        <g className="chart-pitch">
          <rect x={30} y={20} width={500} height={depth} />
          {/* Área grande (40,3 × 16,5 m), área chica (18,3 × 5,5 m) y medialuna (9,15 m desde el penal). */}
          <rect x={px(0.2035)} y={20} width={px(0.7965) - px(0.2035)} height={py(16.5 / 52.5) - 20} />
          <rect x={px(0.3654)} y={20} width={px(0.6346) - px(0.3654)} height={py(5.5 / 52.5) - 20} />
          <circle
            cx={W / 2}
            cy={py(11 / 52.5)}
            r={9.15 * PX_PER_M}
            clipPath={`url(#${clip})`}
            className="chart-pitch-arc"
          />
        </g>
        {shots.map((s, i) => (
          <circle
            key={i}
            cx={px(s.y)}
            cy={py(s.x)}
            r={3 + Math.sqrt(s.xg) * 12}
            className={s.goal ? 'chart-dot' : 'chart-dot chart-dot--open'}
            style={s.goal ? { fill: color(1) } : { stroke: color(4) }}
            onPointerEnter={() => {
              setTip({ x: px(s.y), y: py(s.x), content: <span>{s.title}</span> });
            }}
            onPointerLeave={() => {
              setTip(null);
            }}
          />
        ))}
      </svg>
      <Legend
        items={[
          { label: 'Gol', slot: 1 },
          { label: 'Sin gol', slot: 4 },
        ]}
      />
    </Frame>
  );
}

/** Radar de 3 a 8 ejes en escala 0 a 100 (percentiles o valores normalizados). */
export function Radar({ axes, series, label }: { axes: string[]; series: Series[]; label: string }) {
  const cx = W / 2;
  const cy = H / 2 + 4;
  const r = 92;
  const point = (i: number, v: number) => {
    const a = (i / axes.length) * Math.PI * 2 - Math.PI / 2;
    return [cx + (r * v * Math.cos(a)) / 100, cy + (r * v * Math.sin(a)) / 100] as const;
  };
  return (
    <Frame tip={null} label={label}>
      <svg viewBox={`0 0 ${String(W)} ${String(H)}`} className="chart-svg" role="img" aria-label={label}>
        {[25, 50, 75, 100].map((ring) => (
          <polygon
            key={ring}
            points={axes.map((_, i) => point(i, ring).join(',')).join(' ')}
            className="chart-grid chart-ring"
          />
        ))}
        {axes.map((a, i) => {
          const [ex, ey] = point(i, 116);
          return (
            <text key={a} x={ex} y={ey} textAnchor="middle" dy="0.32em" className="chart-axis chart-radar-label">
              {a}
            </text>
          );
        })}
        {series.map((s) => (
          <polygon
            key={s.id}
            points={s.values.map((v, i) => point(i, Math.max(0, Math.min(100, v ?? 0))).join(',')).join(' ')}
            className="chart-radar-shape"
            style={{ stroke: color(s.slot), fill: color(s.slot) }}
          />
        ))}
      </svg>
      <Legend items={series.map((s) => ({ label: s.label, slot: s.slot, kind: 'line' }))} />
    </Frame>
  );
}
