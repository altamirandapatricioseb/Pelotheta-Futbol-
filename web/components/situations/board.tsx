'use client';

/* El lienzo tiene teclado propio (flechas, + y −) con rol application, que jsx-a11y no reconoce
   como interactivo: por eso se apagan estas dos reglas solo en este archivo. */
/* eslint-disable jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/no-noninteractive-tabindex */

// Interfaz 4 (9.6): tablero tipo Miro. Lienzo con zoom y desplazamiento (rueda, arrastre con
// inercia, pellizco, teclado y botones), minimapa, «ajustar a pantalla», índice de categorías
// que centra cada marco, búsqueda, filtros y orden. La transformación del lienzo se escribe
// directo en el DOM (sin volver a renderizar las 131 tarjetas en cada movimiento).

import {
  ArrowDownIcon,
  ArrowsInIcon,
  ArrowsOutSimpleIcon,
  ArrowUpIcon,
  CaretDownIcon,
  CaretRightIcon,
  CornersOutIcon,
  ListMagnifyingGlassIcon,
  MagnifyingGlassIcon,
  MinusIcon,
  PlusIcon,
  WarningCircleIcon,
} from '@phosphor-icons/react';
import { animate, MotionConfig, motion } from 'motion/react';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

import {
  CATEGORY_NAMES,
  filterCards,
  SMALL_SAMPLE,
  sortCards,
  type CardSort,
  type SituationCard,
  type SituationMatch,
  type SituationRow,
} from '@/lib/situations/board';

interface View {
  x: number;
  y: number;
  k: number;
}

