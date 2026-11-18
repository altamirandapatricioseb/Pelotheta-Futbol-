'use client';

// El camino del dato, contado mientras pasa: la sección queda pegada durante 320 vh. A la derecha el
// diagrama se traza con el scroll (fuentes → pipeline → familias de métricas → Supabase) y una pelota recorre el
// camino; a la izquierda, el párrafo de cada etapa aparece justo cuando la pelota llega. En el
// celular no hay pegado: el diagrama va vertical (de arriba hacia abajo, legible a 375 px) y se
// traza mientras cruza la pantalla; los párrafos van debajo.

import { motion, type MotionValue, useMotionValueEvent, useScroll, useSpring, useTransform } from 'motion/react';
import { useRef } from 'react';

import { FAMILIES } from './metric-families';
import { useWide } from './use-wide';

type Pt = readonly [number, number];
interface Layout {
  view: string;
  vertical: boolean;
  labels: readonly string[];
  sources: readonly Pt[];
  pipe: Pt;
  families: readonly Pt[];
  db: Pt;
}

const WIDE: Layout = {
  view: '0 0 1280 420',
  vertical: false,
  labels: ['Promiedos · Opta', 'StrikerAPI', 'ScoutingStats', 'Statshub', 'transfermarkt-datasets'],
  sources: [40, 115, 190, 265, 340].map((y) => [120, y] as const),
  pipe: [420, 190],
  families: FAMILIES.map((_, i) => [525 + i * 105, 190] as const),
  db: [1180, 190],
};
const TALL: Layout = {
  view: '-20 0 440 940',
  vertical: true,
  labels: ['Promiedos', 'StrikerAPI', 'Scouting', 'Statshub', 'Transfermarkt'],
  sources: [40, 120, 200, 280, 360].map((x) => [x, 70] as const),
  pipe: [200, 250],
  families: FAMILIES.map((_, i) => [200, 365 + i * 80] as const),
  db: [200, 860],
};

const n = (v: number) => String(v);
// Curva de una fuente al pipeline: sale derecho y entra derecho, en la dirección del diagrama.
const sourcePath = ({ vertical, pipe: [px, py] }: Layout, [x, y]: Pt) =>
  vertical
    ? `M${n(x)} ${n(y)} C ${n(x)} ${n(y + 90)}, ${n(px)} ${n(py - 110)}, ${n(px)} ${n(py - 40)}`
    : `M${n(x)} ${n(y)} C ${n(x + 140)} ${n(y)}, ${n(x + 180)} ${n(py)}, ${n(px - 40)} ${n(py)}`;
const trunkEnd = ({ vertical, db: [dx, dy] }: Layout) => (vertical ? ` V ${n(dy - 44)}` : ` H ${n(dx - 44)}`);
const trunk = (l: Layout) =>
  `M${n(l.pipe[0] + (l.vertical ? 0 : 40))} ${n(l.pipe[1] + (l.vertical ? 40 : 0))}${trunkEnd(l)}`;
// La pelota viaja por la segunda fuente, cruza el pipeline y sigue por el tronco hasta la base.
const ballPath = (l: Layout) => `${sourcePath(l, l.sources[1] ?? [0, 0])}${trunkEnd(l)}`;

// Etapas: desde qué progreso se enciende cada una y qué cuenta.
export const STEPS = [
  {
    at: 0.06,
    title: 'Cinco fuentes',
    text: 'Entran las estadísticas de Opta que publica Promiedos, los remates con posición y xG de StrikerAPI, los perfiles de ScoutingStats, las fichas de Statshub y los valores de mercado abiertos de transfermarkt-datasets. Cada fuente se baja con una pausa entre pedidos y respetando su robots.txt.',
  },
  {
    at: 0.3,
    title: 'Un pipeline en Python',
    text: 'Limpia, cruza y valida todo: unifica nombres de jugadores y clubes entre fuentes, detecta lo que falta y entrena tres modelos: valor de mercado, alternativas y predictor de partidos.',
  },
  {
    at: 0.5,
    title: 'Veinticuatro métricas propias',
    text: 'En seis familias. Del equipo: fuerza, rendimiento esperado, estado de forma y armado del once. De cada jugador: su impacto con él en cancha, y la Mejoría y el Potencial.',
  },
  {
    at: 0.8,
    title: 'Postgres con API pública',
    text: 'Todo se guarda en Supabase con seguridad por filas en cada tabla y una API documentada. La web lee de ahí con una caché de seis horas y un botón para actualizar.',
  },
] as const;

