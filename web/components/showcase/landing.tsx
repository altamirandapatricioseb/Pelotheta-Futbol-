'use client';

// Portada del sistema. Una escena tras otra, casi sin texto: el logo se dibuja, PELOTHETA llena la
// pantalla sobre el campo de remates que arma la Θ, tres verbos a escala de pantalla, el camino del
// dato trazado por el scroll, las seis interfaces en capturas reales, tres zooms apilados,
// Sudamérica punteada como selector y el nombre cortado al pie. Sin header: la marca es lo primero.
// Por pedido del dueño, acá no hay versión con menos movimiento.

import { motion, MotionConfig, useInView, useMotionValue, useScroll, useSpring, useTransform } from 'motion/react';
import Link from 'next/link';
import { useCallback, useRef, useState } from 'react';

import { COUNTRIES, countryAvailable } from '@/config/teams';
import type { ShowcaseData } from '@/lib/data/showcase';

import { Cursor } from './cursor';
import { FlowDiagram } from './flow-diagram';
import { Gallery } from './gallery';
import { IntroLoader } from './intro-loader';
import { ShotField } from './shot-field';
import { SouthAmerica } from './south-america';
import { StackCards } from './stack-cards';
import { Verbs } from './verbs';
import { Wordmark } from './wordmark';

const EASE = [0.16, 1, 0.3, 1] as const;

export function ShowcaseLanding({ shots }: ShowcaseData) {
  const [ready, setReady] = useState(false);
  const onIntroDone = useCallback(() => {
    setReady(true);
  }, []);

  // Héroe: 220 vh de recorrido con la escena pegada. El canvas sigue al scroll con inercia.
  const heroRef = useRef<HTMLDivElement>(null);
  const { scrollYProgress: hero } = useScroll({ target: heroRef, offset: ['start start', 'end end'] });
  const heroSmooth = useSpring(hero, { stiffness: 110, damping: 26, mass: 0.7 });
  const tagOpacity = useTransform(hero, [0, 0.35], [1, 0]);
  const tagY = useTransform(hero, [0, 0.35], [0, -30]);

  // Mapa: 250 vh con la escena pegada; los puntos vuelan a su lugar en la primera mitad.
  const mapRef = useRef<HTMLElement>(null);
  // Termina de imprimirse cuando la sección llega arriba: sirve pegada (escritorio) y apilada (celular).
  const { scrollYProgress: mapRaw } = useScroll({ target: mapRef, offset: ['start 85%', 'start 0%'] });
  const map = useSpring(mapRaw, { stiffness: 80, damping: 24 });
  const [hot, setHot] = useState<string | null>(null);
  const onHover = useCallback((slug: string | null) => {
    setHot(slug);
  }, []);

  // Pie: el nombre vuelve a subir, cortado al borde inferior.
  const footRef = useRef<HTMLElement>(null);
  const footIn = useInView(footRef, { once: true, margin: '-20% 0px' });
  const zero = useMotionValue(0);

  return (
    <MotionConfig reducedMotion="never">
      <div className="show-root">
        <Cursor />
        <IntroLoader onDone={onIntroDone} />

        <div ref={heroRef} className="show-hero show-bleed">
          <div className="show-hero__stage">
            <ShotField shots={shots} progress={heroSmooth} className="show-hero__canvas" />
            <div className="show-hero__word">
              <Wordmark progress={hero} ready={ready} />
            </div>
            <motion.div
              className="show-hero__tag"
              style={{ opacity: tagOpacity, y: tagY }}
              initial={{ opacity: 0, y: 24 }}
              animate={ready ? { opacity: 1, y: 0 } : undefined}
              transition={{ duration: 0.9, ease: EASE, delay: 0.7 }}
            >
              <p className="show-lede">Sistema de análisis de datos de fútbol.</p>
            </motion.div>
          </div>
        </div>

        <Verbs />
        <FlowDiagram />
        <Gallery />
        <StackCards />

        <section ref={mapRef} className="show-map show-bleed" aria-labelledby="map-title">
          <div className="show-map__stage">
            <div className="show-map__copy">
              <h2 id="map-title" className="show-title">
                Diez países. Elegí país, categoría y equipo.
              </h2>
              <ul
                className="show-map__list"
                onPointerLeave={() => {
                  onHover(null);
                }}
              >
                {COUNTRIES.map((c) => {
                  const on = countryAvailable(c);
                  return (
                    <li key={c.slug} data-hot={hot === c.slug || undefined} data-on={on || undefined}>
                      {on ? (
                        <Link
                          href={`/elegir?pais=${c.slug}`}
                          className="focus-ring"
                          data-cursor="Entrar"
                          onPointerEnter={() => {
                            onHover(c.slug);
                          }}
                        >
                          {c.name}
                          <small>con datos</small>
                        </Link>
                      ) : (
                        <span
                          onPointerEnter={() => {
                            onHover(c.slug);
                          }}
                        >
                          {c.name}
                        </span>
                      )}
                    </li>
                  );
                })}
              </ul>
              <Link href="/elegir" className="show-button focus-ring" data-cursor="Ir">
                Empezar
              </Link>
            </div>
            <SouthAmerica progress={map} className="show-map__canvas" onHover={onHover} hovered={hot} />
          </div>
        </section>

        <footer ref={footRef} className="show-foot">
          <nav aria-label="Pie de la portada" className="show-foot__links">
            <Link href="/elegir" className="focus-ring">
              Elegir equipo
            </Link>
            <Link href="/api-docs" className="focus-ring">
              API
            </Link>
            <Link href="/estado" className="focus-ring">
              Estado
            </Link>
            <Link href="/privacidad" className="focus-ring">
              Privacidad
            </Link>
            <Link href="/soporte" className="focus-ring">
              Soporte
            </Link>
          </nav>
          <div className="show-foot__word" aria-hidden="true">
            <Wordmark progress={zero} ready={footIn} heading={false} />
          </div>
        </footer>
      </div>
    </MotionConfig>
  );
}
