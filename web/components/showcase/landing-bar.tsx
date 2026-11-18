'use client';

// Acciones flotantes de la portada y el selector: elegir equipo y el tema. En la portada aparecen
// recién después de un poco de scroll, para que lo primero sea solo el nombre; en el selector, desde
// el inicio y con un enlace de vuelta a la portada. Sin marca: no es un header. En el celular se
// esconde al bajar y vuelve al subir: fija arriba tapaba la pizarra y el diagrama mientras se leía.

import { motion, useMotionValueEvent, useScroll } from 'motion/react';
import Link from 'next/link';
import { useRef, useState } from 'react';

import { ThemeToggle } from '@/components/header/theme-toggle';

import { useWide } from './use-wide';

export function LandingBar({ afterScroll = false, back = false }: { afterScroll?: boolean; back?: boolean }) {
  const { scrollY } = useScroll();
  const [shown, setShown] = useState(!afterScroll);
  const wide = useWide();
  const last = useRef(0);
  useMotionValueEvent(scrollY, 'change', (y) => {
    const delta = y - last.current;
    if (Math.abs(delta) < 6) return; // el rebote del dedo no la hace parpadear
    last.current = y;
    // Aparece después de la primera pantalla y se va al llegar al pie, que trae las mismas acciones.
    const end = document.documentElement.scrollHeight - window.innerHeight * 1.5;
    const inRange = !afterScroll || (y > window.innerHeight * 0.5 && y < end);
    setShown(inRange && (wide || delta < 0 || y < 40));
  });

  return (
    <motion.div
      className="show-bar"
      initial={false}
      animate={{ y: shown ? 0 : -24, opacity: shown ? 1 : 0 }}
      transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
      style={{ pointerEvents: shown ? 'auto' : 'none' }}
      aria-hidden={!shown}
    >
      {back ? (
        <Link href="/" className="show-bar__back focus-ring" tabIndex={shown ? 0 : -1}>
          Portada
        </Link>
      ) : (
        <span />
      )}
      <div className="show-bar__end">
        <Link href="/elegir" className="show-button focus-ring" data-cursor="Ir" tabIndex={shown ? 0 : -1}>
          Elegir equipo
        </Link>
        <ThemeToggle />
      </div>
    </motion.div>
  );
}
