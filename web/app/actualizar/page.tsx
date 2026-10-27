import type { Metadata } from 'next';

import { UnderConstruction } from '@/components/under-construction';

export const metadata: Metadata = { title: 'Actualizar' };

export default function Page() {
  return (
    <UnderConstruction
      title="Actualizar"
      stage={3}
      description="Un botón que corre el scraping de nuevo, sube los resultados a la base y refleja los cambios en la página, con la fecha y hora de la última actualización."
    />
  );
}
