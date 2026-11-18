'use client';

// Desglose de una alternativa, a lo Moneyball: el que se va contra el (o los) que entran. Perfil por
// percentiles, qué se gana y qué se pierde estadística por estadística, dónde están las diferencias
// y el mapa precio contra parecido de todas las opciones del jugador.

import Link from 'next/link';

import { ChartCard } from '@/components/charts/chart-card';
import { BarChart, Radar, ScatterChart, type Slot } from '@/components/charts/primitives';
import type { AlternativeRow, AlternativeSection, ModelRun, StyleRow } from '@/lib/data/models';

import { dec2, eur, Hint, Section, shortLabels, Tiles } from './common';
import { SortableTable } from './sortable-table';

interface Props {
  run: ModelRun;
  target: StyleRow;
  targetValue: number | null;
  targetAge: number | null;
  targetMinutes: number | null;
  options: AlternativeRow[];
  chosen: AlternativeRow;
  styles: StyleRow[];
}

const SOURCE = 'Pipeline Pelotheta (estadísticas del sistema cada 90 minutos; valores: transfermarkt-datasets)';
export const SECTION_LABEL: Record<AlternativeSection, string> = {
  externo: 'Un jugador de otro club',
  dupla: 'Una dupla de otro club',
  club: 'Dentro del plantel',
};
const optionName = (a: AlternativeRow) => a.members.map((m) => m.name).join(' + ');
export const optionHref = (a: AlternativeRow) =>
  `/alternativas/${String(a.playerId)}?seccion=${a.section}&opcion=${String(a.rank)}`;

/** Percentil (0 a 100) de un valor dentro de los del plantel: qué parte del plantel está por debajo. */
function percentile(v: number | null, squad: number[]): number | null {
  if (v === null || squad.length === 0) return null;
  return (squad.filter((s) => s <= v).length / squad.length) * 100;
}

const mean = (xs: (number | null | undefined)[]) => {
  const ok = xs.filter((x): x is number => typeof x === 'number');
  return ok.length ? ok.reduce((a, b) => a + b, 0) / ok.length : null;
};

