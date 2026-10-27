import type { Metadata } from 'next';

import { UnderConstruction } from '@/components/under-construction';

export const metadata: Metadata = { title: 'Situaciones' };

export default function Page() {
  return (
    <UnderConstruction
      title="Situaciones"
      stage={6}
      description="Un tablero con más de 100 estadísticas de situaciones de partido: qué pasa cuando Boca empieza perdiendo, cuando convierte primero o cuando juega con uno menos."
    />
  );
}
