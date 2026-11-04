import type { Metadata } from 'next';

import { Landing } from '@/components/charts/landing';
import { getChartCatalog } from '@/lib/data/charts';
import { getLandingData } from '@/lib/data/landing';
import { ErrorNotice } from '@/components/error-notice';

export const metadata: Metadata = {
  description:
    'Boca Juniors 2026 en más de 90 gráficos por categoría: forma, goles, xG, posesión, defensa, pelota parada, jugadores, competición, métricas propias y proyección.',
};

export default async function Page() {
  const [data, charts] = await Promise.all([getLandingData(), getChartCatalog()]);
  if (!data || !charts.ok) {
    return <ErrorNotice code={'PEL-DB-001'} />;
  }
  return <Landing data={data} charts={charts.data} />;
}
