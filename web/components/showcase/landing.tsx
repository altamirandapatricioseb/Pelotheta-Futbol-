'use client';

// Portada del sistema: una sola escena que se transforma con el scroll (los remates arman la Θ),
// cuatro números, las seis interfaces en una fila ligada al scroll, el camino del dato y la
// invitación a elegir equipo. Todo lo que se mueve lo hace con transform y opacity.

import { motion, stagger, useInView, useReducedMotion, useScroll, useSpring, useTransform } from 'motion/react';
import Link from 'next/link';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { MotionValue, Variants } from 'motion/react';

import { AnimatedNumber } from '@/components/animated-number';
import { INTERFACES } from '@/config/navigation';
import { COUNTRIES, countryAvailable } from '@/config/teams';
import type { ShowcaseData } from '@/lib/data/showcase';

import { InterfaceCard, LIST_VARIANTS } from './interface-cards';
import { ShotField } from './shot-field';

const EASE = [0.16, 1, 0.3, 1] as const;
const INT = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 });
const int = (v: number) => INT.format(v);

const WIDE = '(min-width: 860px)';
const subscribe = (cb: () => void) => {
  const mq = window.matchMedia(WIDE);
  mq.addEventListener('change', cb);
  return () => {
    mq.removeEventListener('change', cb);
  };
};
/** true desde 860 px: la fila de interfaces se desplaza con el scroll; abajo de eso, se apila. */
const useWide = () =>
  useSyncExternalStore(
    subscribe,
    () => window.matchMedia(WIDE).matches,
    () => false,
  );

const TITLE_VARIANTS: Variants = {
  hidden: {},
  show: { transition: { delayChildren: stagger(0.06, { startDelay: 0.15 }) } },
};
const WORD_VARIANTS: Variants = {
  hidden: { y: '110%' },
  show: { y: '0%', transition: { duration: 0.9, ease: EASE } },
};
const FADE_UP: Variants = {
  hidden: { opacity: 0, y: 24 },
  show: { opacity: 1, y: 0, transition: { duration: 0.8, ease: EASE } },
};
const STATS_VARIANTS: Variants = {
  hidden: {},
  show: { transition: { delayChildren: stagger(0.08, { from: 'center' }) } },
};

/** Título partido en palabras: cada una sube desde abajo de su propia máscara. */
function Words({ text }: { text: string }) {
  return (
    <>
      {text.split(' ').map((w, i) => (
        <span key={i}>
          <span className="show-word">
            <motion.span variants={WORD_VARIANTS}>{w}</motion.span>
          </span>{' '}
        </span>
      ))}
    </>
  );
}

const FLOW = [
  {
    title: 'Promiedos',
    text: 'Las estadísticas de Opta de cada partido, bajadas con respeto al robots.txt y con una pausa entre pedidos.',
  },
  {
    title: 'Pipeline en Python',
    text: 'Limpia, cruza cuatro fuentes y calcula las métricas propias: Elo, pitagórico, xPts, mejoría α y β.',
  },
  {
    title: 'Supabase',
    text: 'Una base Postgres de solo lectura, con RLS en cada tabla y una API pública documentada.',
  },
  { title: 'Esta web', text: 'Next.js, gráficos en SVG dibujados a mano y una caché de datos de seis horas.' },
] as const;

function FlowStep({
  index,
  progress,
  title,
  text,
}: {
  index: number;
  progress: MotionValue<number>;
  title: string;
  text: string;
}) {
  const start = index * 0.24;
  const opacity = useTransform(progress, [start, start + 0.18], [0, 1]);
  const y = useTransform(progress, [start, start + 0.18], [18, 0]);
  return (
    <motion.li className="show-flow__step" style={{ opacity, y }}>
      <h3>{title}</h3>
      <p>{text}</p>
    </motion.li>
  );
}

