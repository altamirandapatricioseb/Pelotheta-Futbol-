import type { Metadata } from 'next';

import { TeamChooser } from '@/components/showcase/team-chooser';

export const metadata: Metadata = {
  description: 'Elegí país, categoría y equipo para entrar a las interfaces de Pelotheta Θ.',
};

// Los parámetros de la URL se resuelven en el cliente contra las listas cerradas de config/teams.ts.
export default function Page() {
  return <TeamChooser />;
}
