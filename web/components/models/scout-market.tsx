'use client';

// Estadística del mercado en el Ojeador: descriptiva con diagramas de caja, ANOVA del valor por
// puesto, tabla de contingencia puesto × edad, regresión múltiple del precio y el plantel contra la liga.

import type { Summary } from '@/lib/models/inference';
import { AGE_BANDS, type MarketStats } from '@/lib/models/market-stats';
import { GROUPS, type Group } from '@/lib/models/scouting';

import { eur, Section } from './common';
import { ScoutScatter } from './scout-chart';

const GROUP_COLOR: Record<Group, string> = {
  Arquero: 'var(--series-5)',
  Defensor: 'var(--series-4)',
  Mediocampista: 'var(--series-2)',
  Delantero: 'var(--series-8)',
};
const fmt = (d: number) => new Intl.NumberFormat('es-AR', { minimumFractionDigits: d, maximumFractionDigits: d });
const f2 = (v: number) => fmt(2).format(v);
const f3 = (v: number) => fmt(3).format(v);
const pv = (p: number) => (p < 0.001 ? '< 0,001' : f3(p));
const TEST_NAME = { medias: 't de Welch', varianzas: 'F de varianzas', proporciones: 'z de proporciones' };
const TEST_LETTER = { medias: 't', varianzas: 'F', proporciones: 'z' };

function Decision({ p, alpha, yes, no }: { p: number; alpha: number; yes: string; no: string }) {
  return (
    <p className="text-sm">
      <span className="font-semibold">{p < alpha ? 'Se rechaza H₀' : 'No se rechaza H₀'}</span> (p = {pv(p)}, α ={' '}
      {String(alpha).replace('.', ',')}): {p < alpha ? yes : no}
    </p>
  );
}

