'use client';

// Las 24 métricas propias, todas a la vista: una tabla de seis columnas (una por familia) con silueta
// 4-4-3-3-5-5. El hueco del medio es el círculo central de la cancha, que con la línea media dibuja
// la Θ. Con el scroll, las celdas salen de la pelota parada en el centro hasta su casillero, el aro se
// entinta y el número cuenta las que ya llegaron; al volver hacia arriba, todo se repliega. Nada se
// mueve solo. En el celular no hay pegado: cada familia se arma al entrar.

import { cubicBezier, motion, type MotionValue, useScroll, useSpring, useTransform } from 'motion/react';
import { useRef } from 'react';

import { FAMILIES, type Metric, type MetricFamily, METRIC_TOTAL } from './metric-families';
import { useWide } from './use-wide';

// Progreso (0 a 1) de la sección: se pega cerca de 0,24 y ahí empieza el reparto.
const START = 0.24;
const FAMILY_STEP = 0.06;
const CELL_STEP = 0.014;
const DUR = 0.1;
const EASE = cubicBezier(0.16, 1, 0.3, 1);
const cellStart = (family: number, index: number) => START + family * FAMILY_STEP + index * CELL_STEP;
// Orden global (0 a 23) de la primera métrica de cada familia.
const FIRST = FAMILIES.map((_, f) => FAMILIES.slice(0, f).reduce((n, family) => n + family.metrics.length, 0));
// Momento en que cada celda termina de llegar: de acá sale el contador.
const LANDS = FAMILIES.flatMap((family, f) => family.metrics.map((_, i) => cellStart(f, i) + DUR));
const END = Math.max(...LANDS);
const pad = (n: number) => String(n).padStart(2, '0');

interface CellProps {
  metric: Metric;
  order: number;
  col: number;
  row: number;
  start: number;
  dur: number;
  progress: MotionValue<number>;
  wide: boolean;
}

function Cell({ metric, order, col, row, start, dur, progress, wide }: CellProps) {
  const t = useTransform(progress, [start, start + dur], [0, 1], { ease: EASE });
  // En escritorio la celda sale del centro de la Θ (columna 3, fila 4 de la grilla), en porcentaje de
  // su propio tamaño; en el celular solo sube unos píxeles.
  const x = useTransform(t, (v) => (wide ? `${String((1 - v) * (2.5 - col) * 100)}%` : '0%'));
  const y = useTransform(t, (v) => (wide ? `${String((1 - v) * (3.5 - row) * 100)}%` : `${String((1 - v) * 20)}px`));
  const scale = useTransform(t, [0, 1], [wide ? 0.3 : 0.92, 1]);
  const rotate = useTransform(t, [0, 1], [wide ? (order % 2 === 0 ? -8 : 8) : 0, 0]);
  const opacity = useTransform(t, [0, 0.5], [0, 1]);
  return (
    <motion.li className="show-wall__cell" style={{ x, y, scale, rotate, opacity }}>
      <div className="show-wall__face">
        <span className="show-wall__sym" aria-hidden="true">
          {metric.symbol}
        </span>
        <span className="show-wall__num tabular" aria-hidden="true">
          {pad(order + 1)}
        </span>
        <span className="show-wall__name">{metric.name}</span>
      </div>
    </motion.li>
  );
}

interface GroupProps {
  family: MetricFamily;
  index: number;
  section: MotionValue<number>;
  wide: boolean;
}

