'use client';

// Interfaz 4 (9.6): tarjetas de situaciones por categoría y conclusiones del equipo. Se navega con
// el scroll de la página y un índice fijo (sin arrastrar un lienzo, pedido del dueño). Cada fila
// destaca la métrica que mejor responde la pregunta de su tarjeta y muestra el resto al lado.

import {
  ArrowDownIcon,
  ArrowUpIcon,
  CaretDownIcon,
  CaretRightIcon,
  CheckCircleIcon,
  InfoIcon,
  LightbulbIcon,
  ListMagnifyingGlassIcon,
  MagnifyingGlassIcon,
  SquaresFourIcon,
  WarningCircleIcon,
} from '@phosphor-icons/react';
import { MotionConfig, motion } from 'motion/react';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';

import type { Conclusion } from '@/lib/data/situations';
import {
  CATEGORY_NAMES,
  filterCards,
  headline,
  METRICS,
  SMALL_SAMPLE,
  sortCards,
  type CardSort,
  type MainMetric,
  type SituationCard,
  type SituationMatch,
  type SituationRow,
} from '@/lib/situations/board';

const nf = (digits: number) =>
  new Intl.NumberFormat('es-AR', { minimumFractionDigits: digits, maximumFractionDigits: digits });
const N0 = nf(0);
const N1 = nf(1);
const N2 = nf(2);

function formatMetric(metric: MainMetric, v: number): string {
  if (metric === 'win_pct' || metric === 'clean_pct') return `${N0.format(v)} %`;
  return N2.format(v);
}
function formatDiff(metric: MainMetric, d: number): string {
  const sign = d > 0 ? '+' : d < 0 ? '−' : '';
  return metric === 'win_pct' || metric === 'clean_pct'
    ? `${sign}${N0.format(Math.abs(d))} pp`
    : `${sign}${N2.format(Math.abs(d))}`;
}

type View = 'tarjetas' | 'conclusiones';