function Node({
  x,
  y,
  label,
  at,
  progress,
  big = false,
  count,
  lx = x,
  ly = y + 44,
  anchor = 'middle',
}: {
  x: number;
  y: number;
  label: string;
  at: number;
  progress: MotionValue<number>;
  big?: boolean;
  /** Número dentro del punto (cuántas métricas tiene la familia). */
  count?: number;
  /** Posición y alineación de la etiqueta (por defecto, centrada abajo del punto). */
  lx?: number;
  ly?: number;
  anchor?: 'start' | 'middle' | 'end';
}) {
  const scale = useTransform(progress, [at - 0.03, at + 0.03], [0.5, 1]);
  const opacity = useTransform(progress, [at - 0.03, at + 0.02], [0, 1]);
  return (
    <motion.g style={{ scale, opacity, transformOrigin: `${String(x)}px ${String(y)}px` }}>
      <circle
        cx={x}
        cy={y}
        r={big ? 40 : count === undefined ? 8 : 17}
        className={big ? 'show-flow__hub' : 'show-flow__dot'}
      />
      {count !== undefined && (
        <text x={x} y={y + 6} textAnchor="middle" className="show-flow__count">
          {count}
        </text>
      )}
      <text
        x={big ? x : lx}
        y={big ? y + 5 : ly}
        textAnchor={big ? 'middle' : anchor}
        className={big ? 'show-flow__hub-label' : 'show-flow__label'}
      >
        {label}
      </text>
    </motion.g>
  );
}

interface StepProps {
  index: number;
  at: number;
  /** Progreso en el que empieza la etapa siguiente (acá esta se apaga). */
  until: number;
  title: string;
  text: string;
  progress: MotionValue<number>;
}

function Step({ index, at, until, title, text, progress }: StepProps) {
  const opacity = useTransform(progress, [at - 0.02, at + 0.04, until - 0.06, until - 0.02], [0, 1, 1, 0]);
  const y = useTransform(progress, [at - 0.02, at + 0.04], [24, 0]);
  return (
    <motion.div className="show-story__step" style={{ opacity, y }} aria-hidden="true">
      <span className="show-story__num tabular">{String(index + 1).padStart(2, '0')}</span>
      <h3>{title}</h3>
      <p>{text}</p>
    </motion.div>
  );
}

