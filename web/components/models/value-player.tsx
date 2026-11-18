'use client';

// Pantalla de un jugador en Valor: cuánto vale, cuánto se esperaría y por qué, paso a paso, con su
// historial de valor, su lugar en la liga y en el plantel, sus comparables y su rendimiento.

import Link from 'next/link';

import { ChartCard } from '@/components/charts/chart-card';
import { BarChart, LineChart, ScatterChart } from '@/components/charts/primitives';
import type { CoefRow, ModelRun, PoolPlayer, ValueRow } from '@/lib/data/models';

import { dec2, eur, num, Section, Tiles } from './common';
import { SortableTable } from './sortable-table';

export const SOURCE = 'Valores: transfermarkt-datasets (CC0, datos de Transfermarkt) · modelo: pipeline Pelotheta';
export const M = (v: number) => v / 1e6;
export const signed = (v: number) => `${v >= 0 ? '+' : '−'}${dec2(Math.abs(v) * 100)} %`;

// Qué mueve el precio, en el orden en que se arma el número.
export const EFFECTS: { id: string; label: (r: ValueRow) => string; help: string }[] = [
  {
    id: 'edad',
    label: (r) => `Edad (${String(r.detail.age ?? 'n/d')} años)`,
    help: 'Los jóvenes valen más por lo que pueden crecer; pasado el pico, el valor baja.',
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
    help: 'Jugar en un club grande sube el precio: más vidriera y más dinero para retenerlo.',
  },
  {
    id: 'rendimiento',
    label: (r) => `Rendimiento (índice ${dec2(r.detail.performance.rendimiento_indice ?? null)})`,
    help: 'Ajuste por lo que rinde en el equipo: el mercado paga al que rinde por encima de lo que dicen sus papeles.',
  },
];

export function effectOf(r: ValueRow, id: string): number | null {
  const e = r.detail.effects;
  if (id === 'posicion') return (1 + (e.defensor ?? 0)) * (1 + (e.mediocampista ?? 0)) * (1 + (e.delantero ?? 0)) - 1;
  return e[id] ?? null;
}

export function reading(r: ValueRow, gap: number): string {
  if (r.residualPct === null) return 'Sin valor real';
  if (r.residualPct > gap) return 'Más caro de lo esperado';
  if (r.residualPct < -gap) return 'Más barato de lo esperado';
  return 'En línea con lo esperado';
}

interface Props {
  run: ModelRun;
  row: ValueRow;
  rows: ValueRow[];
  coefs: CoefRow[];
  pool: PoolPlayer[];
}

