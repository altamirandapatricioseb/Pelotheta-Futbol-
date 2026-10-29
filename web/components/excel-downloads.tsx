import { CaretDownIcon, FileXlsIcon } from '@phosphor-icons/react/dist/ssr';

import { getCompetitions } from '@/lib/data/players';
import { readPublicEnv } from '@/lib/env';

/** Nombre del libro en el bucket `exports` (igual que `pipeline/excel.py: file_name`). */
export function bookFile(code: string): string {
  return code === 'todas' ? 'pelotheta-global.xlsx' : `pelotheta-${code}.xlsx`;
}

/**
 * «Descargar Excel» (sección 10): los libros que arma el pipeline con gráficos nativos, hojas
 * interactivas (Comparador y Dispersión) y una hoja por gráfico. Uno global y uno por
 * competición, en el bucket público `exports` de Supabase Storage.
 */
export async function ExcelDownloads() {
  const env = readPublicEnv();
  const base = `${env.NEXT_PUBLIC_SUPABASE_URL.replace(/\/$/, '')}/storage/v1/object/public/exports`;
  const competitions = await getCompetitions();
  const books = [
    { code: 'todas', name: 'Todas las competiciones' },
    ...(competitions.ok ? competitions.data.map((c) => ({ code: c.code, name: c.name })) : []),
  ];
  return (
    <details className="downloads">
      <summary className="chip focus-ring">
        <FileXlsIcon size={16} aria-hidden="true" />
        Descargar Excel
        <CaretDownIcon size={12} aria-hidden="true" />
      </summary>
      <div className="downloads__menu">
        <p className="text-xs text-muted">
          Libros con gráficos nativos, Comparador y Dispersión interactivos. Se actualizan con cada carga de datos.
        </p>
        <ul>
          {books.map((b) => (
            <li key={b.code}>
              <a href={`${base}/${bookFile(b.code)}`} download className="focus-ring">
                <FileXlsIcon size={16} aria-hidden="true" />
                {b.name.replace('CONMEBOL ', '').replace('Liga Profesional Argentina', 'Liga Profesional')}
              </a>
            </li>
          ))}
        </ul>
      </div>
    </details>
  );
}