export function FlowStory() {
  const ref = useRef<HTMLElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const wide = useWide();
  const l = wide ? WIDE : TALL;
  // Escritorio: el progreso de la sección pegada. Celular: el del diagrama mientras cruza la pantalla
  // (la sección no se pega, así que su propio progreso se recorría en pocos píxeles).
  const { scrollYProgress: pinned } = useScroll({ target: ref, offset: ['start start', 'end end'] });
  const { scrollYProgress: passing } = useScroll({
    // motion mide el elemento con getBoundingClientRect, que un SVG también tiene; el tipo pide HTML.
    target: svgRef as unknown as React.RefObject<HTMLElement>,
    offset: ['start 85%', 'end 60%'],
  });
  const progress = useSpring(wide ? pinned : passing, { stiffness: 120, damping: 28, mass: 0.6 });
  const sources = useTransform(progress, [0.04, 0.28], [0, 1]);
  const trunkDraw = useTransform(progress, [0.32, 0.8], [0, 1]);
  const ballRef = useRef<SVGCircleElement>(null);
  const pathRef = useRef<SVGPathElement>(null);

  // La pelota: posición sobre el camino según el progreso, sin re-render.
  useMotionValueEvent(progress, 'change', (p) => {
    const path = pathRef.current;
    const ball = ballRef.current;
    if (!path || !ball) return;
    const len = path.getTotalLength();
    const k = Math.min(1, Math.max(0, (p - 0.04) / 0.78));
    const pt = path.getPointAtLength(len * k);
    ball.setAttribute('cx', String(pt.x));
    ball.setAttribute('cy', String(pt.y));
    ball.setAttribute('opacity', k > 0 && k < 1 ? '1' : '0');
  });

  return (
    <section ref={ref} className="show-story show-bleed" aria-label="De las fuentes a la web">
      <div className="show-story__stage">
        <div className="show-story__text">
          <h2 className="show-title">De la cancha a la pantalla.</h2>
          <div className="show-story__steps">
            {STEPS.map((s, i) => (
              <Step
                key={s.title}
                index={i}
                at={s.at}
                until={STEPS[i + 1]?.at ?? 1.2}
                title={s.title}
                text={s.text}
                progress={progress}
              />
            ))}
          </div>
          {/* Para lectores de pantalla y para el celular, el texto completo en orden. */}
          <ol className="show-story__plain">
            {STEPS.map((s) => (
              <li key={s.title}>
                <h3>{s.title}</h3>
                <p>{s.text}</p>
              </li>
            ))}
          </ol>
        </div>
        <svg
          ref={svgRef}
          viewBox={l.view}
          className="show-flow__svg"
          data-vertical={l.vertical || undefined}
          role="img"
          aria-label="Cinco fuentes entran a un pipeline, salen seis familias de métricas propias y terminan en Supabase"
        >
          <path ref={pathRef} d={ballPath(l)} fill="none" stroke="none" />
          {l.sources.map((pt, i) => {
            const [x, y] = pt;
            return (
              <g key={i}>
                <path d={sourcePath(l, pt)} className="show-flow__rail" />
                <motion.path d={sourcePath(l, pt)} className="show-flow__ink" style={{ pathLength: sources }} />
                <Node
                  x={x}
                  y={y}
                  label={l.labels[i] ?? ''}
                  at={0.06 + i * 0.03}
                  progress={progress}
                  // Escritorio: abajo del punto. Celular: arriba y abajo alternados, para no pisarse.
                  ly={l.vertical && i % 2 === 0 ? y - 24 : y + 40}
                />
              </g>
            );
          })}
          <path d={trunk(l)} className="show-flow__rail" />
          <motion.path d={trunk(l)} className="show-flow__ink" style={{ pathLength: trunkDraw }} />
          <Node x={l.pipe[0]} y={l.pipe[1]} label="pipeline" at={0.3} progress={progress} big />
          {FAMILIES.map((family, i) => {
            const [x, y] = l.families[i] ?? [0, 0];
            const odd = i % 2 === 1;
            return (
              <Node
                key={family.slug}
                x={x}
                y={y}
                label={family.name}
                count={family.metrics.length}
                at={0.44 + i * 0.06}
                progress={progress}
                // Escritorio: abajo y arriba alternados. Celular: a la derecha y a la izquierda.
                lx={l.vertical ? (odd ? x - 30 : x + 30) : x}
                ly={l.vertical ? y + 6 : odd ? y - 30 : y + 44}
                anchor={l.vertical ? (odd ? 'end' : 'start') : 'middle'}
              />
            );
          })}
          <Node x={l.db[0]} y={l.db[1]} label="Supabase" at={0.8} progress={progress} big />
          <circle ref={ballRef} r="11" className="show-flow__ball" opacity="0" />
        </svg>
      </div>
    </section>
  );
}
