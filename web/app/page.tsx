import type { Metadata } from 'next';

import { ShowcaseLanding } from '@/components/showcase/landing';
import { getShowcaseData } from '@/lib/data/showcase';

export const metadata: Metadata = {
  description:
    'Pelotheta Θ: elegí un equipo y entrá a sus gráficos, tablas, jugadores, situaciones y comparaciones. Hoy con Boca Juniors 2026.',
};

export default async function Page() {
  const data = await getShowcaseData();
  return <ShowcaseLanding {...data} />;
}
