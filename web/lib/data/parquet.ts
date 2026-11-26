import 'server-only';

import { parquetReadObjects } from 'hyparquet';
import { compressors } from 'hyparquet-compressors';
import { z } from 'zod';

import { lambdas, outcomes, type Profile, scoreMatrix } from '@/lib/models/predictor';

// Capa fría pública (docs/formato-parquet.md). Se lee en el servidor y se cachea una hora: Hugging
// Face recibe un pedido por archivo y hora, no uno por visita (límite anónimo: 3000 cada 5 min por IP).
export const DATASET_URL = 'https://huggingface.co/datasets/pelotheta/pelotheta-futbol';
const BASE = `${DATASET_URL}/resolve/main/`;
const REVALIDATE_S = 3600;

export type ArchiveResult<T> = { ok: true; data: T } | { ok: false; code: 'PEL-ARC-001'; detail: string };

// pyarrow escribe los enteros como INT64 y hyparquet los devuelve como bigint. El faltante sigue null.
const num = z.union([z.number(), z.bigint().transform(Number)]).nullable();
const text = z.string().nullable();

const manifestSchema = z.object({
  archivos: z.array(z.object({ ruta: z.string(), tabla: z.string() })),
});

const identitySchema = z.object({
  uid: z.string(),
  name: z.string(),
  short_name: text,
  country: text,
  country_code: text,
  aliases: text,
});

// Partidos del equipo con todas sus competiciones (hoy solo Boca, desde Supabase).
const teamMatchSchema = z.object({
  match_date: z.string(),
  round_label: text,
  competition_name: text,
  boca_home: z.boolean().nullable(),
  opponent: text,
  goals_for: num,
  goals_against: num,
});

// Todos los partidos de liga (Promiedos): la base para cualquier equipo sin archivo propio.
const leagueResultSchema = z.object({
  source: z.string(),
  stage: text,
  match_date: z.string(),
  home_team: z.string(),
  away_team: z.string(),
  home_goals: num,
  away_goals: num,
});

// Fuerza del predictor (cálculo propio): 1 = promedio de la liga; ataque > 1 convierte más, defensa > 1 recibe más.
const strengthSchema = z.object({
  team_name: z.string(),
  competition: text,
  estimated: z.boolean().nullable(),
  attack_home: num,
  defense_home: num,
  attack_away: num,
  defense_away: num,
  elo: num,
  form: num,
  squad_value_eur: num,
});

const leaderSchema = z.object({
  source: z.string(),
  stat: z.string(),
  rank: num,
  player_name: z.string(),
  team_name: text,
  value: num,
});

// Perfiles de jugadores de toda la liga (cálculo propio sobre Bzzoiro): percentil 0 a 100 cada 90 minutos
// contra los de la misma posición; null cuando la estadística no aplica (atajadas de un delantero).
const profileSchema = z.object({
  player_name: z.string(),
  team_name: z.string(),
  position: text,
  minutes: num,
  matches: num,
  pct_goals: num,
  pct_expected_goals: num,
  pct_expected_assists: num,
  pct_key_pass: num,
  pct_won_tackle: num,
  pct_ball_recovery: num,
  pct_saves: num,
  pct_goals_prevented: num,
});
export type PlayerProfile = z.infer<typeof profileSchema>;

// Valor real (transfermarkt-datasets, CC0) y esperado por el modelo propio, fuera de muestra.
const marketValueSchema = z.object({
  player_name: z.string(),
  team_name: z.string(),
  position_group: text,
  age: num,
  value_eur: num,
  predicted_eur: num,
  gap_pct: num,
});
export type MarketValue = z.infer<typeof marketValueSchema>;

const fixtureSchema = z.object({
  match_date: z.string(),
  stage: text,
  home_team: z.string(),
  away_team: z.string(),
});

// model_run guarda `metrics` como texto JSON; del predictor se usan los β del GLM y los valores por defecto.
const modelRunSchema = z.object({ model: z.string(), metrics: text });
const predictorMetricsSchema = z.object({
  glm: z.object({ names: z.array(z.string()), beta: z.array(z.number()) }),
  league_elo: z.number().optional(),
  default_form: z.number().optional(),
});

