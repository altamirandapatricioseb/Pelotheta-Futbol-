'use client';

// Dispersión del Ojeador: ejes con línea, marcas y título, nombre al lado de los puntos que se
// destacan y una línea de referencia opcional (la mediana del mercado por edad).

import { useRouter } from 'next/navigation';

export interface ScatterPoint {
  key: string;
  x: number;
  y: number;
  /** Nombre que se escribe al lado del punto (sin nombre, solo el punto). */
  label?: string;
  color: string;
  r?: number;
  title: string;
  href?: string;
  emphasis?: boolean;
}

interface Axis {
  title: string;
  log?: boolean;
  format: (v: number) => string;
  min?: number;
  max?: number;
}

const W = 720;
const H = 380;
const L = 96;
const R = 24;
const T = 16;
const B = 52;

function ticks(lo: number, hi: number, log: boolean): number[] {
  if (log) {
    const out: number[] = [];
    for (let e = Math.floor(Math.log10(lo)); e <= Math.ceil(Math.log10(hi)); e++)
      for (const m of [1, 2, 5]) {
        const v = m * 10 ** e;
        if (v >= lo && v <= hi) out.push(v);
      }
    return out;
  }
  const step = (hi - lo) / 4;
  return [0, 1, 2, 3, 4].map((i) => lo + i * step);
}

export function ScoutScatter({
  points,
  x,
  y,
  line,
  caption,
  label,
}: {
  points: ScatterPoint[];
  x: Axis;
  y: Axis;
  line?: { x: number; y: number }[];
  caption: string;
  label: string;
}) {
  const router = useRouter();
  const xs = [...points.map((p) => p.x), ...(line ?? []).map((p) => p.x)];
  const ys = [...points.map((p) => p.y), ...(line ?? []).map((p) => p.y)];
  const pad = (lo: number, hi: number, log?: boolean): [number, number] =>
    log ? [lo / 1.3, hi * 1.3] : [lo - (hi - lo || 1) * 0.05, hi + (hi - lo || 1) * 0.05];
  const [x0, x1] =
    x.min !== undefined && x.max !== undefined ? [x.min, x.max] : pad(Math.min(...xs), Math.max(...xs), x.log);
  const [y0, y1] =
    y.min !== undefined && y.max !== undefined ? [y.min, y.max] : pad(Math.min(...ys), Math.max(...ys), y.log);
  const f = (v: number, lo: number, hi: number, log?: boolean) =>
    log ? (Math.log(v) - Math.log(lo)) / (Math.log(hi) - Math.log(lo) || 1) : (v - lo) / (hi - lo || 1);
  const px = (v: number) => L + f(v, x0, x1, x.log) * (W - L - R);
  const py = (v: number) => H - B - f(v, y0, y1, y.log) * (H - T - B);
  const ordered = [...points].sort((a, b) => Number(a.emphasis ?? false) - Number(b.emphasis ?? false));
  const mid = (T + H - B) / 2;
  return (
    <figure className="scout-chart">
      <svg viewBox={`0 0 ${String(W)} ${String(H)}`} role="img" aria-label={label}>
        {ticks(y0, y1, y.log ?? false).map((t) => (
          <g key={`y${String(t)}`}>
            <line x1={L} x2={W - R} y1={py(t)} y2={py(t)} stroke="var(--chart-grid)" />
            <text x={L - 8} y={py(t) + 4} textAnchor="end" className="scout-axis">
              {y.format(t)}
            </text>
          </g>
        ))}
        {ticks(x0, x1, x.log ?? false).map((t) => (
          <g key={`x${String(t)}`}>
            <line x1={px(t)} x2={px(t)} y1={H - B} y2={H - B + 5} stroke="var(--chart-axis)" />
            <text x={px(t)} y={H - B + 18} textAnchor="middle" className="scout-axis">
              {x.format(t)}
            </text>
          </g>
        ))}
        <line x1={L} x2={W - R} y1={H - B} y2={H - B} stroke="var(--chart-axis)" strokeWidth={1.5} />
        <line x1={L} x2={L} y1={T} y2={H - B} stroke="var(--chart-axis)" strokeWidth={1.5} />
        <text x={(L + W - R) / 2} y={H - 8} textAnchor="middle" className="scout-axis-title">
          {x.title}
        </text>
        <text
          x={16}
          y={mid}
          textAnchor="middle"
          transform={`rotate(-90 16 ${String(mid)})`}
          className="scout-axis-title"
        >
          {y.title}
        </text>
        {line && line.length > 1 ? (
          <polyline
            points={line.map((p) => `${String(px(p.x))},${String(py(p.y))}`).join(' ')}
            fill="none"
            stroke="var(--color-text-muted)"
            strokeWidth={2}
            strokeDasharray="6 4"
          />
        ) : null}
        {ordered.map((p) => {
          const cx = px(p.x);
          const cy = py(p.y);
          const r = p.r ?? 4;
          const right = cx < W - 170;
          return (
            <g
              key={p.key}
              className={p.href ? 'cursor-pointer' : undefined}
              onClick={
                p.href
                  ? () => {
                      router.push(p.href as string);
                    }
                  : undefined
              }
            >
              <circle
                cx={cx}
                cy={cy}
                r={r}
                fill={p.color}
                fillOpacity={p.emphasis ? 1 : 0.6}
                stroke={p.emphasis ? 'var(--color-text)' : 'none'}
                strokeWidth={1.5}
              />
              {p.label ? (
                <text
                  x={right ? cx + r + 4 : cx - r - 4}
                  y={cy + 4}
                  textAnchor={right ? 'start' : 'end'}
                  className={p.emphasis ? 'scout-point-label scout-point-label--on' : 'scout-point-label'}
                >
                  {p.label}
                </text>
              ) : null}
              <title>{p.title}</title>
            </g>
          );
        })}
      </svg>
      <figcaption className="text-xs text-muted">{caption}</figcaption>
    </figure>
  );
}
