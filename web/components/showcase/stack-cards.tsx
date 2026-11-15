'use client';

// Tres zooms del producto apilados: cada tarjeta se pega arriba y la anterior se achica y se apaga
// debajo. Adentro, un recorte ampliado de la captura que se desplaza despacio con el scroll.

import { motion, type MotionValue, useScroll, useTransform } from 'motion/react';
import { useRef } from 'react';

import type { InterfaceLink } from '@/config/navigation';

import { Shot } from './gallery';

interface Card {
  icon: InterfaceLink['icon'];
  title: string;
  /** Punto de la captura que queda en el centro del recorte (object-position). */
  focus: string;
}

const CARDS: Card[] = [
  { icon: 'jugadores', title: 'Plantel con percentiles', focus: '50% 38%' },
  { icon: 'comparar', title: 'Jugador frente a jugador', focus: '50% 45%' },
  { icon: 'situaciones', title: 'Cien situaciones de partido', focus: '40% 30%' },
];

function StackCard({ card, index, progress }: { card: Card; index: number; progress: MotionValue<number> }) {
  const n = CARDS.length;
  const start = index / n;
  const end = (index + 1) / n;
  // Cuando entra la tarjeta siguiente, esta retrocede.
  const scale = useTransform(progress, [end, Math.min(1, end + 1 / n)], [1, 0.9]);
  const opacity = useTransform(progress, [end, Math.min(1, end + 1 / n)], [1, 0.45]);
  const y = useTransform(progress, [start, end], ['0%', '-8%']);
  return (
    <motion.li className="show-stack__card" style={{ scale, opacity }}>
      <h3 className="show-stack__title">
        <span className="tabular">{String(index + 1).padStart(2, '0')}</span>
        {card.title}
      </h3>
      <div className="show-stack__media">
        <motion.span className="show-stack__img" style={{ y, objectPosition: card.focus }}>
          <Shot icon={card.icon} />
        </motion.span>
      </div>
    </motion.li>
  );
}

export function StackCards() {
  const ref = useRef<HTMLElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start start', 'end end'] });
  return (
    <section ref={ref} className="show-stack" aria-label="De cerca">
      <ul>
        {CARDS.map((c, i) => (
          <StackCard key={c.icon} card={c} index={i} progress={scrollYProgress} />
        ))}
      </ul>
    </section>
  );
}
