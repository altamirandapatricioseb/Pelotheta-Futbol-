'use client';

import { ChartCard } from '@/components/charts/chart-card';
import { ScatterChart } from '@/components/charts/primitives';
import type { CoefRow, ModelRun, ValueRow } from '@/lib/data/models';

import { dec2, eur, num, pct, pValue, Section, Tiles, WaitingData } from './common';
import { type Column, SortableTable } from './sortable-table';
import { M, reading, signed, SOURCE } from './value-player';

interface Props {
  run: ModelRun | null;
  rows: ValueRow[];
  coefs: CoefRow[];
}

export function ValueView({ run, rows, coefs }: Props) {
  if (!run || run.status !== 'ok' || rows.length === 0) {
    return (
      <WaitingData
        title="El modelo espera valores de mercado"
        message={`${run?.message ?? 'Todavía no corrió el pipeline con el paso de modelos.'} Los valores llegan solos desde transfermarkt-datasets (datos abiertos CC0) en cada corrida.`}
      />
    );
  }
  const m = run.metrics;
  const gap = num(run.params.gap_pct) ?? 25;
  const players = [...rows].sort((a, b) => a.name.localeCompare(b.name, 'es'));
  const perfTest = (m.performance_test ?? null) as { r: number; p_value: number; n: number } | null;
  const adjust = (m.performance_adjust ?? null) as { b: number; p_value: number; n: number } | null;
  const coef = new Map(coefs.map((c) => [c.feature, c.coef]));
  const peak = (coef.get('edad2') ?? 0) < 0 ? -(coef.get('edad') ?? 0) / (2 * (coef.get('edad2') ?? 1)) : null;
  const sameName = (r: ValueRow) => players.filter((o) => o.name === r.name).length > 1;
  const nameOf = (r: ValueRow) => (sameName(r) ? `${r.name} (${r.position ?? 'n/d'})` : r.name);

  const columns: Column<ValueRow>[] = [
    {
      id: 'name',
      label: 'Jugador',
      help: 'Tocá un jugador para ver su análisis completo.',
      value: (r) => r.name,
      render: nameOf,
    },
    { id: 'pos', label: 'Posición', value: (r) => r.position },
    { id: 'age', label: 'Edad', numeric: true, value: (r) => r.detail.age },
    {
      id: 'contract',
      label: 'Contrato',
      numeric: true,
      help: 'Años que le quedan de contrato.',
      value: (r) => r.detail.contractYears,
      render: (r) => `${dec2(r.detail.contractYears)} años`,
    },
    {
      id: 'actual',
      label: 'Valor real',
      numeric: true,
      help: 'Valor de mercado publicado por transfermarkt-datasets.',
      value: (r) => r.actual,
      render: (r) => eur(r.actual),
    },
    {
      id: 'pred',
      label: 'Esperado',
      numeric: true,
      help: 'Lo que el modelo espera para alguien de su edad, posición, contrato, club y rendimiento.',
      value: (r) => r.predicted,
      render: (r) => eur(r.predicted),
    },
    {
      id: 'gap',
      label: 'Diferencia',
      numeric: true,
      help: '(real − esperado) / esperado. Positivo: el mercado lo paga más. Negativo: sale más barato.',
      value: (r) => r.residualPct,
      render: (r) => (r.residualPct === null ? 'n/d' : `${dec2(r.residualPct)} %`),
    },
    {
      id: 'idx',
      label: 'Rendimiento',
      numeric: true,
      help: 'Índice de rendimiento del sistema (0 a 100) en la temporada.',
      value: (r) => r.detail.performance.rendimiento_indice ?? null,
      render: (r) => dec2(r.detail.performance.rendimiento_indice ?? null),
    },
    { id: 'read', label: 'Lectura', value: (r) => reading(r, gap) },
  ];

  return (
    <div className="grid gap-10">
      <Section
        id="como-se-lee"
        title="Cómo funciona"
        intro={`El modelo aprende de ${String(run.n)} jugadores de toda la Liga Profesional cuánto vale alguien según su edad, su posición, los años de contrato, si es extranjero y el tamaño de su club. Después corrige con el rendimiento de cada jugador del plantel. La diferencia entre el valor real y el esperado dice si el mercado lo paga más o si sale barato.`}
      >
        <Tiles
          items={[
            {
              label: 'Error típico',
              value: num(m.median_ape_oos) === null ? 'n/d' : `${dec2(num(m.median_ape_oos))} %`,
              hint: 'A la mitad de los jugadores, menos que esto',
              help: 'Medido sin trampa: se entrena sin los jugadores del club y se los predice. A la mitad de ellos el modelo les erra por menos de este porcentaje de su valor real.',
            },
            {
              label: 'Error promedio',
              value: num(m.mean_ape_oos) === null ? 'n/d' : `${dec2(num(m.mean_ape_oos))} %`,
              hint: 'Lo suben unos pocos muy errados',
              help: 'El promedio de esos errores: lo tiran para arriba unos pocos jugadores baratos para los que el modelo espera mucho más.',
            },
            {
              label: 'Explica',
              value: pct(num(m.r2)),
              hint: `de las diferencias de valor (R²) · ${String(run.n)} jugadores de la liga`,
              help: 'Qué parte de las diferencias de valor entre jugadores de la liga explican las variables. El resto depende de cosas que ningún dato público mide: lesiones, representante, ofertas, selección.',
            },
            {
              label: '¿Paga el rendimiento?',
              value: perfTest ? (perfTest.p_value < 0.05 ? 'Sí' : 'No se ve') : 'n/d',
              hint: perfTest ? `r = ${dec2(perfTest.r)}, p ${pValue(perfTest.p_value)}` : undefined,
              help: 'Correlación entre lo que rinde cada jugador y cuánto vale de más o de menos según sus papeles. Si es positiva y significativa, el mercado paga el rendimiento.',
            },
          ]}
        />
        <p className="max-w-3xl text-sm text-muted">
          Por qué el error es alto: el valor de mercado es una estimación de la comunidad de Transfermarkt y mezcla
          cosas que no están en ningún dato abierto. Un jugador puede valer la mitad o el doble de lo esperado sin que
          nada esté mal. Lo útil no es el número exacto sino la diferencia: quién vale mucho más o mucho menos de lo que
          sus papeles y su rendimiento dirían.
        </p>
      </Section>

      <Section
        id="plantel"
        title="El plantel"
        intro="Tocá un jugador para ver de dónde sale su precio, su historial, sus comparables y su rendimiento. Los encabezados ordenan: un clic explica la columna, el segundo ordena de menor a mayor y el tercero de mayor a menor."
      >
        <SortableTable
          caption="Valor real, esperado y diferencia de cada jugador"
          rows={players}
          rowKey={(r) => String(r.playerId)}
          rowHref={(r) => `/valor/${String(r.playerId)}`}
          columns={columns}
        />
        <div className="chart-grid-layout">
          <ChartCard
            id="valor-dispersion"
            number="V1"
            title="Valor real contra esperado (millones de euros)"
            source={SOURCE}
            updated={run.trainedAt}
            coverage="Arriba de la diagonal, el mercado lo paga más de lo esperado; abajo, sale barato"
            table={{ head: ['Jugador', 'Real', 'Esperado'], rows: players.map((r) => [r.name, r.actual, r.predicted]) }}
          >
            <ScatterChart
              points={players.map((r) => ({
                x: M(r.predicted ?? 0),
                y: M(r.actual ?? 0),
                label: `${r.name}: real ${eur(r.actual)}, esperado ${eur(r.predicted)}`,
              }))}
              xLabel="Esperado (M €)"
              yLabel="Real (M €)"
              diagonal
              label="Valor de mercado real contra el esperado por el modelo"
            />
          </ChartCard>
          <ChartCard
            id="valor-rendimiento"
            number="V2"
            title="¿Paga el mercado el rendimiento?"
            source={SOURCE}
            updated={run.trainedAt}
            coverage={
              perfTest
                ? `Correlación r = ${dec2(perfTest.r)} con ${String(perfTest.n)} jugadores (p ${pValue(perfTest.p_value)}). Abajo a la derecha: rinden mucho y valen menos de lo esperado`
                : undefined
            }
            table={{
              head: ['Jugador', 'Índice de rendimiento', 'Diferencia %'],
              rows: players.map((r) => [r.name, r.detail.performance.rendimiento_indice ?? null, r.residualPct]),
            }}
          >
            <ScatterChart
              points={players
                .filter((r) => typeof r.detail.performance.rendimiento_indice === 'number' && r.residualPct !== null)
                .map((r) => ({
                  x: r.detail.performance.rendimiento_indice ?? 0,
                  y: r.residualPct ?? 0,
                  label: `${r.name}: rinde ${dec2(r.detail.performance.rendimiento_indice ?? null)}, diferencia ${dec2(r.residualPct)} %`,
                }))}
              xLabel="Índice de rendimiento"
              yLabel="Diferencia con lo esperado (%)"
              medians
              label="Rendimiento contra diferencia de valor"
            />
          </ChartCard>
        </div>
      </Section>

      <Section
        id="coeficientes"
        title="Qué mueve el precio en la liga"
        intro={`Cada fila es una característica del jugador. «Significativa» quiere decir que el efecto es demasiado grande para ser casualidad (p < 0,05).${adjust ? ` Ajuste por rendimiento con ${String(adjust.n)} jugadores del plantel: +1 punto de índice ≈ ${signed(Math.exp(adjust.b) - 1)} de valor (p ${pValue(adjust.p_value)}).` : ''}`}
      >
        <SortableTable
          caption="Coeficientes de la regresión del valor de mercado"
          rows={coefs.filter((c) => c.feature !== 'intercepto')}
          rowKey={(c) => c.feature}
          columns={[
            {
              id: 'var',
              label: 'Característica',
              value: (c) => featureLabel(run, c.feature),
              help: 'Qué se mide de cada jugador.',
            },
            {
              id: 'effect',
              label: 'Efecto en el valor',
              wrap: true,
              value: (c) => c.coef,
              help: 'Cuánto cambia el valor cuando cambia la característica, con todo lo demás igual.',
              render: (c) => effectText(c, peak),
            },
            {
              id: 'sig',
              label: '¿Significativa?',
              value: (c) => c.p,
              help: 'Sí si p < 0,05: el efecto difícilmente sea casualidad.',
              render: (c) => (c.p < 0.05 ? `Sí (p ${pValue(c.p)})` : `No (p ${pValue(c.p)})`),
            },
            {
              id: 'beta',
              label: 'β',
              numeric: true,
              value: (c) => c.coef,
              help: 'Coeficiente en ln(valor). e^β − 1 es el cambio porcentual.',
              render: (c) => dec2(c.coef),
            },
            {
              id: 'ci',
              label: 'IC 95 %',
              numeric: true,
              value: (c) => c.low,
              help: 'Rango donde está el β verdadero con 95 % de confianza. Si no toca el 0, el efecto es real.',
              render: (c) => `[${dec2(c.low)}; ${dec2(c.high)}]`,
            },
          ]}
        />
      </Section>
    </div>
  );
}

function featureLabel(run: ModelRun, id: string): string {
  const features = (Array.isArray(run.params.features) ? run.params.features : []) as { id: string; label: string }[];
  return features.find((f) => f.id === id)?.label ?? id;
}

function effectText(c: CoefRow, peak: number | null): string {
  const e = Math.exp(c.coef) - 1;
  switch (c.feature) {
    case 'edad':
      return peak ? `Sube hasta los ${dec2(peak)} años` : `+1 año: ${signed(e)}`;
    case 'edad2':
      return 'Después del pico, baja (curva)';
    case 'contrato':
      return `+1 año de contrato: ${signed(e)}`;
    case 'extranjero':
      return `Ser extranjero: ${signed(e)}`;
    case 'ln_club':
      return `Resto del plantel 10 % más caro: ${signed(Math.pow(1.1, c.coef) - 1)}`;
    default:
      return `Frente a un arquero: ${signed(e)}`;
  }
}
