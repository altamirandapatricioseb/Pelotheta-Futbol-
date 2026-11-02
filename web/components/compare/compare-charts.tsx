'use client';

// Gráficos de la comparación (9.7): barras divergentes, barras agrupadas y gráfico de bala.
// Mismas reglas que las primitivas de la landing (skill dataviz): marcas finas, grilla tenue,
// texto con tinta de texto, color fijo por entidad (jugador verde, otro jugador violeta, equipo
// azul...) y tooltip al pasar el mouse. Se dibujan al ancho real del contenedor (sin escalar las
// letras ni dejar bordes vacíos). En las divergentes y en la bala la derecha es «mejor» siempre:
// si la estadística es de «menos es mejor», el eje se da vuelta y se avisa.

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';

import type { Slot } from '@/components/charts/primitives';

const PAD_R = 58;
const TOP = 22;

/** Ancho real del contenedor, para dibujar en píxeles (ref de callback: mide al montar y al cambiar). */
function useWidth(): [(el: HTMLDivElement | null) => void, number] {
  const [width, setWidth] = useState(560);
  const observer = useRef<ResizeObserver | null>(null);
  const measure = useCallback((el: HTMLDivElement | null) => {
    observer.current?.disconnect();
    if (!el) return;
    const apply = (w: number) => {
      if (w > 0) setWidth(Math.max(300, Math.round(w)));
    };
    apply(el.getBoundingClientRect().width);
    observer.current = new ResizeObserver(([entry]) => {
      apply(entry?.contentRect.width ?? 0);
    });
    observer.current.observe(el);
  }, []);
  return [measure, width];
}

/** Columna de los nombres: más angosta en el celular. */
const labelWidth = (w: number) => (w < 480 ? 112 : 176);

const color = (slot: Slot) => `var(--series-${String(slot)})`;
const short = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

export interface ChartRef {
  label: string;
  slot: Slot;
}

interface Tip {
  x: number;
  y: number;
  content: ReactNode;
}

/** Marco con tooltip y doble clic sobre una fila (data-stat) para abrir la desglosada. */
function Frame({
  box,
  width,
  height,
  tip,
  label,
  onOpen,
  children,
}: {
  box: (el: HTMLDivElement | null) => void;
  width: number;
  height: number;
  tip: Tip | null;
  label: string;
  onOpen?: (statId: string) => void;
  children: ReactNode;
}) {
  const own = useRef<HTMLDivElement | null>(null);
  const setRef = useCallback(
    (el: HTMLDivElement | null) => {
      own.current = el;
      box(el);
    },
    [box],
  );
  useEffect(() => {
    const el = own.current;
    if (!el || !onOpen) return;
    const open = (e: MouseEvent) => {
      const row = (e.target as Element).closest('[data-stat]');
      const id = row?.getAttribute('data-stat');
      if (id) onOpen(id);
    };
    el.addEventListener('dblclick', open);
    return () => {
      el.removeEventListener('dblclick', open);
    };
  }, [onOpen]);
  return (
    <div ref={setRef} className="chart-frame">
      {children}
      {tip ? (
        <div
          className="chart-tip"
          aria-hidden="true"
          style={{ left: `${String((tip.x / width) * 100)}%`, top: `${String((tip.y / height) * 100)}%` }}
        >
          {tip.content}
        </div>
      ) : null}
      <span className="sr-only">{label}</span>
    </div>
  );
}

function RefKeys({ refs, player }: { refs: ChartRef[]; player?: string }) {
  const items = [...(player ? [{ label: player, slot: 1 as Slot }] : []), ...refs];
  if (items.length < 2) return null;
  return (
    <ul className="chart-legend">
      {items.map((it) => (
        <li key={it.label}>
          <span className="chart-key chart-key--box" style={{ background: color(it.slot) }} />
          {it.label}
        </li>
      ))}
    </ul>
  );
}

export interface DivergingRow {
  id: string;
  label: string;
  higherIsBetter: boolean;
  /** Diferencia porcentual contra cada referencia (null si no se puede calcular). */
  cells: { diffPct: number | null; text: string }[];
}

const pct = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 });

