import type { Metadata } from 'next';

import { UpdatePanel } from '@/components/update/update-panel';
import { getFreshness } from '@/lib/data/freshness';
import { getUpdateStatus } from '@/lib/update/status';

export const metadata: Metadata = { title: 'Actualizar' };

/** Interfaz 6: un botón que vuelve a correr el scraping, carga la base y refresca la web. */
export default async function Page() {
  const [freshness, status] = await Promise.all([getFreshness(), getUpdateStatus()]);
  return (
    <div className="grid gap-6">
      <h1 className="page-title">
        <span className="title-trace">Actualizar</span>
      </h1>
      <p className="max-w-[65ch] text-muted">
        Corre de nuevo el scraping de todas las fuentes, sube los resultados a la base y refleja los cambios en todas
        las páginas. También se actualiza solo el día 1 de cada mes.
      </p>
      <UpdatePanel lastUpdate={freshness.lastUpdate} initial={status} />
    </div>
  );
}
