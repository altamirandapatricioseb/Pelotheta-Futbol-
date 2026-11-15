'use client';

// Tres verbos apilados a escala de pantalla: SCRAPEA / CALCULA / MUESTRA. Cada línea corre en x en
// sentido contrario a la vecina, ligada al scroll, con una copia en contorno verde que la persigue.

import { motion, useScroll, useSpring, useTransform } from 'motion/react';
import { useRef } from 'react';

const LINES = ['Scrapea', 'Calcula', 'Muestra'] as const;

export function Verbs() {
  const ref = useRef<HTMLElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start end', 'end start'] });
  const p = useSpring(scrollYProgress, { stiffness: 90, damping: 26, mass: 0.8 });
  const x0 = useTransform(p, [0, 1], ['-34vw', '8vw']);
  const x1 = useTransform(p, [0, 1], ['34vw', '-8vw']);
  const x2 = useTransform(p, [0, 1], ['-30vw', '10vw']);
  const xs = [x0, x1, x2];
  const ghost = useTransform(p, [0, 1], ['-0.9em', '0.5em']);

  return (
    <section ref={ref} className="show-verbs" aria-label="Qué hace el sistema">
      <div className="show-verbs__stage">
        {LINES.map((line, i) => (
          <motion.div key={line} className="show-verbs__line" style={{ x: xs[i] }}>
            <motion.span className="show-verbs__ghost" style={{ x: ghost }} aria-hidden="true">
              {line}
            </motion.span>
            <span>{line}</span>
          </motion.div>
        ))}
      </div>
    </section>
  );
}
