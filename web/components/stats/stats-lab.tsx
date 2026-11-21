'use client';

// Panel «Probabilidad y estadística» de cada interfaz: dibuja los análisis que arma
// `lib/models/analyses.ts` (distribuciones, intervalos, pruebas, cajas, dispersión, correlaciones,
// ANOVA, contingencia, regresión y curvas). Verde lo bueno, rojo lo malo, violeta lo neutro.

import { ScoutScatter } from '@/components/models/scout-chart';
import { type Analysis, ALPHA, type Format, SECTION_OF, WIDE } from '@/lib/models/analyses';
import type { Summary } from '@/lib/models/inference';

const nf = (d: number) => new Intl.NumberFormat('es-AR', { minimumFractionDigits: d, maximumFractionDigits: d });
const f2 = (v: number) => nf(2).format(v);
const f3 = (v: number) => nf(3).format(v);
const pv = (p: number) => (p < 0.001 ? '< 0,001' : f3(p));
const r1 = (v: number) => Math.round(v * 10) / 10;
const EUR = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 });

function fmt(v: number, format: Format): string {
  if (format === 'pct') return `${nf(1).format(100 * v)} %`;
  if (format === 'eur') return v >= 1e6 ? `€ ${f2(v / 1e6)} M` : `€ ${EUR.format(v)}`;
  if (format === 'int') return nf(0).format(v);
  return f2(v);
}

/** Barras (observado o probabilidad) con puntos del modelo teórico encima. */
function Bars({
  xTitle,
  yTitle,
  bars,
  legend,
}: {
  xTitle: string;
  yTitle: string;
  bars: { label: string; value: number; model?: number; highlight?: boolean }[];
  legend: [string, string | null];
}) {
  const W = 480;
  const H = 280;
  const L = 56;
  const B = 50;
  const T = 14;
  const R = 16;
  const top = Math.max(...bars.map((b) => Math.max(b.value, b.model ?? 0))) * 1.1 || 1;
  const slot = (W - L - R) / bars.length;
  const y = (v: number) => r1(H - B - (v / top) * (H - T - B));
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => t * top);
  const model = bars.flatMap((b, i) => (b.model === undefined ? [] : [{ x: r1(L + slot * (i + 0.5)), y: y(b.model) }]));
  const mid = (T + H - B) / 2;
  return (
    <figure className="scout-chart">
      <svg viewBox={`0 0 ${String(W)} ${String(H)}`} role="img" aria-label={`${yTitle} por ${xTitle.toLowerCase()}`}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={L} x2={W - R} y1={y(t)} y2={y(t)} stroke="var(--chart-grid)" />
            <text x={L - 8} y={y(t) + 4} textAnchor="end" className="scout-axis">
              {top <= 1 ? `${nf(0).format(100 * t)} %` : nf(top < 10 ? 1 : 0).format(t)}
            </text>
          </g>
        ))}
        {bars.map((b, i) => {
          const x = L + slot * i;
          return (
            <g key={b.label}>
              <rect
                x={r1(x + slot * 0.15)}
                y={y(b.value)}
                width={r1(slot * 0.7)}
                height={r1(H - B - y(b.value))}
                rx={3}
                fill={b.highlight ? 'var(--series-1)' : 'var(--series-2)'}
                fillOpacity={b.highlight ? 1 : 0.7}
              >
                <title>{`${b.label}: ${top <= 1 ? fmt(b.value, 'pct') : f2(b.value)}`}</title>
              </rect>
              {bars.length <= 16 || i % 2 === 0 ? (
                <text x={r1(x + slot / 2)} y={H - B + 16} textAnchor="middle" className="scout-axis">
                  {b.label}
                </text>
              ) : null}
            </g>
          );
        })}
        {model.length ? (
          <>
            <polyline
              points={model.map((p) => `${String(p.x)},${String(p.y)}`).join(' ')}
              fill="none"
              stroke="var(--color-text)"
              strokeWidth={1.5}
              strokeDasharray="4 3"
            />
            {model.map((p) => (
              <circle key={`${String(p.x)}-${String(p.y)}`} cx={p.x} cy={p.y} r={3.5} fill="var(--color-text)" />
            ))}
          </>
        ) : null}
        <line x1={L} x2={W - R} y1={H - B} y2={H - B} stroke="var(--chart-axis)" strokeWidth={1.5} />
        <line x1={L} x2={L} y1={T} y2={H - B} stroke="var(--chart-axis)" strokeWidth={1.5} />
        <text x={(L + W - R) / 2} y={H - 8} textAnchor="middle" className="scout-axis-title">
          {xTitle}
        </text>
        <text
          x={14}
          y={mid}
          textAnchor="middle"
          transform={`rotate(-90 14 ${String(mid)})`}
          className="scout-axis-title"
        >
          {yTitle}
        </text>
      </svg>
      <figcaption className="flex flex-wrap gap-4 text-xs text-muted">
        <span className="flex items-center gap-1.5">
          <span className="inline-block size-3 rounded-sm" style={{ background: 'var(--series-2)' }} />
          {legend[0]}
        </span>
        {legend[1] ? (
          <span className="flex items-center gap-1.5">
            <span className="inline-block size-3 rounded-full" style={{ background: 'var(--color-text)' }} />
            {legend[1]}
          </span>
        ) : null}
      </figcaption>
    </figure>
  );
}