export interface NextMatch {
  date: string;
  stage: string | null;
  home: boolean;
  opponent: string;
  win: number;
  draw: number;
  loss: number;
  goalsOwn: number;
  goalsRival: number;
}

const standingSchema = z.object({
  table_name: z.string(),
  rank: num,
  team_name: z.string(),
  played: num,
  won: num,
  drawn: num,
  lost: num,
  goals_for: num,
  goals_against: num,
  points: num,
});

export interface ClubMatch {
  date: string;
  competition: string | null;
  home: boolean | null;
  opponent: string | null;
  goalsFor: number | null;
  goalsAgainst: number | null;
}
export type LeagueResult = z.infer<typeof leagueResultSchema>;
export type StandingRow = z.infer<typeof standingSchema>;
export interface ClubLink {
  uid: string;
  name: string;
}
export interface StandingTable {
  name: string;
  rows: StandingRow[];
}
export interface Club {
  uid: string;
  name: string;
  country: string | null;
  matches: ClubMatch[];
  /** true si los partidos salen de los resultados de liga (sin copas y quizá con fechas faltantes). */
  leagueOnly: boolean;
  standings: StandingTable[];
  strength: z.infer<typeof strengthSchema> | null;
  leaders: z.infer<typeof leaderSchema>[];
  squad: PlayerProfile[];
  next: NextMatch | null;
  values: MarketValue[];
  /** Mediana de |real − esperado| / esperado en toda la liga: cuánto suele errar el modelo. */
  valueError: number | null;
}

const median = (xs: number[]): number | null => {
  const s = xs.toSorted((a, b) => a - b);
  const lo = s[Math.floor((s.length - 1) / 2)];
  const hi = s[Math.ceil((s.length - 1) / 2)];
  return lo === undefined || hi === undefined ? null : (lo + hi) / 2;
};

type Strength = z.infer<typeof strengthSchema>;

/** Pronóstico del próximo partido con el GLM del predictor (la misma cuenta que la página Predictor). */
export function predictNext(
  fixtures: readonly z.infer<typeof fixtureSchema>[],
  strengths: readonly Strength[],
  metrics: z.infer<typeof predictorMetricsSchema> | null,
  isMine: (team: string) => boolean,
): NextMatch | null {
  const fixture = fixtures
    .toSorted((a, b) => a.match_date.localeCompare(b.match_date))
    .find((f) => isMine(f.home_team) || isMine(f.away_team));
  if (!fixture || !metrics) return null;
  const home = isMine(fixture.home_team);
  const opponent = home ? fixture.away_team : fixture.home_team;
  const league = strengths.filter((s) => s.competition === 'liga' && !s.estimated);
  const own = league.find((s) => isMine(s.team_name));
  const rival = league.find((s) => norm(s.team_name) === norm(opponent));
  if (!own || !rival) return null;
  const profile = (s: Strength): Profile => ({
    name: s.team_name,
    attackHome: s.attack_home ?? 1,
    attackAway: s.attack_away ?? 1,
    defenseHome: s.defense_home ?? 1,
    defenseAway: s.defense_away ?? 1,
    value: s.squad_value_eur ?? 1,
    elo: s.elo ?? metrics.league_elo ?? 1500,
    form: s.form ?? metrics.default_form ?? 1.35,
    estimated: false,
    count: 1,
  });
  const lam = lambdas(metrics.glm, profile(own), profile(rival), home ? 'local' : 'visitante');
  const { win, draw, loss } = outcomes(scoreMatrix(lam.own, lam.rival));
  return {
    date: fixture.match_date,
    stage: fixture.stage,
    home,
    opponent,
    win,
    draw,
    loss,
    goalsOwn: lam.own,
    goalsRival: lam.rival,
  };
}

async function fetchFile(path: string): Promise<Response> {
  const res = await fetch(BASE + path, { next: { revalidate: REVALIDATE_S } });
  if (!res.ok) throw new Error(`${path}: HTTP ${String(res.status)}`);
  return res;
}

