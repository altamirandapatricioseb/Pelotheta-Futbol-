'use client';

// Interfaz 1 (9.2): la landing con todos los gráficos a la vista, por categoría. Barra de
// categorías fija que resalta la sección actual, filtros globales de competición y localía,
// 3 o 4 números destacados por sección y una grilla de 1 a 3 columnas según el ancho.

import { useEffect, useMemo, useState } from 'react';

import { AnimatedNumber } from '@/components/animated-number';
import type { ChartDef } from '@/lib/data/charts';
import type { LandingData } from '@/lib/data/landing';
import { formatDateTime } from '@/lib/format';
import type { TeamMatchRow } from '@/lib/stats/catalog';

import { ChartCard } from './chart-card';
import { CHARTS, type ChartContext } from './definitions';

const CATEGORIES: Record<string, string> = {
  A: 'Forma y resultados',
  B: 'Goles',
  C: 'xG y remates',
  D: 'Posesión y circulación',
  E: 'Defensa',
  F: 'Pelota parada',
  G: 'Jugadores',
  H: 'Plantel y carga',
  I: 'Competición',
  J: 'Disciplina',
  K: 'Métricas propias',
  L: 'Situaciones',
  M: 'Modelos y calendario',
  N: 'Evolución y proyección',
  O: 'Táctica',
  P: 'Jugadores avanzados',
  Q: 'Tendencias',
};

// Fuente de cada categoría y las excepciones por gráfico (lo que se muestra al pie de la tarjeta).
const CATEGORY_SOURCE: Record<string, string> = {
  A: 'Promiedos',
  B: 'Promiedos',
  C: 'Promiedos y StrikerAPI',
  D: 'Promiedos y StrikerAPI',
  E: 'Promiedos',
  F: 'Promiedos y StrikerAPI',
  G: 'Promiedos, ScoutingStats y Statshub',
  H: 'Promiedos',
  I: 'StrikerAPI y cálculo propio',
  J: 'Promiedos',
  K: 'Cálculo propio sobre Promiedos',
  L: 'Promiedos',
  M: 'Cálculo propio sobre Promiedos',
  N: 'Cálculo propio (sección 6.1)',
  O: 'ScoutingStats y Promiedos',
  P: 'Promiedos, ScoutingStats y Statshub',
  Q: 'Promiedos y StrikerAPI',
};
const CHART_SOURCE: Record<string, string> = {
  g02: 'Promiedos (Tabla Anual)',
  g19: 'StrikerAPI (liga)',
  g57: 'Promiedos (goleadores de la liga)',
  g58: 'Promiedos (partidos de la liga)',
  g76: 'Promiedos (2025 y 2026)',
  g77: 'Open-Meteo y Promiedos',
  g87: 'ScoutingStats',
  g88: 'StrikerAPI',
};

type Venue = 'todos' | 'local' | 'visitante';