/** Intervalos de confianza horizontales: punto estimado y barra del intervalo, con una referencia opcional. */
function Intervals({
  rows,
  format,
  refLine,
}: {
  rows: { label: string; est: number; lo: number; hi: number; n: number }[];
  format: Format;
  refLine?: { label: string; value: number };
}) {
  const W = 480;
  const L = 170;
  const R = 24;
  const ROW = 30;
  const H = rows.length * ROW + 46;
  const lo = Math.min(...rows.map((r) => r.lo), refLine?.value ?? Infinity);
  const hi = Math.max(...rows.map((r) => r.hi), refLine?.value ?? -Infinity);
  const pad = (hi - lo) * 0.08 || 1;
  const x0 = format === 'pct' ? Math.max(0, lo - pad) : lo - pad;
  const x1 = format === 'pct' ? Math.min(1, hi + pad) : hi + pad;
  const x = (v: number) => r1(L + ((v - x0) / (x1 - x0)) * (W - L - R));
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => x0 + t * (x1 - x0));
  return (
    <figure className="scout-chart">
      <svg viewBox={`0 0 ${String(W)} ${String(H)}`} role="img" aria-label="Intervalos de confianza del 95 %">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={x(t)} x2={x(t)} y1={6} y2={H - 36} stroke="var(--chart-grid)" />
            <text x={x(t)} y={H - 20} textAnchor="middle" className="scout-axis">
              {fmt(t, format)}
            </text>
          </g>
        ))}
        {refLine ? (
          <g>
            <line
              x1={x(refLine.value)}
              x2={x(refLine.value)}
              y1={4}
              y2={H - 36}
              stroke="var(--color-text)"
              strokeWidth={1.5}
              strokeDasharray="5 4"
            />
            <text x={x(refLine.value) + 4} y={H - 40} className="scout-axis">
              {refLine.label}
            </text>
          </g>
        ) : null}
        {rows.map((r, i) => {
          const cy = 16 + i * ROW;
          const tone = refLine
            ? r.lo > refLine.value
              ? 'var(--series-1)'
              : r.hi < refLine.value
                ? 'var(--series-3)'
                : 'var(--series-2)'
            : 'var(--series-2)';
          return (
            <g key={r.label}>
              <text x={L - 10} y={cy + 4} textAnchor="end" className="scout-point-label">
                {r.label.length > 26 ? `${r.label.slice(0, 25)}…` : r.label}
              </text>
              <line x1={x(r.lo)} x2={x(r.hi)} y1={cy} y2={cy} stroke={tone} strokeWidth={3} strokeLinecap="round" />
              <circle cx={x(r.est)} cy={cy} r={5} fill={tone} stroke="var(--color-bg)" strokeWidth={1.5}>
                <title>{`${r.label}: ${fmt(r.est, format)} (${fmt(r.lo, format)} a ${fmt(r.hi, format)}), n = ${String(r.n)}`}</title>
              </circle>
            </g>
          );
        })}
        <line x1={L} x2={W - R} y1={H - 36} y2={H - 36} stroke="var(--chart-axis)" strokeWidth={1.5} />
      </svg>
      <figcaption className="text-xs text-muted">
        Punto: lo estimado; barra: el intervalo del 95 %.
        {refLine ? ' Verde: el intervalo queda entero arriba de la referencia; rojo: entero abajo.' : ''}
      </figcaption>
    </figure>
  );
}

