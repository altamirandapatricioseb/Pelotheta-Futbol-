'use client';

import Link from 'next/link';
import { useState } from 'react';

import type { Category, Group, Need, Report, StatScore } from '@/lib/models/scouting';
import { GROUPS, POSITION_STATS } from '@/lib/models/scouting';

import { eur, Section, Tiles } from './common';
import { ScoutScatter } from './scout-chart';

const CATEGORIES: { id: Category; label: string; intro: string }[] = [
  {
    id: 'necesidad',
    label: 'Por necesidad',
    intro: 'Los que mejor tapan lo que falta: más informes en los puestos con nota de necesidad más alta.',
  },
  {
    id: 'oportunidad',
    label: 'Oportunidades de mercado',
    intro: 'Valen menos que la mediana de su puesto y su edad en la liga, ordenados por calidad y precio.',
  },
  {
    id: 'promesa',
    label: 'Jóvenes promesas',
    intro: 'Hasta 21 años, ordenados por potencial: lo que valen hoy más el margen que da la edad.',
  },
];

const BANDS = [
  { label: 'Hasta 21', min: 0, max: 21 },
  { label: '22 a 25', min: 22, max: 25 },
  { label: '26 a 29', min: 26, max: 29 },
  { label: '30 a 33', min: 30, max: 33 },
  { label: '34 o más', min: 34, max: 99 },
];

export const one = (v: number | null) => (v === null ? 'n/d' : v.toFixed(1).replace('.', ','));
const REF_TEXT = { liga: 'contra los de su puesto en la liga', plantel: 'contra los del puesto en el plantel' };

/** Violeta secundario con intensidad según el valor (0 a 100). */
const violet = (pct: number) =>
  `color-mix(in srgb, var(--series-2) ${String(Math.round(12 + 0.8 * pct))}%, transparent)`;

/** Semáforo de percentil: verde lo muy bueno (70+), rojo lo preocupante (30 o menos), violeta lo intermedio. */
export const toneColor = (pct: number) =>
  pct >= 70 ? 'var(--series-1)' : pct <= 30 ? 'var(--series-3)' : 'var(--series-2)';
const heat = (pct: number) => {
  const strength = pct >= 70 ? pct - 40 : pct <= 30 ? 70 - pct : 25;
  return `color-mix(in srgb, ${toneColor(pct)} ${String(Math.round(strength))}%, transparent)`;
};

export function Bar({ value, label, tone = false }: { value: number; label: string; tone?: boolean }) {
  return (
    <span className="scout-bar" role="img" aria-label={`${label}: ${String(value)} de 100`}>
      <span className="scout-bar__track">
        <span
          className="scout-bar__fill"
          style={{ width: `${String(Math.max(2, value))}%`, background: tone ? toneColor(value) : undefined }}
        />
      </span>
      <span className="tabular text-xs">{value}</span>
    </span>
  );
}

export function Score({ value, label, need = false }: { value: number; label: string; need?: boolean }) {
  // En la necesidad, alta es mala (rojo) y baja es buena (verde); en un informe, alta es buena.
  const tone = need
    ? value >= 6
      ? 'mala'
      : value <= 3
        ? 'buena'
        : 'media'
    : value >= 7.5
      ? 'buena'
      : value >= 6
        ? 'media'
        : 'baja';
  return (
    <span className={`scout-score scout-score--${tone} tabular`} aria-label={`${label}: ${one(value)} de 10`}>
      {one(value)}
    </span>
  );
}