export function ValuePlayer({ run, row, rows, coefs, pool }: Props) {
  const gap = num(run.params.gap_pct) ?? 25;
  const coef = new Map(coefs.map((c) => [c.feature, c.coef]));
  const b = (id: string) => coef.get(id) ?? 0;
  const means = (run.metrics.means ?? {}) as Record<string, number>;
  const effects = EFFECTS.map((e) => ({ ...e, value: effectOf(row, e.id) })).filter(
    (e): e is typeof e & { value: number } => e.value !== null,
  );
  // Paso a paso: del jugador promedio de la liga al valor esperado, multiplicando cada efecto.
  const steps: { label: string; value: number; change: number | null; help: string }[] = [];
  let running = row.detail.average ?? 0;
  steps.push({
    label: 'Jugador promedio de la liga',
    value: running,
    change: null,
    help: 'Edad, contrato y club promedio de la liga: el punto de partida.',
  });
  for (const e of effects) {
    running *= 1 + e.value;
    steps.push({ label: e.label(row), value: running, change: e.value, help: e.help });
  }
  const rest = Object.entries(means)
    .filter(([k]) => k !== 'edad' && k !== 'edad2')
    .reduce((a, [k, v]) => a + b(k) * v, b('intercepto'));
  const ageCurve = Array.from({ length: 21 }, (_, i) => 17 + i).map((age) => ({
    x: age,
    y: M(Math.exp(rest + b('edad') * age + b('edad2') * age * age)),
  }));
  const squad = [...rows]
    .filter((r) => r.residualPct !== null)
    .sort((x, y) => (x.residualPct ?? 0) - (y.residualPct ?? 0));
  const history = row.detail.history;
  const bars = [
    { name: `${row.name} (real)`, value: row.actual },
    { name: `${row.name} (esperado)`, value: row.predicted },
    ...row.detail.comparables.map((c) => ({ name: `${c.name} (${c.team})`, value: c.value })),
  ];
  const perf = row.detail.performance;
  const peakText =
    b('edad2') < 0 ? `La curva sube hasta los ${dec2(-b('edad') / (2 * b('edad2')))} años y después baja` : undefined;

  return (
    <div className="grid gap-10">
      <Section
        id="resumen"
        title={row.name}
        intro={`${row.position ?? 'Posición n/d'} · ${String(row.detail.age ?? 'n/d')} años · ${dec2(row.detail.contractYears)} años de contrato · ${row.detail.foreign ? 'extranjero' : 'argentino'}.`}
      >
        <Tiles
          items={[
            {
              label: 'Valor real',
              value: eur(row.actual),
              help: 'Valor de mercado publicado por transfermarkt-datasets (estimación de la comunidad de Transfermarkt).',
            },
            {
              label: 'Esperado',
              value: eur(row.predicted),
              hint: `Rango del 95 %: ${eur(row.low)} a ${eur(row.high)}`,
              help: 'Lo que el modelo espera para alguien como él. El rango es amplio porque jugadores parecidos valen muy distinto.',
            },
            {
              label: 'Diferencia',
              value: row.residualPct === null ? 'n/d' : `${dec2(row.residualPct)} %`,
              hint: reading(row, gap),
              help: `(real − esperado) / esperado. Más de ${String(gap)} % se marca como más caro o más barato de lo esperado.`,
            },
            {
              label: 'Solo por sus papeles',
              value: eur(row.detail.market),
              hint: 'Sin contar el rendimiento',
              help: 'Lo que se esperaría solo por edad, posición, contrato, nacionalidad y club, antes del ajuste por rendimiento.',
            },
          ]}
        />
        <Tiles
          items={[
            {
              label: 'Índice de rendimiento',
              value: dec2(perf.rendimiento_indice ?? null),
              help: 'El índice del sistema (0 a 100): resume su aporte en cancha contra el resto del plantel.',
            },
            { label: 'Minutos', value: perf.minutos ? String(Math.round(perf.minutos)) : 'n/d' },
            { label: 'Goles + asistencias cada 90', value: dec2(perf.goles_asistencias ?? null) },
            {
              label: 'npxG + xA cada 90',
              value: dec2(perf.npxg_xa ?? null),
              help: 'Goles esperados sin penales más asistencias esperadas: la calidad de las ocasiones que genera.',
            },
          ]}
        />
        <Link href="/valor" className="chip focus-ring w-fit">
          ← Todo el plantel
        </Link>
      </Section>

      <Section
        id="como-se-arma"
        title="Cómo se arma el número"
        intro="Se parte del jugador promedio de la liga y se multiplica por el efecto de cada característica suya. Así se llega al valor esperado."
      >
        <div className="chart-grid-layout">
          <ChartCard
            id="jugador-aportes"
            number="J1"
            title="Qué sube y qué baja su precio"
            source={SOURCE}
            updated={run.trainedAt}
            coverage="Cada barra: cuánto cambia su valor esperado frente al jugador promedio de la liga"
            table={{ head: ['Qué', 'Efecto', 'Por qué'], rows: effects.map((e) => [e.label(row), e.value, e.help]) }}
          >
            <BarChart
              labels={effects.map((e) => e.label(row))}
              horizontal
              format={signed}
              series={[{ id: 'efecto', label: 'Efecto en el valor', slot: 1, values: effects.map((e) => e.value) }]}
              label={`Aporte de cada característica al valor esperado de ${row.name}`}
            />
          </ChartCard>
          <ChartCard
            id="jugador-pasos"
            number="J2"
            title="Del jugador promedio a su valor esperado"
            source={SOURCE}
            updated={run.trainedAt}
            coverage="Cada barra: el valor esperado acumulado después de sumar esa característica (millones de euros)"
            table={{
              head: ['Paso', 'Valor esperado', 'Cambio'],
              rows: steps.map((s) => [s.label, s.value, s.change]),
            }}
          >
            <BarChart
              labels={steps.map((s) => s.label)}
              horizontal
              format={(v) => `€ ${dec2(v)} M`}
              highlight={steps.length - 1}
              series={[
                { id: 'acum', label: 'Valor esperado acumulado', slot: 2, values: steps.map((s) => M(s.value)) },
              ]}
              label={`Cómo se llega al valor esperado de ${row.name}`}
            />
          </ChartCard>
        </div>
        <SortableTable
          caption={`Cálculo paso a paso del valor esperado de ${row.name}`}
          rows={steps}
          rowKey={(s) => s.label}
          columns={[
            { id: 'step', label: 'Paso', value: (s) => s.label },
            {
              id: 'change',
              label: 'Efecto',
              numeric: true,
              help: 'Cuánto multiplica el valor esa característica.',
              value: (s) => s.change,
              render: (s) => (s.change === null ? '—' : signed(s.change)),
            },
            {
              id: 'value',
              label: 'Valor acumulado',
              numeric: true,
              value: (s) => s.value,
              render: (s) => eur(s.value),
            },
            { id: 'why', label: 'Por qué', wrap: true, value: (s) => s.help },
          ]}
        />
      </Section>

      <Section id="contexto" title="Su valor en contexto">
        <div className="chart-grid-layout">
          <ChartCard
            id="jugador-historial"
            number="J3"
            title="Cómo cambió su valor de mercado"
            source={SOURCE}
            updated={run.trainedAt}
            coverage="Cada punto: una valuación publicada (millones de euros)"
            empty={history.length < 2 ? 'Todavía no hay historial de valuaciones para este jugador.' : undefined}
            table={{ head: ['Fecha', 'Valor'], rows: history.map((h) => [h.date, h.value]) }}
          >
            {history.length >= 2 ? (
              <LineChart
                labels={history.map((h) => h.date.slice(0, 7))}
                series={[
                  { id: 'valor', label: 'Valor de mercado (M €)', slot: 1, values: history.map((h) => M(h.value)) },
                ]}
                includeZero={false}
                label={`Historial del valor de mercado de ${row.name}`}
              />
            ) : null}
          </ChartCard>
          <ChartCard
            id="jugador-edad"
            number="J4"
            title="Edad y valor en toda la liga"
            source={SOURCE}
            updated={run.trainedAt}
            coverage={peakText}
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
                  x: row.detail.age ?? 0,
                  y: M(row.actual ?? 0),
                  label: `${row.name}: ${eur(row.actual)}`,
                  slot: 1 as const,
                  size: 1,
                },
              ]}
              groups={[
                { label: row.name, slot: 1 },
                { label: 'Resto de la liga', slot: 4 },
              ]}
              curve={{ label: 'Jugador promedio', slot: 2, points: ageCurve }}
              xLabel="Edad"
              yLabel="Valor (M €)"
              label="Valor de mercado de cada jugador de la liga según su edad"
            />
          </ChartCard>
          <ChartCard
            id="jugador-comparables"
            number="J5"
            title="Contra jugadores parecidos de la liga"
            source={SOURCE}
            updated={run.trainedAt}
            coverage="Misma posición, edad parecida y valor real cerca de lo que el modelo espera para él"
            table={{ head: ['Jugador', 'Valor'], rows: bars.map((x) => [x.name, x.value]) }}
          >
            <BarChart
              labels={bars.map((x) => x.name)}
              horizontal
              format={(v) => `€ ${dec2(v)} M`}
              highlight={0}
              series={[
                {
                  id: 'valor',
                  label: 'Valor (M €)',
                  slot: 1,
                  values: bars.map((x) => (x.value === null ? null : M(x.value))),
                },
              ]}
              label={`Valor de ${row.name} y de sus comparables de la liga`}
            />
          </ChartCard>
          <ChartCard
            id="jugador-plantel"
            number="J6"
            title="Dónde queda en el plantel"
            source={SOURCE}
            updated={run.trainedAt}
            coverage="Diferencia entre lo que vale y lo que se esperaría, para cada jugador del plantel"
            table={{ head: ['Jugador', 'Diferencia %'], rows: squad.map((r) => [r.name, r.residualPct]) }}
          >
            <BarChart
              labels={squad.map((r) => r.name)}
              horizontal
              format={(v) => `${dec2(v)} %`}
              highlight={squad.findIndex((r) => r.playerId === row.playerId)}
              series={[{ id: 'dif', label: 'Real contra esperado', slot: 1, values: squad.map((r) => r.residualPct) }]}
              label="Diferencia porcentual entre el valor real y el esperado de cada jugador del plantel"
            />
          </ChartCard>
          <ChartCard
            id="jugador-rendimiento"
            number="J7"
            title="Rendimiento contra diferencia de valor"
            source={SOURCE}
            updated={run.trainedAt}
            coverage="Abajo a la derecha: rinden mucho y valen menos de lo esperado (oportunidad)"
            table={{
              head: ['Jugador', 'Índice de rendimiento', 'Diferencia %'],
              rows: rows.map((r) => [r.name, r.detail.performance.rendimiento_indice ?? null, r.residualPct]),
            }}
          >
            <ScatterChart
              points={rows
                .filter((r) => typeof r.detail.performance.rendimiento_indice === 'number' && r.residualPct !== null)
                .map((r) => ({
                  x: r.detail.performance.rendimiento_indice ?? 0,
                  y: r.residualPct ?? 0,
                  label: `${r.name}: rinde ${dec2(r.detail.performance.rendimiento_indice ?? null)}, diferencia ${dec2(r.residualPct)} %`,
                  slot: r.playerId === row.playerId ? 1 : 4,
                  size: r.playerId === row.playerId ? 1 : 0.5,
                }))}
              groups={[
                { label: row.name, slot: 1 },
                { label: 'Resto del plantel', slot: 4 },
              ]}
              xLabel="Índice de rendimiento"
              yLabel="Diferencia con lo esperado (%)"
              medians
              label="Rendimiento contra diferencia de valor de cada jugador del plantel"
            />
          </ChartCard>
        </div>
        <h3 className="text-base font-bold">Comparables de la liga</h3>
        <SortableTable
          caption={`Jugadores de la liga comparables con ${row.name}`}
          rows={row.detail.comparables}
          rowKey={(c) => `${c.name}-${c.team}`}
          columns={[
            { id: 'name', label: 'Jugador', value: (c) => c.name },
            { id: 'team', label: 'Club', value: (c) => c.team },
            { id: 'age', label: 'Edad', numeric: true, value: (c) => c.age },
            { id: 'value', label: 'Valor real', numeric: true, value: (c) => c.value, render: (c) => eur(c.value) },
          ]}
        />
      </Section>
    </div>
  );
}
