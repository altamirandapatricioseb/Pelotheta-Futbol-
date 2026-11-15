import type { Metadata } from 'next';
import Link from 'next/link';

import { LandingBar } from '@/components/showcase/landing-bar';
import { ShowcaseLanding } from '@/components/showcase/landing';
import { getShowcaseData } from '@/lib/data/showcase';

export const metadata: Metadata = {
  description:
    'Pelotheta Θ: sistema de análisis de datos de fútbol. Elegí un equipo y entrá a sus gráficos, tablas, jugadores, situaciones y comparaciones.',
};

export default async function Page() {
  const data = await getShowcaseData();
  return (
    <>
      <LandingBar
        action={
          <Link href="/elegir" className="show-button focus-ring" data-cursor="Ir">
            Elegir equipo
          </Link>
        }
      />
      <ShowcaseLanding {...data} />
    </>
  );
}
