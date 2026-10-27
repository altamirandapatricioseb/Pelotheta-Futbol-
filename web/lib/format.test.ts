import { describe, expect, it } from 'vitest';

import { formatDateTime, formatNumber, formatRelativeDays, NOT_AVAILABLE } from './format';

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

describe('formatNumber y formatRelativeDays', () => {
  it('usa separador de miles argentino y coma decimal', () => {
    expect(formatNumber(1234)).toBe('1.234');
    expect(formatNumber(2.5, 1)).toBe('2,5');
    expect(formatNumber(null)).toBe('n/d');
  });

  it('describe la frescura en días', () => {
    const now = new Date('2026-10-27T12:00:00-03:00');
    expect(formatRelativeDays('2026-10-27T08:00:00-03:00', now)).toBe('hoy');
    expect(formatRelativeDays('2026-10-26T08:00:00-03:00', now)).toBe('hace 1 día');
    expect(formatRelativeDays('2026-10-15T08:00:00-03:00', now)).toBe('hace 12 días');
  });
});