async function readTable<T>(path: string, schema: z.ZodType<T>): Promise<T[]> {
  const rows = await parquetReadObjects({ file: await (await fetchFile(path)).arrayBuffer(), compressors });
  return rows.map((r) => schema.parse(r));
}

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

/** Las tablas de posiciones donde aparece el club (por nombre, nombre corto o alias), con su orden. */
export function standingsFor(rows: readonly StandingRow[], names: readonly string[]): StandingTable[] {
  const wanted = new Set(names.map(norm));
  const tables = new Map<string, StandingRow[]>();
  for (const r of rows) tables.set(r.table_name, [...(tables.get(r.table_name) ?? []), r]);
  return [...tables]
    .filter(([, t]) => t.some((r) => wanted.has(norm(r.team_name))))
    .map(([name, t]) => ({ name, rows: t.toSorted((a, b) => (a.rank ?? 99) - (b.rank ?? 99)) }));
}

/** Mismo id que `core.slug` en la base: `Unión de Santa Fe` → `union-de-santa-fe`. */
export const slug = (s: string) =>
  norm(s)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');

/** Partidos de liga de un club desde los resultados de toda la liga, desde su punto de vista. */
export function leagueMatchesFor(rows: readonly LeagueResult[], names: readonly string[]): ClubMatch[] {
  const wanted = new Set(names.map(norm));
  return rows.flatMap((r): ClubMatch[] => {
    const home = wanted.has(norm(r.home_team));
    if (!home && !wanted.has(norm(r.away_team))) return [];
    return [
      {
        date: r.match_date,
        competition: r.stage,
        home,
        opponent: home ? r.away_team : r.home_team,
        goalsFor: home ? r.home_goals : r.away_goals,
        goalsAgainst: home ? r.away_goals : r.home_goals,
      },
    ];
  });
}

const fromTeamMatch = (m: z.infer<typeof teamMatchSchema>): ClubMatch => ({
  date: m.match_date,
  competition: [m.competition_name, m.round_label].filter(Boolean).join(' · ') || null,
  home: m.boca_home,
  opponent: m.opponent,
  goalsFor: m.goals_for,
  goalsAgainst: m.goals_against,
});

const failure = (cause: unknown): ArchiveResult<never> => ({
  ok: false,
  code: 'PEL-ARC-001',
  detail: cause instanceof Error ? cause.message : String(cause),
});

const getManifest = async () => manifestSchema.parse(await (await fetchFile('manifest.json')).json());

// shortcut: lee todas las temporadas y ligas del país juntas; con varias temporadas hay que elegir la última.
async function countryTables(country: string) {
  const manifest = await getManifest();
  const files = (tabla: string) =>
    manifest.archivos.filter((f) => f.tabla === tabla && f.ruta.startsWith(`pais=${country}/`)).map((f) => f.ruta);
  const [results, standings] = await Promise.all([
    Promise.all(files('league_result').map((p) => readTable(p, leagueResultSchema))),
    Promise.all(files('league_standing').map((p) => readTable(p, standingSchema))),
  ]);
  return {
    manifest,
    // Solo filas de fuentes abiertas: el archivo público ya no trae otras, pero la ficha cita a Promiedos.
    results: results.flat().filter((r) => r.source === 'promiedos'),
    standings: standings.flat(),
  };
}

/** Clubes con datos en un país (por ahora, los de sus tablas de posiciones), ordenados por nombre. */
export async function listClubs(country = 'ARG'): Promise<ArchiveResult<ClubLink[]>> {
  try {
    const { results, standings } = await countryTables(country);
    const names = new Set([
      ...standings.map((s) => s.team_name),
      ...results.flatMap((r) => [r.home_team, r.away_team]),
    ]);
    const prefix = country.toLowerCase();
    // Dos grafías del mismo club («Unión» y «Union») dan el mismo id: queda una sola.
    const clubs = new Map([...names].map((name) => [`${prefix}-${slug(name)}`, name]));
    const data = [...clubs].map(([uid, name]) => ({ uid, name }));
    return { ok: true, data: data.toSorted((a, b) => a.name.localeCompare(b.name, 'es')) };
  } catch (cause) {
    return failure(cause);
  }
}

