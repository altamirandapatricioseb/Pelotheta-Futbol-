'use client';

import Link from 'next/link';
import { useRef, useState } from 'react';

import type { Category, Group, Need, Report, StatScore } from '@/lib/models/scouting';
import { GROUPS, POSITION_STATS } from '@/lib/models/scouting';

import { eur, Section, Tiles } from './common';

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

const one = (v: number | null) => (v === null ? 'n/d' : v.toFixed(1).replace('.', ','));
const REF_TEXT = { liga: 'contra los de su puesto en la liga', plantel: 'contra los del puesto en el plantel' };

/** Violeta secundario con intensidad según el valor (0 a 100). */
const violet = (pct: number) => `color-mix(in srgb, var(--series-2) ${String(Math.round(12 + 0.8 * pct))}%, transparent)`;

function Bar({ value, label }: { value: number; label: string }) {
  return (
    <span className="scout-bar" role="img" aria-label={`${label}: ${String(value)} de 100`}>
      <span className="scout-bar__track">
        <span className="scout-bar__fill" style={{ width: `${String(Math.max(2, value))}%` }} />
      </span>
      <span className="tabular text-xs">{value}</span>
    </span>
  );
}

function Score({ value, label }: { value: number; label: string }) {
  const tone = value >= 7.5 ? 'alta' : value >= 6 ? 'media' : 'baja';
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
            <Bar value={s.percentile} label={`${s.label}, percentil`} />
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
        <Score value={need.score} label="Necesidad" />
      </div>
      <ul className="grid gap-1 text-sm">
        {need.reasons.map((r) => (
          <li key={r}>· {r}</li>
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
                      <td key={d.id} className="tabular" style={{ background: violet(s.percentile) }}>
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

/** Nivel contra valor de los informes mostrados: arriba a la izquierda, mucho jugador por poca plata. */
function Scatter({ reports, selected, onSelect }: { reports: Report[]; selected: string | null; onSelect: (id: string) => void }) {
  const W = 640;
  const H = 300;
  const P = 40;
  const values = reports.map((r) => Math.log10(r.player.value ?? 1));
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const x = (v: number) => P + ((Math.log10(v) - lo) / (hi - lo || 1)) * (W - 2 * P);
  const y = (a: number) => H - P - (a / 100) * (H - 2 * P);
  return (
    <figure className="scout-chart">
      <svg viewBox={`0 0 ${String(W)} ${String(H)}`} role="img" aria-label="Nivel actual contra valor de mercado de cada informe">
        {[0, 25, 50, 75, 100].map((t) => (
          <g key={t}>
            <line x1={P} x2={W - P} y1={y(t)} y2={y(t)} stroke="var(--chart-grid)" />
            <text x={P - 6} y={y(t) + 4} textAnchor="end" className="scout-axis">
              {t}
            </text>
          </g>
        ))}
        {[lo, (lo + hi) / 2, hi].map((t) => (
          <text key={t} x={x(10 ** t)} y={H - P + 18} textAnchor="middle" className="scout-axis">
            {eur(10 ** t)}
          </text>
        ))}
        {reports.map((r) => {
          const on = r.id === selected;
          return (
            <circle
              key={r.id}
              cx={x(r.player.value ?? 1)}
              cy={y(r.ability)}
              r={on ? 9 : 4 + r.potential / 25}
              fill="var(--series-2)"
              fillOpacity={on ? 1 : 0.55}
              stroke={on ? 'var(--color-text)' : 'none'}
              className="cursor-pointer"
              onClick={() => {
                onSelect(r.id);
              }}
            >
              <title>{`${r.player.name} (${r.player.team}): nivel ${String(r.ability)}, ${eur(r.player.value)}`}</title>
            </circle>
          );
        })}
      </svg>
      <figcaption className="text-xs text-muted">
        Cada punto es un informe: alto, más nivel; a la derecha, más caro (escala logarítmica); más grande, más
        potencial. Tocá uno para abrir su informe.
      </figcaption>
    </figure>
  );
}

function ReportDetail({ report }: { report: Report }) {
  const p = report.player;
  return (
    <article className="scout-card scout-card--open" aria-label={`Informe de ${p.name}`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-bold">{p.name}</h3>
          <p className="text-sm text-muted">
            {p.team} · {report.group} · {p.age ?? 'n/d'} años · {eur(p.value)}
            {p.minutes ? ` · ${String(p.minutes)} minutos` : ''}
          </p>
          <p className="mt-1 font-semibold">{report.verdict}</p>
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
      </dl>
      {report.scores.length ? (
        <div className="grid gap-1">
          <p className="text-xs font-semibold">Sus estadísticas, contra los de su puesto en la liga</p>
          <StatBars scores={[...report.scores].sort((a, b) => b.percentile - a.percentile)} />
        </div>
      ) : (
        <p className="text-sm text-muted">
          Todavía no hay estadísticas de este jugador. Cuando la fuente las traiga aparecen acá, con su percentil en
          cada estadística del puesto contra el resto de la liga, y pasan a contar en el nivel y en la nota.
        </p>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <ul className="grid gap-0.5 text-sm">
          {report.pros.map((t) => (
            <li key={t} className="text-link">
              + {t}
            </li>
          ))}
        </ul>
        <ul className="grid gap-0.5 text-sm text-muted">
          {report.cons.map((t) => (
            <li key={t}>− {t}</li>
          ))}
        </ul>
      </div>
    </article>
  );
}

function ReportCard({ report, onOpen }: { report: Report; onOpen: () => void }) {
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
            <span className="font-semibold">Bueno en: </span>
            {report.strengths.map((s) => s.label).join(', ')}
          </>
        ) : (
          <span className="text-muted">En qué es bueno: aparece cuando estén sus estadísticas.</span>
        )}
      </p>
      <button type="button" className="chip focus-ring w-fit" onClick={onOpen}>
        Ver informe completo
      </button>
    </li>
  );
}

export function ScoutView({ needs, reports, marketSize }: { needs: Need[]; reports: Report[]; marketSize: number }) {
  const [category, setCategory] = useState<Category>('necesidad');
  const [group, setGroup] = useState<Group | 'todos'>('todos');
  const [selected, setSelected] = useState<string | null>(null);
  const detailRef = useRef<HTMLDivElement>(null);
  const current = CATEGORIES.find((c) => c.id === category) ?? CATEGORIES[0];
  const shown = reports.filter((r) => r.category === category && (group === 'todos' || r.group === group));
  const open = shown.find((r) => r.id === selected) ?? null;
  const top = needs[0];
  const select = (id: string) => {
    setSelected(id);
    requestAnimationFrame(() => detailRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  };
  return (
    <div className="grid gap-8">
      <Tiles
        items={[
          { label: 'Mayor necesidad', value: top ? top.group : 'n/d', hint: top ? `${one(top.score)} de 10` : undefined },
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
            <Scatter reports={shown} selected={open?.id ?? null} onSelect={select} />
            <div ref={detailRef} className="scroll-mt-24">
              {open ? <ReportDetail report={open} /> : null}
            </div>
            <ul className="scout-grid">
              {shown.map((r) => (
                <ReportCard
                  key={r.id}
                  report={r}
                  onOpen={() => {
                    select(r.id);
                  }}
                />
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
