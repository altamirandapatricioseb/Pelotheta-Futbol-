'use client';

import { useState } from 'react';

import { ChartCard } from '@/components/charts/chart-card';
import { BarChart, Heatmap, ScatterChart, type Slot } from '@/components/charts/primitives';
import type { AlternativeRow, AlternativeSection, ModelRun, StyleRow } from '@/lib/data/models';

import { optionHref } from './alternative-detail';
import { dec2, eur, num, pct, Section, shortLabels, Tiles, WaitingData } from './common';
import { SortableTable } from './sortable-table';

interface Props {
  team: string;
  run: ModelRun | null;
  styles: StyleRow[];
  alternatives: AlternativeRow[];
  initialPlayer: number | null;
}

const SOURCE = 'Pipeline Pelotheta (estadísticas del sistema cada 90 minutos; valores: transfermarkt-datasets)';
const SLOTS: Slot[] = [1, 2, 4, 5, 6, 7];

const SECTIONS: { id: AlternativeSection; title: string; intro: string; empty: string }[] = [
  {
    id: 'externo',
    title: 'Un jugador de otro club',
    intro: 'El que más se le parece, uno por uno.',
    empty:
      'Todavía no hay estadísticas de jugadores de otros clubes. Cuando se carguen, acá aparecen primero, de la más parecida a la menos.',
  },
  {
    id: 'dupla',
    title: 'Una dupla de otro club',
    intro: 'Dos jugadores cuyo perfil promedio se le parece; con precios, juntos tienen que costar menos.',
    empty: 'Las duplas se arman con jugadores de otros clubes: aparecen cuando haya sus estadísticas.',
  },
  {
    id: 'club',
    title: 'Dentro del plantel',
    intro: 'Un compañero que ya está en el club, aparte para que no tape a las opciones de afuera.',
    empty: 'Sin compañeros con minutos suficientes para comparar.',
  },
];

