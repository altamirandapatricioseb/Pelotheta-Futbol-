import { CheckCircleIcon, ClockIcon, WarningCircleIcon } from '@phosphor-icons/react/dist/ssr';

import { getFreshness } from '@/lib/data/freshness';
import { formatDateTime, formatRelativeDays } from '@/lib/format';

const STATUS_TEXT = {
  ok: 'Promiedos: carga completa',
  parcial: 'Promiedos: carga parcial',
  error: 'Promiedos: la última carga falló',
  omitido: 'Promiedos: sin cambios',
} as const;

/** Segunda fila del header: última actualización y estado de la fuente principal. */
export async function FreshnessStrip() {
  const f = await getFreshness();
  if (!f.reachable) {
    return (
      <p role="status" className="freshness freshness--warn">
        <WarningCircleIcon size={16} weight="fill" aria-hidden="true" />
        PEL-DB-001: la base de datos no responde (puede estar pausada). Los datos vuelven solos.
      </p>
    );
  }
  return (
    <p className="freshness">
      <span className="freshness__item">
        <ClockIcon size={16} aria-hidden="true" />
        Última actualización:
        <time className="tabular font-semibold text-fg" dateTime={f.lastUpdate ?? undefined}>
          {formatDateTime(f.lastUpdate)}
        </time>
        {f.lastUpdate ? <span>({formatRelativeDays(f.lastUpdate)})</span> : null}
      </span>
      {f.sourceStatus ? (
        <span className="freshness__item">
          {f.sourceStatus === 'error' ? (
            <WarningCircleIcon size={16} weight="fill" aria-hidden="true" className="text-warn" />
          ) : (
            <CheckCircleIcon size={16} weight="fill" aria-hidden="true" className="text-link" />
          )}
          {STATUS_TEXT[f.sourceStatus]}
        </span>
      ) : null}
    </p>
  );
}
