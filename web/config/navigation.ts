// Las 6 interfaces del header, en el orden de la sección 9.1 más «Actualizar» (9.11).
export interface InterfaceLink {
  href: string;
  label: string;
  icon: 'graficos' | 'equipo' | 'jugadores' | 'situaciones' | 'comparar' | 'actualizar';
}

export const INTERFACES: readonly InterfaceLink[] = [
  { href: '/', label: 'Gráficos', icon: 'graficos' },
  { href: '/equipo', label: 'Equipo', icon: 'equipo' },
  { href: '/jugadores', label: 'Jugadores', icon: 'jugadores' },
  { href: '/situaciones', label: 'Situaciones', icon: 'situaciones' },
  { href: '/comparar', label: 'Comparar', icon: 'comparar' },
  { href: '/actualizar', label: 'Actualizar', icon: 'actualizar' },
];

/** La pestaña activa: coincidencia exacta para el inicio y por prefijo para el resto. */
export function isActive(pathname: string, href: string): boolean {
  return href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(`${href}/`);
}