export function AlternativeDetail({
  run,
  target,
  targetValue,
  targetAge,
  targetMinutes,
  options,
  chosen,
  styles,
}: Props) {
  const features = (Array.isArray(run.params.features) ? run.params.features : []) as { id: string; label: string }[];
  const pair = chosen.members.length > 1;
  const name = optionName(chosen);
  // Para una dupla, su perfil es el promedio de los dos (así la compara el modelo).
  const option = {
    features: Object.fromEntries(features.map((f) => [f.id, mean(chosen.members.map((m) => m.features[f.id]))])),
    z: Object.fromEntries(features.map((f) => [f.id, mean(chosen.members.map((m) => m.z[f.id])) ?? 0])),
  };
  const targetZ = (id: string) => {
    // z del que se va: con media y desvío del plantel, igual que el modelo.
    const squad = styles.map((s) => s.features[id]).filter((v): v is number => typeof v === 'number');
    const mu = mean(squad) ?? 0;
    const sd = Math.sqrt(squad.reduce((a, v) => a + (v - mu) ** 2, 0) / Math.max(1, squad.length - 1)) || 1;
    return ((target.features[id] ?? mu) - mu) / sd;
  };
  const rows = features.map((f) => {
    const squad = styles.map((s) => s.features[f.id]).filter((v): v is number => typeof v === 'number');
    const own = target.features[f.id] ?? null;
    const alt = option.features[f.id] ?? null;
    const dz = (option.z[f.id] ?? 0) - targetZ(f.id);
    return {
      id: f.id,
      label: f.label,
      own,
      alt,
      diff: own !== null && alt !== null ? alt - own : null,
      dz,
      ownPct: target.percentiles[f.id] ?? percentile(own, squad),
      altPct: percentile(alt, squad),
    };
  });
  const short = shortLabels(rows.map((r) => r.label));
  const total = rows.reduce((a, r) => a + r.dz ** 2, 0) || 1;
  const byGap = [...rows].sort((a, b) => b.dz - a.dz);
  const byShare = [...rows].sort((a, b) => b.dz ** 2 - a.dz ** 2);
  const priced = options.filter((o) => o.total !== null);
  const slotOf = (s: AlternativeSection): Slot => (s === 'externo' ? 1 : s === 'dupla' ? 2 : 4);
  const memberAges = chosen.members.map((m) => m.age).filter((a): a is number => a !== null);

  return (
    <div className="grid gap-10">
      <Section
        id="resumen"
        title={`Sale ${target.name}, entra ${name}`}
        intro={`${SECTION_LABEL[chosen.section]} · opción ${String(chosen.rank)}. El parecido mide qué tan cerca están sus 17 estadísticas cada 90 minutos, llevadas a la misma escala; 100 % sería el mismo jugador.`}
      >
        <Tiles
          items={[
            {
              label: 'Parecido',
              value: `${dec2(chosen.similarity)} %`,
              help: 'Cercanía entre los dos perfiles en las 17 estadísticas, de 0 a 100 %. Arriba de 80 % juegan muy parecido.',
            },
            {
              label: 'Perfil',
              value: chosen.members.map((m) => m.profile).join(' / '),
              hint: `${target.name}: ${target.label}`,
              help: 'Grupo de K-means: jugadores que se parecen entre sí; el nombre sale de sus dos rasgos más fuertes.',
            },
            {
              label: 'Valor',
              value: eur(chosen.total),
              hint: `${target.name}: ${eur(targetValue)}`,
              help: 'Valor de mercado (transfermarkt-datasets). En una dupla, la suma de los dos.',
            },
            {
              label: chosen.savings !== null && chosen.savings >= 0 ? 'Ahorro' : 'Diferencia',
              value:
                chosen.savings === null
                  ? 'n/d'
                  : chosen.savings >= 0
                    ? eur(chosen.savings)
                    : `${eur(-chosen.savings)} más`,
              help: 'Valor del que se va menos el de la alternativa: lo que se ahorraría el club con el reemplazo.',
            },
            {
              label: 'Edad',
              value: memberAges.length ? memberAges.join(' y ') : 'n/d',
              hint: `${target.name}: ${String(targetAge ?? 'n/d')}`,
            },
            {
              label: 'Minutos',
              value: chosen.members.map((m) => String(m.minutes ?? 'n/d')).join(' y '),
              hint: `${target.name}: ${String(targetMinutes ?? 'n/d')}`,
              help: 'Minutos jugados en la temporada: con pocos minutos las estadísticas cada 90 son menos confiables.',
            },
          ]}
        />
        <nav aria-label="Otras opciones" className="flex flex-wrap gap-2">
          <Link href={`/alternativas?jugador=${String(target.playerId)}`} className="chip focus-ring">
            ← Todas las opciones de {target.name}
          </Link>
          {options
            .filter((o) => o !== chosen)
            .slice(0, 6)
            .map((o) => (
              <Link key={`${o.section}-${String(o.rank)}`} href={optionHref(o)} className="chip focus-ring">
                {optionName(o)} · {dec2(o.similarity)} %
              </Link>
            ))}
        </nav>
      </Section>

      <Section
        id="graficos"
        title="La comparación"
        intro="Los percentiles se calculan contra el plantel propio: 80 quiere decir que supera al 80 % de los compañeros en esa estadística."
      >
        <div className="chart-grid-layout">
          <ChartCard
            id="alt-perfil"
            number="D1"
            title={`Perfil: ${target.name} contra ${name}`}
            source={SOURCE}
            updated={run.trainedAt}
            coverage="Percentil dentro del plantel en cada estadística (0 a 100)"
            table={{
              head: ['Estadística', target.name, name],
              rows: rows.map((r) => [r.label, r.ownPct, r.altPct]),
            }}
          >
            <Radar
              axes={rows.map((r) => short(r.label))}
              titles={rows.map((r) => r.label)}
              series={[
                { id: 't', label: target.name, slot: 1, values: rows.map((r) => r.ownPct ?? 0) },
                { id: 'a', label: name, slot: 2, values: rows.map((r) => r.altPct ?? 0) },
              ]}
              label={`Perfil por percentiles de ${target.name} y de ${name}`}
            />
          </ChartCard>
          <ChartCard
            id="alt-gana-pierde"
            number="D2"
            title="Qué se gana y qué se pierde con el cambio"
            source={SOURCE}
            updated={run.trainedAt}
            coverage="Positivo: la alternativa hace más que el que se va. En desvíos del plantel: 1 = un jugador típicamente más alto"
            table={{
              head: ['Estadística', 'Diferencia (desvíos)', `${target.name} cada 90`, `${name} cada 90`],
              rows: byGap.map((r) => [r.label, r.dz, r.own, r.alt]),
            }}
          >
            <BarChart
              labels={byGap.map((r) => r.label)}
              horizontal
              format={(v) => `${v >= 0 ? '+' : ''}${dec2(v)}`}
              series={[{ id: 'dz', label: 'Alternativa − original', slot: 1, values: byGap.map((r) => r.dz) }]}
              label="Diferencia de cada estadística entre la alternativa y el jugador original"
            />
          </ChartCard>
          <ChartCard
            id="alt-diferencias"
            number="D3"
            title="Dónde está la diferencia"
            source={SOURCE}
            updated={run.trainedAt}
            coverage="Qué parte de la distancia total entre los dos aporta cada estadística"
            table={{
              head: ['Estadística', '% de la diferencia'],
              rows: byShare.map((r) => [r.label, r.dz ** 2 / total]),
            }}
          >
            <BarChart
              labels={byShare.map((r) => r.label)}
              horizontal
              format={(v) => `${dec2(v * 100)} %`}
              series={[
                {
                  id: 'share',
                  label: 'Parte de la diferencia',
                  slot: 3,
                  values: byShare.map((r) => r.dz ** 2 / total),
                },
              ]}
              label="Aporte de cada estadística a la diferencia entre los dos perfiles"
            />
          </ChartCard>
          <ChartCard
            id="alt-moneyball"
            number="D4"
            title={`Moneyball: precio contra parecido de las opciones para ${target.name}`}
            source={SOURCE}
            updated={run.trainedAt}
            coverage="Lo ideal está arriba a la izquierda: muy parecido y barato"
            empty={priced.length === 0 ? 'Todavía no hay opciones con valor de mercado.' : undefined}
            table={{
              head: ['Opción', 'Tipo', 'Valor', 'Parecido %'],
              rows: options.map((o) => [optionName(o), SECTION_LABEL[o.section], o.total, o.similarity]),
            }}
          >
            {priced.length > 0 ? (
              <ScatterChart
                points={priced.map((o) => ({
                  x: (o.total ?? 0) / 1e6,
                  y: o.similarity,
                  label: `${optionName(o)}: ${eur(o.total)}, ${dec2(o.similarity)} % parecido`,
                  slot: o === chosen ? 3 : slotOf(o.section),
                  size: o === chosen ? 1 : 0.5,
                }))}
                groups={[
                  { label: 'Otro club', slot: 1 },
                  { label: 'Dupla', slot: 2 },
                  { label: 'Plantel', slot: 4 },
                  { label: 'Esta opción', slot: 3 },
                ]}
                xLabel="Valor (M €)"
                yLabel="Parecido (%)"
                label="Valor de mercado contra parecido de cada alternativa"
              />
            ) : null}
          </ChartCard>
        </div>
      </Section>

      <Section
        id="estadisticas"
        title="Estadística por estadística"
        intro="Cada 90 minutos. Los encabezados ordenan: un clic explica la columna, el segundo ordena de menor a mayor y el tercero de mayor a menor."
      >
        <SortableTable
          caption={`Estadísticas cada 90 de ${target.name} y de ${name}`}
          rows={rows}
          rowKey={(r) => r.id}
          columns={[
            { id: 'stat', label: 'Estadística', value: (r) => r.label },
            {
              id: 'own',
              label: target.name,
              numeric: true,
              help: `Lo que hace ${target.name} cada 90 minutos.`,
              value: (r) => r.own,
              render: (r) => dec2(r.own),
            },
            {
              id: 'alt',
              label: pair ? 'Dupla (promedio)' : (chosen.members[0]?.name ?? 'Alternativa'),
              numeric: true,
              help: pair
                ? 'El promedio de los dos: así los compara el modelo.'
                : 'Lo que hace la alternativa cada 90 minutos.',
              value: (r) => r.alt,
              render: (r) => dec2(r.alt),
            },
            {
              id: 'diff',
              label: 'Diferencia',
              numeric: true,
              help: 'Alternativa menos original, cada 90 minutos.',
              value: (r) => r.diff,
              render: (r) => (r.diff === null ? 'n/d' : `${r.diff >= 0 ? '+' : ''}${dec2(r.diff)}`),
            },
            {
              id: 'pct',
              label: 'Percentiles',
              numeric: true,
              help: 'Percentil de cada uno dentro del plantel propio (original → alternativa).',
              value: (r) => r.altPct,
              render: (r) => `${dec2(r.ownPct)} → ${dec2(r.altPct)}`,
            },
          ]}
        />
        {pair ? (
          <p className="flex items-center gap-1 text-sm text-muted">
            Por qué una dupla
            <Hint text="Dos jugadores que, promediados, se parecen al que se va: uno puede cubrir la parte ofensiva y el otro la defensiva. Con precios, juntos tienen que costar menos que él." />
          </p>
        ) : null}
      </Section>
    </div>
  );
}
