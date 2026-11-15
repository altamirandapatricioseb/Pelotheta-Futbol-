'use client';

// El logo de Pelotheta como SVG animable: anillo (círculo central), barra interior (no toca el anillo,
// como en la letra theta) y los
// cuatro gajos de la pelota. Mismas formas que public/brand/pelotheta-futbol.svg, en currentColor.

import { motion, type Variants } from 'motion/react';

const EASE = [0.16, 1, 0.3, 1] as const;

const RING: Variants = {
  hidden: { pathLength: 0, opacity: 0 },
  show: { pathLength: 1, opacity: 1, transition: { duration: 0.9, ease: EASE } },
};
const BAR: Variants = {
  hidden: { scaleX: 0 },
  show: { scaleX: 1, transition: { duration: 0.5, ease: EASE, delay: 0.45 } },
};
const PANEL: Variants = {
  hidden: { scale: 0.3, opacity: 0 },
  show: (i: number) => ({
    scale: 1,
    opacity: 1,
    transition: { type: 'spring', stiffness: 320, damping: 22, delay: 0.55 + i * 0.07 },
  }),
};

const PANELS = [
  'M27 12.5H37L40.5 16.5 36.5 20.5H27.5L23.5 16.5Z',
  'M13 27 13.5 23 16 19.5 21.5 20.5 25 24 23.5 27Z',
  'M51 27 50.5 23 48 19.5 42.5 20.5 39 24 40.5 27Z',
  'M27 37.5H37L40 44 36 50.5H28L24 44Z',
];

interface ThetaMarkProps {
  className?: string;
  /** Con `draw`, las partes entran en secuencia (loader y cierre); sin él, el logo ya está dibujado. */
  draw?: boolean;
}

export function ThetaMark({ className, draw = false }: ThetaMarkProps) {
  return (
    <motion.svg
      viewBox="0 0 64 64"
      className={className}
      aria-hidden="true"
      initial={draw ? 'hidden' : false}
      animate="show"
      style={{ overflow: 'visible' }}
    >
      {PANELS.map((d, i) => (
        <motion.path
          key={d}
          d={d}
          fill="currentColor"
          variants={PANEL}
          custom={i}
          style={{ transformOrigin: '32px 32px' }}
        />
      ))}
      <motion.rect
        x="19"
        y="29"
        width="26"
        height="6"
        rx="3"
        fill="currentColor"
        variants={BAR}
        style={{ transformOrigin: '32px 32px' }}
      />
      <motion.circle
        cx="32"
        cy="32"
        r="26"
        fill="none"
        stroke="currentColor"
        strokeWidth="7"
        strokeLinecap="round"
        variants={RING}
        style={{ rotate: -90, transformOrigin: '32px 32px' }}
      />
    </motion.svg>
  );
}