export function SituationsBoard({
  cards,
  matches,
  baseWinPct,
  conclusions,
}: {
  cards: SituationCard[];
  matches: Record<number, SituationMatch>;
  baseWinPct: number | null;
  conclusions: Conclusion[];
}) {
  const [view, setView] = useState<View>('tarjetas');
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('');
  const [level, setLevel] = useState('');
  const [onlyData, setOnlyData] = useState(false);
  const [hideSmall, setHideSmall] = useState(false);
  const [sort, setSort] = useState<CardSort>('categoria');
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [active, setActive] = useState('');

  const visible = useMemo(
    () => sortCards(filterCards(cards, { query, category, level, onlyData, hideSmall }), sort),
    [cards, query, category, level, onlyData, hideSmall, sort],
  );
  const frames = useMemo(() => {
    if (sort !== 'categoria') {
      return [{ id: sort, name: sort === 'destacados' ? 'Destacados' : 'Por tamaño de muestra', cards: visible }];
    }
    return Object.keys(CATEGORY_NAMES)
      .map((id) => ({ id, name: CATEGORY_NAMES[id] ?? id, cards: visible.filter((c) => c.category === id) }))
      .filter((f) => f.cards.length);
  }, [visible, sort]);

  // Resalta en el índice el marco que ocupa la parte de arriba de la pantalla.
  useEffect(() => {
    if (view !== 'tarjetas') return;
    const elements = frames.flatMap((f) => document.getElementById(`marco-${f.id}`) ?? []);
    const observer = new IntersectionObserver(
      () => {
        const line = window.innerHeight * 0.35;
        const current = elements.filter((el) => el.getBoundingClientRect().top <= line).at(-1) ?? elements[0];
        if (current) setActive(current.id.replace('marco-', ''));
      },
      { rootMargin: '-120px 0px -55% 0px', threshold: [0, 1] },
    );
    for (const el of elements) observer.observe(el);
    return () => {
      observer.disconnect();
    };
  }, [frames, view]);

  const withData = cards.filter((c) => c.available && c.rows.length).length;

  return (
    <MotionConfig reducedMotion="user">
      <div className="grid gap-5">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="min-w-0">
            <h1 className="page-title">
              <span className="title-trace">Situaciones</span>
            </h1>
            <p className="mt-2 max-w-[70ch] text-muted">
              Cuando pasa algo en un partido, ¿qué le pasa a Boca? {cards.length} tarjetas, {withData} con datos. Cada
              fila se compara con la temporada completa
              {baseWinPct !== null ? ` (${N0.format(baseWinPct)} % de victorias)` : ''}.
            </p>
          </div>
          <div className="view-switch" role="group" aria-label="Vista">
            <button
              type="button"
              className="view-switch__button focus-ring"
              aria-pressed={view === 'tarjetas'}
              onClick={() => {
                setView('tarjetas');
              }}
            >
              <SquaresFourIcon size={16} aria-hidden="true" /> Tarjetas
            </button>
            <button
              type="button"
              className="view-switch__button view-switch__button--insight focus-ring"
              aria-pressed={view === 'conclusiones'}
              onClick={() => {
                setView('conclusiones');
              }}
            >
              <LightbulbIcon size={16} weight="fill" aria-hidden="true" /> Conclusiones
              <span className="tabular">{conclusions.length}</span>
            </button>
          </div>
        </div>

        {view === 'conclusiones' ? (
          <ConclusionsView
            conclusions={conclusions}
            onShowCards={() => {
              setView('tarjetas');
            }}
          />
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Búsqueda, filtros y orden">
              <label className="chip focus-ring min-w-0 cursor-text">
                <MagnifyingGlassIcon size={14} aria-hidden="true" />
                <span className="sr-only">Buscar tarjeta</span>
                <input
                  type="search"
                  className="min-w-0 bg-transparent outline-none"
                  placeholder="Buscar tarjeta"
                  value={query}
                  onChange={(e) => {
                    setQuery(e.target.value);
                  }}
                />
              </label>
              <select
                aria-label="Categoría"
                className="select focus-ring min-w-0"
                value={category}
                onChange={(e) => {
                  setCategory(e.target.value);
                }}
              >
                <option value="">Todas las categorías</option>
                {Object.entries(CATEGORY_NAMES).map(([id, name]) => (
                  <option key={id} value={id}>
                    {id}. {name}
                  </option>
                ))}
              </select>
              <select
                aria-label="Nivel"
                className="select focus-ring min-w-0"
                value={level}
                onChange={(e) => {
                  setLevel(e.target.value);
                }}
              >
                <option value="">Todos los niveles</option>
                <option value="A">Nivel A (dato directo)</option>
                <option value="B">Nivel B (calculado)</option>
                <option value="C">Nivel C (sin fuente)</option>
              </select>
              <button
                type="button"
                className="chip focus-ring"
                aria-pressed={onlyData}
                onClick={() => {
                  setOnlyData((v) => !v);
                }}
              >
                Solo con datos
              </button>
              <button
                type="button"
                className="chip focus-ring"
                aria-pressed={hideSmall}
                onClick={() => {
                  setHideSmall((v) => !v);
                }}
              >
                Ocultar muestra pequeña
              </button>
              <select
                aria-label="Orden"
                className="select focus-ring min-w-0"
                value={sort}
                onChange={(e) => {
                  setSort(e.target.value as CardSort);
                }}
              >
                <option value="categoria">Por categoría</option>
                <option value="destacados">Destacados (lo que más se aleja de la temporada)</option>
                <option value="muestra">Por tamaño de muestra</option>
              </select>
            </div>

            <div className="situ-layout">
              <nav className="situ-index" aria-label="Índice de categorías">
                <ul>
                  {frames.map((f) => (
                    <li key={f.id}>
                      <a
                        href={`#marco-${f.id}`}
                        className="situ-index__link focus-ring"
                        aria-current={active === f.id ? 'true' : undefined}
                      >
                        <span>{f.name}</span>
                        <span className="tabular text-muted">{f.cards.length}</span>
                      </a>
                    </li>
                  ))}
                </ul>
              </nav>

              <div className="grid min-w-0 gap-6">
                {frames.map((f) => (
                  <section key={f.id} id={`marco-${f.id}`} className="situ-frame" aria-labelledby={`titulo-${f.id}`}>
                    <header className="situ-frame__head">
                      <button
                        type="button"
                        className="icon-button focus-ring"
                        aria-expanded={!collapsed.has(f.id)}
                        aria-controls={`grilla-${f.id}`}
                        title={collapsed.has(f.id) ? 'Expandir' : 'Colapsar'}
                        onClick={() => {
                          setCollapsed((s) => {
                            const next = new Set(s);
                            if (next.has(f.id)) next.delete(f.id);
                            else next.add(f.id);
                            return next;
                          });
                        }}
                      >
                        {collapsed.has(f.id) ? (
                          <CaretRightIcon size={14} aria-hidden="true" />
                        ) : (
                          <CaretDownIcon size={14} aria-hidden="true" />
                        )}
                        <span className="sr-only">{collapsed.has(f.id) ? 'Expandir' : 'Colapsar'}</span>
                      </button>
                      <h2 id={`titulo-${f.id}`} className="text-lg font-extrabold">
                        {sort === 'categoria' ? `${f.id}. ` : ''}
                        {f.name}
                      </h2>
                      <span className="tabular text-sm text-muted">{f.cards.length} tarjetas</span>
                    </header>
                    {!collapsed.has(f.id) ? (
                      <div id={`grilla-${f.id}`} className="situ-frame__grid">
                        {f.cards.map((c, i) => (
                          <SituationCardView key={c.id} card={c} matches={matches} index={i} />
                        ))}
                      </div>
                    ) : null}
                  </section>
                ))}
                {frames.length === 0 ? <p className="text-muted">No hay tarjetas con estos filtros.</p> : null}
              </div>
            </div>
          </>
        )}
      </div>
    </MotionConfig>
  );
}

