import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { CHARTS } from './definitions';

// El catálogo es la fuente única (data/chart_catalog.csv): cada gráfico con datos tiene que
// tener su dibujo y ninguno «sin datos» puede dibujarse con datos inventados.
const csv = readFileSync(fileURLToPath(new URL('../../../data/chart_catalog.csv', import.meta.url)), 'utf-8');
const rows = csv
  .trim()
  .split('\n')
  .slice(1)
  .map((line) => line.split(','))
  .map((cells) => ({ id: cells[0] ?? '', available: cells[8] === 'true' }));

describe('definiciones de los gráficos', () => {
  it('cada gráfico con datos del catálogo tiene su dibujo', () => {
    const missing = rows.filter((r) => r.available && !(r.id in CHARTS)).map((r) => r.id);
    expect(missing).toEqual([]);
  });

  it('ningún gráfico sin datos tiene dibujo y no sobran dibujos fuera del catálogo', () => {
    const ids = new Set(rows.map((r) => r.id));
    const unavailable = new Set(rows.filter((r) => !r.available).map((r) => r.id));
    expect(Object.keys(CHARTS).filter((id) => unavailable.has(id) || !ids.has(id))).toEqual([]);
  });

  it('el piso de 50 gráficos con datos se cumple', () => {
    expect(rows.filter((r) => r.available).length).toBeGreaterThanOrEqual(50);
  });
});
