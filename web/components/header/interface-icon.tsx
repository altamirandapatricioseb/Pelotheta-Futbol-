import {
  ArrowsClockwiseIcon,
  ArrowsLeftRightIcon,
  ChartLineUpIcon,
  ShieldIcon,
  SquaresFourIcon,
  UserListIcon,
} from '@phosphor-icons/react/dist/ssr';
import type { IconWeight } from '@phosphor-icons/react';

import type { InterfaceLink } from '@/config/navigation';

const ICONS = {
  graficos: ChartLineUpIcon,
  equipo: ShieldIcon,
  jugadores: UserListIcon,
  situaciones: SquaresFourIcon,
  comparar: ArrowsLeftRightIcon,
  actualizar: ArrowsClockwiseIcon,
} as const;

/** Ícono Phosphor de cada interfaz: peso regular y relleno en la pestaña activa (9.10). */
export function InterfaceIcon({ name, weight = 'regular' }: { name: InterfaceLink['icon']; weight?: IconWeight }) {
  const Icon = ICONS[name];
  return <Icon size={18} weight={weight} aria-hidden="true" />;
}
