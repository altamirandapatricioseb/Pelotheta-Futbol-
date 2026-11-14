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
export function InterfaceIcon({
  name,
  weight = 'regular',
  size = 18,
}: {
  name: InterfaceLink['icon'];
  weight?: IconWeight;
  size?: number;
}) {
  const Icon = ICONS[name];
  return <Icon size={size} weight={weight} aria-hidden="true" />;
}
