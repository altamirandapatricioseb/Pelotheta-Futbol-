import { describe, expect, it } from 'vitest';

import { formatDateTime, NOT_AVAILABLE } from './format';

describe('formatDateTime', () => {
  it('usa dd/mm/aaaa y la hora de Buenos Aires', () => {
    // 15:30 UTC son las 12:30 en Buenos Aires (UTC-3, sin horario de verano).
    expect(formatDateTime('2026-10-27T15:30:00Z')).toBe('27/10/2026, 12:30');
  });

  it('devuelve n/d con valores vacíos o inválidos', () => {
    expect(formatDateTime(null)).toBe(NOT_AVAILABLE);
    expect(formatDateTime('no es una fecha')).toBe(NOT_AVAILABLE);
  });
});
