// Estado del botón «Actualizar» (Interfaz 6) a partir de la última corrida del workflow.
// Lógica pura, sin red: la usan el route handler y los tests.

/** Enfriamiento entre corridas: protege a las fuentes y a la cuota de las APIs (ADR 0004). */
export const COOLDOWN_MS = 60 * 60 * 1000;

export interface WorkflowRun {
  status: 'queued' | 'in_progress' | 'completed' | 'waiting' | 'requested' | 'pending';
  conclusion: 'success' | 'failure' | 'cancelled' | 'skipped' | 'timed_out' | null;
  createdAt: string;
  updatedAt: string;
  /** Nombre del paso que falló (solo si la corrida falló). */
  failedStep?: string | null;
}

export type UpdateStateName = 'idle' | 'running' | 'cooldown';

export interface UpdateState {
  state: UpdateStateName;
  /** Cuándo se puede volver a apretar el botón (solo en enfriamiento). */
  nextAvailableAt: string | null;
  lastRun: WorkflowRun | null;
}

export function updateState(lastRun: WorkflowRun | null, now: Date = new Date()): UpdateState {
  if (!lastRun) return { state: 'idle', nextAvailableAt: null, lastRun: null };
  if (lastRun.status !== 'completed') return { state: 'running', nextAvailableAt: null, lastRun };
  const available = Date.parse(lastRun.createdAt) + COOLDOWN_MS;
  if (available > now.getTime()) {
    return { state: 'cooldown', nextAvailableAt: new Date(available).toISOString(), lastRun };
  }
  return { state: 'idle', nextAvailableAt: null, lastRun };
}