function StatBars({ scores }: { scores: StatScore[] }) {
  return (
    <dl className="scout-stats">
      {scores.map((s) => (
        <div key={s.id} className="contents">
          <dt className="text-xs text-muted">{s.label}</dt>
          <dd>
            <Bar value={s.percentile} label={`${s.label}, percentil`} tone />
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** Matriz de profundidad y edades: puestos contra franjas de edad, cada jugador con su peso en minutos. */
function DepthMatrix({ needs }: { needs: Need[] }) {
  const byGroup = new Map(needs.map((n) => [n.group, n]));
  const maxMinutes = Math.max(1, ...needs.flatMap((n) => n.players.map((p) => p.minutes)));
  return (
    <div className="overflow-x-auto">
      <table className="scout-matrix">
        <caption className="sr-only">Plantel por puesto y franja de edad</caption>
        <thead>
          <tr>
            <th scope="col">Puesto</th>
            {BANDS.map((b) => (
              <th key={b.label} scope="col">
                {b.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {GROUPS.map((g) => {
            const players = byGroup.get(g)?.players ?? [];
            return (
              <tr key={g}>
                <th scope="row">
                  {g}
                  <span className="block text-xs font-normal text-muted">{players.length} jugadores</span>
                </th>
                {BANDS.map((b) => (
                  <td key={b.label}>
                    <span className="flex flex-wrap gap-1">
                      {players
                        .filter((p) => p.age !== null && p.age >= b.min && p.age <= b.max)
                        .map((p) => (
                          <Link
                            key={p.id}
                            href={`/jugador/${String(p.id)}`}
                            className="scout-chip focus-ring"
                            style={{ background: violet((100 * p.minutes) / maxMinutes) }}
                            title={`${p.name}: ${String(p.age)} años, ${String(p.minutes)} minutos`}
                          >
                            {p.name}
                          </Link>
                        ))}
                    </span>
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="mt-2 text-xs text-muted">Más violeta, más minutos jugados. Sin edad cargada no aparece.</p>
    </div>
  );
}

function NeedCard({ need }: { need: Need }) {
  const defs = POSITION_STATS[need.group];
  const weak = need.weakStats.slice(0, 3);
  return (
    <li className="scout-card">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-bold">{need.group}</h3>
          <p className="text-xs text-muted">
            {need.regulars} habituales de {need.players.length} · {need.target} lugares · edad media{' '}
            {one(need.averageAge)}
            {need.budget !== null ? ` · presupuesto de referencia ${eur(need.budget)}` : ''}
          </p>
        </div>
        <Score value={need.score} label="Necesidad" need />
      </div>
      <ul className="grid gap-1 text-sm">
        {need.reasons.map((r) => (
          <li
            key={r}
            className={r.startsWith('Puesto cubierto') ? 'scout-good' : need.score >= 6 ? 'scout-bad' : undefined}
          >
            · {r}
          </li>
        ))}
      </ul>
      {weak.length ? (
        <div className="grid gap-1">
          <p className="text-xs font-semibold">Lo más flojo de los titulares ({REF_TEXT[need.reference]})</p>
          <StatBars scores={weak} />
        </div>
      ) : null}
      <div className="overflow-x-auto">
        <table className="scout-heat">
          <caption className="sr-only">
            Percentil de cada jugador del puesto en sus estadísticas, {REF_TEXT[need.reference]}
          </caption>
          <thead>
            <tr>
              <th scope="col">Jugador</th>
              <th scope="col">Edad</th>
              <th scope="col">Min.</th>
              {defs.map((d) => (
                <th key={d.id} scope="col">
                  {d.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {need.players.map((p) => {
              const byId = new Map(p.scores.map((s) => [s.id, s]));
              return (
                <tr key={p.id}>
                  <th scope="row">
                    <Link href={`/jugador/${String(p.id)}`} className="text-link hover:underline">
                      {p.name}
                    </Link>
                    {p.contractYears !== null && p.contractYears <= 1 ? (
                      <span className="ml-1 text-xs text-muted">(contrato ≤ 1 año)</span>
                    ) : null}
                  </th>
                  <td className="tabular">{p.age ?? 'n/d'}</td>
                  <td className="tabular">{p.minutes}</td>
                  {defs.map((d) => {
                    const s = byId.get(d.id);
                    return s ? (
                      <td key={d.id} className="tabular" style={{ background: heat(s.percentile) }}>
                        {s.percentile}
                      </td>
                    ) : (
                      <td key={d.id} className="text-muted">
                        –
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted">
        Percentil de 0 a 100 {REF_TEXT[need.reference]} (en las que menos es mejor, ya está dado vuelta); con menos de
        300 minutos no se calcula.
        {need.reference === 'plantel'
          ? ' Cuando haya estadísticas de los otros clubes, la comparación pasa a ser contra la liga y entra en la nota.'
          : ''}
      </p>
    </li>
  );
}

export const reportHref = (r: Report) =>
  `/ojeador/informe?jugador=${encodeURIComponent(r.player.name)}&club=${encodeURIComponent(r.player.team)}`;

function ReportCard({ report }: { report: Report }) {
  const p = report.player;
  return (
    <li className="scout-card">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate font-bold">{p.name}</h3>
          <p className="text-xs text-muted">
            {p.team} · {report.group} · {p.age ?? 'n/d'} años
          </p>
        </div>
        <Score value={report.score} label="Nota del informe" />
      </div>
      <p className="text-sm font-semibold">{report.verdict}</p>
      <dl className="scout-stats">
        <dt className="text-xs text-muted">Nivel actual</dt>
        <dd>
          <Bar value={report.ability} label="Nivel actual" />
        </dd>
        <dt className="text-xs text-muted">Potencial</dt>
        <dd>
          <Bar value={report.potential} label="Potencial" />
        </dd>
        <dt className="text-xs text-muted">Valor</dt>
        <dd className="tabular text-xs">{eur(p.value)}</dd>
        <dt className="text-xs text-muted">Mediana puesto y edad</dt>
        <dd className="tabular text-xs">{eur(report.expectedValue)}</dd>
      </dl>
      <p className="text-xs">
        {report.strengths.length ? (
          <>
            <span className="scout-good font-semibold">Bueno en: </span>
            {report.strengths.map((s) => s.label).join(', ')}
          </>
        ) : (
          <span className="text-muted">En qué es bueno: aparece cuando estén sus estadísticas.</span>
        )}
      </p>
      <Link href={reportHref(report)} className="chip focus-ring w-fit">
        Ver informe completo
      </Link>
    </li>
  );
}

export function ScoutView({ needs, reports, marketSize }: { needs: Need[]; reports: Report[]; marketSize: number }) {
  const [category, setCategory] = useState<Category>('necesidad');
  const [group, setGroup] = useState<Group | 'todos'>('todos');
  const current = CATEGORIES.find((c) => c.id === category) ?? CATEGORIES[0];
  const shown = reports.filter((r) => r.category === category && (group === 'todos' || r.group === group));
  const top = needs[0];
  return (
    <div className="grid gap-8">
      <Tiles
        items={[
          {
            label: 'Mayor necesidad',
            value: top ? top.group : 'n/d',
            hint: top ? `${one(top.score)} de 10` : undefined,
          },
          {
            label: 'Jugadores en el mercado',
            value: String(marketSize),
            help: 'Jugadores de otros clubes de la liga con valor de mercado cargado.',
          },
          {
            label: 'Para fichar',
            value: String(new Set(reports.filter((r) => r.verdict === 'Fichar').map((r) => r.id)).size),
            help: 'Informes con nota de 7,5 o más.',
          },
        ]}
      />

      <Section
        id="profundidad"
        title="Matriz de profundidad y edades"
        intro="El plantel por puesto y franja de edad: dónde hay jugadores de sobra, dónde falta recambio y qué puestos envejecen juntos."
      >
        <DepthMatrix needs={needs} />
      </Section>

      <Section
        id="necesidades"
        title="Lo que le falta al plantel"
        intro="Nota de necesidad por puesto (0 a 10): profundidad (los que casi no juegan cuentan medio lugar), nivel de los titulares en las estadísticas del puesto contra la liga, titulares veteranos (35 años en arqueros, 32 en defensores y mediocampistas, 31 en delanteros) y contratos que terminan."
      >
        <ul className="grid gap-4">
          {needs.map((n) => (
            <NeedCard key={n.group} need={n} />
          ))}
        </ul>
      </Section>

      <Section id="informes" title="Informes de ojeador" intro={current?.intro}>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Categoría">
          {CATEGORIES.map((c) => (
            <button
              key={c.id}
              type="button"
              className="chip focus-ring"
              aria-pressed={category === c.id}
              onClick={() => {
                setCategory(c.id);
              }}
            >
              {c.label}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Puesto">
          {(['todos', ...GROUPS] as const).map((g) => (
            <button
              key={g}
              type="button"
              className="chip focus-ring"
              aria-pressed={group === g}
              onClick={() => {
                setGroup(g);
              }}
            >
              {g === 'todos' ? 'Todos los puestos' : g}
            </button>
          ))}
        </div>
        {shown.length ? (
          <>
            <ScoutScatter
              label="Nivel actual contra valor de mercado de cada informe"
              points={shown.map((r) => ({
                key: r.id,
                x: r.player.value ?? 1,
                y: r.ability,
                label: r.player.name,
                color: 'var(--series-2)',
                r: 4 + r.potential / 25,
                title: `${r.player.name} (${r.player.team}): nivel ${String(r.ability)}, potencial ${String(r.potential)}, ${eur(r.player.value)}`,
                href: reportHref(r),
              }))}
              x={{ title: 'Valor de mercado (escala logarítmica)', log: true, format: eur }}
              y={{ title: 'Nivel actual (0 a 100)', min: 0, max: 100, format: (v) => String(Math.round(v)) }}
              caption="Cada punto es un informe: más arriba, más nivel; más a la derecha, más caro; más grande, más potencial. Arriba a la izquierda, mucho jugador por poca plata. Tocá uno para abrir su informe completo."
            />
            <ul className="scout-grid">
              {shown.map((r) => (
                <ReportCard key={r.id} report={r} />
              ))}
            </ul>
          </>
        ) : (
          <p className="text-sm text-muted">Sin informes para este filtro con los datos cargados.</p>
        )}
        <p className="text-xs text-muted">
          Nivel actual (0 a 100): el valor de mercado en escala logarítmica dentro del puesto; cuando hay estadísticas,
          pesa 60 % la media de sus percentiles contra la liga. Potencial: el nivel más un margen por edad. Fichar desde
          7,5; seguir de cerca desde 6.
        </p>
      </Section>
    </div>
  );
}
