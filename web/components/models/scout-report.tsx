'use client';

// Informe completo de un jugador de otro club: resumen, su precio contra el mercado por edad y todas
// las estadísticas del catálogo (las mismas que tienen los jugadores propios) contra la liga y
// contra los titulares propios del puesto. Sin estadísticas cargadas, las filas quedan listas.

import type { Report } from '@/lib/models/scouting';

import { eur, Section } from './common';
import { ScoutScatter } from './scout-chart';
import { Bar, Score } from './scout-view';

export interface ReportStatRow {
  id: string;
  name: string;
  category: string;
  unit: string;
  per90: boolean;
  higherIsBetter: boolean;
  value: number | null;
  percentile: number | null;
  leagueMedian: number | null;
  ownMedian: number | null;
}

const DEC = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 2 });
const fmt = (v: number | null, unit: string) =>
  v === null ? '–' : unit === '%' ? `${v.toFixed(1).replace('.', ',')} %` : DEC.format(v);

function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? (s[m] as number) : ((s[m - 1] as number) + (s[m] as number)) / 2;
}

/** Contra los titulares propios: verde si los supera por más de 10 %, rojo si queda 10 % abajo. */
function versusOwn(r: ReportStatRow): 'scout-good' | 'scout-bad' | undefined {
  if (r.value === null || r.ownMedian === null || r.ownMedian === 0) return undefined;
  const diff = (r.value - r.ownMedian) / Math.abs(r.ownMedian);
  const better = r.higherIsBetter ? diff : -diff;
  return better >= 0.1 ? 'scout-good' : better <= -0.1 ? 'scout-bad' : undefined;
}