const MIN_ZOOM = 0.25;
const MAX_ZOOM = 1.5;
const clampZoom = (k: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, k));
const pct = (v: number) => `${new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 }).format(v)} %`;
const dec = (v: number) =>
  new Intl.NumberFormat('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v);
const signed = (v: number) =>
  `${v > 0 ? '+' : v < 0 ? '−' : ''}${new Intl.NumberFormat('es-AR', { maximumFractionDigits: 1 }).format(Math.abs(v))}`;

interface FrameRect {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export function SituationsBoard({
  cards,
  matches,
  baseWinPct,
}: {
  cards: SituationCard[];
  matches: Record<number, SituationMatch>;
  baseWinPct: number | null;
}) {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('');
  const [level, setLevel] = useState('');
  const [onlyData, setOnlyData] = useState(false);
  const [hideSmall, setHideSmall] = useState(false);
  const [sort, setSort] = useState<CardSort>('categoria');
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [isolated, setIsolated] = useState<string | null>(null);
  const [focused, setFocused] = useState<string | null>(null);

  const visible = useMemo(
    () => sortCards(filterCards(cards, { query, category: isolated ?? category, level, onlyData, hideSmall }), sort),
    [cards, query, category, isolated, level, onlyData, hideSmall, sort],
  );
  // Marcos por categoría. Con orden «Destacados» o «Muestra», un solo marco con todo ordenado.
  const frames = useMemo(() => {
    if (sort !== 'categoria')
      return [{ id: sort, name: sort === 'destacados' ? 'Destacados' : 'Por tamaño de muestra', cards: visible }];
    return Object.keys(CATEGORY_NAMES)
      .map((id) => ({ id, name: CATEGORY_NAMES[id] ?? id, cards: visible.filter((c) => c.category === id) }))
      .filter((f) => f.cards.length);
  }, [visible, sort]);

  // --- Lienzo -------------------------------------------------------------------------------
  const viewportRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const view = useRef<View>({ x: 24, y: 24, k: 0.8 });
  const [mini, setMini] = useState<View & { vw: number; vh: number }>({ x: 24, y: 24, k: 0.8, vw: 0, vh: 0 });
  const [rects, setRects] = useState<FrameRect[]>([]);
  const [size, setSize] = useState({ w: 1, h: 1 });
  const raf = useRef(0);

  const apply = useCallback(() => {
    const { x, y, k } = view.current;
    if (contentRef.current)
      contentRef.current.style.transform = `translate(${String(x)}px, ${String(y)}px) scale(${String(k)})`;
    cancelAnimationFrame(raf.current);
    raf.current = requestAnimationFrame(() => {
      const el = viewportRef.current;
      setMini({ x, y, k, vw: el?.clientWidth ?? 0, vh: el?.clientHeight ?? 0 });
    });
  }, []);

  const zoomAt = useCallback(
    (factor: number, cx: number, cy: number) => {
      const v = view.current;
      const k = clampZoom(v.k * factor);
      // El punto bajo el cursor queda fijo.
      view.current = { k, x: cx - ((cx - v.x) * k) / v.k, y: cy - ((cy - v.y) * k) / v.k };
      apply();
    },
    [apply],
  );

  const moveTo = useCallback(
    (target: View) => {
      const from = { ...view.current };
      const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (still) {
        view.current = target;
        apply();
        return;
      }
      void animate(0, 1, {
        duration: 0.45,
        ease: [0.16, 1, 0.3, 1],
        onUpdate: (t) => {
          view.current = {
            x: from.x + (target.x - from.x) * t,
            y: from.y + (target.y - from.y) * t,
            k: from.k + (target.k - from.k) * t,
          };
          apply();
        },
      });
    },
    [apply],
  );

  const fit = useCallback(() => {
    const el = viewportRef.current;
    if (!el) return;
    const k = clampZoom(Math.min(el.clientWidth / size.w, el.clientHeight / size.h) * 0.96);
    moveTo({ k, x: (el.clientWidth - size.w * k) / 2, y: 16 });
  }, [size, moveTo]);

  const centerOn = useCallback(
    (id: string) => {
      const el = viewportRef.current;
      const r = rects.find((f) => f.id === id);
      if (!el || !r) return;
      const k = clampZoom(Math.min(1, (el.clientWidth / r.w) * 0.94, (el.clientHeight / Math.min(r.h, 900)) * 0.94));
      moveTo({ k, x: el.clientWidth / 2 - (r.x + r.w / 2) * k, y: 24 - r.y * k });
    },
    [rects, moveTo],
  );

  // Medidas de los marcos para el minimapa y el índice (en coordenadas del lienzo).
  useLayoutEffect(() => {
    const content = contentRef.current;
    if (!content) return;
    const measure = () => {
      setSize({ w: content.scrollWidth, h: content.scrollHeight });
      setRects(
        [...content.querySelectorAll<HTMLElement>('[data-frame]')].map((f) => ({
          id: f.dataset.frame ?? '',
          x: f.offsetLeft,
          y: f.offsetTop,
          w: f.offsetWidth,
          h: f.offsetHeight,
        })),
      );
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(content);
    return () => {
      ro.disconnect();
    };
  }, [frames, collapsed, focused]);

  useEffect(() => {
    apply();
  }, [apply]);

  // Rueda: con Ctrl (o pellizco del trackpad) hace zoom; sin Ctrl, desplaza.
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const box = el.getBoundingClientRect();
      if (e.ctrlKey || e.metaKey) {
        zoomAt(Math.exp(-e.deltaY * 0.01), e.clientX - box.left, e.clientY - box.top);
      } else {
        view.current = { ...view.current, x: view.current.x - e.deltaX, y: view.current.y - e.deltaY };
        apply();
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      el.removeEventListener('wheel', onWheel);
    };
  }, [zoomAt, apply]);

  // Arrastre con inercia y pellizco con dos dedos.
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const velocity = useRef({ x: 0, y: 0, t: 0 });
  const inertia = useRef(0);
  const onPointerDown = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest('button, a, input, select, [data-no-pan]')) return;
    cancelAnimationFrame(inertia.current);
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    velocity.current = { x: 0, y: 0, t: performance.now() };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const prev = pointers.current.get(e.pointerId);
    if (!prev) return;
    const box = e.currentTarget.getBoundingClientRect();
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      const other = a === prev ? b : a;
      if (other) {
        const before = Math.hypot(prev.x - other.x, prev.y - other.y);
        const after = Math.hypot(e.clientX - other.x, e.clientY - other.y);
        if (before > 0)
          zoomAt(after / before, (e.clientX + other.x) / 2 - box.left, (e.clientY + other.y) / 2 - box.top);
      }
    } else {
      const dx = e.clientX - prev.x;
      const dy = e.clientY - prev.y;
      const now = performance.now();
      const dt = Math.max(1, now - velocity.current.t);
      velocity.current = { x: dx / dt, y: dy / dt, t: now };
      view.current = { ...view.current, x: view.current.x + dx, y: view.current.y + dy };
      apply();
    }
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
  };
  const onPointerUp = (e: React.PointerEvent) => {
    const wasPanning = pointers.current.size === 1;
    pointers.current.delete(e.pointerId);
    if (!wasPanning || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    // Inercia: la velocidad del último tramo se frena de a poco.
    let { x: vx, y: vy } = velocity.current;
    const step = () => {
      vx *= 0.92;
      vy *= 0.92;
      if (Math.abs(vx) < 0.02 && Math.abs(vy) < 0.02) return;
      view.current = { ...view.current, x: view.current.x + vx * 16, y: view.current.y + vy * 16 };
      apply();
      inertia.current = requestAnimationFrame(step);
    };
    inertia.current = requestAnimationFrame(step);
  };
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.target !== e.currentTarget) return;
    const el = viewportRef.current;
    const pan: Record<string, [number, number]> = {
      ArrowLeft: [80, 0],
      ArrowRight: [-80, 0],
      ArrowUp: [0, 80],
      ArrowDown: [0, -80],
    };
    const delta = pan[e.key];
    if (delta) {
      e.preventDefault();
      view.current = { ...view.current, x: view.current.x + delta[0], y: view.current.y + delta[1] };
      apply();
    } else if ((e.key === '+' || e.key === '-') && el) {
      e.preventDefault();
      zoomAt(e.key === '+' ? 1.2 : 1 / 1.2, el.clientWidth / 2, el.clientHeight / 2);
    }
  };

  const toggle = (set: Set<string>, id: string) => {
    const next = new Set(set);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  };

  const withData = cards.filter((c) => c.available && c.rows.length).length;
  const miniScale = 200 / Math.max(1, size.w);

  return (
    <MotionConfig reducedMotion="user">
      <div className="grid gap-4">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="page-title">
              <span className="title-trace">Situaciones</span>
            </h1>
            <p className="mt-2 max-w-[70ch] text-muted">
              Cuando pasa algo en un partido, ¿qué le pasa a Boca? {cards.length} tarjetas, {withData} con datos. Cada
              fila compara el % de victorias con la base de la temporada
              {baseWinPct !== null ? ` (${pct(baseWinPct)})` : ''}.
            </p>
          </div>
        </div>

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
            className="select focus-ring"
            value={category}
            onChange={(e) => {
              setCategory(e.target.value);
              setIsolated(null);
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
            className="select focus-ring"
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
            className="select focus-ring"
            value={sort}
            onChange={(e) => {
              setSort(e.target.value as CardSort);
            }}
          >
            <option value="categoria">Por categoría</option>
            <option value="destacados">Destacados (diferencia más extrema)</option>
            <option value="muestra">Por tamaño de muestra</option>
          </select>
        </div>

        <div className="situ-layout">
          <nav className="situ-index" aria-label="Índice de categorías">
            <p className="text-xs font-semibold text-muted">Ir a un marco</p>
            <ul>
              {frames.map((f) => (
                <li key={f.id}>
                  <button
                    type="button"
                    className="situ-index__link focus-ring"
                    onClick={() => {
                      centerOn(f.id);
                    }}
                  >
                    <span>{f.name}</span>
                    <span className="tabular text-muted">{f.cards.length}</span>
                  </button>
                </li>
              ))}
            </ul>
          </nav>

          <div
            ref={viewportRef}
            className="situ-viewport focus-ring"
            tabIndex={0}
            role="application"
            aria-roledescription="lienzo"
            aria-label="Lienzo de situaciones: arrastrá para moverte, Ctrl y rueda o pellizco para el zoom, flechas y + o − con el teclado"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            onKeyDown={onKeyDown}
          >
            <div ref={contentRef} className="situ-content">
              {frames.map((f, fi) => (
                <motion.section
                  key={f.id}
                  data-frame={f.id}
                  className="situ-frame"
                  aria-labelledby={`marco-${f.id}`}
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.35, delay: Math.min(fi, 10) * 0.04, ease: [0.16, 1, 0.3, 1] }}
                >
                  <header className="situ-frame__head">
                    <button
                      type="button"
                      className="icon-button focus-ring"
                      aria-expanded={!collapsed.has(f.id)}
                      title={collapsed.has(f.id) ? 'Expandir el marco' : 'Colapsar el marco'}
                      onClick={() => {
                        setCollapsed((s) => toggle(s, f.id));
                      }}
                    >
                      {collapsed.has(f.id) ? (
                        <CaretRightIcon size={14} aria-hidden="true" />
                      ) : (
                        <CaretDownIcon size={14} aria-hidden="true" />
                      )}
                      <span className="sr-only">{collapsed.has(f.id) ? 'Expandir' : 'Colapsar'}</span>
                    </button>
                    <h2 id={`marco-${f.id}`} className="text-lg font-extrabold">
                      {sort === 'categoria' ? `${f.id}. ` : ''}
                      {f.name}
                    </h2>
                    <span className="tabular text-sm text-muted">{f.cards.length} tarjetas</span>
                    {sort === 'categoria' ? (
                      <button
                        type="button"
                        className="icon-button focus-ring ml-auto"
                        aria-pressed={isolated === f.id}
                        title={isolated === f.id ? 'Mostrar todos los marcos' : 'Aislar este marco'}
                        onClick={() => {
                          setIsolated((v) => (v === f.id ? null : f.id));
                        }}
                      >
                        {isolated === f.id ? (
                          <ArrowsInIcon size={14} aria-hidden="true" />
                        ) : (
                          <CornersOutIcon size={14} aria-hidden="true" />
                        )}
                        <span className="sr-only">
                          {isolated === f.id ? 'Mostrar todos los marcos' : 'Aislar este marco'}
                        </span>
                      </button>
                    ) : null}
                  </header>
                  {!collapsed.has(f.id) ? (
                    <div className="situ-frame__grid">
                      {f.cards.map((c, ci) => (
                        <SituationCardView
                          key={c.id}
                          card={c}
                          matches={matches}
                          index={ci}
                          focused={focused === c.id}
                          onFocus={() => {
                            setFocused((v) => (v === c.id ? null : c.id));
                          }}
                        />
                      ))}
                    </div>
                  ) : null}
                </motion.section>
              ))}
              {frames.length === 0 ? <p className="text-muted">No hay tarjetas con estos filtros.</p> : null}
            </div>

            <div className="situ-controls" data-no-pan>
              <button
                type="button"
                className="icon-button focus-ring"
                title="Acercar"
                onClick={() => {
                  const el = viewportRef.current;
                  if (el) zoomAt(1.2, el.clientWidth / 2, el.clientHeight / 2);
                }}
              >
                <PlusIcon size={16} aria-hidden="true" />
                <span className="sr-only">Acercar</span>
              </button>
              <button
                type="button"
                className="icon-button focus-ring"
                title="Alejar"
                onClick={() => {
                  const el = viewportRef.current;
                  if (el) zoomAt(1 / 1.2, el.clientWidth / 2, el.clientHeight / 2);
                }}
              >
                <MinusIcon size={16} aria-hidden="true" />
                <span className="sr-only">Alejar</span>
              </button>
              <button type="button" className="icon-button focus-ring" title="Ajustar a pantalla" onClick={fit}>
                <ArrowsOutSimpleIcon size={16} aria-hidden="true" />
                <span className="sr-only">Ajustar a pantalla</span>
              </button>
              <span className="tabular text-xs text-muted">{Math.round(mini.k * 100)} %</span>
            </div>

            <button
              type="button"
              className="situ-minimap"
              data-no-pan
              aria-label="Minimapa: tocá un lugar para ir ahí"
              style={{ height: Math.max(60, size.h * miniScale) }}
              onClick={(e) => {
                const box = e.currentTarget.getBoundingClientRect();
                const cx = (e.clientX - box.left) / miniScale;
                const cy = (e.clientY - box.top) / miniScale;
                moveTo({
                  k: view.current.k,
                  x: mini.vw / 2 - cx * view.current.k,
                  y: mini.vh / 2 - cy * view.current.k,
                });
              }}
            >
              {rects.map((r) => (
                <span
                  key={r.id}
                  className="situ-minimap__frame"
                  style={{
                    left: r.x * miniScale,
                    top: r.y * miniScale,
                    width: r.w * miniScale,
                    height: r.h * miniScale,
                  }}
                />
              ))}
              <span
                className="situ-minimap__view"
                style={{
                  left: (-mini.x / mini.k) * miniScale,
                  top: (-mini.y / mini.k) * miniScale,
                  width: (mini.vw / mini.k) * miniScale,
                  height: (mini.vh / mini.k) * miniScale,
                }}
              />
            </button>
          </div>
        </div>
      </div>
    </MotionConfig>
  );
}

