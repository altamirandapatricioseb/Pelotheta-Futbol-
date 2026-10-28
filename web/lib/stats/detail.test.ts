import { describe, expect, it } from 'vitest';

import { currentStreak } from './detail';

describe('currentStreak', () => {
  it('cuenta los partidos seguidos, desde el último, del mismo lado del promedio', () => {
    // Promedio 2: los últimos tres están por encima.
    expect(currentStreak([1, 0, 3, 4, 5], 2)).toEqual({ count: 3, above: true });
    expect(currentStreak([5, 1, 0], 2)).toEqual({ count: 2, above: false });
  });
  it('los n/d no cortan ni suman; un valor igual al promedio corta la racha', () => {
    expect(currentStreak([3, null, 4], 2)).toEqual({ count: 2, above: true });
    expect(currentStreak([3, 2, 4], 2)).toEqual({ count: 1, above: true });
  });
  it('sin datos no hay racha', () => {
    expect(currentStreak([null], 2)).toBeNull();
  });
});