// --- Conclusiones --------------------------------------------------------------------------

const AREA_ORDER = ['Equipo', 'Pelota parada', 'Arqueros', 'Defensores', 'Mediocampistas', 'Delanteros', 'Disciplina'];
const TONE_LABEL: Record<Conclusion['tone'], string> = {
  positivo: 'A favor',
  negativo: 'A mejorar',
  neutral: 'Rasgo de estilo',
};

/** Números de la regla con el formato de su unidad, para completar la frase. */
function fillText(c: Conclusion): string {
  const value =
    c.unit === '%'
      ? `${N0.format(c.value)} %`
      : c.unit === 'prop'
        ? `${N0.format(c.value * 100)} %`
        : N2.format(c.value);
  const reference =
    c.reference === null
      ? ''
      : c.kind === 'cuota' || c.unit === '%'
        ? `${N0.format(c.reference)} %`
        : c.unit === 'prop'
          ? `${N0.format(c.reference * 100)} %`
          : N2.format(c.reference);
  return c.text
    .replaceAll('{valor}', value)
    .replaceAll('{referencia}', reference)
    .replaceAll('{percentil}', c.percentile === null ? '' : N0.format(c.percentile))
    .replaceAll('{n}', N0.format(c.n));
}

function basisText(c: Conclusion): string {
  if (c.kind === 'liga')
    return `Contra los ${N0.format(c.n)} clubes de la liga · percentil ${N0.format(c.percentile ?? 0)}`;
  if (c.kind === 'cuota')
    return 'Su parte del total del plantel dividida por su parte de los minutos (1 = lo esperable)';
  return `Sobre ${N0.format(c.n)} ${c.unit === 'pp90' ? 'minutos' : 'casos'} de la temporada`;
}

function linkFor(c: Conclusion): string | null {
  if (!c.link || c.link === 'situaciones') return null;
  return c.link.startsWith('eq_') ? `/estadistica/${c.link}?entidad=equipo` : `/jugadores?estadistica=${c.link}`;
}