/** Diferencia porcentual del jugador contra cada referencia; a la derecha (verde), mejor. */
export function DivergingBars({
  rows,
  refs,
  label,
  onOpen,
}: {
  rows: DivergingRow[];
  refs: ChartRef[];
  label: string;
  onOpen?: (statId: string) => void;
}) {
  const [tip, setTip] = useState<Tip | null>(null);
  const [box, W] = useWidth();
  const LABEL_W = labelWidth(W);
  const PLOT_W = W - LABEL_W - PAD_R;
  const chars = Math.floor(LABEL_W / 6.4);
  const bar = 6;
  const rowH = refs.length * (bar + 4) + 10;
  const height = TOP + rows.length * rowH + 8;
  const signed = (r: DivergingRow, v: number) => (r.higherIsBetter ? v : -v);
  const all = rows.flatMap((r) => r.cells.flatMap((c) => (c.diffPct === null ? [] : [Math.abs(c.diffPct)])));
  // Tope de 200 %: una diferencia enorme (contra una media cercana a 0) no aplasta al resto.
  const max = Math.min(200, Math.max(10, ...all));
  const x0 = LABEL_W + PLOT_W / 2;
  const x = (v: number) => x0 + (Math.max(-max, Math.min(max, v)) / max) * (PLOT_W / 2);
  return (
    <Frame box={box} width={W} height={height} tip={tip} label={label} onOpen={onOpen}>
      <svg viewBox={`0 0 ${String(W)} ${String(height)}`} className="chart-svg" role="img" aria-label={label}>
        <g className="chart-axis">
          <text x={LABEL_W + 4} y={12}>
            peor
          </text>
          <text x={W - PAD_R - 4} y={12} textAnchor="end">
            mejor
          </text>
          <text x={x0} y={12} textAnchor="middle">
            igual
          </text>
        </g>
        <line x1={x0} x2={x0} y1={TOP - 4} y2={height - 6} className="chart-baseline" />
        {[-max / 2, max / 2].map((t) => (
          <line key={t} x1={x(t)} x2={x(t)} y1={TOP - 4} y2={height - 6} className="chart-grid" />
        ))}
        {rows.map((r, i) => {
          const y = TOP + i * rowH;
          return (
            <g
              key={r.id}
              data-stat={r.id}
              className="cmp-chart-row"
              onPointerEnter={() => {
                setTip({
                  x: x0,
                  y: y + 4,
                  content: (
                    <>
                      <strong>{r.label}</strong>
                      {r.cells.map((c, k) => (
                        <span key={refs[k]?.label ?? k}>
                          <i className="chart-key chart-key--box" style={{ background: color(refs[k]?.slot ?? 3) }} />
                          {refs[k]?.label}: {c.text}
                        </span>
                      ))}
                      {!r.higherIsBetter ? <span>Menos es mejor: el eje está dado vuelta.</span> : null}
                    </>
                  ),
                });
              }}
              onPointerLeave={() => {
                setTip(null);
              }}
            >
              <rect x={0} y={y} width={W} height={rowH} className="cmp-chart-hit" />
              <text x={LABEL_W - 8} y={y + rowH / 2} dy="0.32em" textAnchor="end" className="cmp-label">
                <title>{r.label}</title>
                {short(r.label, chars)}
                {!r.higherIsBetter ? ' ↓' : ''}
              </text>
              {r.cells.map((c, k) => {
                const by = y + 5 + k * (bar + 4);
                if (c.diffPct === null) {
                  return (
                    <text key={k} x={x0 + 4} y={by + bar / 2} dy="0.32em" className="cmp-value">
                      sin %
                    </text>
                  );
                }
                const v = signed(r, c.diffPct);
                const left = Math.min(x(v), x0);
                const width = Math.max(1, Math.abs(x(v) - x0));
                return (
                  <g key={k}>
                    <rect x={LABEL_W - 4} y={by} width={3} height={bar} style={{ fill: color(refs[k]?.slot ?? 3) }} />
                    <rect
                      x={left}
                      y={by}
                      width={width}
                      height={bar}
                      rx={2}
                      style={{ fill: v >= 0 ? 'var(--color-best)' : 'var(--color-worst)' }}
                    />
                    <text
                      x={v >= 0 ? left + width + 4 : left - 4}
                      y={by + bar / 2}
                      dy="0.32em"
                      textAnchor={v >= 0 ? 'start' : 'end'}
                      className="cmp-value"
                    >
                      {Math.abs(c.diffPct) > max ? '› ' : ''}
                      {c.diffPct > 0 ? '+' : ''}
                      {pct.format(c.diffPct)} %
                    </text>
                  </g>
                );
              })}
            </g>
          );
        })}
      </svg>
      <RefKeys refs={refs} />
    </Frame>
  );
}