function SituationCardView({
  card,
  matches,
  index,
  focused,
  onFocus,
}: {
  card: SituationCard;
  matches: Record<number, SituationMatch>;
  index: number;
  focused: boolean;
  onFocus: () => void;
}) {
  const [openRow, setOpenRow] = useState<string | null>(null);
  const empty = !card.available || card.rows.length === 0;
  const opened = card.rows.find((r) => r.param === openRow);
  return (
    <motion.article
      className={`situ-card${empty ? ' situ-card--empty' : ''}${focused ? ' situ-card--focused' : ''}`}
      aria-labelledby={`tarjeta-${card.id}`}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: Math.min(index, 12) * 0.025, ease: [0.16, 1, 0.3, 1] }}
    >
      <header className="grid gap-1">
        <div className="flex items-start justify-between gap-2">
          <h3 id={`tarjeta-${card.id}`} className="text-base font-bold leading-snug">
            <button type="button" className="text-left focus-ring rounded" aria-expanded={focused} onClick={onFocus}>
              {card.title}
            </button>
          </h3>
          <span className="tabular text-xs text-muted">{card.id.slice(1)}</span>
        </div>
        <p className="text-xs text-muted">
          {card.condition}
          {card.measured !== 'Resultado del partido' ? ` · mide: ${card.measured.toLowerCase()}` : ''}
        </p>
        <div className="flex flex-wrap gap-1">
          <span className="level-badge" title={`Nivel ${card.level}`}>
            Nivel {card.level}
          </span>
          {card.estimated ? (
            <span className="level-badge" title="Usa un supuesto: es una estimación">
              Estimado
            </span>
          ) : null}
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
              open={openRow === r.param}
              big={focused}
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