function Group({ family, index, section, wide }: GroupProps) {
  const ref = useRef<HTMLLIElement>(null);
  const { scrollYProgress: enter } = useScroll({ target: ref, offset: ['start 92%', 'start 50%'] });
  const progress = useTransform(() => (wide ? section.get() : enter.get()));
  const headAt = wide ? 0.08 + index * 0.02 : 0;
  const headEnd = headAt + (wide ? 0.08 : 0.2);
  const headOpacity = useTransform(progress, [headAt, headEnd], [0, 1]);
  const headY = useTransform(progress, [headAt, headEnd], [12, 0]);
  return (
    <li ref={ref} className="show-wall__group" data-scope={family.scope}>
      <motion.h3 className="show-wall__fam" style={{ opacity: headOpacity, y: headY }}>
        <span className="show-wall__idx tabular" aria-hidden="true">
          {pad(index + 1)}
        </span>
        {family.name}
        <span className="sr-only">, métricas de {family.scope === 'Equipo' ? 'equipo' : 'jugador'}</span>
      </motion.h3>
      <ul className="show-wall__cells">
        {family.metrics.map((metric, i) => (
          <Cell
            key={metric.name}
            metric={metric}
            order={(FIRST[index] ?? 0) + i}
            col={index}
            row={i}
            start={wide ? cellStart(index, i) : i * 0.12}
            dur={wide ? DUR : 0.4}
            progress={progress}
            wide={wide}
          />
        ))}
      </ul>
    </li>
  );
}

export function MetricsWall() {
  const ref = useRef<HTMLElement>(null);
  const wide = useWide();
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start 50%', 'end end'] });
  const { scrollYProgress: enter } = useScroll({ target: ref, offset: ['start 85%', 'start 35%'] });
  const p = useSpring(scrollYProgress, { stiffness: 120, damping: 28, mass: 0.6 });

  // El número cuenta las celdas que ya están en su lugar, así que baja al volver hacia arriba.
  const count = useTransform(() =>
    String(wide ? LANDS.filter((at) => p.get() >= at).length : Math.round(enter.get() * METRIC_TOTAL)),
  );
  const frame = useTransform(p, [0.04, 0.2], [0, 1]);
  const mid = useTransform(p, [0.04, 0.22], [0, 1]);
  const ink = useTransform(p, [START, END], [0, 1]);
  const bar = useTransform(p, [END, END + 0.08], [0, 1]);
  const ball = useTransform(p, [0.14, 0.22, END, END + 0.06], [0, 1, 1, 0]);
  const pulse = useTransform(p, [END, END + 0.04, END + 0.08], [1, 1.06, 1]);

  return (
    <section ref={ref} className="show-wall show-bleed" aria-labelledby="wall-title">
      <div className="show-wall__stage">
        <h2 id="wall-title" className="show-wall__head">
          <motion.span className="show-wall__count tabular" aria-hidden="true">
            {count}
          </motion.span>
          <span className="sr-only">{METRIC_TOTAL}</span>
          <span className="show-wall__title">métricas propias, calculadas en cada corrida.</span>
        </h2>
        <div className="show-wall__board">
          <motion.div className="show-wall__mid" style={{ scaleX: mid }} aria-hidden="true" />
          <motion.div className="show-wall__theta" style={{ scale: pulse }} aria-hidden="true">
            <svg viewBox="0 0 200 200">
              <motion.circle cx="100" cy="100" r="78" className="show-wall__rail" style={{ pathLength: frame }} />
              <g transform="rotate(-90 100 100)">
                <motion.circle cx="100" cy="100" r="78" className="show-wall__ink" style={{ pathLength: ink }} />
              </g>
              <motion.line
                x1="56"
                x2="144"
                y1="100"
                y2="100"
                className="show-wall__bar"
                style={{ scaleX: bar, transformOrigin: '100px 100px' }}
              />
              <motion.circle
                cx="100"
                cy="100"
                r="11"
                className="show-flow__ball"
                style={{ scale: ball, transformOrigin: '100px 100px' }}
              />
            </svg>
          </motion.div>
          <p className="show-wall__legend" aria-hidden="true">
            <span data-scope="Equipo">Del equipo</span>
            <span data-scope="Jugador">De cada jugador</span>
          </p>
          <ol className="show-wall__groups">
            {FAMILIES.map((family, i) => (
              <Group key={family.slug} family={family} index={i} section={p} wide={wide} />
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
}
