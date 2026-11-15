'use client';

// Cursor propio de la portada (solo con mouse o trackpad): un punto que sigue al puntero con un
// resorte y un anillo que llega un poco después. Sobre un enlace el anillo crece y, si el enlace
// trae data-cursor, muestra esa palabra adentro.

import { motion, useMotionValue, useSpring } from 'motion/react';
import { useEffect, useState } from 'react';

import { useFinePointer } from './use-wide';

export function Cursor() {
  const fine = useFinePointer();
  const x = useMotionValue(-100);
  const y = useMotionValue(-100);
  const dot = { x: useSpring(x, { stiffness: 600, damping: 40 }), y: useSpring(y, { stiffness: 600, damping: 40 }) };
  const ring = { x: useSpring(x, { stiffness: 180, damping: 22 }), y: useSpring(y, { stiffness: 180, damping: 22 }) };
  const [label, setLabel] = useState<string | null>(null);
  const [over, setOver] = useState(false);

  useEffect(() => {
    if (!fine) return;
    const move = (e: PointerEvent) => {
      x.set(e.clientX);
      y.set(e.clientY);
      const target = (e.target as Element | null)?.closest<HTMLElement>('a, button, [data-cursor]');
      setOver(Boolean(target));
      setLabel(target?.dataset.cursor ?? null);
    };
    window.addEventListener('pointermove', move, { passive: true });
    document.documentElement.dataset.showCursor = '';
    return () => {
      window.removeEventListener('pointermove', move);
      delete document.documentElement.dataset.showCursor;
    };
  }, [fine, x, y]);

  if (!fine) return null;
  return (
    <>
      <motion.div className="show-cursor__dot" style={{ x: dot.x, y: dot.y }} aria-hidden="true" />
      <motion.div
        className="show-cursor__ring"
        style={{ x: ring.x, y: ring.y }}
        animate={{ scale: label ? 2.6 : over ? 1.7 : 1 }}
        transition={{ type: 'spring', stiffness: 260, damping: 20 }}
        aria-hidden="true"
      >
        {label ? <span>{label}</span> : null}
      </motion.div>
    </>
  );
}