/** Ficha pública de un club por su id estable (`arg-boca-juniors`); null si no está en el archivo. */
export async function getClub(uid: string): Promise<ArchiveResult<Club | null>> {
  try {
    const country = uid.slice(0, 3).toUpperCase();
    const [{ manifest, results, standings }, identities] = await Promise.all([
      countryTables(country),
      readTable('referencia/team_identity.parquet', identitySchema),
    ]);
    const known = identities.find((t) => t.uid === uid);
    const found =
      known?.name ??
      [...standings.map((s) => s.team_name), ...results.flatMap((r) => [r.home_team, r.away_team])].find(
        (n) => `${country.toLowerCase()}-${slug(n)}` === uid,
      );
    if (found === undefined) return { ok: true, data: null };
    const aliases = known ? z.array(z.string()).parse(JSON.parse(known.aliases ?? '[]')) : [];
    const names = [found, known?.short_name ?? '', ...aliases].filter(Boolean);
    // Si el club tiene archivo propio (todas sus competiciones) se usa ese; si no, sus partidos de liga.
    const own = manifest.archivos.filter((f) => f.tabla === 'boca_match' && f.ruta.includes(`/equipo=${uid}/`));
    const inCountry = (tabla: string) =>
      manifest.archivos.filter((f) => f.tabla === tabla && f.ruta.startsWith(`pais=${country}/`)).map((f) => f.ruta);
    const [ownMatches, strengths, leaders, profiles, fixtures, runs, marketValues] = await Promise.all([
      Promise.all(own.map((f) => readTable(f.ruta, teamMatchSchema))),
      Promise.all(inCountry('team_strength').map((p) => readTable(p, strengthSchema))),
      Promise.all(inCountry('league_leader').map((p) => readTable(p, leaderSchema))),
      Promise.all(inCountry('league_player_profile').map((p) => readTable(p, profileSchema))),
      Promise.all(inCountry('league_fixture').map((p) => readTable(p, fixtureSchema))),
      Promise.all(inCountry('model_run').map((p) => readTable(p, modelRunSchema))),
      Promise.all(inCountry('league_market_value').map((p) => readTable(p, marketValueSchema))),
    ]);
    const allValues = marketValues.flat();
    const predictor = runs.flat().find((r) => r.model === 'predictor_partido')?.metrics;
    const parsed = predictor ? predictorMetricsSchema.safeParse(JSON.parse(predictor)) : null;
    const matches = own.length ? ownMatches.flat().map(fromTeamMatch) : leagueMatchesFor(results, names);
    const wanted = new Set(names.map(norm));
    const mine = (team: string | null) => team !== null && wanted.has(norm(team));
    return {
      ok: true,
      data: {
        uid,
        name: found,
        country: known?.country ?? identities.find((t) => t.country_code === country)?.country ?? null,
        matches: matches.toSorted((a, b) => a.date.localeCompare(b.date)),
        leagueOnly: own.length === 0,
        standings: standingsFor(standings, names),
        // La fuerza de liga medida (no la estimada para rivales de copa).
        strength: strengths.flat().find((s) => s.competition === 'liga' && !s.estimated && mine(s.team_name)) ?? null,
        leaders: leaders
          .flat()
          .filter((l) => l.source === 'promiedos' && mine(l.team_name))
          .toSorted((a, b) => a.stat.localeCompare(b.stat) || (a.rank ?? 99) - (b.rank ?? 99)),
        squad: profiles
          .flat()
          .filter((p) => mine(p.team_name))
          .toSorted((a, b) => (b.minutes ?? 0) - (a.minutes ?? 0)),
        next: predictNext(fixtures.flat(), strengths.flat(), parsed?.success ? parsed.data : null, mine),
        values: allValues.filter((v) => mine(v.team_name)).toSorted((a, b) => (b.value_eur ?? 0) - (a.value_eur ?? 0)),
        valueError: median(allValues.flatMap((v) => (v.gap_pct === null ? [] : [Math.abs(v.gap_pct)]))),
      },
    };
  } catch (cause) {
    return failure(cause);
  }
}