/** Diagramas de caja horizontales en escala logarítmica (mínimo, Q1, mediana, Q3, máximo y la media). */
function Boxplots({ rows }: { rows: { label: string; summary: Summary; color: string }[] }) {
  const W = 720;
  const L = 170;
  const R = 24;
  const ROW = 44;
  const H = rows.length * ROW + 56;
  const lo = Math.min(...rows.map((r) => r.summary.min));
  const hi = Math.max(...rows.map((r) => r.summary.max));
  const x = (v: number) =>
    L + ((Math.log10(v) - Math.log10(lo)) / (Math.log10(hi) - Math.log10(lo) || 1)) * (W - L - R);
  const ticks: number[] = [];
  for (let e = Math.floor(Math.log10(lo)); e <= Math.ceil(Math.log10(hi)); e++)
    for (const m of [1, 3]) if (m * 10 ** e >= lo && m * 10 ** e <= hi) ticks.push(m * 10 ** e);
  return (
    <figure className="scout-chart">
      <svg viewBox={`0 0 ${String(W)} ${String(H)}`} role="img" aria-label="Diagramas de caja del valor de mercado">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={x(t)} x2={x(t)} y1={8} y2={H - 44} stroke="var(--chart-grid)" />
            <text x={x(t)} y={H - 26} textAnchor="middle" className="scout-axis">
              {eur(t)}
            </text>
          </g>
        ))}
        <line x1={L} x2={W - R} y1={H - 44} y2={H - 44} stroke="var(--chart-axis)" strokeWidth={1.5} />
        <line x1={L} x2={L} y1={8} y2={H - 44} stroke="var(--chart-axis)" strokeWidth={1.5} />
        <text x={(L + W - R) / 2} y={H - 6} textAnchor="middle" className="scout-axis-title">
          Valor de mercado (escala logarítmica)
        </text>
        {rows.map((r, i) => {
          const cy = 14 + i * ROW + ROW / 2;
          const s = r.summary;
          return (
            <g key={r.label}>
              <text x={L - 10} y={cy + 4} textAnchor="end" className="scout-point-label">
                {r.label} (n = {s.n})
              </text>
              <line x1={x(s.min)} x2={x(s.max)} y1={cy} y2={cy} stroke={r.color} strokeWidth={2} />
              <line x1={x(s.min)} x2={x(s.min)} y1={cy - 7} y2={cy + 7} stroke={r.color} strokeWidth={2} />
              <line x1={x(s.max)} x2={x(s.max)} y1={cy - 7} y2={cy + 7} stroke={r.color} strokeWidth={2} />
              <rect
                x={x(s.q1)}
                y={cy - 13}
                width={Math.max(2, x(s.q3) - x(s.q1))}
                height={26}
                rx={4}
                fill={r.color}
                fillOpacity={0.35}
                stroke={r.color}
                strokeWidth={2}
              />
              <line
                x1={x(s.median)}
                x2={x(s.median)}
                y1={cy - 13}
                y2={cy + 13}
                stroke="var(--color-text)"
                strokeWidth={2.5}
              />
              <path
                d={`M${String(x(s.mean))} ${String(cy - 6)} l6 6 l-6 6 l-6 -6 z`}
                fill="var(--color-bg)"
                stroke="var(--color-text)"
                strokeWidth={1.5}
              >
                <title>{`Media: ${eur(s.mean)}`}</title>
              </path>
            </g>
          );
        })}
      </svg>
      <figcaption className="text-xs text-muted">
        La caja va del primer al tercer cuartil; la raya es la mediana; el rombo, la media; los bigotes, el mínimo y el
        máximo. Si la media queda a la derecha de la mediana, el precio tiene asimetría positiva (pocos jugadores muy
        caros).
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
            {head.map((h) => (
              <th key={h} scope="col">
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

function regressionReading(j: number, beta: number[]): string {
  const b = beta[j] ?? 0;
  if (j >= 3) return `Vale ${f2(10 ** b)} veces lo que un arquero de la misma edad`;
  if (j === 2 && b < 0) return `Pico de precio a los ${f2(-(beta[1] ?? 0) / (2 * b))} años`;
  return '';
}

export function MarketStatsView({
  stats,
  team,
  points,
}: {
  stats: MarketStats;
  team: string;
  points: { name: string; team: string; group: Group; age: number; value: number }[];
}) {
  const a = stats.anova;
  const c = stats.contingency;
  const r = stats.regression;
  const n = stats.league.summary.n;
  const boxes = [
    ...stats.byGroup.map((g) => ({ label: g.group, summary: g.summary, color: GROUP_COLOR[g.group] })),
    { label: 'Toda la liga', summary: stats.league.summary, color: 'var(--chart-axis)' },
    ...(stats.own ? [{ label: team, summary: stats.own.summary, color: 'var(--color-brand)' }] : []),
  ];
  return (
    <div className="grid gap-8">
      <Section
        id="mercado-descriptiva"
        title="Cómo se reparte el valor por puesto"
        intro={`Población: los ${String(n)} jugadores de la liga con valor de mercado cargado (transfermarkt-datasets), sin ${team}. Como es la población entera y no una muestra, se estratifica por puesto: cada estrato es un puesto y se lo describe por separado.`}
      >
        <Boxplots rows={boxes} />
        <Table
          head={['Grupo', 'n', 'Media', 'IC 95 % de la media', 'Mediana', 'Q1', 'Q3', 'Desvío', 'CV', 'Asimetría']}
        >
          {boxes.map(({ label, summary: s }) => (
            <tr key={label}>
              <th scope="row">{label}</th>
              <td className="tabular">{s.n}</td>
              <td className="tabular">{eur(s.mean)}</td>
              <td className="tabular">
                {eur(Math.max(0, s.ciLow))} a {eur(s.ciHigh)}
              </td>
              <td className="tabular">{eur(s.median)}</td>
              <td className="tabular">{eur(s.q1)}</td>
              <td className="tabular">{eur(s.q3)}</td>
              <td className="tabular">{eur(s.sd)}</td>
              <td className="tabular">{f2(s.cv)}</td>
              <td className="tabular">{f2(s.skew)}</td>
            </tr>
          ))}
        </Table>
      </Section>

      <Section
        id="mercado-anova"
        title="¿El puesto cambia el precio? (ANOVA de un factor)"
        intro="H₀: la media del logaritmo del valor es la misma en los cuatro puestos. Se usa el logaritmo porque el precio es muy asimétrico y el ANOVA supone normalidad y varianzas parecidas en cada grupo."
      >
        <Table head={['Fuente', 'Suma de cuadrados', 'gl', 'Cuadrado medio', 'F', 'p']}>
          <tr>
            <th scope="row">Entre puestos</th>
            <td className="tabular">{f3(a.ssb)}</td>
            <td className="tabular">{a.dfb}</td>
            <td className="tabular">{f3(a.msb)}</td>
            <td className="tabular">{f2(a.f)}</td>
            <td className="tabular">{pv(a.p)}</td>
          </tr>
          <tr>
            <th scope="row">Dentro (error)</th>
            <td className="tabular">{f3(a.ssw)}</td>
            <td className="tabular">{a.dfw}</td>
            <td className="tabular">{f3(a.msw)}</td>
            <td />
            <td />
          </tr>
          <tr>
            <th scope="row">Total</th>
            <td className="tabular">{f3(a.ssb + a.ssw)}</td>
            <td className="tabular">{a.dfb + a.dfw}</td>
            <td />
            <td />
            <td />
          </tr>
        </Table>
        <Decision
          p={a.p}
          alpha={stats.alpha}
          yes={`el puesto sí cambia el precio medio. El puesto explica el ${f2(100 * a.eta2)} % de la variabilidad (η²).`}
          no={`no hay evidencia de que el puesto cambie el precio medio (η² = ${f2(100 * a.eta2)} %).`}
        />
      </Section>

      <Section
        id="mercado-contingencia"
        title="¿Puesto y edad van juntos? (tabla de contingencia)"
        intro="H₀: el puesto y la franja de edad son independientes. Cada celda muestra los jugadores observados y, abajo, los que se esperarían si fueran independientes; más violeta, más se aparta de lo esperado (residuo estandarizado)."
      >
        <Table head={['Puesto', ...AGE_BANDS.map((b) => b.label)]}>
          {GROUPS.map((g, i) => (
            <tr key={g}>
              <th scope="row">{g}</th>
              {AGE_BANDS.map((b, j) => {
                const z = c.residuals[i]?.[j] ?? 0;
                return (
                  <td
                    key={b.label}
                    className="tabular"
                    style={{
                      background: `color-mix(in srgb, var(--series-2) ${String(Math.min(80, Math.round(Math.abs(z) * 25)))}%, transparent)`,
                    }}
                    title={`Residuo estandarizado ${f2(z)}`}
                  >
                    {c.table[i]?.[j] ?? 0}
                    <span className="block text-xs text-muted">{f2(c.expected[i]?.[j] ?? 0)}</span>
                  </td>
                );
              })}
            </tr>
          ))}
        </Table>
        <p className="text-sm">
          χ² = {f2(c.statistic)} con {String(c.df)} grados de libertad.
        </p>
        <Decision
          p={c.p}
          alpha={stats.alpha}
          yes="la edad se reparte distinto según el puesto: las celdas más violetas muestran dónde."
          no="la edad se reparte igual en todos los puestos."
        />
      </Section>

      <Section
        id="mercado-regresion"
        title="Qué explica el precio (regresión lineal múltiple)"
        intro="Modelo: log₁₀(valor) = β₀ + β₁·edad + β₂·edad² + una variable indicadora por puesto (el arquero es la base). La edad al cuadrado capta que el precio sube hasta un pico y después baja. Las curvas son el precio que espera el modelo para cada puesto y edad."
      >
        <ScoutScatter
          label="Valor de mercado contra edad con las curvas de la regresión por puesto"
          points={points.map((p) => ({
            key: `${p.name}|${p.team}`,
            x: p.age,
            y: p.value,
            color: GROUP_COLOR[p.group],
            r: 2.5,
            title: `${p.name} (${p.team}), ${p.group}: ${String(p.age)} años, ${eur(p.value)}`,
          }))}
          lines={stats.curves.map((cv) => ({
            key: cv.group,
            points: cv.points,
            color: GROUP_COLOR[cv.group],
          }))}
          x={{ title: 'Edad (años)', format: (v) => String(Math.round(v)) }}
          y={{ title: 'Valor de mercado (escala logarítmica)', log: true, format: eur }}
          caption="Cada punto es un jugador de la liga, con el color de su puesto; cada curva, lo que predice el modelo para ese puesto (las curvas casi se superponen: el puesto pesa poco)."
        />
        <ul className="flex flex-wrap gap-4 text-xs" aria-label="Colores por puesto">
          {GROUPS.map((g) => (
            <li key={g} className="flex items-center gap-1.5">
              <span className="inline-block size-3 rounded-full" style={{ background: GROUP_COLOR[g] }} />
              {g}
            </li>
          ))}
        </ul>
        <Table head={['Variable', 'β', 'Error estándar', 't', 'p', 'Lectura']}>
          {r.names.map((name, j) => (
            <tr key={name}>
              <th scope="row">{name}</th>
              <td className="tabular">{f3(r.beta[j] ?? 0)}</td>
              <td className="tabular">{f3(r.se[j] ?? 0)}</td>
              <td className="tabular">{f2(r.t[j] ?? 0)}</td>
              <td className="tabular">{pv(r.p[j] ?? 1)}</td>
              <td className="text-left text-xs">{regressionReading(j, r.beta)}</td>
            </tr>
          ))}
        </Table>
        <p className="text-sm">
          R² = {f3(r.r2)} · R² ajustado = {f3(r.r2adj)} · F = {f2(r.f)} con ({String(r.k)}; {String(r.n - r.k - 1)}) gl,
          p = {pv(r.pF)} · n = {r.n}. Con la edad sola (regresión simple), R² = {f3(stats.simpleR2)}: sumar la edad al
          cuadrado y el puesto explica {f2(100 * (r.r2 - stats.simpleR2))} puntos más de la variabilidad.
        </p>
        <p className="text-xs text-muted">
          La edad y el puesto explican solo una parte del precio: el resto depende de lo que juega cada uno, del club y
          del contrato (eso lo mira la interfaz Valor para el plantel propio).
        </p>
      </Section>

      {stats.comparisons.length ? (
        <Section
          id="mercado-plantel"
          title={`${team} contra la liga (pruebas de hipótesis)`}
          intro={`Dos muestras independientes: el plantel de ${team} (n = ${String(stats.own?.summary.n ?? 0)}) y el resto de la liga (n = ${String(n)}). Medias y varianzas se comparan sobre el logaritmo del valor; la media se muestra vuelta a euros (media geométrica).`}
        >
          <Table head={['Pregunta', 'Prueba', team, 'Liga', 'Estadístico', 'gl', 'p', 'Decisión']}>
            {stats.comparisons.map((t) => (
              <tr key={t.id}>
                <th scope="row" className="whitespace-normal">
                  {t.title}
                </th>
                <td className="text-left">{TEST_NAME[t.id]}</td>
                <td className="tabular">{t.own}</td>
                <td className="tabular">{t.league}</td>
                <td className="tabular">
                  {TEST_LETTER[t.id]} = {f2(t.statistic)}
                </td>
                <td className="tabular">
                  {Array.isArray(t.df)
                    ? `${String(t.df[0])}; ${String(t.df[1])}`
                    : fmt(t.id === 'medias' ? 1 : 0).format(t.df)}
                </td>
                <td className="tabular">{pv(t.p)}</td>
                <td className="text-left">{t.reject ? 'Hay diferencia' : 'Sin diferencia'}</td>
              </tr>
            ))}
          </Table>
          <p className="text-xs text-muted">
            Nivel de significación α = {String(stats.alpha).replace('.', ',')}. «Hay diferencia» = se rechaza H₀ (que
            son iguales). El diagrama de caja de {team} está arriba, junto al de la liga.
          </p>
        </Section>
      ) : null}
    </div>
  );
}
