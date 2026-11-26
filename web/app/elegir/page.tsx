import type { Metadata } from 'next';

import { LandingBar } from '@/components/showcase/landing-bar';
import { TeamChooser } from '@/components/showcase/team-chooser';
import { getChooserCountries } from '@/lib/data/chooser';

export const metadata: Metadata = {
  description: 'Elegí país, categoría y equipo para entrar a las interfaces de Pelotheta Θ.',
};

// Los parámetros de la URL se resuelven en el cliente contra la lista cerrada de clubes con datos.
export default async function Page() {
  const countries = await getChooserCountries();
  return (
    <>
      <LandingBar back />
      <TeamChooser countries={countries} />
    </>
  );
}
