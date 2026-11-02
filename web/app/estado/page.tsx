import type { Metadata } from 'next';

import { ErrorNotice } from '@/components/error-notice';
import { articleUrl } from '@/lib/errors';
import { daysSince, formatDateTime, formatNumber, formatRelativeDays } from '@/lib/format';
import { createApiClient } from '@/lib/supabase/server';

export const metadata: Metadata = { title: 'Estado' };

const STATUS: Record<string, string> = { ok: 'Bien', parcial: 'Parcial', error: 'Con error', omitido: 'Omitida' };
// SLO de frescura (docs/slo.md): los datos no pueden tener más de 35 días.
const FRESHNESS_DAYS = 35;

/** Estado público del sistema (14.6 y 16.5): SLOs, corridas del pipeline y última corrida de cada fuente. */
export default async function Page() {
  const api = createApiClient();
  const [sources, runs, quality] = await Promise.all([
    api.from('source_status').select('source, last_run_at, last_status, last_success_at').order('source'),
    api
      .from('pipeline_run_metrics')
      .select('run_id, finished_at, duration_s, status, matches, rows_loaded, warnings, errors, db_size_bytes')
      .order('finished_at', { ascending: false })
      .limit(6),
    api.from('data_quality').select('table_name, description_es, failing, total, checked_at').order('table_name'),
  ]);
  // La frescura se mide con la fuente principal (partidos de Promiedos), no con la más reciente.
  const lastSuccess = sources.data?.find((s) => s.source === 'promiedos')?.last_success_at;
  const age = lastSuccess ? daysSince(lastSuccess) : null;
  const lastRun = runs.data?.[0];
  // Semáforo de calidad (16.1): una fila por tabla con los chequeos que pasan y los que fallan.
  const byTable = new Map<string, { ok: number; total: number; failing: string[] }>();
  for (const q of quality.data ?? []) {
    const t = byTable.get(q.table_name) ?? { ok: 0, total: 0, failing: [] };
    t.total += 1;
    if (q.failing === 0) t.ok += 1;
    else t.failing.push(`${q.description_es} (${String(q.failing)} de ${String(q.total)})`);
    byTable.set(q.table_name, t);
  }
  const checkedAt = quality.data?.[0]?.checked_at;

  return (
    <div className="grid gap-6">
      <h1 className="page-title">
        <span className="title-trace">Estado del sistema</span>
      </h1>
      <p className="max-w-[65ch] text-muted">
        Objetivos de servicio, corridas del pipeline y última corrida de cada fuente. La salud en vivo (base y versión
        desplegada) está en{' '}
        <a href="/api/health" className="focus-ring underline">
          /api/health
        </a>
        , que un control automático consulta cada 6 horas.
      </p>
      {sources.error ? (
        <ErrorNotice code="PEL-DB-001" />
      ) : (
        <>
          <section className="grid gap-2" aria-labelledby="slo">
            <h2 id="slo" className="text-xl font-bold">
              Objetivos de servicio
            </h2>
            <ul className="grid gap-1">
              <li>
                <strong>Frescura de los datos</strong> (hasta {FRESHNESS_DAYS} días):{' '}
                {age === null || !lastSuccess
                  ? 'sin cargas exitosas registradas.'
                  : `última carga exitosa de partidos ${formatRelativeDays(lastSuccess)} · ${age <= FRESHNESS_DAYS ? 'cumple' : 'no cumple'}.`}
              </li>
              <li>
                <strong>Última corrida del pipeline:</strong>{' '}
                {lastRun
                  ? `${STATUS[lastRun.status] ?? lastRun.status} el ${formatDateTime(lastRun.finished_at)}.`
                  : 'todavía no hay métricas (se registran desde noviembre de 2026).'}
              </li>
              <li>
                <strong>Disponibilidad del sitio</strong> (99 % mensual): la mide el control de salud cada 6 horas y
                cada caída abre un issue «salud».
              </li>
            </ul>
          </section>

          {runs.data?.length ? (
            // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- región desplazable con nombre (axe)
            <div className="data-table-wrap" tabIndex={0} role="region" aria-label="Corridas del pipeline">
              <table className="data-table tabular">
                <caption className="text-left font-bold">Corridas del pipeline</caption>
                <thead>
                  <tr>
                    <th scope="col">Terminó</th>
                    <th scope="col">Resultado</th>
                    <th scope="col">Duración</th>
                    <th scope="col">Partidos</th>
                    <th scope="col">Filas</th>
                    <th scope="col">Avisos</th>
                    <th scope="col">Errores</th>
                    <th scope="col">Base</th>
                  </tr>
                </thead>
                <tbody>
                  {runs.data.map((r) => (
                    <tr key={r.run_id}>
                      <th scope="row">{formatDateTime(r.finished_at)}</th>
                      <td className="text-left">{STATUS[r.status] ?? r.status}</td>
                      <td>{formatNumber(r.duration_s / 60, 1)} min</td>
                      <td>{r.matches}</td>
                      <td>{formatNumber(r.rows_loaded, 0)}</td>
                      <td>{r.warnings}</td>
                      <td>{r.errors}</td>
                      <td>{r.db_size_bytes === null ? '—' : `${formatNumber(r.db_size_bytes / 1_048_576, 0)} MB`}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}

          {byTable.size ? (
            <section className="grid gap-2" aria-labelledby="calidad">
              <h2 id="calidad" className="text-xl font-bold">
                Calidad de datos
              </h2>
              <p className="text-sm text-muted">
                Unicidad, valores obligatorios, rangos, referencias, frescura y conciliación de los goles con los
                eventos{checkedAt ? `, revisados el ${formatDateTime(checkedAt)}` : ''}.
              </p>
              <ul className="grid gap-1">
                {[...byTable].map(([table, t]) => (
                  <li key={table} className="flex flex-wrap items-baseline gap-2">
                    <span className={t.failing.length ? 'font-bold value-worst' : 'font-bold value-best'}>
                      {t.failing.length ? 'Con fallas' : 'Bien'}
                    </span>
                    <code>{table}</code>
                    <span className="text-muted">
                      {String(t.ok)} de {String(t.total)} chequeos
                      {t.failing.length ? ` · ${t.failing.join('; ')}` : ''}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {/* Con foco y nombre: en el celular la tabla se desplaza de costado (axe: scrollable-region-focusable). */}
          {/* eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- región desplazable con nombre */}
          <div className="data-table-wrap" tabIndex={0} role="region" aria-label="Estado de las fuentes">
            <table className="data-table tabular">
              <caption className="text-left font-bold">Fuentes de datos</caption>
              <thead>
                <tr>
                  <th scope="col">Fuente</th>
                  <th scope="col">Última corrida</th>
                  <th scope="col">Resultado</th>
                  <th scope="col">Última carga exitosa</th>
                </tr>
              </thead>
              <tbody>
                {sources.data.map((s) => (
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
        </>
      )}
    </div>
  );
}
