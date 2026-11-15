'use client';

// El camino del dato, contado mientras pasa: la sección queda pegada durante 320 vh. A la derecha el
// diagrama se traza con el scroll (fuentes → pipeline → familias de métricas → Supabase) y una pelota recorre el
// camino; a la izquierda, el párrafo de cada etapa aparece justo cuando la pelota llega. En el
// celular no hay pegado: el diagrama arriba y los párrafos abajo, uno por uno al entrar.

import { motion, type MotionValue, useMotionValueEvent, useScroll, useSpring, useTransform } from 'motion/react';
import { useRef } from 'react';

import { FAMILIES } from './metric-families';

const SOURCES = ['Promiedos · Opta', 'StrikerAPI', 'ScoutingStats', 'Statshub'];
const SOURCE_Y = [70, 150, 230, 310];
const PIPE = { x: 420, y: 190 };
// Un nodo por familia de métricas: el número adentro es cuántas tiene (suman las 24).
const FAMILY_X = FAMILIES.map((_, i) => 525 + i * 105);
const DB = { x: 1180, y: 190 };

const sourcePath = (y: number) =>
  `M120 ${String(y)} C 260 ${String(y)}, 300 ${String(PIPE.y)}, ${String(PIPE.x - 40)} ${String(PIPE.y)}`;
// La pelota viaja por la tercera fuente, cruza el pipeline y sigue por el tronco hasta la base.
const BALL_PATH = `M120 ${String(SOURCE_Y[1] ?? 150)} C 260 ${String(SOURCE_Y[1] ?? 150)}, 300 ${String(PIPE.y)}, ${String(PIPE.x - 40)} ${String(PIPE.y)} H ${String(DB.x - 44)}`;
const TRUNK = `M${String(PIPE.x + 40)} ${String(PIPE.y)} H ${String(DB.x - 44)}`;

// Etapas: desde qué progreso se enciende cada una y qué cuenta.
export const STEPS = [
  {
    at: 0.06,
    title: 'Cuatro fuentes',
    text: 'Entran las estadísticas de Opta que publica Promiedos, los remates con posición y xG de StrikerAPI, los perfiles de ScoutingStats y las fichas de Statshub. Cada fuente se baja con una pausa entre pedidos y respetando su robots.txt.',
  },
  {
    at: 0.3,
    title: 'Un pipeline en Python',
    text: 'Limpia, cruza y valida todo: unifica nombres de jugadores y rivales, detecta lo que falta y deja cada partido con sus valores base y sus métricas calculadas.',
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
  above = false,
}: {
  x: number;
  y: number;
  label: string;
  at: number;
  progress: MotionValue<number>;
  big?: boolean;
  /** Número dentro del punto (cuántas métricas tiene la familia). */
  count?: number;
  /** Etiqueta arriba del punto en vez de abajo, para que las vecinas no se pisen. */
  above?: boolean;
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
        x={x}
        y={big ? y + 5 : above ? y - 30 : y + 44}
        textAnchor="middle"
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
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start start', 'end end'] });
  const progress = useSpring(scrollYProgress, { stiffness: 120, damping: 28, mass: 0.6 });
  const sources = useTransform(progress, [0.04, 0.28], [0, 1]);
  const trunk = useTransform(progress, [0.32, 0.8], [0, 1]);
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
          viewBox="0 0 1280 400"
          className="show-flow__svg"
          role="img"
          aria-label="Cuatro fuentes entran a un pipeline, salen seis familias de métricas propias y terminan en Supabase"
        >
          <path ref={pathRef} d={BALL_PATH} fill="none" stroke="none" />
          {SOURCE_Y.map((y, i) => (
            <g key={y}>
              <path d={sourcePath(y)} className="show-flow__rail" />
              <motion.path d={sourcePath(y)} className="show-flow__ink" style={{ pathLength: sources }} />
              <Node x={120} y={y} label={SOURCES[i] ?? ''} at={0.06 + i * 0.03} progress={progress} />
            </g>
          ))}
          <path d={TRUNK} className="show-flow__rail" />
          <motion.path d={TRUNK} className="show-flow__ink" style={{ pathLength: trunk }} />
          <Node x={PIPE.x} y={PIPE.y} label="pipeline" at={0.3} progress={progress} big />
          {FAMILIES.map((family, i) => (
            <Node
              key={family.slug}
              x={FAMILY_X[i] ?? 0}
              y={PIPE.y}
              label={family.name}
              count={family.metrics.length}
              above={i % 2 === 1}
              at={0.44 + i * 0.06}
              progress={progress}
            />
          ))}
          <Node x={DB.x} y={DB.y} label="Supabase" at={0.8} progress={progress} big />
          <circle ref={ballRef} r="11" className="show-flow__ball" opacity="0" />
        </svg>
      </div>
    </section>
  );
}
