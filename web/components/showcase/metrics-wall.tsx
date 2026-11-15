'use client';

// Las métricas propias del sistema (las de docs/metricas_propias.md) en tres cintas de tipografía
// enorme que corren en sentidos opuestos. La velocidad se suma a la del scroll: si scrolleás rápido,
// las cintas aceleran; si frenás, vuelven a su paso. Sin texto corrido: los nombres son el visual.

import {
  motion,
  useAnimationFrame,
  useInView,
  useMotionValue,
  useScroll,
  useSpring,
  useTransform,
  useVelocity,
} from 'motion/react';
import { useRef } from 'react';

import { AnimatedNumber } from '@/components/animated-number';

const ROWS = [
  ['Elo', 'Probabilidad previa', 'Sorpresa', 'Brier', 'xPts', 'Puntos − xPts', 'Pitagórico', 'Rachas'],
  [
    'Forma',
    'Consistencia',
    'Rotación',
    'Estabilidad del once',
    'Concentración de goles',
    'Puntos por tercio',
    'NR',
    'NR relativo',
  ],
  ['EWA', 'ELA', 'NR con xG', 'Índice de rendimiento', 'Mejoría α', 'Mejoría β', 'Potencial α', 'Potencial β'],
] as const;
const TOTAL = ROWS.reduce((a, r) => a + r.length, 0);
const int = (v: number) => String(Math.round(v));

function Row({
  names,
  direction,
  boost,
}: {
  names: readonly string[];
  direction: 1 | -1;
  boost: ReturnType<typeof useSpring>;
}) {
  // Posición en porcentaje del ancho de una copia (la cinta lleva dos copias seguidas).
  const pos = useMotionValue(0);
  useAnimationFrame((_, delta) => {
    const speed = 2.2 + Math.abs(boost.get()) * 0.006;
    pos.set((pos.get() + (speed * delta) / 1000) % 50);
  });
  const x = useTransform(pos, (v) => `${String(direction === 1 ? -v : v - 50)}%`);
  return (
    <div className="show-wall__row" aria-hidden="true">
      <motion.div className="show-wall__track" style={{ x }}>
        {[...names, ...names].map((n, i) => (
          <span key={i} data-fill={i % 3 === 0 || undefined}>
            {n}
          </span>
        ))}
      </motion.div>
    </div>
  );
}

export function MetricsWall() {
  const ref = useRef<HTMLElement>(null);
  const seen = useInView(ref, { once: true, margin: '-20% 0px' });
  const { scrollY } = useScroll();
  const velocity = useVelocity(scrollY);
  const boost = useSpring(velocity, { stiffness: 300, damping: 60 });

  return (
    <section ref={ref} className="show-wall show-bleed" aria-labelledby="wall-title">
      <h2 id="wall-title" className="show-wall__title">
        <AnimatedNumber value={seen ? TOTAL : 0} format={int} className="show-wall__count tabular" />
        <span>métricas propias, calculadas en cada corrida.</span>
      </h2>
      {ROWS.map((names, i) => (
        <Row key={i} names={names} direction={i % 2 === 0 ? 1 : -1} boost={boost} />
      ))}
      <ul className="sr-only">
        {ROWS.flat().map((n) => (
          <li key={n}>{n}</li>
        ))}
      </ul>
    </section>
  );
}
