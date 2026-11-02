'use client';

import { MoonIcon, SunIcon } from '@phosphor-icons/react';

import { THEME_COOKIE } from '@/lib/theme';

/** Modo claro u oscuro (9.10). Sin elección guardada, sigue la preferencia del sistema. */
export function ThemeToggle() {
  const toggle = (event: React.MouseEvent<HTMLButtonElement>) => {
    const root = document.documentElement;
    const current =
      root.dataset.theme ?? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    const next = current === 'dark' ? 'light' : 'dark';
    const apply = () => {
      root.dataset.theme = next;
    };
    document.cookie = `${THEME_COOKIE}=${next}; path=/; max-age=31536000; samesite=lax`;
    // Sin View Transitions o con «reducir movimiento», el cambio es instantáneo.
    if (!('startViewTransition' in document) || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      apply();
      return;
    }
    // El tema nuevo se revela como un círculo que crece desde el botón hasta cubrir la pantalla.
    const { left, top, width, height } = event.currentTarget.getBoundingClientRect();
    const x = left + width / 2;
    const y = top + height / 2;
    const radius = Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y));
    const transition = document.startViewTransition(apply);
    void transition.ready.then(() => {
      root.animate(
        {
          clipPath: [
            `circle(0px at ${String(x)}px ${String(y)}px)`,
            `circle(${String(radius)}px at ${String(x)}px ${String(y)}px)`,
          ],
        },
        { duration: 550, easing: 'cubic-bezier(0.16, 1, 0.3, 1)', pseudoElement: '::view-transition-new(root)' },
      );
    });
  };
  return (
    <button
      type="button"
      className="icon-button theme-toggle focus-ring"
      title="Cambiar entre modo claro y oscuro"
      onClick={toggle}
    >
      <SunIcon size={18} aria-hidden="true" className="icon-sun" />
      <MoonIcon size={18} aria-hidden="true" className="icon-moon" />
      <span className="sr-only">Cambiar entre modo claro y oscuro</span>
    </button>
  );
}