function SituationRowView({
  row,
  open,
  big,
  onToggle,
}: {
  row: SituationRow;
  open: boolean;
  big: boolean;
  onToggle: () => void;
}) {
  const small = row.n < SMALL_SAMPLE;
  const better = row.delta > 0;
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
          <span className="tabular text-sm font-bold">{pct(row.winPct)}</span>
          <span
            className={`situ-delta tabular ${row.delta === 0 ? 'text-muted' : better ? 'value-best' : 'value-worst'}`}
            title="Diferencia de % de victorias contra la base de Boca, en puntos porcentuales"
          >
            {row.delta !== 0 ? (
              better ? (
                <ArrowUpIcon size={12} weight="bold" aria-hidden="true" />
              ) : (
                <ArrowDownIcon size={12} weight="bold" aria-hidden="true" />
              )
            ) : null}
            {signed(row.delta)} pp
          </span>
        </span>
        <span className="situ-row__line">
          <span className={`situ-bar${big ? ' situ-bar--big' : ''}`} aria-hidden="true">
            <motion.span
              className="situ-bar__fill"
              style={{ width: `${String(row.winPct)}%` }}
              initial={{ scaleX: 0 }}
              whileInView={{ scaleX: 1 }}
              viewport={{ once: true }}
              transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
            />
            <span className="situ-bar__base" style={{ left: `${String(row.base)}%` }} />
          </span>
          <span className="tabular text-xs text-muted">
            {row.n} PJ · {row.w}-{row.d}-{row.l} · {dec(row.ppg)} pts
          </span>
          {small ? <span className="situ-small">Muestra pequeña</span> : null}
        </span>
      </button>
    </li>
  );
}
