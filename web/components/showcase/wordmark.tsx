'use client';

// PELOTHETA a todo el ancho de la pantalla, con el logo como última letra. El tamaño se calcula
// midiendo la palabra: siempre llena exactamente el ancho disponible. Cada letra sube desde su
// propia máscara y, con el scroll, se separa de las demás (paralaje por letra).

import { motion, type MotionValue, stagger, useTransform, type Variants } from 'motion/react';
import { useLayoutEffect, useRef } from 'react';

import { ThetaMark } from './theta-mark';

const LETTERS = 'PELOTHETA'.split('');
const EASE = [0.16, 1, 0.3, 1] as const;

const WORD: Variants = {
  hidden: {},
  show: { transition: { delayChildren: stagger(0.045, { startDelay: 0.05 }) } },
};
const LETTER: Variants = {
  hidden: { y: '115%', rotate: 6 },
  show: { y: '0%', rotate: 0, transition: { duration: 0.95, ease: EASE } },
};
const MARK: Variants = {
  hidden: { rotate: -120, scale: 0.4, opacity: 0 },
  show: { rotate: 0, scale: 1, opacity: 1, transition: { type: 'spring', stiffness: 220, damping: 20, delay: 0.5 } },
};

// Desplazamiento de cada letra con el scroll: alternado y creciente hacia los bordes.
const DRIFT = [-140, 90, -60, 120, -170, 70, -110, 140, -80, 60];

function Letter({ ch, index, progress }: { ch: string; index: number; progress: MotionValue<number> }) {
  const y = useTransform(progress, [0, 1], [0, DRIFT[index] ?? 0]);
  return (
    <motion.span className="show-word__mask" style={{ y }}>
      <motion.span className="show-word__letter" variants={LETTER}>
        {ch}
      </motion.span>
    </motion.span>
  );
}

interface WordmarkProps {
  /** Progreso del héroe (0 arriba, 1 al final del recorrido). */
  progress: MotionValue<number>;
  ready: boolean;
  /** El del héroe es el h1 de la página; el del pie, un párrafo. */
  heading?: boolean;
}

export function Wordmark({ progress, ready, heading = true }: WordmarkProps) {
  const Tag = heading ? motion.h1 : motion.p;
  const box = useRef<HTMLDivElement>(null);
  const word = useRef<HTMLHeadingElement>(null);
  const markRotate = useTransform(progress, [0, 1], [0, 180]);
  const markY = useTransform(progress, [0, 1], [0, -40]);

  useLayoutEffect(() => {
    const b = box.current;
    const w = word.current;
    if (!b || !w) return;
    const fit = () => {
      // Se mide a 100px y se escala: la palabra ocupa el ancho del contenedor menos un respiro.
      w.style.fontSize = '100px';
      const natural = w.getBoundingClientRect().width;
      w.style.fontSize = `${String(natural ? ((b.clientWidth - 24) / natural) * 100 : 100)}px`;
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(b);
    return () => {
      ro.disconnect();
    };
  }, []);

  return (
    <div ref={box} className="show-word">
      <Tag ref={word} className="show-word__text" variants={WORD} initial="hidden" animate={ready ? 'show' : 'hidden'}>
        {LETTERS.map((ch, i) => (
          <Letter key={i} ch={ch} index={i} progress={progress} />
        ))}
        <motion.span className="show-word__mask" style={{ rotate: markRotate, y: markY }}>
          <motion.span className="show-word__letter show-word__mark" variants={MARK}>
            <ThetaMark />
            <span className="sr-only">Θ</span>
          </motion.span>
        </motion.span>
      </Tag>
    </div>
  );
}