export function ScoutReportView({
  report,
  rows,
  team,
  starters,
  leaguePeers,
  market,
  own,
}: {
  report: Report;
  rows: ReportStatRow[];
  team: string;
  starters: string[];
  leaguePeers: number;
  market: { name: string; team: string; age: number; value: number }[];
  own: { name: string; age: number; value: number }[];
}) {
  const p = report.player;
  const withValue = rows.filter((r) => r.value !== null);
  const ranked = rows.filter((r) => r.percentile !== null).sort((a, b) => (b.percentile ?? 0) - (a.percentile ?? 0));
  const best = ranked.slice(0, 8);
  const worst = ranked
    .slice(-5)
    .reverse()
    .filter((r) => (r.percentile ?? 100) <= 40);
  const categories = [...new Set(rows.map((r) => r.category))];
  const ages = [...new Set(market.map((m) => m.age))].sort((a, b) => a - b);
  const medianLine = ages.flatMap((a) => {
    const v = median(market.filter((m) => Math.abs(m.age - a) <= 2).map((m) => m.value));
    return v === null ? [] : [{ x: a, y: v }];
  });

  return (
    <div className="grid gap-8">
      <div className="scout-card scout-card--open">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm text-muted">
              {p.team} · {report.group} · {p.age ?? 'n/d'} años · {eur(p.value)}
              {p.minutes ? ` · ${String(p.minutes)} minutos` : ''}
            </p>
            <p className="mt-1 text-lg font-bold">{report.verdict}</p>
          </div>
          <Score value={report.score} label="Nota del informe" />
        </div>
        <dl className="scout-stats">
          <dt className="text-xs text-muted">Nivel actual</dt>
          <dd>
            <Bar value={report.ability} label="Nivel actual" />
          </dd>
          <dt className="text-xs text-muted">Potencial</dt>
          <dd>
            <Bar value={report.potential} label="Potencial" />
          </dd>
          <dt className="text-xs text-muted">Mediana de su puesto y edad</dt>
          <dd className="tabular text-sm">{eur(report.expectedValue)}</dd>
        </dl>
        <div className="grid gap-3 sm:grid-cols-2">
          <ul className="grid gap-0.5 text-sm">
            {report.pros.map((t) => (
              <li key={t} className="scout-good">
                + {t}
              </li>
            ))}
          </ul>
          <ul className="grid gap-0.5 text-sm">
            {report.cons.map((t) => (
              <li key={t} className="scout-bad">
                − {t}
              </li>
            ))}
          </ul>
        </div>
      </div>

      <Section
        id="precio"
        title="Su precio en el mercado"
        intro={`Todos los ${report.group.toLowerCase()}s de la liga con valor cargado, por edad. La línea punteada es la mediana del puesto para cada edad (±2 años): abajo de la línea, sale barato para su edad.`}
      >
        <ScoutScatter
          label={`Valor de mercado contra edad de los ${report.group.toLowerCase()}s de la liga`}
          points={[
            ...market
              .filter((m) => !(m.name === p.name && m.team === p.team))
              .map((m) => ({
                key: `${m.name}|${m.team}`,
                x: m.age,
                y: m.value,
                color: 'var(--chart-axis)',
                r: 3,
                title: `${m.name} (${m.team}): ${String(m.age)} años, ${eur(m.value)}`,
              })),
            ...own.map((m) => ({
              key: `propio|${m.name}`,
              x: m.age,
              y: m.value,
              label: m.name,
              color: 'var(--series-4)',
              r: 5,
              title: `${m.name} (${team}): ${String(m.age)} años, ${eur(m.value)}`,
            })),
            ...(p.age !== null && p.value !== null
              ? [
                  {
                    key: 'el',
                    x: p.age,
                    y: p.value,
                    label: p.name,
                    color: 'var(--series-2)',
                    r: 8,
                    emphasis: true,
                    title: `${p.name}: ${String(p.age)} años, ${eur(p.value)}`,
                  },
                ]
              : []),
          ]}
          line={medianLine}
          x={{ title: 'Edad (años)', format: (v) => String(Math.round(v)) }}
          y={{ title: 'Valor de mercado (escala logarítmica)', log: true, format: eur }}
          caption={`Violeta: ${p.name}. Azul: los ${report.group.toLowerCase()}s de ${team}. Gris: el resto de la liga.`}
        />
      </Section>

      <Section
        id="perfil"
        title="En qué es bueno y en qué no"
        intro={`Percentil de 0 a 100 contra los ${String(leaguePeers)} ${report.group.toLowerCase()}s de la liga con 450 minutos o más y estadísticas cargadas, cada 90 minutos donde corresponde.`}
      >
        {ranked.length ? (
          <div className="grid gap-6 md:grid-cols-2">
            <div className="grid gap-2">
              <p className="text-sm font-semibold scout-good">Lo mejor</p>
              <dl className="scout-stats">
                {best.map((r) => (
                  <div key={r.id} className="contents">
                    <dt className="text-xs text-muted">{r.name}</dt>
                    <dd>
                      <Bar value={r.percentile ?? 0} label={`${r.name}, percentil`} tone />
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
            <div className="grid gap-2">
              <p className="text-sm font-semibold scout-bad">Lo peor</p>
              {worst.length ? (
                <dl className="scout-stats">
                  {worst.map((r) => (
                    <div key={r.id} className="contents">
                      <dt className="text-xs text-muted">{r.name}</dt>
                      <dd>
                        <Bar value={r.percentile ?? 0} label={`${r.name}, percentil`} tone />
                      </dd>
                    </div>
                  ))}
                </dl>
              ) : (
                <p className="text-sm text-muted">Ninguna estadística por debajo del percentil 40.</p>
              )}
            </div>
          </div>
        ) : (
          <p className="under-construction text-sm">
            Todavía no hay estadísticas de {p.name}
            {leaguePeers < 5 ? ' ni de suficientes jugadores de la liga para compararlo' : ''}. Cuando la fuente las
            traiga (las mismas {String(rows.length)} que se ven de los jugadores de {team}), acá aparecen lo mejor y lo
            peor de su juego contra el resto de la liga, y la tabla de abajo se completa con sus valores.
          </p>
        )}
      </Section>

      <Section
        id="estadisticas"
        title="Todas sus estadísticas"
        intro={`Las ${String(rows.length)} estadísticas del puesto en el catálogo, por categoría. «Titulares» es la mediana de ${starters.join(', ') || 'los titulares'} en ${team}: verde si él los supera por más de 10 %, rojo si queda 10 % abajo.`}
      >
        {!withValue.length ? (
          <p className="text-xs text-muted">
            Sin valores todavía: la columna «Él» se llena cuando estén sus estadísticas.
          </p>
        ) : null}
        {categories.map((c) => (
          <div key={c} className="overflow-x-auto">
            <h3 className="mb-1 text-sm font-bold">{c.charAt(0).toUpperCase() + c.slice(1)}</h3>
            <table className="scout-heat scout-table">
              <thead>
                <tr>
                  <th scope="col">Estadística</th>
                  <th scope="col">Él</th>
                  <th scope="col">Percentil en la liga</th>
                  <th scope="col">Mediana liga</th>
                  <th scope="col">Titulares {team}</th>
                </tr>
              </thead>
              <tbody>
                {rows
                  .filter((r) => r.category === c)
                  .map((r) => (
                    <tr key={r.id}>
                      <th scope="row">
                        {r.name}
                        {r.per90 ? <span className="text-xs font-normal text-muted"> (90)</span> : null}
                      </th>
                      <td className={`tabular ${versusOwn(r) ?? ''}`}>{fmt(r.value, r.unit)}</td>
                      <td className="min-w-40">
                        {r.percentile !== null ? (
                          <Bar value={r.percentile} label={`${r.name}, percentil`} tone />
                        ) : (
                          <span className="text-muted">–</span>
                        )}
                      </td>
                      <td className="tabular">{fmt(r.leagueMedian, r.unit)}</td>
                      <td className="tabular">{fmt(r.ownMedian, r.unit)}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        ))}
      </Section>
      <p className="text-xs text-muted">
        Verde: lo muy bueno (percentil 70 o más). Rojo: lo preocupante (30 o menos). Violeta: lo intermedio.
      </p>
    </div>
  );
}
