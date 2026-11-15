'use client';

// Carga de la portada: el logo se dibuja mientras un odómetro de tres cifras cuenta hasta 100; después
// el telón sube y deja ver el héroe. Dura 1,3 s y pasa siempre: la marca es lo primero que se ve.

import { animate, motion } from 'motion/react';
import { useEffect, useRef, useState } from 'react';

import { ThetaMark } from './theta-mark';

export const INTRO_MS = 1300;

export function IntroLoader({ onDone }: { onDone: () => void }) {
  const [gone, setGone] = useState(false);
  const digits = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const node = digits.current;
    const controls = animate(0, 100, {
      duration: INTRO_MS / 1000,
      ease: [0.65, 0, 0.35, 1],
      onUpdate: (v) => {
        if (node) node.textContent = String(Math.round(v)).padStart(3, '0');
      },
    });
    const t = window.setTimeout(() => {
      setGone(true);
      onDone();
    }, INTRO_MS);
    return () => {
      controls.stop();
      window.clearTimeout(t);
    };
  }, [onDone]);

  return (
    <motion.div
      className="show-intro"
      initial={false}
      animate={gone ? { y: '-100%' } : { y: '0%' }}
      transition={{ duration: 0.75, ease: [0.76, 0, 0.24, 1] }}
      onAnimationComplete={() => {
        if (gone) document.querySelector('.show-intro')?.remove();
      }}
      aria-hidden="true"
    >
      <ThetaMark draw className="show-intro__mark" />
      <span ref={digits} className="show-intro__count tabular">
        000
      </span>
    </motion.div>
  );
}