export interface GroupedRow {
  id: string;
  label: string;
  /** Jugador primero y después cada referencia. */
  values: (number | null)[];
  texts: string[];
}

/** Jugador contra cada referencia, estadística por estadística (cada fila con su escala). */
export function GroupedBars({
  rows,
  refs,
  player,
  label,
  onOpen,
}: {
  rows: GroupedRow[];
  refs: ChartRef[];
  player: string;
  label: string;
  onOpen?: (statId: string) => void;
}) {
  const [tip, setTip] = useState<Tip | null>(null);
  const [box, W] = useWidth();
  const LABEL_W = labelWidth(W);
  const PLOT_W = W - LABEL_W - PAD_R;
  const chars = Math.floor(LABEL_W / 6.4);
  const series: ChartRef[] = [{ label: player, slot: 1 }, ...refs];
  const bar = 6;
  const rowH = series.length * (bar + 4) + 10;
  const height = TOP + rows.length * rowH;
  return (
    <Frame box={box} width={W} height={height} tip={tip} label={label} onOpen={onOpen}>
      <svg viewBox={`0 0 ${String(W)} ${String(height)}`} className="chart-svg" role="img" aria-label={label}>
        <text x={LABEL_W} y={12} className="cmp-value">
          Cada fila con su propia escala
        </text>
        {rows.map((r, i) => {
          const y = TOP + i * rowH;
          const nums = r.values.filter((v): v is number => v !== null);
          const lo = Math.min(0, ...nums);
          const hi = Math.max(0, ...nums);
          const span = hi - lo || 1;
          const x = (v: number) => LABEL_W + ((v - lo) / span) * PLOT_W;
          return (
            <g
              key={r.id}
              data-stat={r.id}
              className="cmp-chart-row"
              onPointerEnter={() => {
                setTip({
                  x: LABEL_W + PLOT_W / 2,
                  y: y + 4,
                  content: (
                    <>
                      <strong>{r.label}</strong>
                      {series.map((s, k) => (
                        <span key={s.label}>
                          <i className="chart-key chart-key--box" style={{ background: color(s.slot) }} />
                          {s.label}: {r.texts[k]}
                        </span>
                      ))}
                    </>
                  ),
                });
              }}
              onPointerLeave={() => {
                setTip(null);
              }}
            >
              <rect x={0} y={y} width={W} height={rowH} className="cmp-chart-hit" />
              <text x={LABEL_W - 8} y={y + rowH / 2} dy="0.32em" textAnchor="end" className="cmp-label">
                <title>{r.label}</title>
                {short(r.label, chars)}
              </text>
              <line x1={x(0)} x2={x(0)} y1={y + 3} y2={y + rowH - 5} className="chart-baseline" />
              {r.values.map((v, k) => {
                const by = y + 5 + k * (bar + 4);
                if (v === null) {
                  return (
                    <text key={k} x={x(0) + 4} y={by + bar / 2} dy="0.32em" className="cmp-value">
                      sin datos
                    </text>
                  );
                }
                const left = Math.min(x(v), x(0));
                const width = Math.max(1, Math.abs(x(v) - x(0)));
                return (
                  <g key={k}>
                    <rect
                      x={left}
                      y={by}
                      width={width}
                      height={bar}
                      rx={2}
                      style={{ fill: color(series[k]?.slot ?? 3) }}
                    />
                    <text x={left + width + 4} y={by + bar / 2} dy="0.32em" className="cmp-value">
                      {r.texts[k]}
                    </text>
                  </g>
                );
              })}
            </g>
          );
        })}
      </svg>
      <RefKeys refs={refs} player={player} />
    </Frame>
  );
}

export interface BulletRow {
  id: string;
  label: string;
  higherIsBetter: boolean;
  player: number | null;
  playerText: string;
  reference: number | null;
  referenceText: string;
  /** Rango del grupo de referencia: mínimo, cuartiles y máximo. */
  range: { min: number; q1: number; q3: number; max: number } | null;
}

