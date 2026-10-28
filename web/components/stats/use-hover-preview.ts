'use client';

// Vista previa de una columna al pasar el mouse por las tablas. Dos cuidados para que no
// parpadee: (1) espera un instante quieto sobre la columna antes de cambiar el panel y (2) el
// panel no se achica mientras se recorren columnas, así la tabla no se mueve debajo del mouse
// (si se movía, el mouse quedaba sobre otra celda y el panel cambiaba otra vez, en bucle).

import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';

const HOVER_DELAY_MS = 160;

export function useHoverPreview(): {
  preview: string | null;
  hover: (id: string | null) => void;
  focus: (id: string) => void;
} {
  const [preview, setPreview] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hover = useCallback((id: string | null) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      setPreview(id);
    }, HOVER_DELAY_MS);
  }, []);
  const focus = useCallback((id: string) => {
    if (timer.current) clearTimeout(timer.current);
    setPreview(id);
  }, []);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  return { preview, hover, focus };
}

/** El elemento solo crece de alto (vuelve a medir si cambia el ancho de la ventana). */
export function useGrowOnlyHeight(ref: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let max = 0;
    let width = window.innerWidth;
    const observer = new ResizeObserver(() => {
      if (window.innerWidth !== width) {
        width = window.innerWidth;
        max = 0;
        el.style.minHeight = '';
      }
      const h = el.getBoundingClientRect().height;
      if (h > max) {
        max = h;
        el.style.minHeight = `${String(Math.ceil(h))}px`;
      }
    });
    observer.observe(el);
    return () => {
      observer.disconnect();
    };
  }, [ref]);
}
