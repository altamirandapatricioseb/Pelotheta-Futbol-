'use client';

import { ListIcon, XIcon } from '@phosphor-icons/react';
import { motion } from 'motion/react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';

import { INTERFACES, isActive } from '@/config/navigation';

import { InterfaceIcon } from './interface-icon';
import { ThemeToggle } from './theme-toggle';

interface SiteHeaderProps {
  teamMark: React.ReactNode;
  systemMark: React.ReactNode;
}

const UNDERLINE_SPRING = { type: 'spring', stiffness: 420, damping: 36 } as const;

/**
 * Header fijo (9.1): se compacta al bajar. El subrayado de la pestaña activa se desliza entre
 * pestañas con `layoutId`. La última actualización y el estado de la fuente se muestran solo en
 * Actualizar (pedido del dueño, 28-oct).
 */
export function SiteHeader({ teamMark, systemMark }: SiteHeaderProps) {
  const pathname = usePathname();
  const [compact, setCompact] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPath, setMenuPath] = useState(pathname);

  // Al cambiar de página se cierra el menú del celular (ajuste de estado durante el render,
  // la forma que recomienda React en vez de un efecto).
  if (menuPath !== pathname) {
    setMenuPath(pathname);
    setMenuOpen(false);
  }

  useEffect(() => {
    const onScroll = () => {
      setCompact(window.scrollY > 24);
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
        <Link href="/" className="site-header__side focus-ring rounded-md">
          {teamMark}
          <span className="sr-only">, ir al inicio</span>
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
          <ThemeToggle />
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