function Boxes({ rows, format }: { rows: { label: string; summary: Summary }[]; format: Format }) {
  const W = 480;
  const L = 130;
  const R = 24;
  const ROW = 44;
  const H = rows.length * ROW + 46;
  const lo = Math.min(...rows.map((r) => r.summary.min));
  const hi = Math.max(...rows.map((r) => r.summary.max));
  const pad = (hi - lo) * 0.05 || 1;
  const x = (v: number) => r1(L + ((v - (lo - pad)) / (hi - lo + 2 * pad)) * (W - L - R));
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => lo - pad + t * (hi - lo + 2 * pad));
  return (
    <figure className="scout-chart">
      <svg viewBox={`0 0 ${String(W)} ${String(H)}`} role="img" aria-label="Diagramas de caja">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={x(t)} x2={x(t)} y1={6} y2={H - 36} stroke="var(--chart-grid)" />
            <text x={x(t)} y={H - 20} textAnchor="middle" className="scout-axis">
              {fmt(t, format)}
            </text>
          </g>
        ))}
        <line x1={L} x2={W - R} y1={H - 36} y2={H - 36} stroke="var(--chart-axis)" strokeWidth={1.5} />
        {rows.map((r, i) => {
          const cy = 12 + i * ROW + ROW / 2;
          const s = r.summary;
          return (
            <g key={r.label}>
              <text x={L - 10} y={cy + 4} textAnchor="end" className="scout-point-label">
                {r.label} (n = {s.n})
              </text>
              <line x1={x(s.min)} x2={x(s.max)} y1={cy} y2={cy} stroke="var(--series-2)" strokeWidth={2} />
              <rect
                x={x(s.q1)}
                y={cy - 12}
                width={Math.max(2, r1(x(s.q3) - x(s.q1)))}
                height={24}
                rx={4}
                fill="var(--series-2)"
                fillOpacity={0.35}
                stroke="var(--series-2)"
                strokeWidth={2}
              />
              <line
                x1={x(s.median)}
                x2={x(s.median)}
                y1={cy - 12}
                y2={cy + 12}
                stroke="var(--color-text)"
                strokeWidth={2.5}
              />
              <path
                d={`M${String(x(s.mean))} ${String(cy - 6)} l6 6 l-6 6 l-6 -6 z`}
                fill="var(--color-bg)"
                stroke="var(--color-text)"
                strokeWidth={1.5}
              >
                <title>{`Media ${fmt(s.mean, format)} · mediana ${fmt(s.median, format)} · desvío ${fmt(s.sd, format)}`}</title>
              </path>
            </g>
          );
        })}
      </svg>
      <figcaption className="text-xs text-muted">
        Caja: primer a tercer cuartil; raya: mediana; rombo: media; bigotes: mínimo y máximo.
      </figcaption>
    </figure>
  );
}