function ConclusionsView({ conclusions, onShowCards }: { conclusions: Conclusion[]; onShowCards: () => void }) {
  if (!conclusions.length)
    return <p className="text-muted">Todavía no hay conclusiones calculadas para esta temporada.</p>;
  const count = (tone: Conclusion['tone']) => conclusions.filter((c) => c.tone === tone).length;
  const areas = [...new Set([...AREA_ORDER, ...conclusions.map((c) => c.area)])].filter((a) =>
    conclusions.some((c) => c.area === a),
  );
  return (
    <div className="grid gap-6">
      <div className="grid gap-2">
        <p className="max-w-[75ch] text-sm text-muted">
          Cada conclusión sale de comparar a Boca con los 30 clubes de la liga o a cada posición con el resto del
          plantel, con los números de esta temporada. Se recalculan en cada actualización: si los números cambian,
          cambia la conclusión y su color.
        </p>
        <ul className="flex flex-wrap gap-2 text-sm">
          <li className="concl-count concl-count--positivo">
            <CheckCircleIcon size={16} weight="fill" aria-hidden="true" /> {count('positivo')} a favor
          </li>
          <li className="concl-count concl-count--negativo">
            <WarningCircleIcon size={16} weight="fill" aria-hidden="true" /> {count('negativo')} a mejorar
          </li>
          <li className="concl-count concl-count--neutral">
            <InfoIcon size={16} weight="fill" aria-hidden="true" /> {count('neutral')} rasgos de estilo
          </li>
        </ul>
      </div>
      {areas.map((area) => (
        <section key={area} className="grid gap-3" aria-labelledby={`area-${area}`}>
          <h2 id={`area-${area}`} className="text-lg font-extrabold">
            {area}
          </h2>
          <ul className="concl-grid">
            {conclusions
              .filter((c) => c.area === area)
              .map((c, i) => {
                const href = linkFor(c);
                const Icon =
                  c.tone === 'positivo' ? CheckCircleIcon : c.tone === 'negativo' ? WarningCircleIcon : InfoIcon;
                return (
                  <motion.li
                    key={c.id}
                    className={`concl concl--${c.tone}`}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.3, delay: Math.min(i, 8) * 0.04, ease: [0.16, 1, 0.3, 1] }}
                  >
                    <p className="concl__tag">
                      <Icon size={16} weight="fill" aria-hidden="true" />
                      {TONE_LABEL[c.tone]} · {c.title}
                    </p>
                    <p className="concl__text">{fillText(c)}</p>
                    <p className="text-xs text-muted">{basisText(c)}</p>
                    {href ? (
                      <Link href={href} className="text-xs font-semibold text-link focus-ring">
                        Ver la estadística
                      </Link>
                    ) : c.link === 'situaciones' ? (
                      <button
                        type="button"
                        className="justify-self-start text-xs font-semibold text-link focus-ring"
                        onClick={onShowCards}
                      >
                        Ver las tarjetas de situaciones
                      </button>
                    ) : null}
                  </motion.li>
                );
              })}
          </ul>
        </section>
      ))}
    </div>
  );
}

// --- Tarjetas ------------------------------------------------------------------------------

function SituationCardView({
  card,
  matches,
  index,
}: {
  card: SituationCard;
  matches: Record<number, SituationMatch>;
  index: number;
}) {
  const [openRow, setOpenRow] = useState<string | null>(null);
  const empty = !card.available || card.rows.length === 0;
  const opened = card.rows.find((r) => r.param === openRow);
  const meta = METRICS[card.mainMetric];
  return (
    <motion.article
      className={`situ-card${empty ? ' situ-card--empty' : ''}`}
      aria-labelledby={`tarjeta-${card.id}`}
      initial={{ opacity: 0, y: 8 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '0px 0px -40px 0px' }}
      transition={{ duration: 0.3, delay: Math.min(index % 6, 5) * 0.03, ease: [0.16, 1, 0.3, 1] }}
    >
      <header className="grid gap-1">
        <div className="flex items-start justify-between gap-2">
          <h3 id={`tarjeta-${card.id}`} className="text-base font-bold leading-snug">
            {card.title}
          </h3>
          <span className="tabular text-xs text-muted">{card.id.slice(1)}</span>
        </div>
        <p className="text-xs text-muted">
          {card.condition}
          {card.measured !== 'Resultado del partido' ? ` · mide: ${card.measured.toLowerCase()}` : ''}
        </p>
        <div className="flex flex-wrap items-center gap-1">
          <span className="level-badge">Nivel {card.level}</span>
          {card.estimated ? <span className="level-badge">Estimado</span> : null}
          {!empty ? <span className="text-xs text-muted">Destaca: {meta.label}</span> : null}
        </div>
      </header>

      {!card.available ? (
        <p className="flex items-start gap-2 text-sm text-muted">
          <WarningCircleIcon size={16} aria-hidden="true" className="mt-0.5 shrink-0" />
          <span>
            <span className="font-bold text-fg">n/d.</span> Falta: {card.required}. {card.reason}.
          </span>
        </p>
      ) : card.rows.length === 0 ? (
        <p className="text-sm text-muted">Sin casos en la temporada: la condición no se dio en ningún partido.</p>
      ) : (
        <ul className="situ-rows">
          {card.rows.map((r) => (
            <SituationRowView
              key={r.param}
              row={r}
              metric={card.mainMetric}
              open={openRow === r.param}
              onToggle={() => {
                setOpenRow((v) => (v === r.param ? null : r.param));
              }}
            />
          ))}
        </ul>
      )}

      {!empty ? (
        <button
          type="button"
          className="chip focus-ring justify-self-start"
          aria-expanded={openRow !== null}
          onClick={() => {
            setOpenRow((v) => (v === null ? (card.rows[0]?.param ?? null) : null));
          }}
        >
          <ListMagnifyingGlassIcon size={14} aria-hidden="true" />
          {openRow === null ? 'Ver los partidos' : 'Ocultar los partidos'}
        </button>
      ) : null}

      {opened ? (
        <div className="situ-matches">
          <p className="text-xs font-semibold text-muted">
            {opened.param}: {opened.n} partidos
          </p>
          <table className="chart-table">
            <caption className="sr-only">
              Partidos de la fila {opened.param} de {card.title}
            </caption>
            <thead>
              <tr>
                <th scope="col">Fecha</th>
                <th scope="col">Rival</th>
                <th scope="col">Resultado</th>
              </tr>
            </thead>
            <tbody>
              {opened.matchIds.map((id) => {
                const m = matches[id];
                return m ? (
                  <tr key={id}>
                    <td>{m.date.split('-').reverse().join('/')}</td>
                    <td>
                      {m.home ? 'vs' : 'en'} {m.opponent}
                    </td>
                    <td>
                      {m.goalsFor}-{m.goalsAgainst} ({m.result})
                    </td>
                  </tr>
                ) : null;
              })}
            </tbody>
          </table>
        </div>
      ) : null}
    </motion.article>
  );
}

