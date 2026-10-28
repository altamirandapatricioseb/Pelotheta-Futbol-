'use client';

import { MoonIcon, SunIcon } from '@phosphor-icons/react';

import { THEME_COOKIE } from '@/lib/theme';

/** Modo claro u oscuro (9.10). Sin elección guardada, sigue la preferencia del sistema. */
export function ThemeToggle() {
  const toggle = () => {
    const root = document.documentElement;
    const current =
      root.dataset.theme ?? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    const next = current === 'dark' ? 'light' : 'dark';
    root.dataset.theme = next;
    document.cookie = `${THEME_COOKIE}=${next}; path=/; max-age=31536000; samesite=lax`;
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
