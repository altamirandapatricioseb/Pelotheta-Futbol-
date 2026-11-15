'use client';

// Portada del sistema. Una escena tras otra, casi sin texto: PELOTHETA llena la pantalla sobre el
// campo de remates que arma la Θ, tres verbos a escala de pantalla, el camino del dato contado
// mientras una pelota lo recorre, las seis interfaces con gráficos generados, Sudamérica punteada
// como selector y un pie completo. Sin header: la marca es lo primero. Por pedido del dueño, acá no
// hay versión con menos movimiento.

import { motion, MotionConfig, useScroll, useSpring, useTransform } from 'motion/react';
import Link from 'next/link';
import { useCallback, useRef, useState } from 'react';

import { ThemeToggle } from '@/components/header/theme-toggle';
import { SYSTEM_NAME } from '@/config/brand';
import { INTERFACES } from '@/config/navigation';
import { COUNTRIES, countryAvailable } from '@/config/teams';
import type { ShowcaseData } from '@/lib/data/showcase';

import { Cursor } from './cursor';
import { FlowStory } from './flow-story';
import { Gallery } from './gallery';
import { ShotField } from './shot-field';
import { SouthAmerica } from './south-america';
import { ThetaMark } from './theta-mark';
import { Verbs } from './verbs';
import { Wordmark } from './wordmark';

const EASE = [0.16, 1, 0.3, 1] as const;
const SOURCES = ['Promiedos (estadísticas de Opta)', 'StrikerAPI', 'ScoutingStats', 'Statshub'];

export function ShowcaseLanding({ shots }: ShowcaseData) {
  // Héroe: 220 vh de recorrido con la escena pegada. El canvas sigue al scroll con inercia.
  const heroRef = useRef<HTMLDivElement>(null);
  const { scrollYProgress: hero } = useScroll({ target: heroRef, offset: ['start start', 'end end'] });
  const heroSmooth = useSpring(hero, { stiffness: 110, damping: 26, mass: 0.7 });
  const tagOpacity = useTransform(hero, [0, 0.35], [1, 0]);
  const tagY = useTransform(hero, [0, 0.35], [0, -30]);

  // Mapa: termina de imprimirse cuando la sección llega arriba; sirve pegada y apilada.
  const mapRef = useRef<HTMLElement>(null);
  const { scrollYProgress: mapRaw } = useScroll({ target: mapRef, offset: ['start 85%', 'start 0%'] });
  const map = useSpring(mapRaw, { stiffness: 80, damping: 24 });
  const [hot, setHot] = useState<string | null>(null);
  const onHover = useCallback((slug: string | null) => {
    setHot(slug);
  }, []);

  return (
    <MotionConfig reducedMotion="never">
      <div className="show-root">
        <Cursor />

        <div ref={heroRef} className="show-hero show-bleed">
          <div className="show-hero__stage">
            <ShotField shots={shots} progress={heroSmooth} className="show-hero__canvas" />
            <div className="show-hero__word">
              <Wordmark progress={hero} ready />
            </div>
            <motion.p
              className="show-hero__tag show-lede"
              style={{ opacity: tagOpacity, y: tagY }}
              initial={{ opacity: 0, y: 24 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.9, ease: EASE, delay: 0.8 }}
            >
              Sistema de análisis de datos de fútbol.
            </motion.p>
          </div>
        </div>

        <Verbs />
        <FlowStory />
        <Gallery />

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

        <footer className="show-foot show-bleed">
          <div className="show-foot__inner">
            <div className="show-foot__brand">
              <ThetaMark className="show-foot__mark" />
              <p className="show-foot__name">{SYSTEM_NAME}</p>
              <p className="show-foot__desc">
                Sistema de análisis de datos de fútbol: estadísticas, métricas propias y comparaciones, equipo por
                equipo.
              </p>
              <div className="show-foot__actions">
                <Link href="/elegir" className="show-button focus-ring" data-cursor="Ir">
                  Elegir equipo
                </Link>
                <ThemeToggle />
              </div>
            </div>
            <nav aria-label="Interfaces" className="show-foot__col">
              <h3>Interfaces</h3>
              <ul>
                {INTERFACES.map((item) => (
                  <li key={item.href}>
                    <Link href={item.href} className="focus-ring">
                      {item.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
            <nav aria-label="Sistema" className="show-foot__col">
              <h3>Sistema</h3>
              <ul>
                <li>
                  <Link href="/api-docs" className="focus-ring">
                    API pública
                  </Link>
                </li>
                <li>
                  <Link href="/estado" className="focus-ring">
                    Estado
                  </Link>
                </li>
                <li>
                  <Link href="/soporte" className="focus-ring">
                    Soporte
                  </Link>
                </li>
                <li>
                  <Link href="/privacidad" className="focus-ring">
                    Privacidad
                  </Link>
                </li>
              </ul>
            </nav>
            <div className="show-foot__col">
              <h3>Fuentes</h3>
              <ul>
                {SOURCES.map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ul>
            </div>
          </div>
          <p className="show-foot__legal">
            Proyecto de portfolio sin fines comerciales. Datos de partidos: Promiedos (estadísticas de Opta). Las
            interfaces se publican por etapas. Hecho en Argentina.
          </p>
        </footer>
      </div>
    </MotionConfig>
  );
}
