'use client';

// Selector de equipo en tres pantallas: país, categoría y equipo. Cada paso es una URL
// (/elegir?pais=…&categoria=…&equipo=…), así que el botón «atrás» funciona y se puede compartir.
// Lo que no tiene datos se ve pero no se puede elegir. Al final, todas las interfaces.

import { AnimatePresence, motion, MotionConfig, stagger, type Variants } from 'motion/react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect } from 'react';

import { TEAM_NAME, TEAM_PHOTO_SRC } from '@/config/brand';
import { categoryAvailable, countryAvailable, resolveChoice, type Category, type Country } from '@/config/teams';

import { TEAM_COOKIE } from '@/lib/team-cookie';

import { InterfaceGrid } from './interface-cards';

const EASE = [0.16, 1, 0.3, 1] as const;

// La pantalla entra destapándose desde arriba (máscara) y las fichas suben escalonadas.
const SCREEN: Variants = {
  hidden: { clipPath: 'inset(0 0 100% 0)', y: 24 },
  show: {
    clipPath: 'inset(0 0 0% 0)',
    y: 0,
    transition: { duration: 0.7, ease: EASE, delayChildren: stagger(0.045, { startDelay: 0.1 }) },
  },
  exit: { opacity: 0, y: -24, transition: { duration: 0.3, ease: 'easeIn' } },
};
const TILE: Variants = {
  hidden: { opacity: 0, y: 28 },
  show: { opacity: 1, y: 0, transition: { duration: 0.7, ease: EASE } },
};

interface TileProps {
  name: string;
  meta: string;
  href: string;
  available: boolean;
  code?: string;
}

function Tile({ name, meta, href, available, code }: TileProps) {
  const body = (
    <>
      {code ? <span className="show-tile__code">{code}</span> : null}
      <span className="show-tile__name">{name}</span>
      <span className="show-tile__meta">{available ? meta : 'Sin datos todavía'}</span>
    </>
  );
  return (
    <motion.li variants={TILE}>
      {available ? (
        <Link href={href} className="show-tile focus-ring">
          {body}
        </Link>
      ) : (
        <span className="show-tile" aria-disabled="true">
          {body}
        </span>
      )}
    </motion.li>
  );
}

const plural = (n: number, one: string, many: string) => `${String(n)} ${n === 1 ? one : many}`;

export function TeamChooser({ countries }: { countries: readonly Country[] }) {
  const params = useSearchParams();
  const router = useRouter();
  const { country, category, team } = resolveChoice(
    params.get('pais'),
    params.get('categoria'),
    params.get('equipo'),
    countries,
  );
  // El equipo elegido queda en una cookie para todas las interfaces; refresh repinta el header.
  useEffect(() => {
    if (!team) return;
    document.cookie = `${TEAM_COOKIE}=${team.slug}; path=/; max-age=31536000; samesite=lax`;
    router.refresh();
  }, [team, router]);
  const step = team ? 3 : category ? 2 : country ? 1 : 0;
  const title = ['Elegí el país', 'Elegí la categoría', 'Elegí el equipo', team?.name ?? ''][step] ?? '';

  const crumbs: { label: string; href: string }[] = [
    { label: 'País', href: '/elegir' },
    ...(country ? [{ label: country.name, href: `/elegir?pais=${country.slug}` }] : []),
    ...(country && category
      ? [{ label: category.name, href: `/elegir?pais=${country.slug}&categoria=${category.slug}` }]
      : []),
  ];

  const tiles = (c?: Country, k?: Category) => {
    if (c && k) {
      return k.teams.map((t) => (
        <Tile
          key={t.slug}
          name={t.name}
          meta="Temporada 2026"
          href={`/elegir?pais=${c.slug}&categoria=${k.slug}&equipo=${t.slug}`}
          available={t.available}
        />
      ));
    }
    if (c) {
      return c.categories.map((k) => (
        <Tile
          key={k.slug}
          name={k.name}
          meta={plural(k.teams.filter((t) => t.available).length, 'equipo con datos', 'equipos con datos')}
          href={`/elegir?pais=${c.slug}&categoria=${k.slug}`}
          available={categoryAvailable(k)}
        />
      ));
    }
    return countries.map((x) => (
      <Tile
        key={x.slug}
        name={x.name}
        code={x.code}
        meta={plural(x.categories.length, 'categoría', 'categorías')}
        href={`/elegir?pais=${x.slug}`}
        available={countryAvailable(x)}
      />
    ));
  };

  return (
    <MotionConfig reducedMotion="never">
      <div className="show-choose">
        <nav aria-label="Lo elegido hasta ahora" className="flex flex-wrap items-center justify-between gap-4">
          <ol className="show-crumbs">
            <AnimatePresence initial={false}>
              {crumbs.map((c, i) => (
                <motion.li
                  key={c.href}
                  layout
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -10 }}
                  transition={{ duration: 0.35, ease: EASE }}
                >
                  {i > 0 ? <span aria-hidden="true">/</span> : null}
                  {i === crumbs.length - 1 && step === 3 ? (
                    <span>{c.label}</span>
                  ) : (
                    <Link href={c.href} className="focus-ring">
                      {c.label}
                    </Link>
                  )}
                </motion.li>
              ))}
            </AnimatePresence>
          </ol>
          <p className="show-steps">
            <span className="sr-only">Paso {String(Math.min(step + 1, 3))} de 3</span>
            {[0, 1, 2].map((i) => (
              <i key={i} data-on={i <= step || undefined} aria-hidden="true" />
            ))}
          </p>
        </nav>

        <AnimatePresence mode="wait" initial={false}>
          <motion.section key={step} variants={SCREEN} initial="hidden" animate="show" exit="exit" aria-live="polite">
            {step < 3 ? (
              <>
                <h1 className="show-title">{title}</h1>
                <ul className="show-tiles">{tiles(country, category)}</ul>
              </>
            ) : (
              <>
                <div className="show-chosen">
                  {TEAM_PHOTO_SRC && team?.name === TEAM_NAME ? (
                    // eslint-disable-next-line @next/next/no-img-element -- escudo local chico
                    <img src={TEAM_PHOTO_SRC} alt="" width={72} height={72} />
                  ) : null}
                  <div>
                    <h1 className="show-title">{title}</h1>
                    <p className="text-muted mt-2">
                      {category?.name}, {country?.name}. Temporada 2026, partidos oficiales.
                    </p>
                  </div>
                </div>
                <InterfaceGrid />
              </>
            )}
          </motion.section>
        </AnimatePresence>
      </div>
    </MotionConfig>
  );
}
