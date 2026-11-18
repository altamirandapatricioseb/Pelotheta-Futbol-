'use client';

import { ChartCard } from '@/components/charts/chart-card';
import { BarChart, ScatterChart } from '@/components/charts/primitives';
import type { CoefRow, ModelRun, ValueRow } from '@/lib/data/models';

import { dec2, dec3, eur, num, pct, pValue, Section, Tiles, WaitingData } from './common';

interface Props {
  run: ModelRun | null;
  rows: ValueRow[];
  coefs: CoefRow[];
}

const SOURCE = 'Valores: transfermarkt-datasets (CC0, datos de Transfermarkt) · modelo: pipeline Pelotheta';
const M = (v: number) => v / 1e6;

export function ValueView({ run, rows, coefs }: Props) {
  const features = (Array.isArray(run?.params.features) ? run.params.features : []) as { id: string; label: string }[];
  const label = (id: string) => (id === 'intercepto' ? 'Intercepto' : (features.find((f) => f.id === id)?.label ?? id));
  const gap = num(run?.params.gap_pct) ?? 25;

  if (!run || run.status !== 'ok') {
    return (
      <div className="grid gap-8">
        <WaitingData
          title="El modelo espera valores de mercado reales"
          message={`${run?.message ?? 'Todavía no corrió el pipeline con el paso de modelos.'} Con esos valores se ajusta la regresión y se compara lo que el modelo cree que vale cada jugador con lo que dice el mercado.`}
        >
          <p className="text-sm">
            Los valores llegan solos desde transfermarkt-datasets (datos abiertos CC0) en cada corrida. Para completar o
            corregir un jugador: <code>data/manual/market_values.csv</code>.
          </p>
          <pre className="overflow-x-auto rounded-md bg-[var(--color-surface-2)] p-3 text-xs">
            {
              'jugador,equipo,fecha,valor_eur,fuente,url\nNombre Apellido,boca-juniors,2026-10-01,1500000,transfermarkt,https://www.transfermarkt.com/...'
            }
          </pre>
        </WaitingData>
        {rows.length > 0 ? (
          <Section
            id="variables"
            title="Lo que va a usar el modelo"
            intro="ln(valor) = β₀ + β₁·edad + β₂·edad² + … por mínimos cuadrados. Estas son las variables de cada jugador con 450 minutos o más, ya calculadas."
          >
            <FeatureTable rows={rows} features={features} />
          </Section>
        ) : null}
      </div>
    );
  }

  const priced = rows.filter((r) => r.actual !== null && r.predicted !== null);
  const byGap = [...priced].sort((a, b) => (a.residualPct ?? 0) - (b.residualPct ?? 0));
  const m = run.metrics;
  const reading = (r: ValueRow) =>
    r.residualPct === null
      ? 'Sin valor real'
      : r.residualPct > gap
        ? 'El mercado lo paga más'
        : r.residualPct < -gap
          ? 'Más barato de lo que rinde'
          : 'En línea con el modelo';

  return (
    <div className="grid gap-10">
      <Tiles
        items={[
          { label: 'Jugadores con valor real', value: String(run.n) },
          { label: 'R²', value: dec3(num(m.r2)), hint: 'Varianza de ln(valor) explicada' },
          { label: 'R² ajustado', value: dec3(num(m.adj_r2)), hint: 'Castiga variables de más' },
          {
            label: 'Error medio',
            value: num(m.mape) === null ? 'n/d' : `${dec2(num(m.mape))} %`,
            hint: '|real − predicho| / predicho',
          },
        ]}
      />
      <Section
        id="real-vs-modelo"
        title="Lo que vale contra lo que el modelo cree que vale"
        intro={`Arriba de la diagonal, el mercado lo paga más de lo que el modelo predice por su rendimiento y su edad; abajo, sale más barato. Diferencias de más de ${String(gap)} % se marcan.`}
      >
        <div className="chart-grid-layout">
          <ChartCard
            id="valor-dispersion"
            number="V1"
            title="Valor real contra valor predicho (millones de euros)"
            source={SOURCE}
            updated={run.trainedAt}
            table={{
              head: ['Jugador', 'Real', 'Predicho', 'Mínimo (95 %)', 'Máximo (95 %)'],
              rows: priced.map((r) => [r.name, r.actual, r.predicted, r.low, r.high]),
            }}
          >
            <ScatterChart
              points={priced.map((r) => ({
                x: M(r.predicted ?? 0),
                y: M(r.actual ?? 0),
                label: `${r.name}: real ${eur(r.actual)}, predicho ${eur(r.predicted)}`,
              }))}
              xLabel="Predicho (M €)"
              yLabel="Real (M €)"
              diagonal
              label="Valor de mercado real contra el predicho por la regresión"
            />
          </ChartCard>
          <ChartCard
            id="valor-diferencia"
            number="V2"
            title="Diferencia entre el mercado y el modelo"
            source={SOURCE}
            updated={run.trainedAt}
            table={{
              head: ['Jugador', 'Diferencia %', 'Lectura'],
              rows: byGap.map((r) => [r.name, r.residualPct, reading(r)]),
            }}
          >
            <BarChart
              labels={byGap.map((r) => r.name)}
              horizontal
              format={(v) => `${dec2(v)} %`}
              series={[{ id: 'gap', label: 'Real contra predicho', slot: 1, values: byGap.map((r) => r.residualPct) }]}
              label="Porcentaje de diferencia entre el valor real y el predicho por jugador"
            />
          </ChartCard>
          <ChartCard
            id="valor-residuos"
            number="V3"
            title="Residuos contra valor predicho"
            source={SOURCE}
            updated={run.trainedAt}
            coverage="Supuesto de la regresión: residuos sin forma, alrededor de cero"
            table={{
              head: ['Jugador', 'Predicho', 'Residuo %'],
              rows: priced.map((r) => [r.name, r.predicted, r.residualPct]),
            }}
          >
            <ScatterChart
              points={priced.map((r) => ({ x: M(r.predicted ?? 0), y: r.residualPct ?? 0, label: r.name }))}
              xLabel="Predicho (M €)"
              yLabel="Residuo (%)"
              label="Residuos de la regresión contra el valor predicho"
            />
          </ChartCard>
        </div>
      </Section>

      <Section
        id="coeficientes"
        title="Inferencia sobre los coeficientes"
        intro="Cada β con su error estándar, el estadístico t = β / EE, el p-valor de H₀: β = 0 y el intervalo del 95 %. Un intervalo que no toca el 0 dice que esa variable mueve el valor."
      >
        <div className="data-table-wrap">
          <table className="data-table">
            <caption className="sr-only">Coeficientes de la regresión de ln(valor)</caption>
            <thead>
              <tr>
                <th scope="col">Variable</th>
                <th scope="col">β</th>
                <th scope="col">Error estándar</th>
                <th scope="col">t</th>
                <th scope="col">p</th>
                <th scope="col">IC 95 %</th>
                <th scope="col">Efecto</th>
              </tr>
            </thead>
            <tbody>
              {coefs.map((c) => (
                <tr key={c.feature}>
                  <th scope="row">{label(c.feature)}</th>
                  <td className="tabular">{dec3(c.coef)}</td>
                  <td className="tabular">{dec3(c.stdErr)}</td>
                  <td className="tabular">{dec2(c.t)}</td>
                  <td className="tabular">{pValue(c.p)}</td>
                  <td className="tabular">
                    [{dec3(c.low)}; {dec3(c.high)}]
                  </td>
                  <td>
                    {c.feature === 'intercepto'
                      ? '—'
                      : c.p < 0.05
                        ? `Significativo: +1 en la variable ≈ ${pct(Math.exp(c.coef) - 1, 1)} de valor`
                        : 'No significativo al 5 %'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section id="tabla" title="Todos los jugadores">
        <div className="data-table-wrap">
          <table className="data-table">
            <caption className="sr-only">Valor real, predicho e intervalo de predicción por jugador</caption>
            <thead>
              <tr>
                <th scope="col">Jugador</th>
                <th scope="col">Posición</th>
                <th scope="col">Real</th>
                <th scope="col">Predicho</th>
                <th scope="col">Intervalo 95 %</th>
                <th scope="col">Lectura</th>
              </tr>
            </thead>
            <tbody>
              {[...rows]
                .sort((a, b) => (b.predicted ?? 0) - (a.predicted ?? 0))
                .map((r) => (
                  <tr key={r.playerId}>
                    <th scope="row">{r.name}</th>
                    <td>{r.position ?? 'n/d'}</td>
                    <td className="tabular">{eur(r.actual)}</td>
                    <td className="tabular">{eur(r.predicted)}</td>
                    <td className="tabular">
                      {eur(r.low)} – {eur(r.high)}
                    </td>
                    <td>{reading(r)}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </Section>
    </div>
  );
}

function FeatureTable({ rows, features }: { rows: ValueRow[]; features: { id: string; label: string }[] }) {
  return (
    <div className="data-table-wrap">
      <table className="data-table">
        <caption className="sr-only">Variables de la regresión por jugador</caption>
        <thead>
          <tr>
            <th scope="col">Jugador</th>
            {features.map((f) => (
              <th key={f.id} scope="col">
                {f.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {[...rows]
            .sort((a, b) => a.name.localeCompare(b.name, 'es'))
            .map((r) => (
              <tr key={r.playerId}>
                <th scope="row">{r.name}</th>
                {features.map((f) => (
                  <td key={f.id} className="tabular">
                    {dec2(r.features[f.id])}
                  </td>
                ))}
              </tr>
            ))}
        </tbody>
      </table>
    </div>
  );
}
