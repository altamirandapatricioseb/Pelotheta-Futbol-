import type { Metadata } from 'next';

import { SituationsBoard } from '@/components/situations/board';
import { getSituations } from '@/lib/data/situations';

export const metadata: Metadata = {
  title: 'Situaciones',
  description:
    'Más de 100 situaciones de partido de Boca Juniors 2026: qué pasa cuando empieza perdiendo, cuando convierte primero, con uno menos o según el rival.',
};

export default async function Page() {
  const result = await getSituations();
  if (!result.ok) {
    return (
      <div role="alert" className="under-construction">
        <p className="font-bold">{result.code}: la base de datos no responde.</p>
        <p className="text-muted">Puede estar pausada por inactividad. Probá de nuevo en unos minutos.</p>
      </div>
    );
  }
  return (
    <SituationsBoard
      cards={result.data.cards}
      matches={result.data.matches}
      baseWinPct={result.data.baseWinPct}
      conclusions={result.data.conclusions}
    />
  );
}
