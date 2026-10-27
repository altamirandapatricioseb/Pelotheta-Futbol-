import type { Metadata } from 'next';

import { UnderConstruction } from '@/components/under-construction';

export const metadata: Metadata = { title: 'Comparar' };

export default function Page() {
  return (
    <UnderConstruction
      title="Comparar"
      stage={7}
      description="Comparación directa de un jugador contra el plantel, su zona, su posición u otro jugador, con gráficos por categoría."
    />
  );
}
