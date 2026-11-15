'use client';

// Acciones flotantes de la portada y el selector: elegir equipo y el tema. En la portada aparecen
// recién después de un poco de scroll, para que lo primero sea solo el nombre; en el selector, desde
// el inicio y con un enlace de vuelta a la portada. Sin marca: no es un header.

import { motion, useMotionValueEvent, useScroll } from 'motion/react';
import Link from 'next/link';
import { useState } from 'react';

import { ThemeToggle } from '@/components/header/theme-toggle';

export function LandingBar({ afterScroll = false, back = false }: { afterScroll?: boolean; back?: boolean }) {
  const { scrollY } = useScroll();
  const [shown, setShown] = useState(!afterScroll);
  useMotionValueEvent(scrollY, 'change', (y) => {
    // Aparece después de la primera pantalla y se va al llegar al pie, que trae las mismas acciones.
    if (afterScroll) {
      const end = document.documentElement.scrollHeight - window.innerHeight * 1.5;
      setShown(y > window.innerHeight * 0.5 && y < end);
    }
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
