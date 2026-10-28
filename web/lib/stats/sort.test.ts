import { describe, expect, it } from 'vitest';

import { nextSort } from './sort';

describe('nextSort', () => {
  it('un clic en otra columna solo la selecciona: no reordena', () => {
    expect(nextSort(null, 'goles', 'minutos')).toEqual({ selected: 'goles', sort: null });
    expect(nextSort({ id: 'minutos', dir: 'desc' }, 'goles', 'minutos')).toEqual({
      selected: 'goles',
      sort: { id: 'minutos', dir: 'desc' },
    });
  });

  it('clics sobre la columna actual: de menor a mayor, de mayor a menor y sin orden', () => {
    const first = nextSort(null, 'goles', 'goles');
    expect(first.sort).toEqual({ id: 'goles', dir: 'asc' });
    const second = nextSort(first.sort, 'goles', 'goles');
    expect(second.sort).toEqual({ id: 'goles', dir: 'desc' });
    expect(nextSort(second.sort, 'goles', 'goles').sort).toBeNull();
  });

  it('si estaba ordenada por otra columna, la actual arranca de menor a mayor', () => {
    expect(nextSort({ id: 'minutos', dir: 'desc' }, 'goles', 'goles').sort).toEqual({ id: 'goles', dir: 'asc' });
  });
});
