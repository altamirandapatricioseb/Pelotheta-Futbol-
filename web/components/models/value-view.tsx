'use client';

import { useState } from 'react';

import { ChartCard } from '@/components/charts/chart-card';
import { BarChart, ScatterChart } from '@/components/charts/primitives';
import type { CoefRow, ModelRun, PoolPlayer, ValueRow } from '@/lib/data/models';

import { dec2, eur, num, pct, pValue, Section, Tiles, WaitingData } from './common';
import { type Column, SortableTable } from './sortable-table';

interface Props {
  run: ModelRun | null;
  rows: ValueRow[];
  coefs: CoefRow[];
  pool: PoolPlayer[];
  initialPlayer: number | null;
}

const SOURCE = 'Valores: transfermarkt-datasets (CC0, datos de Transfermarkt) · modelo: pipeline Pelotheta';
const M = (v: number) => v / 1e6;
const signed = (v: number) => `${v >= 0 ? '+' : '−'}${pct(Math.abs(v))}`;

// Qué mueve el precio, en el orden en que se lee.
const EFFECTS: { id: string; label: (r: ValueRow) => string; help: string }[] = [
  {
    id: 'edad',
    label: (r) => `Edad (${String(r.detail.age ?? 'n/d')} años)`,
    help: 'Los jugadores jóvenes valen más por lo que pueden crecer; después del pico, el valor baja.',
  },
  {
    id: 'posicion',
    label: (r) => `Posición (${r.position ?? 'n/d'})`,
    help: 'Cuánto paga el mercado por su puesto frente a un arquero.',
  },
  {
    id: 'contrato',
    label: (r) => `Contrato (${dec2(r.detail.contractYears)} años)`,
    help: 'Con más años de contrato el club puede pedir más: el que se va libre no cuesta nada.',
  },
  {
    id: 'extranjero',
    label: (r) => `Extranjero (${r.detail.foreign ? 'sí' : 'no'})`,
    help: 'Los extranjeros de la liga suelen valer más: un club los trae porque cuestan.',
  },
  {
    id: 'ln_club',
    label: (r) => `Club (resto del plantel ${eur(r.detail.clubRest)})`,
    help: 'Jugar en un club grande sube el precio: más vidriera, más dinero para retenerlo.',
  },
  {
    id: 'rendimiento',
    label: (r) => `Rendimiento (índice ${dec2(r.detail.performance.rendimiento_indice ?? null)})`,
    help: 'El ajuste por lo que rinde en el equipo: el mercado paga al que rinde por encima de lo que dicen sus papeles.',
  },
];

function effectOf(r: ValueRow, id: string): number | null {
  const e = r.detail.effects;
  if (id === 'posicion') return (1 + (e.defensor ?? 0)) * (1 + (e.mediocampista ?? 0)) * (1 + (e.delantero ?? 0)) - 1;
  return e[id] ?? null;
}

