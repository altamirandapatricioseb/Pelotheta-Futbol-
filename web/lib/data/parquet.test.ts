import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const { getClub, listClubs, slug, standingsFor } = await import('./parquet');

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
    expect(matches[0]?.goalsFor).toBe(2); // INT64 → number
    expect(matches[1]?.goalsFor).toBeNull(); // el faltante no es 0
    expect(standings.map((t) => t.name)).toEqual(['Grupo A']);
    expect(standings[0]?.rows.map((r) => r.team_name)).toEqual(['Club Á', 'Club B']);
  });

  it('un club que no está devuelve null y una caída devuelve PEL-ARC-001', async () => {
    serveFixtures();
    expect(await getClub('arg-otro')).toEqual({ ok: true, data: null });
    serveFixtures(true);
    expect(await getClub('arg-club-a')).toMatchObject({ ok: false, code: 'PEL-ARC-001' });
  });

  it('un club sin archivo propio sale de los resultados de liga, solo de fuentes abiertas', async () => {
    serveFixtures();
    const result = await getClub('arg-club-c');
    if (!result.ok || !result.data) throw new Error('sin ficha');
    expect(result.data.country).toBe('Argentina');
    expect(result.data.matches).toEqual([
      { date: '2026-02-02', competition: 'Fecha 1', home: false, opponent: 'Club B', goalsFor: 3, goalsAgainst: 1 },
      { date: '2026-02-09', competition: 'Fecha 1', home: true, opponent: 'Unión', goalsFor: null, goalsAgainst: null },
    ]);
    const clubs = await listClubs('ARG');
    // «Club A» y «Club Á» dan el mismo id (como core.slug): una sola entrada. Club X es de StrikerAPI: no entra.
    expect(clubs.ok && clubs.data.map((c) => c.uid)).toEqual(['arg-club-a', 'arg-club-b', 'arg-club-c', 'arg-union']);
  });

  it('suma la fuerza de liga medida y los destacados del club, solo de fuentes abiertas', async () => {
    serveFixtures();
    const result = await getClub('arg-club-c');
    if (!result.ok || !result.data) throw new Error('sin ficha');
    expect(result.data.strength?.elo).toBe(1550); // la de liga, no la estimada de copa
    expect(result.data.leaders.map((l) => l.player_name)).toEqual(['Nueve C']);
    // Plantel: solo el club, más minutos primero; el percentil faltante sigue null.
    expect(result.data.squad.map((p) => p.player_name)).toEqual(['Titular C', 'Suplente C']);
    expect(result.data.squad[0]?.pct_expected_goals).toBeNull();
  });

  it('el id coincide con core.slug de la base', () => {
    expect(slug("Newell's Old Boys")).toBe('newell-s-old-boys');
    expect(slug('Central Córdoba SdE')).toBe('central-cordoba-sde');
    expect(slug('  Unión de Santa Fe ')).toBe('union-de-santa-fe');
  });

  it('compara nombres sin tildes ni mayúsculas', () => {
    const row = { table_name: 'T', rank: 1, team_name: 'CLUB Á', played: null, won: null, drawn: null, lost: null };
    const full = { ...row, goals_for: null, goals_against: null, points: null };
    expect(standingsFor([full], ['club a'])).toHaveLength(1);
    expect(standingsFor([full], ['otro'])).toHaveLength(0);
  });
});
