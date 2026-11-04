import type { Metadata } from 'next';

import { SituationsBoard } from '@/components/situations/board';
import { getSituations } from '@/lib/data/situations';
import { ErrorNotice } from '@/components/error-notice';

export const metadata: Metadata = {
  description:
    'Más de 100 situaciones de partido de Boca Juniors 2026: qué pasa cuando empieza perdiendo, cuando convierte primero, con uno menos o según el rival.',
};

export default async function Page() {
  const result = await getSituations();
  if (!result.ok) {
    return <ErrorNotice code={result.code} />;
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
