import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const {
  getClub,
  getClubPlayerMatches,
  getClubTeamMatches,
  getLeagueMatch,
  getLeaguePlayer,
  listClubs,
  predictNext,
  slug,
  standingsFor,
} = await import('./parquet');

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
  it('lee el crudo por jugador del dataset privado solo con token, con el rival del mismo partido', async () => {
    serveFixtures();
    vi.stubEnv('HF_TOKEN', '');
    expect(await getClubPlayerMatches('arg-club-a', 'Club A')).toEqual({ ok: true, data: null });
    vi.stubEnv('HF_TOKEN', 'hf_prueba');
    const result = await getClubPlayerMatches('arg-club-a', 'Club A');
    vi.unstubAllEnvs();
    if (!result.ok || !result.data) throw new Error('sin datos');
    expect(result.data.map((r) => [r.date, r.opponent, r.minutes])).toEqual([
      ['2026-02-01', 'Club B', 90],
      ['2026-03-01', null, 45],
    ]);
    expect(result.data[0]?.stats).toMatchObject({ goals: 1, rating: 7.5, expected_goals: 0.8 });
    expect(result.data[1]?.playerId).toBe('101');
  });

  it('da los partidos de liga de un club con sus estadísticas, con la forma de la tabla de Equipo', async () => {
    serveFixtures();
    const result = await getClubTeamMatches('arg-club-a', 'Club A');
    if (!result.ok) throw new Error(result.detail);
    expect(result.data).toHaveLength(1);
    expect(result.data[0]).toMatchObject({ matchId: 'm1', home: true, goalsFor: 2, opponent: 'Club B' });
    expect(result.data[0]?.stats).toEqual({ matches: 1, points: 3, shots_total: 12, shots_total_against: 5 });
  });

  it('arma la ficha de un partido de liga: goles en orden, planilla, tabla y otros cruces', async () => {
    serveFixtures();
    const result = await getLeagueMatch('arg-club-a', 'm1');
    if (!result.ok || !result.data) throw new Error('sin partido');
    const { result: r, goals, home, away, headToHead } = result.data;
    expect(goals).toEqual([
      { minute: 10, home: true },
      { minute: 70, home: true },
    ]);
    expect([r.referee, r.yellow_away, r.red_home]).toEqual(['Árbitro Uno', 3, null]);
    expect(home.uid).toBe('arg-club-a');
    expect(home.standing?.rank).toBe(1); // «Club Á» de la tabla es «Club A»
    expect(away.standing?.points).toBe(0);
    expect(headToHead.map((m) => m.ext_id)).toEqual(['m9']);
    expect(await getLeagueMatch('arg-club-a', 'm4')).toEqual({ ok: true, data: null }); // StrikerAPI: no es abierta
  });

  it('arma la ficha de un jugador de liga con los de su posición para comparar', async () => {
    serveFixtures();
    const result = await getLeaguePlayer('arg-club-c', '101', '102');
    if (!result.ok || !result.data) throw new Error('sin ficha');
    const { player, peers, versus, league } = result.data;
    expect(player.player_name).toBe('Titular C');
    expect(player.per90_goals).toBe(0.4);
    expect(player.per90_saves).toBeNull();
    expect(league).toBe('arg-liga');
    expect(peers.map((p) => p.player_name)).toEqual(['Otro B', 'Suplente C']);
    expect(versus?.team_name).toBe('Club B');
    expect(await getLeaguePlayer('arg-club-c', '999')).toEqual({ ok: true, data: null });
  });

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
      {
        id: 'm2',
        date: '2026-02-02',
        competition: 'Fecha 1',
        home: false,
        opponent: 'Club B',
        goalsFor: 3,
        goalsAgainst: 1,
      },
      {
        id: 'm3',
        date: '2026-02-09',
        competition: 'Fecha 1',
        home: true,
        opponent: 'Unión',
        goalsFor: null,
        goalsAgainst: null,
      },
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
    // Valor de mercado: solo el club, el más caro primero; el error es la mediana de toda la liga.
    expect(result.data.values.map((v) => v.player_name)).toEqual(['Caro C', 'Barato C']);
    expect(result.data.valueError).toBe(50);
    // Situaciones del club, con los tramos como columnas numéricas y el faltante en null.
    expect(result.data.situation?.racha).toBe('GEG');
    expect(result.data.situation?.favor_76_90).toBe(1);
    expect(result.data.situation?.ppp_recibio_primero).toBeNull();
  });

  it('pronostica el próximo partido del club con el GLM del predictor', () => {
    const strength = (team_name: string, attack: number) => ({
      team_name,
      competition: 'liga',
      estimated: false,
      attack_home: attack,
      defense_home: 1,
      attack_away: attack,
      defense_away: 1,
      elo: 1500,
      form: 1.35,
      squad_value_eur: 1e7,
    });
    const strengths = [
      { ...strength('Club B', 9), competition: 'copa', estimated: true }, // la estimada de copa no cuenta
      strength('Club A', 1.5),
      strength('Club B', 0.7),
      strength('Club C', 1),
    ];
    const fixtures = [
      { match_date: '2026-12-02', stage: null, home_team: 'Club C', away_team: 'Club A' },
      { match_date: '2026-11-29', stage: 'Cuartos', home_team: 'Club B', away_team: 'Club A' },
    ];
    const metrics = { glm: { names: ['ataque', 'defensa', 'local'], beta: [0.2, 1, 1, 0.25] } };
    const isA = (t: string) => t === 'Club A';
    const next = predictNext(fixtures, strengths, metrics, isA);
    expect(next).toMatchObject({ date: '2026-11-29', home: false, opponent: 'Club B', stage: 'Cuartos' });
    if (next === null) throw new Error('sin pronóstico');
    expect(next.win + next.draw + next.loss).toBeCloseTo(1, 9);
    expect(next.win).toBeGreaterThan(next.loss); // ataca el doble que el rival
    expect(predictNext(fixtures, strengths, null, isA)).toBeNull(); // sin modelo no se inventa
    expect(predictNext(fixtures, strengths, metrics, (t) => t === 'Otro')).toBeNull();
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
