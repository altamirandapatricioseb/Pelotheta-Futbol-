'use client';

import { ArrowsClockwiseIcon, CheckCircleIcon, ClockIcon, WarningCircleIcon } from '@phosphor-icons/react';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';

import { formatDateTime } from '@/lib/format';

type PanelState = 'loading' | 'idle' | 'running' | 'cooldown' | 'unconfigured' | 'unavailable';

interface StatusResponse {
  state: PanelState;
  nextAvailableAt?: string | null;
  lastRun?: { conclusion: string | null; failedStep?: string | null } | null;
}

const POLL_MS = 10_000;

const MESSAGES: Record<PanelState, string> = {
  loading: 'Consultando el estado…',
  idle: 'Listo para actualizar.',
  running: 'Actualizando: scraping, carga en la base y página. Tarda unos minutos.',
  cooldown: 'Hubo una actualización hace menos de una hora.',
  unconfigured: 'PEL-UPD-001: el botón todavía no está habilitado en este despliegue.',
  unavailable: 'PEL-UPD-002: no se pudo consultar el estado. Probá de nuevo en un rato.',
};

/** Botón de la Interfaz 6: dispara el workflow y refresca la página al terminar. */
export function UpdatePanel({ lastUpdate, initial }: { lastUpdate: string | null; initial: StatusResponse }) {
  const router = useRouter();
  const [status, setStatus] = useState<StatusResponse>(initial);
  const [busy, setBusy] = useState(false);
  const wasRunning = useRef(initial.state === 'running');

  const refresh = useCallback(async () => {
    try {
      const response = await fetch('/api/actualizar', { cache: 'no-store' });
      const next = (await response.json()) as StatusResponse;
      if (wasRunning.current && next.state !== 'running') router.refresh();
      wasRunning.current = next.state === 'running';
      setStatus(next);
    } catch {
      setStatus({ state: 'unavailable' });
    }
  }, [router]);

  useEffect(() => {
    if (status.state !== 'running') return;
    const id = setInterval(() => {
      void refresh();
    }, POLL_MS);
    return () => {
      clearInterval(id);
    };
  }, [status.state, refresh]);

  async function start() {
    setBusy(true);
    try {
      const response = await fetch('/api/actualizar', { method: 'POST' });
      const next = (await response.json()) as StatusResponse;
      wasRunning.current = next.state === 'running';
      setStatus(next);
    } catch {
      setStatus({ state: 'unavailable' });
    } finally {
      setBusy(false);
    }
  }

  const disabled = busy || status.state !== 'idle';
  const failed = status.state !== 'running' && status.lastRun?.conclusion === 'failure';

  return (
    <section className="update-panel" aria-labelledby="update-title">
      <h2 id="update-title" className="sr-only">
        Actualizar datos
      </h2>
      <p className="update-panel__last">
        <ClockIcon size={20} aria-hidden="true" />
        Última actualización:{' '}
        <time className="tabular font-semibold" dateTime={lastUpdate ?? undefined}>
          {formatDateTime(lastUpdate)}
        </time>
      </p>
      <button
        type="button"
        className="update-panel__button focus-ring"
        onClick={() => void start()}
        disabled={disabled}
      >
        <ArrowsClockwiseIcon
          size={22}
          aria-hidden="true"
          className={status.state === 'running' ? 'update-panel__spin' : undefined}
        />
        {status.state === 'running' ? 'Actualizando…' : 'Actualizar'}
      </button>
      <p role="status" aria-live="polite" className="update-panel__status">
        {failed ? (
          <>
            <WarningCircleIcon size={18} weight="fill" aria-hidden="true" className="text-warn" />
            PEL-UPD-003: la última corrida falló
            {status.lastRun?.failedStep ? ` en el paso «${status.lastRun.failedStep}»` : ''}. Se puede volver a
            intentar.
          </>
        ) : (
          <>
            {status.state === 'idle' ? (
              <CheckCircleIcon size={18} weight="fill" aria-hidden="true" className="text-link" />
            ) : null}
            {MESSAGES[status.state]}
            {status.state === 'cooldown' && status.nextAvailableAt
              ? ` Disponible desde las ${formatDateTime(status.nextAvailableAt)}.`
              : ''}
          </>
        )}
      </p>
    </section>
  );
}
