import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const { getClub, standingsFor } = await import('./parquet');

const FIXTURES = fileURLToPath(new URL('./__fixtures__/', import.meta.url));

// Sirve los archivos sintéticos (zstd, enteros INT64) como si fueran Hugging Face.
function serveFixtures(fail = false) {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) => {
      const name = url.split('/').pop() ?? '';
      return Promise.resolve(fail ? new Response('', { status: 503 }) : new Response(readFileSync(FIXTURES + name)));
    }),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('archivo abierto en Parquet', () => {
  it('arma la ficha del club: partidos en orden, faltantes en null y su tabla por alias', async () => {
    serveFixtures();
    const result = await getClub('arg-club-a');
    expect(result.ok).toBe(true);
    if (!result.ok || !result.data) return;
    const { matches, standings } = result.data;
    expect(matches.map((m) => m.opponent)).toEqual(['Club B', 'Club C']);
    expect(matches[0]?.goals_for).toBe(2); // INT64 → number
    expect(matches[1]?.goals_for).toBeNull(); // el faltante no es 0
    expect(standings.map((t) => t.name)).toEqual(['Grupo A']);
    expect(standings[0]?.rows.map((r) => r.team_name)).toEqual(['Club Á', 'Club B']);
  });

  it('un club que no está devuelve null y una caída devuelve PEL-ARC-001', async () => {
    serveFixtures();
    expect(await getClub('arg-otro')).toEqual({ ok: true, data: null });
    serveFixtures(true);
    expect(await getClub('arg-club-a')).toMatchObject({ ok: false, code: 'PEL-ARC-001' });
  });

  it('compara nombres sin tildes ni mayúsculas', () => {
    const row = { table_name: 'T', rank: 1, team_name: 'CLUB Á', played: null, won: null, drawn: null, lost: null };
    const full = { ...row, goals_for: null, goals_against: null, points: null };
    expect(standingsFor([full], ['club a'])).toHaveLength(1);
    expect(standingsFor([full], ['otro'])).toHaveLength(0);
  });
});
