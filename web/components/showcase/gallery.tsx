'use client';

// Las seis interfaces como galería horizontal pegada al scroll: cada pantalla es un gráfico generado
// que se destapa con una máscara, con el nombre de la interfaz detrás, enorme. En el celular la
// galería se apila y cada pantalla se destapa al entrar.

import { motion, type MotionValue, useScroll, useSpring, useTransform } from 'motion/react';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';

import { INTERFACES, type InterfaceLink } from '@/config/navigation';

import { Poster } from './posters';
import { useWide } from './use-wide';

function Slide({
  item,
  index,
  track,
  wide,
}: {
  item: InterfaceLink;
  index: number;
  track: MotionValue<number>;
  wide: boolean;
}) {
  // Progreso local: 0 cuando la pantalla entra por la derecha, 0,5 centrada, 1 cuando sale.
  const n = INTERFACES.length;
  const local = useTransform(track, [(index - 1) / (n - 1), (index + 1) / (n - 1)], [0, 1]);
  const clip = useTransform(local, [0.1, 0.5], ['inset(12% 40% 12% 40% round 24px)', 'inset(0% 0% 0% 0% round 24px)']);
  const imgY = useTransform(local, [0, 1], ['-6%', '6%']);
  const wordX = useTransform(local, [0, 1], ['18vw', '-18vw']);
  return (
    <li className="show-slide">
      <motion.span className="show-slide__word" aria-hidden="true" style={wide ? { x: wordX } : undefined}>
        {item.label}
      </motion.span>
      <Link href={item.href} className="show-slide__link focus-ring" data-cursor="Entrar">
        {wide ? (
          <motion.figure key="wide" className="show-slide__frame" style={{ clipPath: clip }}>
            <motion.span className="show-slide__img" style={{ y: imgY }}>
              <Poster icon={item.icon} />
            </motion.span>
            <figcaption>
              <span className="show-slide__index tabular">{String(index + 1).padStart(2, '0')}</span>
              <span className="show-slide__name">{item.label}</span>
            </figcaption>
          </motion.figure>
        ) : (
          <motion.figure
            key="stacked"
            className="show-slide__frame"
            initial={{ clipPath: 'inset(10% 30% 10% 30% round 24px)' }}
            whileInView={{ clipPath: 'inset(0% 0% 0% 0% round 24px)' }}
            viewport={{ once: true, margin: '-15% 0px' }}
            transition={{ duration: 0.9, ease: [0.65, 0, 0.35, 1] }}
          >
            <span className="show-slide__img">
              <Poster icon={item.icon} />
            </span>
            <figcaption>
              <span className="show-slide__index tabular">{String(index + 1).padStart(2, '0')}</span>
              <span className="show-slide__name">{item.label}</span>
            </figcaption>
          </motion.figure>
        )}
      </Link>
    </li>
  );
}

export function Gallery() {
  const wide = useWide();
  const wrap = useRef<HTMLElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const [shift, setShift] = useState(0);
  useEffect(() => {
    const w = wrap.current;
    const l = list.current;
    if (!w || !l) return;
    const measure = () => {
      setShift(Math.max(0, l.scrollWidth - w.clientWidth));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(w);
    ro.observe(l);
    return () => {
      ro.disconnect();
    };
  }, [wide]);
  const { scrollYProgress } = useScroll({ target: wrap, offset: ['start start', 'end end'] });
  const smooth = useSpring(scrollYProgress, { stiffness: 90, damping: 26 });
  const x = useTransform(smooth, (v) => (wide ? -v * shift : 0));

  return (
    <section ref={wrap} className="show-gallery" aria-label="Las seis interfaces">
      <div className="show-gallery__stage">
        <motion.ul ref={list} className="show-gallery__track" style={{ x }}>
          {INTERFACES.map((item, i) => (
            <Slide key={item.href} item={item} index={i} track={smooth} wide={wide} />
          ))}
        </motion.ul>
      </div>
    </section>
  );
}