/** Posición en la barra de la métrica principal, en su escala (0 a 100). */
function barPosition(metric: MainMetric, v: number): number {
  if (metric === 'win_pct' || metric === 'clean_pct') return Math.max(0, Math.min(100, v));
  if (metric === 'goal_diff') return Math.max(0, Math.min(100, ((v + 3) / 6) * 100));
  return Math.max(0, Math.min(100, (v / 3) * 100));
}

function SituationRowView({
  row,
  metric,
  open,
  onToggle,
}: {
  row: SituationRow;
  metric: MainMetric;
  open: boolean;
  onToggle: () => void;
}) {
  const small = row.n < SMALL_SAMPLE;
  const h = headline(row, metric);
  return (
    <li>
      <button
        type="button"
        className={`situ-row focus-ring${open ? ' situ-row--open' : ''}`}
        aria-pressed={open}
        onClick={onToggle}
      >
        <span className="situ-row__line">
          <span className="situ-row__param">{row.param}</span>
          <span className="tabular text-sm font-bold">{formatMetric(metric, h.value)}</span>
          <span
            className={`situ-delta tabular ${h.diff === 0 ? 'text-muted' : h.better ? 'value-best' : 'value-worst'}`}
            title={`Diferencia contra la temporada (${formatMetric(metric, h.base)})`}
          >
            {h.diff > 0 ? (
              <ArrowUpIcon size={12} weight="bold" aria-hidden="true" />
            ) : h.diff < 0 ? (
              <ArrowDownIcon size={12} weight="bold" aria-hidden="true" />
            ) : null}
            {formatDiff(metric, h.diff)}
          </span>
        </span>
        <span className="situ-bar" aria-hidden="true">
          <motion.span
            className="situ-bar__fill"
            style={{ width: `${String(barPosition(metric, h.value))}%` }}
            initial={{ scaleX: 0 }}
            whileInView={{ scaleX: 1 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
          />
          <span className="situ-bar__base" style={{ left: `${String(barPosition(metric, h.base))}%` }} />
        </span>
        <span className="situ-row__facts tabular">
          <span>{row.n} PJ</span>
          <span>
            {row.w}-{row.d}-{row.l}
          </span>
          {metric !== 'win_pct' ? <span>{N0.format(row.winPct)} % vict.</span> : null}
          {metric !== 'ppg' ? <span>{N2.format(row.ppg)} pts</span> : null}
          {metric !== 'gf' ? <span>GF {N1.format(row.gf)}</span> : null}
          {metric !== 'ga' ? <span>GC {N1.format(row.ga)}</span> : null}
          {metric !== 'clean_pct' ? <span>valla {N0.format(row.cleanPct)} %</span> : null}
          {small ? <span className="situ-small">Muestra pequeña</span> : null}
        </span>
      </button>
    </li>
  );
}
