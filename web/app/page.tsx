import type { Metadata } from 'next';

import { UnderConstruction } from '@/components/under-construction';

export const metadata: Metadata = { title: 'Gráficos' };

export default function Page() {
  return (
    <UnderConstruction
      title="Gráficos"
      stage={5}
      description="La portada del sistema: al menos 50 gráficos por categoría (resultados, ataque, defensa, disciplina, minutos y más), varios a la vez, con lectura automática de cada uno."
    />
  );
}