export function ValueView({ run, rows, coefs, pool, initialPlayer }: Props) {
  const players = [...rows].sort((a, b) => a.name.localeCompare(b.name, 'es'));
  const [playerId, setPlayerId] = useState(initialPlayer ?? players[0]?.playerId ?? 0);
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
  const coef = new Map(coefs.map((c) => [c.feature, c]));
  const means = (m.means ?? {}) as Record<string, number>;
  const perfTest = (m.performance_test ?? null) as { r: number; p_value: number; n: number } | null;
  const adjust = (m.performance_adjust ?? null) as { b: number; p_value: number; n: number } | null;
  const reading = (r: ValueRow) =>
    r.residualPct === null
      ? 'Sin valor real'
      : r.residualPct > gap
        ? 'Más caro de lo esperado'
        : r.residualPct < -gap
          ? 'Más barato de lo esperado'
          : 'En línea con lo esperado';
  const target = rows.find((r) => r.playerId === playerId) ?? players[0];
  const sameName = (r: ValueRow) => players.filter((o) => o.name === r.name).length > 1;
  const nameOf = (r: ValueRow) => (sameName(r) ? `${r.name} (${r.position ?? 'n/d'})` : r.name);

  // Curva de la edad para un jugador promedio de la liga (las demás variables en su promedio).
  const b = (id: string) => coef.get(id)?.coef ?? 0;
  const rest = Object.entries(means)
    .filter(([k]) => k !== 'edad' && k !== 'edad2')
    .reduce((a, [k, v]) => a + b(k) * v, b('intercepto'));
  const ageCurve = Array.from({ length: 21 }, (_, i) => 17 + i).map((age) => ({
    x: age,
    y: M(Math.exp(rest + b('edad') * age + b('edad2') * age * age)),
  }));
  const peak = b('edad2') < 0 ? -b('edad') / (2 * b('edad2')) : null;

  const effects = target
    ? EFFECTS.map((e) => ({ ...e, value: effectOf(target, e.id) })).filter((e) => e.value !== null)
    : [];

  const allColumns: Column<ValueRow>[] = [
    { id: 'name', label: 'Jugador', value: (r) => r.name, render: nameOf },
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
    { id: 'read', label: 'Lectura', value: reading },
  ];

  return (
    <div className="grid gap-10">
      <Section
        id="como-se-lee"
        title="Cómo funciona"
        intro={`El modelo aprende de ${String(run.n)} jugadores de toda la Liga Profesional cuánto vale alguien según su edad, su posición, los años de contrato, si es extranjero y el tamaño de su club. Después corrige con el rendimiento de cada jugador de Boca (el índice del sistema). La diferencia entre el valor real y el esperado dice si el mercado lo paga más o si sale barato para lo que es y lo que rinde.`}
      >
        <Tiles
          items={[
            {
              label: 'Error típico',
              value: num(m.median_ape_oos) === null ? 'n/d' : `${dec2(num(m.median_ape_oos))} %`,
              hint: 'Mitad de los jugadores, menos que esto',
              help: 'Medido sin trampa: se entrena sin los jugadores de Boca y se los predice. A la mitad de ellos el modelo les erra por menos de este porcentaje de su valor real.',
            },
            {
              label: 'Error promedio',
              value: num(m.mean_ape_oos) === null ? 'n/d' : `${dec2(num(m.mean_ape_oos))} %`,
              hint: 'Lo suben los pocos casos muy errados',
              help: 'El promedio de esos errores. Es más alto que el típico porque unos pocos jugadores baratos para los que el modelo espera mucho más tiran el promedio para arriba.',
            },
            {
              label: 'Explica',
              value: pct(num(m.r2)),
              hint: 'de las diferencias de valor (R²)',
              help: 'Qué parte de las diferencias de valor entre jugadores de la liga explican las variables. El resto depende de cosas que ningún dato público mide: lesiones, representante, ofertas, selección.',
            },
            {
              label: '¿Paga el rendimiento?',
              value: perfTest ? (perfTest.p_value < 0.05 ? 'Sí' : 'No se ve') : 'n/d',
              hint: perfTest ? `r = ${dec2(perfTest.r)}, p ${pValue(perfTest.p_value)}` : undefined,
              help: 'Correlación entre lo que rinde cada jugador de Boca y cuánto vale de más o de menos según sus papeles. Si es positiva y significativa, el mercado paga el rendimiento.',
            },
          ]}
        />
        <p className="max-w-3xl text-sm text-muted">
          Por qué el error es alto: el valor de mercado es una estimación de la comunidad de Transfermarkt y mezcla
          cosas que no están en ningún dato abierto. Con estas variables, un jugador puede valer la mitad o el doble de
          lo esperado sin que nada esté mal. Por eso lo útil no es el número exacto sino la diferencia: quién vale mucho
          más o mucho menos de lo que sus papeles y su rendimiento dirían.
        </p>
      </Section>

      {target ? (
        <Section
          id="analisis"
          title="Analizar un jugador"
          intro="Elegí un jugador: de dónde sale su precio, a quién se parece en la liga y cuánto rinde."
        >
          <label className="flex items-center gap-2 text-sm font-semibold">
            Jugador
            <select
              className="select"
              value={target.playerId}
              onChange={(e) => {
                setPlayerId(Number(e.target.value));
              }}
            >
              {players.map((r) => (
                <option key={r.playerId} value={r.playerId}>
                  {nameOf(r)}
                </option>
              ))}
            </select>
          </label>
          <Tiles
            items={[
              { label: 'Valor real', value: eur(target.actual) },
              {
                label: 'Esperado',
                value: eur(target.predicted),
                hint: `Rango del 95 %: ${eur(target.low)} a ${eur(target.high)}`,
                help: 'Lo que el modelo espera para alguien como él. El rango es amplio porque el valor de mercado varía mucho entre jugadores parecidos.',
              },
              {
                label: 'Diferencia',
                value: target.residualPct === null ? 'n/d' : `${dec2(target.residualPct)} %`,
                hint: reading(target),
                help: `Diferencias de más de ${String(gap)} % se marcan como «más caro» o «más barato» de lo esperado.`,
              },
              {
                label: 'Jugador promedio de la liga',
                value: eur(target.detail.average),
                help: 'Lo que vale un jugador con la edad, el contrato y el club promedio de la liga: el punto de partida del gráfico de abajo.',
              },
            ]}
          />
          <div className="chart-grid-layout">
            <ChartCard
              id="valor-aportes"
              number="V1"
              title={`De dónde sale el precio de ${target.name}`}
              source={SOURCE}
              updated={run.trainedAt}
              coverage={`Cada barra: cuánto sube o baja su valor esperado frente al jugador promedio de la liga (${eur(target.detail.average)})`}
              table={{
                head: ['Qué', 'Efecto', 'Por qué'],
                rows: effects.map((e) => [e.label(target), e.value, e.help]),
              }}
            >
              <BarChart
                labels={effects.map((e) => e.label(target))}
                horizontal
                format={(v) => signed(v)}
                series={[{ id: 'efecto', label: 'Efecto en el valor', slot: 1, values: effects.map((e) => e.value) }]}
                label={`Aporte de cada variable al valor esperado de ${target.name}`}
              />
            </ChartCard>
            <ChartCard
              id="valor-edad"
              number="V2"
              title="Edad y valor en toda la liga"
              source={SOURCE}
              updated={run.trainedAt}
              coverage={
                peak ? `La curva sube hasta los ${dec2(peak)} años y después baja (jugador promedio)` : undefined
              }
              table={{
                head: ['Jugador', 'Club', 'Edad', 'Valor (M €)'],
                rows: pool.slice(0, 60).map((p) => [p.name, p.team, p.age, p.value === null ? null : M(p.value)]),
              }}
            >
              <ScatterChart
                points={[
                  ...pool
                    .filter((p) => p.age !== null && p.value !== null)
                    .map((p) => ({
                      x: p.age ?? 0,
                      y: M(p.value ?? 0),
                      label: `${p.name} (${p.team}): ${eur(p.value)}`,
                      slot: 4 as const,
                      size: 0.15,
                    })),
                  {
                    x: target.detail.age ?? 0,
                    y: M(target.actual ?? 0),
                    label: `${target.name}: ${eur(target.actual)}`,
                    slot: 1 as const,
                    size: 1,
                  },
                ]}
                groups={[
                  { label: target.name, slot: 1 },
                  { label: 'Resto de la liga', slot: 4 },
                ]}
                curve={{ label: 'Jugador promedio', slot: 2, points: ageCurve }}
                xLabel="Edad"
                yLabel="Valor (M €)"
                label="Valor de mercado de cada jugador de la liga según su edad"
              />
            </ChartCard>
          </div>
          <h3 className="text-base font-bold">Rendimiento en la temporada</h3>
          <Tiles
            items={[
              {
                label: 'Índice de rendimiento',
                value: dec2(target.detail.performance.rendimiento_indice ?? null),
                help: 'El índice del sistema (0 a 100): resume su aporte en cancha contra el resto del plantel.',
              },
              {
                label: 'Minutos',
                value: String(Math.round(target.detail.performance.minutos ?? 0) || 'n/d'),
              },
              {
                label: 'Goles + asistencias cada 90',
                value: dec2(target.detail.performance.goles_asistencias ?? null),
              },
              {
                label: 'npxG + xA cada 90',
                value: dec2(target.detail.performance.npxg_xa ?? null),
                help: 'Goles esperados sin penales más asistencias esperadas: la calidad de las ocasiones que genera, cada 90 minutos.',
              },
            ]}
          />
          <h3 className="text-base font-bold">Comparables de la liga</h3>
          <p className="text-sm text-muted">
            Misma posición, edad parecida y un valor real cercano a lo que el modelo espera para {target.name}.
          </p>
          <SortableTable
            caption={`Jugadores de la liga comparables con ${target.name}`}
            rows={target.detail.comparables}
            rowKey={(c) => `${c.name}-${c.team}`}
            columns={[
              { id: 'name', label: 'Jugador', value: (c) => c.name },
              { id: 'team', label: 'Club', value: (c) => c.team },
              { id: 'age', label: 'Edad', numeric: true, value: (c) => c.age },
              {
                id: 'value',
                label: 'Valor real',
                numeric: true,
                value: (c) => c.value,
                render: (c) => eur(c.value),
              },
            ]}
          />
        </Section>
      ) : null}

      <Section
        id="plantel"
        title="Todo el plantel"
        intro="Tocá un jugador para ver su análisis. Los encabezados ordenan: un clic explica la columna, el segundo ordena de menor a mayor y el tercero de mayor a menor."
      >
        <SortableTable
          caption="Valor real, esperado y diferencia de cada jugador"
          rows={players}
          rowKey={(r) => String(r.playerId)}
          rowHref={(r) => `/valor?jugador=${String(r.playerId)}#analisis`}
          current={(r) => r.playerId === target?.playerId}
          columns={allColumns}
        />
        <div className="chart-grid-layout">
          <ChartCard
            id="valor-dispersion"
            number="V3"
            title="Valor real contra esperado (millones de euros)"
            source={SOURCE}
            updated={run.trainedAt}
            coverage="Arriba de la diagonal, el mercado lo paga más de lo esperado; abajo, sale barato"
            table={{
              head: ['Jugador', 'Real', 'Esperado'],
              rows: players.map((r) => [r.name, r.actual, r.predicted]),
            }}
          >
            <ScatterChart
              points={players.map((r) => ({
                x: M(r.predicted ?? 0),
                y: M(r.actual ?? 0),
                label: `${r.name}: real ${eur(r.actual)}, esperado ${eur(r.predicted)}`,
                slot: r.playerId === target?.playerId ? 1 : 4,
              }))}
              xLabel="Esperado (M €)"
              yLabel="Real (M €)"
              diagonal
              label="Valor de mercado real contra el esperado por el modelo"
            />
          </ChartCard>
          <ChartCard
            id="valor-rendimiento"
            number="V4"
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
                  slot: r.playerId === target?.playerId ? 1 : 4,
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
        intro={`Cada fila es una variable de la regresión sobre ln(valor) con ${String(run.n)} jugadores. «Significativa» quiere decir que el efecto es demasiado grande para ser casualidad (p < 0,05).${adjust ? ` Ajuste por rendimiento con ${String(adjust.n)} jugadores de Boca: +1 punto de índice ≈ ${signed(Math.exp(adjust.b) - 1)} de valor (p ${pValue(adjust.p_value)}).` : ''}`}
      >
        <SortableTable
          caption="Coeficientes de la regresión del valor de mercado"
          rows={coefs.filter((c) => c.feature !== 'intercepto')}
          rowKey={(c) => c.feature}
          columns={[
            {
              id: 'var',
              label: 'Variable',
              value: (c) => featureLabel(run, c.feature),
              help: 'Qué se mide de cada jugador.',
            },
            {
              id: 'effect',
              label: 'Efecto en el valor',
              wrap: true,
              value: (c) => c.coef,
              help: 'Cuánto cambia el valor cuando cambia la variable, con todo lo demás igual.',
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
