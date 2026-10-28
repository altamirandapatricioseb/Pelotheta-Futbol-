import type { Metadata } from 'next';

import { Landing } from '@/components/charts/landing';
import { getChartCatalog } from '@/lib/data/charts';
import { getLandingData } from '@/lib/data/landing';

export const metadata: Metadata = {
  title: 'Gráficos',
  description:
    'Boca Juniors 2026 en más de 90 gráficos por categoría: forma, goles, xG, posesión, defensa, pelota parada, jugadores, competición, métricas propias y proyección.',
};

export default async function Page() {
  const [data, charts] = await Promise.all([getLandingData(), getChartCatalog()]);
  if (!data || !charts.ok) {
    return (
      <div role="alert" className="under-construction">
        <p className="font-bold">PEL-DB-001: la base de datos no responde.</p>
        <p className="text-muted">Puede estar pausada por inactividad. Probá de nuevo en unos minutos.</p>
      </div>
    );
  }
  return <Landing data={data} charts={charts.data} />;
}