/** Marcador del jugador sobre el rango del grupo de referencia; a la derecha, mejor. */
export function BulletChart({
  rows,
  reference,
  player,
  label,
  onOpen,
}: {
  rows: BulletRow[];
  reference: ChartRef;
  player: string;
  label: string;
  onOpen?: (statId: string) => void;
}) {
  const [tip, setTip] = useState<Tip | null>(null);
  const [box, W] = useWidth();
  const LABEL_W = labelWidth(W);
  const PLOT_W = W - LABEL_W - PAD_R;
  const chars = Math.floor(LABEL_W / 6.4);
  const rowH = 26;
  const height = TOP + rows.length * rowH + 6;
  return (
    <Frame box={box} width={W} height={height} tip={tip} label={label} onOpen={onOpen}>
      <svg viewBox={`0 0 ${String(W)} ${String(height)}`} className="chart-svg" role="img" aria-label={label}>
        <g className="chart-axis">
          <text x={LABEL_W} y={12}>
            peor
          </text>
          <text x={W - PAD_R} y={12} textAnchor="end">
            mejor
          </text>
        </g>
        {rows.map((r, i) => {
          const y = TOP + i * rowH;
          const nums = [r.player, r.reference, r.range?.min, r.range?.max].filter(
            (v): v is number => typeof v === 'number',
          );
          const lo = Math.min(...nums);
          const hi = Math.max(...nums);
          const span = hi - lo || 1;
          // Si menos es mejor, el eje va al revés: el mejor valor queda a la derecha.
          const x = (v: number) => LABEL_W + (r.higherIsBetter ? (v - lo) / span : (hi - v) / span) * PLOT_W;
          const mid = y + rowH / 2;
          return (
            <g
              key={r.id}
              data-stat={r.id}
              className="cmp-chart-row"
              onPointerEnter={() => {
                setTip({
                  x: LABEL_W + PLOT_W / 2,
                  y: y + 2,
                  content: (
                    <>
                      <strong>{r.label}</strong>
                      <span>
                        {player}: {r.playerText}
                      </span>
                      <span>
                        {reference.label}: {r.referenceText}
                      </span>
                      {r.range ? (
                        <span>
                          Rango del grupo: {r.range.min.toLocaleString('es-AR', { maximumFractionDigits: 2 })} a{' '}
                          {r.range.max.toLocaleString('es-AR', { maximumFractionDigits: 2 })}
                        </span>
                      ) : null}
                    </>
                  ),
                });
              }}
              onPointerLeave={() => {
                setTip(null);
              }}
            >
              <rect x={0} y={y} width={W} height={rowH} className="cmp-chart-hit" />
              <text x={LABEL_W - 8} y={mid} dy="0.32em" textAnchor="end" className="cmp-label">
                <title>{r.label}</title>
                {short(r.label, chars)}
                {!r.higherIsBetter ? ' ↓' : ''}
              </text>
              {nums.length === 0 ? (
                <text x={LABEL_W} y={mid} dy="0.32em" className="cmp-value">
                  sin datos
                </text>
              ) : (
                <>
                  {r.range ? (
                    <>
                      <rect
                        x={Math.min(x(r.range.min), x(r.range.max))}
                        y={mid - 6}
                        width={Math.max(2, Math.abs(x(r.range.max) - x(r.range.min)))}
                        height={12}
                        rx={3}
                        className="cmp-bullet-range"
                      />
                      <rect
                        x={Math.min(x(r.range.q1), x(r.range.q3))}
                        y={mid - 6}
                        width={Math.max(2, Math.abs(x(r.range.q3) - x(r.range.q1)))}
                        height={12}
                        className="cmp-bullet-iqr"
                      />
                    </>
                  ) : null}
                  {r.reference !== null ? (
                    <line
                      x1={x(r.reference)}
                      x2={x(r.reference)}
                      y1={mid - 9}
                      y2={mid + 9}
                      strokeWidth={3}
                      strokeLinecap="round"
                      style={{ stroke: color(reference.slot) }}
                    />
                  ) : null}
                  {r.player !== null ? (
                    <circle cx={x(r.player)} cy={mid} r={5} className="chart-dot" style={{ fill: color(1) }} />
                  ) : null}
                  <text x={W - PAD_R + 6} y={mid} dy="0.32em" className="cmp-value">
                    {r.playerText}
                  </text>
                </>
              )}
            </g>
          );
        })}
      </svg>
      <ul className="chart-legend">
        <li>
          <span className="chart-key cmp-dot-key" style={{ background: color(1) }} />
          Punto: {player}
        </li>
        <li>
          <span className="chart-key chart-key--line" style={{ background: color(reference.slot) }} />
          Línea: {reference.label}
        </li>
        {reference.slot !== 2 ? (
          <li>
            <span className="chart-key chart-key--box cmp-bullet-key" />
            Banda: rango de {reference.label} (más oscura, la mitad del medio)
          </li>
        ) : null}
      </ul>
    </Frame>
  );
}