export function AlternativesView({ team, run, styles, alternatives, initialPlayer }: Props) {
  const sorted = [...styles].sort((a, b) => a.name.localeCompare(b.name, 'es'));
  const [playerId, setPlayerId] = useState(initialPlayer ?? sorted[0]?.playerId ?? 0);
  if (!run || run.status !== 'ok' || styles.length === 0) {
    return (
      <WaitingData
        title="Las alternativas esperan más jugadores"
        message={run?.message ?? 'Todavía no corrió el pipeline con el paso de modelos.'}
      />
    );
  }
  const updated = run.trainedAt;
  const features = (Array.isArray(run.params.features) ? run.params.features : []) as { id: string; label: string }[];
  const byId = new Map(styles.map((s) => [s.playerId, s]));
  const short = shortLabels(features.map((f) => f.label));
  const labels = [...new Set(styles.map((s) => s.label))];
  const slotOf = (label: string) => SLOTS[labels.indexOf(label) % SLOTS.length] ?? 1;
  const target = byId.get(playerId) ?? sorted[0];
  const mine = alternatives.filter((a) => a.playerId === target?.playerId);
  const bySection = (id: AlternativeSection) =>
    mine.filter((a) => a.section === id).sort((a, b) => b.similarity - a.similarity || a.rank - b.rank);
  const curve = (Array.isArray(run.metrics.k_curve) ? run.metrics.k_curve : []) as { k: number; silhouette: number }[];
  const corr = (Array.isArray(run.metrics.correlation) ? run.metrics.correlation : []) as number[][];
  const share = (Array.isArray(run.metrics.pca_share) ? run.metrics.pca_share : []) as number[];
  const others = num(run.params.others_with_stats) ?? 0;
  const othersTotal = num(run.params.others_total) ?? 0;

  return (
    <div className="grid gap-10">
      <Section
        id="elegir"
        title="Elegí un jugador"
        intro="Las alternativas se ordenan de la más parecida a la menos. Parecido: cercanía en 17 estadísticas cada 90 minutos, llevadas a la misma escala para que pesen igual."
      >
        <label className="flex items-center gap-2 text-sm font-semibold">
          Jugador de {team}
          <select
            className="select"
            value={target?.playerId}
            onChange={(e) => {
              setPlayerId(Number(e.target.value));
            }}
          >
            {sorted.map((s) => (
              <option key={s.playerId} value={s.playerId}>
                {/* Dos jugadores con el mismo apellido se distinguen por la posición. */}
                {sorted.filter((o) => o.name === s.name).length > 1 ? `${s.name} (${s.position ?? 'n/d'})` : s.name}
              </option>
            ))}
          </select>
        </label>
        {target ? (
          <Tiles
            items={[
              { label: 'Perfil', value: target.label },
              { label: 'Posición', value: target.position ?? 'n/d' },
              {
                label: 'Jugadores de otros clubes con estadísticas',
                value: String(others),
                hint: `${String(othersTotal)} cargados con nombre y valor`,
              },
            ]}
          />
        ) : null}
      </Section>

      {SECTIONS.map((sec) => {
        const rows = bySection(sec.id);
        return (
          <Section key={sec.id} id={`alt-${sec.id}`} title={sec.title} intro={sec.intro}>
            {rows.length === 0 ? (
              <p className="text-muted">{sec.empty}</p>
            ) : (
              <SortableTable
                caption={`${sec.title}: alternativas para ${target?.name ?? ''}, de la más parecida a la menos`}
                rows={rows}
                rowKey={(a) => `${sec.id}-${String(a.rank)}`}
                rowHref={optionHref}
                columns={[
                  {
                    id: 'who',
                    label: sec.id === 'dupla' ? 'Jugadores' : 'Jugador',
                    help: 'Tocá la fila para ver la comparación completa.',
                    value: (a) => a.members.map((m) => m.name).join(' + '),
                  },
                  {
                    id: 'club',
                    label: 'Club',
                    value: (a) => [...new Set(a.members.map((m) => m.team))].join(' / '),
                  },
                  {
                    id: 'profile',
                    label: 'Perfil',
                    help: 'Grupo de K-means al que pertenece: el nombre sale de sus dos rasgos más fuertes.',
                    value: (a) => a.members.map((m) => m.profile).join(' / '),
                  },
                  {
                    id: 'sim',
                    label: 'Parecido',
                    numeric: true,
                    help: 'Cercanía en las 17 estadísticas cada 90, de 0 a 100 %. 100 % sería el mismo jugador.',
                    value: (a) => a.similarity,
                    render: (a) => `${dec2(a.similarity)} %`,
                  },
                  {
                    id: 'age',
                    label: 'Edad',
                    numeric: true,
                    value: (a) => a.members[0]?.age ?? null,
                    render: (a) => a.members.map((m) => String(m.age ?? 'n/d')).join(' y '),
                  },
                  {
                    id: 'value',
                    label: 'Valor',
                    numeric: true,
                    help: 'Valor de mercado (transfermarkt-datasets). En una dupla, la suma.',
                    value: (a) => a.total,
                    render: (a) => eur(a.total),
                  },
                  {
                    id: 'savings',
                    label: 'Diferencia',
                    numeric: true,
                    help: 'Valor del jugador que se va menos el de la alternativa: positivo, el club ahorra.',
                    value: (a) => a.savings,
                    render: (a) =>
                      a.savings === null
                        ? 'n/d'
                        : a.savings >= 0
                          ? `ahorra ${eur(a.savings)}`
                          : `cuesta ${eur(-a.savings)} más`,
                  },
                ]}
              />
            )}
          </Section>
        );
      })}

      <Section
        id="perfiles"
        title="Perfiles de juego (K-means)"
        intro="K-means agrupa a los jugadores por cercanía en esas 17 estadísticas; el nombre de cada grupo sale de sus dos rasgos más fuertes. El mapa los proyecta en las dos direcciones de mayor varianza. Los arqueros no entran: sus estadísticas son de otro tipo."
      >
        <Tiles
          items={[
            {
              label: 'Perfiles (k)',
              value: String(num(run.metrics.k) ?? 'n/d'),
              hint: 'Elegido por la silueta más alta',
            },
            { label: 'Silueta', value: dec2(num(run.metrics.silhouette)), hint: '−1 a 1: qué tan separados' },
            {
              label: 'Varianza en el mapa',
              value: pct((share[0] ?? 0) + (share[1] ?? 0)),
              hint: 'Dos componentes principales',
            },
          ]}
        />
        <div className="chart-grid-layout">
          <ChartCard
            id="alt-mapa"
            number="A2"
            title="Plantel por perfil de juego"
            source={SOURCE}
            updated={updated}
            table={{
              head: ['Jugador', 'Perfil', 'Componente 1', 'Componente 2'],
              rows: sorted.map((s) => [s.name, s.label, s.pc1, s.pc2]),
            }}
          >
            <ScatterChart
              points={styles.map((s) => ({
                x: s.pc1,
                y: s.pc2,
                label: `${s.name} · ${s.label}`,
                slot: slotOf(s.label),
              }))}
              groups={labels.map((l) => ({ label: l, slot: slotOf(l) }))}
              xLabel={`Componente 1 (${pct(share[0])})`}
              yLabel={`Componente 2 (${pct(share[1])})`}
              label="Mapa de perfiles de juego del plantel"
            />
          </ChartCard>
          <ChartCard
            id="alt-silueta"
            number="A3"
            title="¿Cuántos perfiles? Silueta según k"
            source={SOURCE}
            updated={updated}
            table={{ head: ['k', 'Silueta'], rows: curve.map((c) => [c.k, c.silhouette]) }}
          >
            <BarChart
              labels={curve.map((c) => `k = ${String(c.k)}`)}
              series={[{ id: 'sil', label: 'Silueta', slot: 1, values: curve.map((c) => c.silhouette) }]}
              highlight={curve.findIndex((c) => c.k === num(run.metrics.k))}
              label="Silueta media para cada cantidad de grupos"
            />
          </ChartCard>
          <ChartCard
            id="alt-correlacion"
            number="A4"
            title="Qué estadísticas van juntas (correlación r)"
            source={SOURCE}
            updated={updated}
            coverage="Cerca de 1 suben juntas; cerca de −1, una sube cuando la otra baja"
            table={{
              head: ['', ...features.map((f) => f.label)],
              rows: features.map((f, i) => [f.label, ...(corr[i] ?? [])]),
            }}
          >
            <Heatmap
              rows={features.map((f) => f.label)}
              cols={features.map((f) => short(f.label))}
              values={corr}
              diverging
              label="Correlación entre las estadísticas usadas para agrupar"
            />
          </ChartCard>
        </div>
      </Section>
    </div>
  );
}
