'use client';

// Número que cuenta hasta su valor (9.10). Adaptado de «Contador Animado» (skiper37) de
// Skiper UI (https://skiper-ui.com/v1/skiper37, @gurvinder-singh02): misma idea de easing,
// reescrito con `animate` de motion y sin dependencias extra.

import { animate } from 'motion/react';
import { useEffect, useRef } from 'react';

interface AnimatedNumberProps {
  value: number;
  format: (value: number) => string;
  className?: string;
}

export function AnimatedNumber({ value, format, className }: AnimatedNumberProps) {
  const ref = useRef<HTMLSpanElement>(null);
  const from = useRef(0);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      node.textContent = format(value);
      from.current = value;
      return;
    }
    const controls = animate(from.current, value, {
      duration: 0.7,
      ease: [0.16, 1, 0.3, 1],
      onUpdate: (latest) => {
        node.textContent = format(latest);
      },
    });
    from.current = value;
    return () => {
      controls.stop();
    };
  }, [value, format]);

  // El texto inicial ya es el valor final: si la animación no corre, se ve el dato correcto.
  return (
    <span ref={ref} className={className}>
      {format(value)}
    </span>
  );
}
