'use client';

// El camino del dato en un solo SVG: cuatro fuentes entran por la izquierda, se juntan en el
// pipeline, atraviesan las cinco métricas propias y terminan en Supabase y en la web. Las líneas
// se trazan con el scroll, los nodos se encienden cuando la línea los alcanza y hay puntos que
// viajan por los caminos (animateMotion nativo, sin JavaScript por cuadro).

import { motion, type MotionValue, useScroll, useTransform } from 'motion/react';
import { useRef } from 'react';

const SOURCES = ['Promiedos · Opta', 'StrikerAPI', 'ScoutingStats', 'Statshub'];
const METRICS = ['Elo', 'Pitagórico', 'xPts', 'Mejoría α β', 'Proyección'];
const SOURCE_Y = [70, 150, 230, 310];
const PIPE = { x: 420, y: 190 };
const METRIC_X = [560, 680, 800, 920, 1040];
const DB = { x: 1180, y: 190 };

const sourcePath = (y: number) =>
  `M120 ${String(y)} C 260 ${String(y)}, 300 ${String(PIPE.y)}, ${String(PIPE.x - 40)} ${String(PIPE.y)}`;
const TRUNK = `M${String(PIPE.x + 40)} ${String(PIPE.y)} H ${String(DB.x - 44)}`;

function Node({
  x,
  y,
  label,
  at,
  progress,
  big = false,
}: {
  x: number;
  y: number;
  label: string;
  at: number;
  progress: MotionValue<number>;
  big?: boolean;
}) {
  const scale = useTransform(progress, [at - 0.04, at + 0.03], [0.6, 1]);
  const opacity = useTransform(progress, [at - 0.04, at + 0.02], [0, 1]);
  return (
    <motion.g style={{ scale, opacity, transformOrigin: `${String(x)}px ${String(y)}px` }}>
      <circle cx={x} cy={y} r={big ? 40 : 7} className={big ? 'show-flow__hub' : 'show-flow__dot'} />
      <text
        x={x}
        y={big ? y + 5 : y + 30}
        textAnchor="middle"
        className={big ? 'show-flow__hub-label' : 'show-flow__label'}
      >
        {label}
      </text>
    </motion.g>
  );
}

export function FlowDiagram() {
  const ref = useRef<HTMLElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start 85%', 'end 55%'] });
  const sources = useTransform(scrollYProgress, [0.05, 0.4], [0, 1]);
  const trunk = useTransform(scrollYProgress, [0.42, 0.9], [0, 1]);

  return (
    <section ref={ref} className="show-flow" aria-label="De las fuentes a la web">
      <svg
        viewBox="0 0 1280 400"
        className="show-flow__svg"
        role="img"
        aria-label="Cuatro fuentes entran a un pipeline, salen cinco métricas propias y terminan en Supabase y la web"
      >
        {SOURCE_Y.map((y, i) => (
          <g key={y}>
            <path d={sourcePath(y)} className="show-flow__rail" />
            <motion.path d={sourcePath(y)} className="show-flow__ink" style={{ pathLength: sources }} />
            <circle r="4" className="show-flow__spark">
              <animateMotion
                dur={`${String(3.2 + i * 0.5)}s`}
                begin={`${String(i * 0.6)}s`}
                repeatCount="indefinite"
                path={sourcePath(y)}
              />
            </circle>
            <Node x={120} y={y} label={SOURCES[i] ?? ''} at={0.05 + i * 0.03} progress={scrollYProgress} />
          </g>
        ))}
        <path d={TRUNK} className="show-flow__rail" />
        <motion.path d={TRUNK} className="show-flow__ink" style={{ pathLength: trunk }} />
        <circle r="4" className="show-flow__spark">
          <animateMotion dur="4s" begin="1s" repeatCount="indefinite" path={TRUNK} />
        </circle>
        <Node x={PIPE.x} y={PIPE.y} label="pipeline" at={0.42} progress={scrollYProgress} big />
        {METRIC_X.map((x, i) => (
          <Node key={x} x={x} y={PIPE.y} label={METRICS[i] ?? ''} at={0.5 + i * 0.075} progress={scrollYProgress} />
        ))}
        <Node x={DB.x} y={DB.y} label="Supabase" at={0.92} progress={scrollYProgress} big />
      </svg>
      <ul className="show-flow__legend">
        <li>Cuatro fuentes</li>
        <li>Un pipeline en Python</li>
        <li>Cinco métricas propias</li>
        <li>Postgres con API pública</li>
      </ul>
    </section>
  );
}
