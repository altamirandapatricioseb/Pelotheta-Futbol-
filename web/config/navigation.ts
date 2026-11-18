// Las interfaces del header: las 6 de la sección 9.1, los 3 modelos (valor, alternativas, predictor) y «Actualizar» (9.11).
export interface InterfaceLink {
  href: string;
  label: string;
  icon:
    | 'graficos'
    | 'equipo'
    | 'jugadores'
    | 'situaciones'
    | 'comparar'
    | 'valor'
    | 'alternativas'
    | 'predictor'
    | 'actualizar';
}

export const INTERFACES: readonly InterfaceLink[] = [
  { href: '/graficos', label: 'Gráficos', icon: 'graficos' },
  { href: '/equipo', label: 'Equipo', icon: 'equipo' },
  { href: '/jugadores', label: 'Jugadores', icon: 'jugadores' },
  { href: '/situaciones', label: 'Situaciones', icon: 'situaciones' },
  { href: '/comparar', label: 'Comparar', icon: 'comparar' },
  { href: '/valor', label: 'Valor', icon: 'valor' },
  { href: '/alternativas', label: 'Alternativas', icon: 'alternativas' },
  { href: '/predictor', label: 'Predictor', icon: 'predictor' },
  { href: '/actualizar', label: 'Actualizar', icon: 'actualizar' },
];

/** La pestaña activa: coincidencia exacta para el inicio y por prefijo para el resto. */
export function isActive(pathname: string, href: string): boolean {
  return href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(`${href}/`);
}
