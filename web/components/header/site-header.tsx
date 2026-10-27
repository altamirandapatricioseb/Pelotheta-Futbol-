'use client';

import { ListIcon, XIcon } from '@phosphor-icons/react';
import { motion } from 'motion/react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

import { INTERFACES, isActive } from '@/config/navigation';

import { InterfaceIcon } from './interface-icon';

interface SiteHeaderProps {
  teamMark: React.ReactNode;
  systemMark: React.ReactNode;
  freshness: React.ReactNode;
}

const UNDERLINE_SPRING = { type: 'spring', stiffness: 420, damping: 36 } as const;

/**
 * Header fijo (9.1): se compacta al bajar, y la segunda fila (última actualización y estado
 * de la fuente) se oculta al bajar y reaparece al subir. El subrayado de la pestaña activa se
 * desliza entre pestañas con `layoutId`.
 */
export function SiteHeader({ teamMark, systemMark, freshness }: SiteHeaderProps) {
  const pathname = usePathname();
  const [compact, setCompact] = useState(false);
  const [showStrip, setShowStrip] = useState(true);
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPath, setMenuPath] = useState(pathname);
  const lastY = useRef(0);

  // Al cambiar de página se cierra el menú del celular (ajuste de estado durante el render,
  // la forma que recomienda React en vez de un efecto).
  if (menuPath !== pathname) {
    setMenuPath(pathname);
    setMenuOpen(false);
  }

  useEffect(() => {
    const onScroll = () => {
      const y = window.scrollY;
      setCompact(y > 24);
      // Margen de 6 px para que un temblor del scroll no haga parpadear la fila.
      if (Math.abs(y - lastY.current) > 6) {
        setShowStrip(y < lastY.current || y < 80);
        lastY.current = y;
      }
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
    };
  }, []);

  return (
    <header className="site-header" data-compact={compact || undefined}>
      <div className="site-header__bar">
        <Link href="/" className="site-header__side focus-ring rounded-md" aria-label="Boca Juniors, ir al inicio">
          {teamMark}
        </Link>

        <nav aria-label="Interfaces" className="site-header__nav">
          <ul className="flex h-full items-stretch gap-1">
            {INTERFACES.map((item) => {
              const active = isActive(pathname, item.href);
              return (
                <li key={item.href} className="relative">
                  <Link
                    href={item.href}
                    aria-current={active ? 'page' : undefined}
                    className="nav-tab focus-ring"
                    data-active={active || undefined}
                  >
                    <InterfaceIcon name={item.icon} weight={active ? 'fill' : 'regular'} />
                    <span>{item.label}</span>
                  </Link>
                  {active ? (
                    <motion.span layoutId="nav-underline" className="nav-underline" transition={UNDERLINE_SPRING} />
                  ) : null}
                </li>
              );
            })}
          </ul>
        </nav>

        <div className="site-header__side site-header__side--end">
          {systemMark}
          <button
            type="button"
            className="menu-button focus-ring"
            aria-expanded={menuOpen}
            aria-controls="menu-movil"
            onClick={() => {
              setMenuOpen((open) => !open);
            }}
          >
            {menuOpen ? <XIcon size={22} aria-hidden="true" /> : <ListIcon size={22} aria-hidden="true" />}
            <span className="sr-only">{menuOpen ? 'Cerrar menú' : 'Abrir menú'}</span>
          </button>
        </div>
      </div>

      <div className="site-header__strip" data-hidden={!showStrip || undefined}>
        {freshness}
      </div>

      {menuOpen ? (
        <nav id="menu-movil" aria-label="Interfaces en el celular" className="mobile-menu">
          <ul>
            {INTERFACES.map((item) => {
              const active = isActive(pathname, item.href);
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    aria-current={active ? 'page' : undefined}
                    className="mobile-menu__link focus-ring"
                  >
                    <InterfaceIcon name={item.icon} weight={active ? 'fill' : 'regular'} />
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      ) : null}
    </header>
  );
}