function Table({ head, children }: { head: string[]; children: React.ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="scout-heat scout-table">
        <thead>
          <tr>
            {head.map((h, i) => (
              <th key={`${h}-${String(i)}`} scope="col">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

function SummaryTable({ rows, format }: { rows: { label: string; summary: Summary }[]; format: Format }) {
  return (
    <Table head={['Grupo', 'n', 'Media', 'IC 95 %', 'Mediana', 'Desvío', 'CV']}>
      {rows.map(({ label, summary: s }) => (
        <tr key={label}>
          <th scope="row">{label}</th>
          <td className="tabular">{s.n}</td>
          <td className="tabular">{fmt(s.mean, format)}</td>
          <td className="tabular">
            {fmt(s.ciLow, format)} a {fmt(s.ciHigh, format)}
          </td>
          <td className="tabular">{fmt(s.median, format)}</td>
          <td className="tabular">{fmt(s.sd, format)}</td>
          <td className="tabular">{f2(s.cv)}</td>
        </tr>
      ))}
    </Table>
  );
}

function AnovaTable({ a }: { a: Extract<Analysis, { kind: 'anova' }> }) {
  return (
    <Table head={['Fuente', 'Suma de cuadrados', 'gl', 'Cuadrado medio', 'F', 'p']}>
      <tr>
        <th scope="row">Entre grupos</th>
        <td className="tabular">{f3(a.result.ssb)}</td>
        <td className="tabular">{a.result.dfb}</td>
        <td className="tabular">{f3(a.result.msb)}</td>
        <td className="tabular">{f2(a.result.f)}</td>
        <td className="tabular">{pv(a.result.p)}</td>
      </tr>
      <tr>
        <th scope="row">Dentro (error)</th>
        <td className="tabular">{f3(a.result.ssw)}</td>
        <td className="tabular">{a.result.dfw}</td>
        <td className="tabular">{f3(a.result.msw)}</td>
        <td />
        <td />
      </tr>
    </Table>
  );
}

function Body({ a }: { a: Analysis }) {
  switch (a.kind) {
    case 'dist':
      return (
        <Bars
          xTitle={a.xTitle}
          yTitle="Frecuencia"
          bars={a.bars.map((b) => ({ label: b.label, value: b.observed, model: b.expected }))}
          legend={['Observado', `Esperado con ${a.model}`]}
        />
      );
    case 'pmf':
      return (
        <Bars
          xTitle={a.xTitle}
          yTitle="Probabilidad"
          bars={a.bars.map((b) => ({ label: b.label, value: b.p, model: b.approx, highlight: b.highlight }))}
          legend={['Probabilidad', a.approxLabel ?? null]}
        />
      );
    case 'ci':
      return <Intervals rows={a.rows} format={a.format} refLine={a.ref} />;
    case 'box':
      return (
        <>
          <Boxes rows={a.rows} format={a.format} />
          <SummaryTable rows={a.rows} format={a.format} />
        </>
      );
    case 'tests':
      return (
        <Table head={['Pregunta', 'Prueba', a.labels[0], a.labels[1], 'Estadístico', 'gl', 'p', 'Decisión']}>
          {a.rows.map((r) => (
            <tr key={r.question}>
              <th scope="row" className="whitespace-normal">
                {r.question}
              </th>
              <td className="text-left">{r.test}</td>
              <td className="tabular">{r.a}</td>
              <td className="tabular">{r.b}</td>
              <td className="tabular">
                {r.letter} = {f2(r.statistic)}
              </td>
              <td className="tabular">{r.df}</td>
              <td className="tabular">{pv(r.p)}</td>
              <td className="text-left">{r.p < ALPHA ? 'Hay diferencia' : 'Sin diferencia'}</td>
            </tr>
          ))}
        </Table>
      );
    case 'scatter':
      return (
        <ScoutScatter
          compact
          label={a.title}
          points={a.points.map((p) => ({
            key: p.key,
            x: p.x,
            y: p.y,
            label: p.label,
            color: 'var(--series-2)',
            r: 4,
            title: `${p.label ?? ''} (${f2(p.x)}; ${f2(p.y)})`,
          }))}
          lines={[{ key: 'recta', points: a.line, color: 'var(--color-text)' }]}
          x={{ title: a.xTitle, format: f2 }}
          y={{ title: a.yTitle, format: f2 }}
          caption={a.note}
        />
      );
    case 'curves':
      return (
        <>
          <ScoutScatter
            compact
            label={a.title}
            points={[]}
            lines={a.curves.map((c) => ({ key: c.key, points: c.points, color: c.color }))}
            x={{
              title: a.xTitle,
              format: (v) => (a.xTitle.startsWith('Probabilidad') ? `${nf(0).format(100 * v)} %` : f2(v)),
            }}
            y={{ title: a.yTitle, format: f2 }}
            caption=""
          />
          <ul className="flex flex-wrap gap-4 text-xs">
            {a.curves.map((c) => (
              <li key={c.key} className="flex items-center gap-1.5">
                <span className="inline-block h-1 w-5 rounded" style={{ background: c.color }} />
                {c.label}
              </li>
            ))}
          </ul>
        </>
      );
    case 'corr':
      return (
        <Table head={['', ...a.labels]}>
          {a.labels.map((label, i) => (
            <tr key={label}>
              <th scope="row">{label}</th>
              {(a.matrix[i] ?? []).map((r, j) => {
                const p = a.pvals[i]?.[j] ?? 1;
                const color = r >= 0 ? 'var(--series-1)' : 'var(--series-3)';
                return (
                  <td
                    key={a.labels[j] ?? j}
                    className="tabular"
                    style={
                      i === j
                        ? undefined
                        : {
                            background: `color-mix(in srgb, ${color} ${String(Math.round(Math.abs(r) * 70))}%, transparent)`,
                          }
                    }
                    title={`r = ${f3(r)}, p = ${pv(p)}`}
                  >
                    {i === j ? '1' : `${f2(r)}${p < ALPHA ? '*' : ''}`}
                  </td>
                );
              })}
            </tr>
          ))}
        </Table>
      );
    case 'anova':
      return (
        <>
          <Boxes rows={a.rows} format={a.format} />
          <AnovaTable a={a} />
          <SummaryTable rows={a.rows} format={a.format} />
        </>
      );
    case 'contingency':
      return (
        <Table head={['', ...a.colLabels]}>
          {a.rowLabels.map((label, i) => (
            <tr key={label}>
              <th scope="row">{label}</th>
              {a.colLabels.map((c, j) => {
                const z = a.residuals[i]?.[j] ?? 0;
                return (
                  <td
                    key={c}
                    className="tabular"
                    style={{
                      background: `color-mix(in srgb, var(--series-2) ${String(Math.min(80, Math.round(Math.abs(z) * 25)))}%, transparent)`,
                    }}
                    title={`Residuo estandarizado ${f2(z)}`}
                  >
                    {a.table[i]?.[j] ?? 0}
                    <span className="block text-xs text-muted">{f2(a.expected[i]?.[j] ?? 0)}</span>
                  </td>
                );
              })}
            </tr>
          ))}
        </Table>
      );
    case 'regression':
      return (
        <>
          <Table head={['Variable', 'β', 'Error estándar', 't', 'p']}>
            {a.result.names.map((name, j) => (
              <tr key={name}>
                <th scope="row">{name}</th>
                <td className="tabular">{f3(a.result.beta[j] ?? 0)}</td>
                <td className="tabular">{f3(a.result.se[j] ?? 0)}</td>
                <td className="tabular">{f2(a.result.t[j] ?? 0)}</td>
                <td className={`tabular ${(a.result.p[j] ?? 1) < ALPHA ? 'font-semibold' : ''}`}>
                  {pv(a.result.p[j] ?? 1)}
                </td>
              </tr>
            ))}
          </Table>
          <p className="text-sm">
            R² = {f3(a.result.r2)} · R² ajustado = {f3(a.result.r2adj)} · F = {f2(a.result.f)} con ({String(a.result.k)}
            ; {String(a.result.n - a.result.k - 1)}) gl, p = {pv(a.result.pF)} · n = {a.result.n}
          </p>
        </>
      );
  }
}

/**
 * Análisis de una interfaz agrupados en secciones por lo que muestran (Goles, Local y visitante…),
 * cada uno en una tarjeta como los demás gráficos. No se dibuja si no hay datos suficientes.
 */
export function StatsLab({ analyses }: { analyses: Analysis[] }) {
  if (!analyses.length) return null;
  const sections = [...new Set(analyses.map((a) => SECTION_OF[a.id] ?? 'Más análisis'))];
  return (
    <div className="grid gap-8">
      {sections.map((name) => (
        <section key={name} aria-label={name} className="grid gap-4">
          <h2 className="text-xl font-bold">{name}</h2>
          <div className="chart-grid-layout">
            {analyses
              .filter((a) => (SECTION_OF[a.id] ?? 'Más análisis') === name)
              .map((a) => (
                <article
                  key={a.id}
                  className={`chart-card${WIDE.has(a.id) ? ' chart-card--wide' : ''}`}
                  aria-labelledby={`titulo-${a.id}`}
                >
                  <header>
                    <h3 id={`titulo-${a.id}`} className="text-base font-bold leading-snug">
                      {a.title}
                    </h3>
                    <p className="mt-1 text-xs text-muted">{a.intro}</p>
                  </header>
                  <Body a={a} />
                  {a.reading ? <p className="text-xs font-medium">{a.reading}</p> : null}
                </article>
              ))}
          </div>
        </section>
      ))}
    </div>
  );
}
