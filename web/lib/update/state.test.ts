import { describe, expect, it } from 'vitest';

import { COOLDOWN_MS, justFinished, updateState, type WorkflowRun } from './state';

const now = new Date('2026-10-27T15:00:00Z');
const run = (overrides: Partial<WorkflowRun>): WorkflowRun => ({
  status: 'completed',
  conclusion: 'success',
  createdAt: '2026-10-27T10:00:00Z',
  updatedAt: '2026-10-27T10:20:00Z',
  ...overrides,
});

describe('updateState', () => {
  it('sin corridas previas se puede actualizar', () => {
    expect(updateState(null, now)).toEqual({ state: 'idle', nextAvailableAt: null, lastRun: null });
  });

  it('una corrida en curso bloquea el botón', () => {
    const r = run({ status: 'in_progress', conclusion: null, createdAt: '2026-10-27T14:55:00Z' });
    expect(updateState(r, now).state).toBe('running');
  });

  it('una corrida en cola también cuenta como en curso', () => {
    expect(updateState(run({ status: 'queued', conclusion: null }), now).state).toBe('running');
  });

  it('dentro de los 60 minutos desde la última corrida hay que esperar', () => {
    const r = run({ createdAt: '2026-10-27T14:30:00Z' });
    const result = updateState(r, now);
    expect(result.state).toBe('cooldown');
    expect(result.nextAvailableAt).toBe(new Date(Date.parse('2026-10-27T14:30:00Z') + COOLDOWN_MS).toISOString());
  });

  it('pasado el enfriamiento se puede volver a actualizar', () => {
    expect(updateState(run({ createdAt: '2026-10-27T13:00:00Z' }), now).state).toBe('idle');
  });
});

describe('justFinished', () => {
  it('una corrida exitosa que terminó hace poco renueva los datos de la web', () => {
    expect(justFinished(run({ updatedAt: '2026-10-27T14:50:00Z' }), now)).toBe(true);
  });

  it('no renueva por una corrida vieja, fallida o en curso', () => {
    expect(justFinished(run({ updatedAt: '2026-10-27T10:20:00Z' }), now)).toBe(false);
    expect(justFinished(run({ updatedAt: '2026-10-27T14:50:00Z', conclusion: 'failure' }), now)).toBe(false);
    expect(justFinished(run({ status: 'in_progress', conclusion: null, updatedAt: '2026-10-27T14:59:00Z' }), now)).toBe(
      false,
    );
    expect(justFinished(null, now)).toBe(false);
  });
});
