'use client';

import { ChartCard } from '@/components/charts/chart-card';
import { BarChart } from '@/components/charts/primitives';
import type { StatTest } from '@/lib/data/models';

import { dec2, dec3, num, pct, pValue } from './common';

const nums = (v: unknown): number[] => (Array.isArray(v) ? v.map((x) => (typeof x === 'number' ? x : 0)) : []);
const strs = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : []);

/**
 * Panel «Probabilidad»: pruebas de hipótesis e intervalos del equipo. Lo calcula el pipeline (pipeline/match_predictor.py, stat_tests).
 */
export function ProbabilityPanel({ tests, updated }: { tests: StatTest[]; updated: string | null }) {
  if (tests.length === 0) {
    return <p className="text-muted">Las pruebas aparecen después de la próxima corrida del pipeline.</p>;
  }
  return (
    <div className="chart-grid-layout">
      {tests.map((t, i) => {
        const d = t.detail;
        const footer = (
          <div className="grid gap-1 text-sm">
            <p className="tabular text-muted">
              {t.p !== null
                ? `χ² = ${dec2(t.statistic)} · gl = ${String(t.df ?? 'n/d')} · p = ${pValue(t.p)}`
                : 'Intervalo t de Student'}
            </p>
            <p>{t.decision}</p>
          </div>
        );
        const common = {
          id: `prob-${t.id}`,
          number: `P${String(i + 1)}`,
          title: t.title,
          source: 'Pipeline Pelotheta',
          updated,
        };
        if (Array.isArray(d.observed) && Array.isArray(d.labels)) {
          const labels = strs(d.labels);
          const observed = nums(d.observed);
          const expected = nums(d.expected);
          return (
            <ChartCard
              key={t.id}
              {...common}
              coverage={`λ = ${dec2(num(d.lambda))} goles por partido · ${String(num(d.n) ?? 0)} partidos`}
              table={{
                head: ['Goles', 'Observados', 'Esperados (Poisson)'],
                rows: labels.map((l, j) => [l, observed[j] ?? 0, expected[j] ?? 0]),
              }}
            >
              <BarChart
                labels={labels}
                series={[
                  { id: 'obs', label: 'Observados', slot: 1, values: observed },
                  { id: 'esp', label: 'Esperados si fuera Poisson', slot: 2, values: expected },
                ]}
                label={`${t.title}: frecuencias observadas contra las esperadas`}
              />
              {footer}
            </ChartCard>
          );
        }
        if (Array.isArray(d.observed) && Array.isArray(d.rows)) {
          const rows = strs(d.rows);
          const cols = strs(d.cols);
          const obs = (d.observed as unknown[]).map(nums);
          const exp = (Array.isArray(d.expected) ? (d.expected as unknown[]) : []).map(nums);
          return (
            <ChartCard
              key={t.id}
              {...common}
              table={{
                head: ['', ...cols.flatMap((c) => [`${c} (obs.)`, `${c} (esp.)`])],
                rows: rows.map((r, j) => [r, ...cols.flatMap((_, k) => [obs[j]?.[k] ?? 0, exp[j]?.[k] ?? 0])]),
              }}
            >
              <BarChart
                labels={rows}
                stacked
                series={cols.map((c, k) => ({
                  id: c,
                  label: c,
                  slot: ([1, 5, 3] as const)[k] ?? 4,
                  values: obs.map((r) => r[k] ?? 0),
                }))}
                label={`${t.title}: resultados de local y de visitante`}
              />
              <p className="text-sm">
                P(gana) = {pct(num(d.p_win))} · P(gana | local) = {pct(num(d.p_win_given_home))} · P(gana | visitante) ={' '}
                {pct(num(d.p_win_given_away))}
                {d.small_expected === true ? ' · Hay frecuencias esperadas menores a 5: tomar el p con cautela.' : ''}
              </p>
              {footer}
            </ChartCard>
          );
        }
        const mean = num(d.mean);
        const low = num(d.low);
        const high = num(d.high);
        return (
          <ChartCard key={t.id} {...common} coverage={`${String(num(d.n) ?? 0)} partidos · desvío ${dec3(num(d.sd))}`}>
            <div className="grid gap-2 py-6 text-center">
              <p className="tile-value tabular">
                {dec2(low)} ≤ μ ≤ {dec2(high)}
              </p>
              <p className="text-muted">
                Media muestral: {dec2(mean)} goles por partido (estimador de máxima verosimilitud de λ)
              </p>
            </div>
            {footer}
          </ChartCard>
        );
      })}
    </div>
  );
}