export function ShowcaseLanding({ matches, goals, charts, shots }: ShowcaseData) {
  const reduced = useReducedMotion();
  const wide = useWide();

  // Héroe: 200 vh de recorrido, escena pegada. El progreso pasa por un resorte para que el
  // canvas siga al scroll con inercia (el modo «smooth» de onScroll en Anime.js).
  const heroRef = useRef<HTMLDivElement>(null);
  const { scrollYProgress: heroRaw } = useScroll({ target: heroRef, offset: ['start start', 'end end'] });
  const heroSmooth = useSpring(heroRaw, { stiffness: 110, damping: 26, mass: 0.7 });
  const hero = reduced ? heroRaw : heroSmooth;
  const cueOpacity = useTransform(heroRaw, [0, 0.12], [1, 0]);
  const copyY = useTransform(heroRaw, [0, 1], [0, reduced ? 0 : -48]);
  const captionOpacity = useTransform(heroRaw, [0.68, 0.92], [0, 1]);
  const captionY = useTransform(heroRaw, [0.68, 0.92], [reduced ? 0 : 14, 0]);

  // Números: cuentan la primera vez que entran en pantalla.
  const statsRef = useRef<HTMLUListElement>(null);
  const statsIn = useInView(statsRef, { once: true, margin: '-15% 0px' });

  // Interfaces: la fila se desplaza en x lo que sobra del ancho de la pantalla.
  const trackWrap = useRef<HTMLElement>(null);
  const track = useRef<HTMLUListElement>(null);
  const [shift, setShift] = useState(0);
  useEffect(() => {
    const wrap = trackWrap.current;
    const list = track.current;
    if (!wrap || !list) return;
    const measure = () => {
      setShift(Math.max(0, list.scrollWidth - wrap.clientWidth + wrap.clientWidth * 0.06));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(wrap);
    ro.observe(list);
    return () => {
      ro.disconnect();
    };
  }, [wide]);
  const { scrollYProgress: trackRaw } = useScroll({ target: trackWrap, offset: ['start start', 'end end'] });
  const trackX = useTransform(trackRaw, (v) => (wide ? -v * shift : 0));

  // Camino del dato: la línea se traza con el scroll y cada parada aparece cuando la línea pasa.
  const flowRef = useRef<HTMLElement>(null);
  const { scrollYProgress: flow } = useScroll({ target: flowRef, offset: ['start 78%', 'end 60%'] });

  const stats = [
    { label: 'partidos oficiales', value: matches },
    { label: 'goles a favor', value: goals },
    { label: 'remates con posición', value: shots.length },
    { label: 'gráficos', value: charts },
  ];

  return (
    <div className="show-root">
      <div ref={heroRef} className="show-hero show-bleed">
        <div className="show-hero__stage">
          <ShotField shots={shots} progress={hero} className="show-hero__canvas" />
          <motion.div
            className="show-hero__copy"
            style={{ y: copyY }}
            initial="hidden"
            animate="show"
            variants={TITLE_VARIANTS}
          >
            <h1 className="show-display">
              <Words text="Cada remate, en su lugar." />
            </h1>
            <motion.p className="show-lede" variants={FADE_UP}>
              {int(matches)} partidos, {int(goals)} goles y {int(charts)} gráficos de Boca Juniors 2026, medidos partido
              a partido. Elegí tu equipo y entrá a los datos.
            </motion.p>
            <motion.div className="show-actions" variants={FADE_UP}>
              <Link href="/elegir" className="show-button focus-ring">
                Elegir equipo
              </Link>
              <Link href="/graficos" className="show-button show-button--ghost focus-ring">
                Ver los gráficos
              </Link>
            </motion.div>
          </motion.div>
          <motion.p className="show-caption" style={{ opacity: captionOpacity, y: captionY }} aria-hidden="true">
            Pelotheta Θ
          </motion.p>
          <motion.p className="show-cue" style={{ opacity: cueOpacity }} aria-hidden="true">
            Deslizá
          </motion.p>
        </div>
      </div>

      <section aria-label="La temporada en números">
        <motion.ul
          ref={statsRef}
          className="show-stats"
          variants={STATS_VARIANTS}
          initial="hidden"
          animate={statsIn ? 'show' : 'hidden'}
        >
          {stats.map((s) => (
            <motion.li key={s.label} className="show-stat" variants={FADE_UP}>
              <AnimatedNumber value={statsIn ? s.value : 0} format={int} className="show-stat__value tabular" />
              <span className="show-stat__label">{s.label}</span>
            </motion.li>
          ))}
        </motion.ul>
      </section>

      <section ref={trackWrap} className="show-interfaces" aria-labelledby="interfaces-title">
        <div className="show-interfaces__stage">
          <motion.h2
            id="interfaces-title"
            className="show-title"
            initial={{ opacity: 0, y: 24 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-10% 0px' }}
            transition={{ duration: 0.8, ease: EASE }}
          >
            Seis puertas a los mismos datos.
          </motion.h2>
          <motion.ul
            ref={track}
            className="show-track"
            style={{ x: trackX }}
            variants={LIST_VARIANTS}
            initial="hidden"
            whileInView="show"
            viewport={{ once: true, margin: '-10% 0px' }}
          >
            {INTERFACES.map((item) => (
              <InterfaceCard key={item.href} item={item} />
            ))}
          </motion.ul>
        </div>
      </section>

      <section ref={flowRef} className="show-flow" aria-labelledby="flow-title">
        <h2 id="flow-title" className="show-title">
          De la cancha a la pantalla.
        </h2>
        <svg className="show-flow__line" viewBox="0 0 1200 24" preserveAspectRatio="none" aria-hidden="true">
          <path d="M0 12 H1200" className="show-flow__rail" />
          <motion.path d="M0 12 H1200" className="show-flow__ink" style={{ pathLength: flow }} />
        </svg>
        <ol className="show-flow__steps">
          {FLOW.map((f, i) => (
            <FlowStep key={f.title} index={i} progress={flow} title={f.title} text={f.text} />
          ))}
        </ol>
      </section>

      <section className="show-cta" aria-labelledby="cta-title">
        <h2 id="cta-title" className="show-display">
          Elegí tu equipo.
        </h2>
        <p className="show-lede">
          Hoy, Boca Juniors. El resto de los países de la Libertadores aparece en el selector y se habilita cuando
          entren sus datos.
        </p>
        <div className="show-actions">
          <Link href="/elegir" className="show-button focus-ring">
            Empezar
          </Link>
        </div>
        <div className="show-marquee" aria-hidden="true">
          <div className="show-marquee__track">
            {[...COUNTRIES, ...COUNTRIES].map((c, i) => (
              <span key={i} data-on={countryAvailable(c) || undefined}>
                {c.name}
              </span>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