const INT = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 });
const DEC1 = new Intl.NumberFormat('es-AR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const DEC2 = new Intl.NumberFormat('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const int = (v: number) => INT.format(v);
const dec1 = (v: number) => DEC1.format(v);
const dec2 = (v: number) => DEC2.format(v);
const pct = (v: number) => `${int(v)} %`;

interface Tile {
  label: string;
  value: number | null;
  format: (v: number) => string;
  hint?: string;
}

const val = (m: TeamMatchRow, k: string) => m.stats[k] ?? null;
const total = (ms: TeamMatchRow[], k: string) => {
  const v = ms.map((m) => val(m, k)).filter((x): x is number => x !== null);
  return v.length ? v.reduce((a, b) => a + b, 0) : null;
};
const mean = (ms: TeamMatchRow[], k: string) => {
  const v = ms.map((m) => val(m, k)).filter((x): x is number => x !== null);
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
};
const share = (ms: TeamMatchRow[], test: (m: TeamMatchRow) => boolean) =>
  ms.length ? (ms.filter(test).length / ms.length) * 100 : null;
const pts = (m: TeamMatchRow) => (m.goalsFor > m.goalsAgainst ? 3 : m.goalsFor === m.goalsAgainst ? 1 : 0);

/** Números destacados de cada sección (9.2): 3 o 4, siempre con el filtro aplicado. */
function tiles(category: string, ctx: ChartContext): Tile[] {
  const { matches: ms, data, regulars } = ctx;
  const n = ms.length;
  const goals = ms.reduce((a, m) => a + m.goalsFor, 0);
  const against = ms.reduce((a, m) => a + m.goalsAgainst, 0);
  const player = (id: string) => {
    const best = data.players
      .map((p) => ({ p, v: p.stats[id] ?? null }))
      .filter((x): x is { p: (typeof data.players)[number]; v: number } => x.v !== null)
      .sort((a, b) => b.v - a.v)[0];
    return best ? { value: best.v, hint: best.p.name } : { value: null };
  };
  switch (category) {
    case 'A':
      return [
        { label: 'Partidos', value: n, format: int },
        { label: 'Puntos por partido', value: n ? ms.reduce((a, m) => a + pts(m), 0) / n : null, format: dec2 },
        { label: 'Victorias', value: share(ms, (m) => m.goalsFor > m.goalsAgainst), format: pct },
        { label: 'Diferencia de gol', value: goals - against, format: int },
      ];
    case 'B':
      return [
        { label: 'Goles a favor', value: goals, format: int },
        { label: 'Goles en contra', value: against, format: int },
        { label: 'Goles por partido', value: n ? goals / n : null, format: dec2 },
        { label: 'Partidos sin marcar', value: share(ms, (m) => m.goalsFor === 0), format: pct },
      ];
    case 'C':
      return [
        { label: 'xG a favor', value: total(ms, 'xg'), format: dec1, hint: 'partidos con xG' },
        { label: 'xG en contra', value: total(ms, 'xg_against'), format: dec1 },
        { label: 'Remates por partido', value: mean(ms, 'shots_total'), format: dec1 },
        { label: 'Remates al arco por partido', value: mean(ms, 'shots_on_target'), format: dec1 },
      ];
    case 'D':
      return [
        { label: 'Posesión media', value: mean(ms, 'possession_pct'), format: pct },
        { label: 'Pases por partido', value: mean(ms, 'passes'), format: int },
        { label: 'Precisión de pase', value: mean(ms, 'pass_accuracy_pct'), format: pct },
      ];
    case 'E':
      return [
        { label: 'Vallas invictas', value: share(ms, (m) => m.goalsAgainst === 0), format: pct },
        { label: 'Goles recibidos por partido', value: n ? against / n : null, format: dec2 },
        { label: 'Remates del rival por partido', value: mean(ms, 'shots_total_against'), format: dec1 },
      ];
    case 'F':
      return [
        { label: 'Córners por partido', value: mean(ms, 'corners'), format: dec1 },
        { label: 'Goles de pelota parada', value: total(ms, 'goals_set_piece'), format: int, hint: 'liga' },
        { label: 'Penales convertidos', value: total(ms, 'penalties_scored'), format: int, hint: 'liga' },
      ];
    case 'G': {
      const scorer = player('goles');
      const assister = player('asistencias');
      return [
        { label: 'Jugadores usados', value: data.players.filter((p) => p.minutes > 0).length, format: int },
        { label: 'Goleador', value: scorer.value, format: int, hint: scorer.hint },
        { label: 'Máximo asistidor', value: assister.value, format: int, hint: assister.hint },
      ];
    }
    case 'H':
      return [
        { label: 'Con 450 minutos o más', value: regulars.length, format: int },
        { label: 'Más minutos', value: regulars[0]?.minutes ?? null, format: int, hint: regulars[0]?.name },
        { label: 'Cambios en el once por partido', value: mean(ms, 'eq_rotacion'), format: dec1 },
      ];
    case 'I': {
      const last = ms.findLast((m) => val(m, 'eq_elo') !== null);
      return [
        { label: 'Elo actual', value: last ? val(last, 'eq_elo') : null, format: int },
        { label: 'Elo medio de los rivales', value: mean(ms, 'eq_elo_rival'), format: int },
        {
          label: 'Puntos por partido de la liga',
          value: data.leaguePpg,
          format: dec2,
          hint: 'promedio de la Tabla Anual',
        },
      ];
    }
    case 'J':
      return [
        { label: 'Amarillas por partido', value: mean(ms, 'yellow_cards'), format: dec1 },
        { label: 'Rojas', value: total(ms, 'red_cards'), format: int },
        { label: 'Faltas por partido', value: mean(ms, 'fouls'), format: dec1 },
      ];
    case 'K':
      return [
        { label: 'xPts propio', value: total(ms, 'eq_xpts'), format: dec1 },
        { label: 'Puntos reales', value: ms.reduce((a, m) => a + pts(m), 0), format: int },
        { label: 'Brier medio del Elo', value: mean(ms, 'eq_brier'), format: dec2, hint: '0 es perfecto' },
      ];
    case 'L':
      return [
        { label: 'Puntos ganados desde atrás', value: total(ms, 'points_from_behind'), format: int },
        { label: 'Puntos perdidos con ventaja', value: total(ms, 'points_dropped_from_ahead'), format: int },
        {
          label: 'Ganando al descanso',
          value: share(ms, (m) => (val(m, 'goals_for_ht') ?? 0) > (val(m, 'goals_against_ht') ?? 0)),
          format: pct,
        },
      ];
    case 'M':
      return [
        { label: 'Probabilidad media de ganar', value: mean(ms, 'eq_prob_victoria'), format: pct },
        { label: 'Días de descanso medios', value: mean(ms, 'rest_days'), format: dec1 },
        {
          label: 'Repetición del once',
          value: mean(ms, 'eq_estabilidad_once'),
          format: dec2,
          hint: 'Jaccard, 1 = mismo once',
        },
      ];
    case 'N': {
      const best = player('potencial_beta');
      return [
        {
          label: 'Jugadores con Potencial',
          value: data.players.filter((p) => p.stats.potencial_beta !== undefined).length,
          format: int,
        },
        { label: 'Mayor Potencial β', value: best.value, format: dec1, hint: best.hint },
      ];
    }
    case 'O':
      return [
        {
          label: 'Formaciones usadas',
          value: new Set(ms.flatMap((m) => data.formations[m.matchId]?.boca ?? [])).size,
          format: int,
        },
        { label: 'Duelos ganados por partido', value: mean(ms, 'duels_won'), format: dec1 },
        { label: 'Ocasiones claras por partido', value: mean(ms, 'big_chances'), format: dec1 },
      ];
    case 'P':
      return [
        { label: 'Jugadores de referencia', value: regulars.length, format: int, hint: '450 minutos o más' },
        {
          label: 'Calificación más alta',
          value: player('calificacion').value,
          format: dec2,
          hint: player('calificacion').hint,
        },
      ];
    case 'Q':
      return [
        { label: 'Ambos marcan', value: share(ms, (m) => m.goalsFor > 0 && m.goalsAgainst > 0), format: pct },
        { label: 'Más de 2,5 goles', value: share(ms, (m) => m.goalsFor + m.goalsAgainst > 2.5), format: pct },
      ];
    default:
      return [];
  }
}

export function Landing({ data, charts }: { data: LandingData; charts: ChartDef[] }) {
  const [competition, setCompetition] = useState('todas');
  const [venue, setVenue] = useState<Venue>('todos');
  const [active, setActive] = useState('A');

  const competitions = useMemo(
    () => [...new Map(data.matches.map((m) => [m.competitionCode, m.competitionName])).entries()],
    [data.matches],
  );
  const ctx = useMemo<ChartContext>(() => {
    const matches = data.matches.filter(
      (m) =>
        (competition === 'todas' || m.competitionCode === competition) &&
        (venue === 'todos' || (venue === 'local') === m.home),
    );
    const minMinutes = data.params.MIN_MINUTES ?? 450;
    const regulars = data.players.filter((p) => p.minutes >= minMinutes).sort((a, b) => b.minutes - a.minutes);
    return { data, matches, regulars };
  }, [data, competition, venue]);

  const sections = useMemo(
    () =>
      Object.keys(CATEGORIES)
        .map((c) => ({ id: c, name: CATEGORIES[c] ?? c, charts: charts.filter((x) => x.category === c) }))
        .filter((s) => s.charts.length),
    [charts],
  );

  // Resalta en la barra la sección que ocupa la parte de arriba de la pantalla.
  useEffect(() => {
    const elements = sections.flatMap((s) => document.getElementById(`categoria-${s.id.toLowerCase()}`) ?? []);
    // El observador solo avisa que algo cambió; la activa es la última sección cuyo comienzo ya
    // pasó por debajo de la barra (con los avisos parciales se elegía la anterior).
    const observer = new IntersectionObserver(
      () => {
        const line = window.innerHeight * 0.4;
        const current = elements.filter((el) => el.getBoundingClientRect().top <= line).at(-1) ?? elements[0];
        if (current) setActive(current.id.replace('categoria-', '').toUpperCase());
      },
      { rootMargin: '-140px 0px -55% 0px', threshold: [0, 1] },
    );
    for (const el of elements) observer.observe(el);
    return () => {
      observer.disconnect();
    };
  }, [sections]);

  // La categoría activa queda a la vista dentro de la barra (en pantallas chicas se desplaza).
  useEffect(() => {
    const bar = document.querySelector<HTMLElement>('.category-bar');
    const chip = bar?.querySelector<HTMLElement>('[aria-current="true"]');
    if (!bar || !chip) return;
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    bar.scrollTo({
      left: chip.offsetLeft - bar.clientWidth / 2 + chip.clientWidth / 2,
      behavior: still ? 'auto' : 'smooth',
    });
  }, [active]);

  const updated = data.updated ? formatDateTime(data.updated) : null;
  const working = charts.filter((c) => c.available).length;

  return (
    <div className="grid gap-6 [&>*]:min-w-0">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="page-title">
            <span className="title-trace">Gráficos</span>
          </h1>
          <p className="mt-2 text-muted">
            Boca Juniors 2026 · {charts.length} gráficos en {sections.length} categorías · {working} con datos
          </p>
        </div>
        <div
          className="flex min-w-0 max-w-full flex-wrap items-center gap-2"
          role="group"
          aria-label="Filtros globales"
        >
          <label className="flex min-w-0 max-w-full items-center gap-2 text-sm font-semibold text-muted">
            Competición
            <select
              className="select focus-ring min-w-0 flex-1"
              value={competition}
              onChange={(e) => {
                setCompetition(e.target.value);
              }}
            >
              <option value="todas">Todas</option>
              {competitions.map(([code, name]) => (
                <option key={code} value={code}>
                  {name}
                </option>
              ))}
            </select>
          </label>
          {(['todos', 'local', 'visitante'] as const).map((v) => (
            <button
              key={v}
              type="button"
              className="chip focus-ring"
              aria-pressed={venue === v}
              onClick={() => {
                setVenue(v);
              }}
            >
              {v === 'todos' ? 'Local y visitante' : v === 'local' ? 'Local' : 'Visitante'}
            </button>
          ))}
        </div>
      </div>
      <p className="text-xs text-muted">
        Los filtros cambian los gráficos del equipo. Los de jugadores usan toda la temporada ({ctx.matches.length}{' '}
        partidos en el filtro).
      </p>

      <nav className="category-bar" aria-label="Categorías de gráficos">
        {sections.map((s) => (
          <a
            key={s.id}
            href={`#categoria-${s.id.toLowerCase()}`}
            className="chip focus-ring shrink-0"
            aria-current={active === s.id ? 'true' : undefined}
          >
            {s.name}
          </a>
        ))}
      </nav>

      {sections.map((s) => (
        <section
          key={s.id}
          id={`categoria-${s.id.toLowerCase()}`}
          className="landing-section grid gap-4"
          aria-labelledby={`titulo-${s.id}`}
        >
          <h2 id={`titulo-${s.id}`} className="text-xl font-bold">
            {s.name}
          </h2>
          <ul className="tile-row">
            {tiles(s.id, ctx).map((t) => (
              <li key={t.label} className="tile">
                <span className="tile-label">{t.label}</span>
                {t.value === null || !Number.isFinite(t.value) ? (
                  <span className="tile-value">n/d</span>
                ) : (
                  <AnimatedNumber value={t.value} format={t.format} className="tile-value tabular" />
                )}
                {t.hint ? <span className="tile-hint">{t.hint}</span> : null}
              </li>
            ))}
          </ul>
          <div className="chart-grid-layout">
            {s.charts.map((c) => {
              const render = CHARTS[c.id];
              const out =
                c.available && render ? render(ctx) : { empty: c.reason || 'Este gráfico todavía no tiene datos.' };
              const common = {
                id: c.id,
                number: c.id.slice(1),
                title: c.title,
                source: CHART_SOURCE[c.id] ?? CATEGORY_SOURCE[c.category] ?? 'Promiedos',
                updated,
                origin: c.origin?.href,
                originLabel: c.origin?.label,
              };
              return 'empty' in out ? (
                <ChartCard key={c.id} {...common} empty={out.empty} />
              ) : (
                <ChartCard key={c.id} {...common} table={out.table} coverage={out.coverage}>
                  {out.node}
                </ChartCard>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
