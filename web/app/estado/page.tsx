import type { Metadata } from 'next';

import { ErrorNotice } from '@/components/error-notice';
import { articleUrl } from '@/lib/errors';
import { formatDateTime } from '@/lib/format';
import { createApiClient } from '@/lib/supabase/server';

export const metadata: Metadata = { title: 'Estado' };

const STATUS: Record<string, string> = { ok: 'Bien', parcial: 'Parcial', error: 'Con error', omitido: 'Omitida' };

/** Estado público del sistema (sección 14.6): última corrida de cada fuente. */
export default async function Page() {
  const { data, error } = await createApiClient()
    .from('source_status')
    .select('source, last_run_at, last_status, last_success_at')
    .order('source');
  return (
    <div className="grid gap-6">
      <h1 className="page-title">
        <span className="title-trace">Estado del sistema</span>
      </h1>
      <p className="max-w-[65ch] text-muted">
        Última corrida de cada fuente de datos. La salud en vivo (base y versión desplegada) está en{' '}
        <a href="/api/health" className="focus-ring underline">
          /api/health
        </a>
        , que un control automático consulta cada 6 horas.
      </p>
      {error ? (
        <ErrorNotice code="PEL-DB-001" />
      ) : (
        // Con foco y nombre: en el celular la tabla se desplaza de costado y hay que poder hacerlo con teclado
        // (axe: scrollable-region-focusable).
        // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- región desplazable con nombre
        <div className="data-table-wrap" tabIndex={0} role="region" aria-label="Estado de las fuentes">
          <table className="data-table tabular">
            <caption className="sr-only">Estado de las fuentes</caption>
            <thead>
              <tr>
                <th scope="col">Fuente</th>
                <th scope="col">Última corrida</th>
                <th scope="col">Resultado</th>
                <th scope="col">Última carga exitosa</th>
              </tr>
            </thead>
            <tbody>
              {data.map((s) => (
                <tr key={s.source}>
                  <th scope="row">{s.source}</th>
                  <td>{formatDateTime(s.last_run_at)}</td>
                  <td className="text-left">
                    {s.last_status ? (STATUS[s.last_status] ?? s.last_status) : '—'}
                    {s.last_status === 'error' ? (
                      <>
                        {' · '}
                        <a href={articleUrl('PEL-SRC-003')} className="focus-ring underline">
                          PEL-SRC-003
                        </a>
                      </>
                    ) : null}
                  </td>
                  <td>{formatDateTime(s.last_success_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
